import asyncio
import json
import logging
from uuid import uuid4, UUID
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, Form, status

logger = logging.getLogger(__name__)
from fastapi.responses import StreamingResponse
from typing import Optional, List
from sqlalchemy.orm import Session
from app.core.app_database import get_app_db, AppSessionLocal
from app.core.auth import get_current_user, get_current_user_from_query, get_principal
from app.utils.feature_flags import get_flags_for_role
from app.schemas.config_schema import JobType, Action
from app.schemas.job_schema import JobResponse, JobStepResponse, JobCreatedResponse, FeedbackRequest, JobListResponse
import app.services.job_service as job_service
from app.services.audit_service import log_audit
from app.services.pipeline_router import resolve_pipeline_name, get_agent_input_topic, _fallback_topic, get_pipeline_definition_id, _load_registry
from app.utils.kafka import get_producer
from app.utils.config_client import get_config
from app.utils.redis_client import tail_stream, read_aggregator_partial

router = APIRouter(prefix="/v1/jobs", tags=["jobs"])

ALLOWED_AUDIO_TYPES = {
    "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
    "audio/flac", "audio/aac", "audio/aiff", "audio/alac", "audio/ogg",
}


def _tenant_id_for(user: dict) -> UUID | None:
    """Return the user's UUID for non-admins (scopes queries to their own jobs).
    Returns None for admins (no filter — they see everything)."""
    if user.get("role") == "admin":
        return None
    try:
        return UUID(user["sub"])
    except (KeyError, ValueError):
        return None


@router.post("/", response_model=JobCreatedResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_job(
    request: Request,
    file: Optional[UploadFile] = None,
    text: Optional[str] = Form(""),
    job: List[str] = Form(...),
    action: Optional[List[str]] = Form(None),
    pipeline_id: Optional[UUID] = Form(None),
    model_name: str = Form("whisperx"),
    target_lang: Optional[str] = Form("en"),
    principal: dict = Depends(get_principal),
    db: Session = Depends(get_app_db),
):
    """Submit a job for async processing. Returns 202 with job_id immediately.

    Auth: accepts dashboard JWT (HS256), Authentik JWT (RS256), or mk_ access key.
    Access keys are restricted to the pipeline_ids listed on the key.
    """
    producer = None
    # Normalize across auth types
    user = principal
    try:
        tenant_id = UUID(principal["sub"]) if principal.get("auth_type") != "access_key" else UUID(principal["tenant_id"])
    except (KeyError, ValueError):
        tenant_id = None
    access_key_id = principal.get("access_key_id")
    allowed_pipelines = principal.get("allowed_pipeline_ids")  # None = unrestricted

    try:
        job_id = str(uuid4())

        # --- Normalize comma-separated form values ---
        flat_jobs = []
        for j in job:
            flat_jobs.extend(j.split(","))
        job = [j.strip() for j in flat_jobs if j.strip()]

        for j in job:
            if j not in [item.value for item in JobType]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"{j} is not a valid job type. Valid types: summarise, transcribe",
                )

        if action:
            flat_actions = []
            for a in action:
                flat_actions.extend(a.split(","))
            action = [a.strip() for a in flat_actions if a.strip()]
            for a in action:
                if a not in [item.value for item in Action]:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"{a} is not a valid action. Valid actions: soap, prescription",
                    )

        
        if pipeline_id:
            from app.services.pipeline_router import get_pipeline_name_by_id
            pipeline_name = get_pipeline_name_by_id(pipeline_id)
            if not pipeline_name:
                raise HTTPException(status_code=404, detail=f"Pipeline definition {pipeline_id} not found")
            pipeline_definition_id = pipeline_id
            # Derive step list from graph for job record display
            input_type = "audio" if any(j in ("transcribe", "preprocess") for j in job) else "text"
            _, pipeline = resolve_pipeline_name(input_type, action or [])
        else:
            # Resolve pipeline from input type
            input_type = "audio" if any(j in ("transcribe", "preprocess") for j in job) else "text"
            pipeline_name, pipeline = resolve_pipeline_name(input_type, action or [])

            _graph_id_str = get_pipeline_definition_id(pipeline_name)
            pipeline_definition_id = None
            if _graph_id_str:
                try:
                    pipeline_definition_id = UUID(_graph_id_str)
                except ValueError:
                    pass

        # Access key pipeline restriction — reject if requested pipeline not in allowed set
        if allowed_pipelines is not None and pipeline_name not in allowed_pipelines:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access key does not permit pipeline '{pipeline_name}'",
            )

        input_meta = {
            "model_name": model_name,
            "target_lang": target_lang,
            "actions": action,
        }
        timeout = int(get_config("job_timeout_seconds", 120))

        producer = await get_producer()

        first_step = pipeline[0] if pipeline else None

        # Feature flag enforcement — checked inline because the flag depends on job type
        _enabled = get_flags_for_role(user.get("role", "user"))
        if first_step in ("transcribe", "preprocess") and "audio_job" not in _enabled:
            raise HTTPException(status_code=403, detail="Feature 'audio_job' is not available for your account.")
        if first_step == "summarise" and "text_job" not in _enabled:
            raise HTTPException(status_code=403, detail="Feature 'text_job' is not available for your account.")
        if "reason" in pipeline and "reasoning" not in _enabled:
            raise HTTPException(status_code=403, detail="Feature 'reasoning' is not available for your account.")

        if first_step in ("transcribe", "preprocess"):
            if not file:
                raise HTTPException(status_code=400, detail="Specify audio file for transcription")
            if file.content_type not in ALLOWED_AUDIO_TYPES:
                raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")
            if action == [] and "summarise" in pipeline:
                raise HTTPException(status_code=400, detail="Specify action for summary")

            UPLOAD_DIR = Path("/app/uploads/audio")
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            filename = f"{job_id}_{file.filename}"
            path = UPLOAD_DIR / filename

            file_bytes = await file.read()
            if not file_bytes:
                raise HTTPException(status_code=400, detail="Uploaded file is empty")
            with open(path, "wb") as f:
                f.write(file_bytes)

            input_meta["file_path"] = str(path)
            input_meta["filename"] = file.filename

            job_service.create_job(db, job_id, pipeline, input_meta, timeout, tenant_id=tenant_id, access_key_id=access_key_id, pipeline_definition_id=pipeline_definition_id)

            # Route to preprocessor if pipeline starts with preprocess, else directly to STT
            if first_step == "preprocess":
                first_topic = get_agent_input_topic("audio_preprocessor") or _fallback_topic("preprocess") or "audio.uploaded"
            else:
                first_topic = get_agent_input_topic("stt") or _fallback_topic("transcribe") or "audio.uploaded"
            await producer.send_and_wait(first_topic, {
                "job_id": job_id, "step_name": first_step,
                "file_path": str(path), "model_name": model_name,
                "target_lang": target_lang, "action": action,
            })

        elif first_step == "summarise":
            if not text or len(text.strip()) == 0:
                raise HTTPException(status_code=400, detail="Specify text for summarisation")
            if action == []:
                raise HTTPException(status_code=400, detail="Specify action for summary")

            job_service.create_job(db, job_id, pipeline, input_meta, timeout, tenant_id=tenant_id, access_key_id=access_key_id, pipeline_definition_id=pipeline_definition_id)

            first_topic = get_agent_input_topic("nlp") or _fallback_topic("summarise") or "transcript.generated"
            await producer.send_and_wait(first_topic, {
                "job_id": job_id, "step_name": "summarise",
                "transcript": text, "action": action,
            })

        else:
            raise HTTPException(status_code=400, detail="No valid job specified")

        log_audit(
            db,
            actor_type=principal.get("auth_type", "jwt"),
            action="job.create",
            resource=f"job:{job_id}",
            user_id=principal.get("username") or principal.get("sub"),
            tenant_id=tenant_id,
            ip_address=request.client.host if request.client else None,
            detail={"pipeline": pipeline_name, "job_types": job},
        )
        return JobCreatedResponse(
            job_id=job_id,
            status="in_progress",
            message="Job submitted. Poll GET /v1/jobs/{job_id} for results.",
        )

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unhandled error in create_job")
        raise HTTPException(status_code=500, detail="Internal server error")
    finally:
        if producer:
            await producer.stop()


@router.get("/", response_model=JobListResponse)
def list_jobs(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_app_db),
    user: dict = Depends(get_current_user),
):
    """List jobs. Admins see all jobs; regular users see only their own."""
    return job_service.list_jobs(
        db, status=status, limit=limit, offset=offset,
        tenant_id=_tenant_id_for(user),
    )


@router.get("/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    db: Session = Depends(get_app_db),
    user: dict = Depends(get_current_user),
):
    """Poll job status and results. Non-admins can only access their own jobs."""
    job = job_service.get_job(db, job_id, tenant_id=_tenant_id_for(user))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}/steps", response_model=list[JobStepResponse])
def get_job_steps(
    job_id: str,
    db: Session = Depends(get_app_db),
    user: dict = Depends(get_current_user),
):
    """Get per-step status and results for a job."""
    job = job_service.get_job(db, job_id, tenant_id=_tenant_id_for(user))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job_service.get_job_steps(db, job_id)


_SSE_POLL_INTERVAL = 0.5   # seconds between DB polls
_SSE_MAX_SECONDS = 600     # 10 minutes hard timeout


@router.get("/{job_id}/stream")
async def stream_job(
    job_id: str,
    user: dict = Depends(get_current_user_from_query),
):
    """
    SSE endpoint — streams job/step state changes as they happen.

    Event types:
      job.started     — initial snapshot when connection is established
      step.started    — a pipeline step moved to in_progress
      step.completed  — a pipeline step finished successfully
      step.failed     — a pipeline step failed
      job.completed   — terminal: job finished, result attached
      job.failed      — terminal: job failed, error attached
      heartbeat       — sent every 15s to keep the connection alive

    Auth: send the JWT as ?token=<jwt> (EventSource can't set headers).
    """
    # Capture tenant filter in closure so the generator enforces ownership
    tenant_id = _tenant_id_for(user)

    async def event_generator():
        db = AppSessionLocal()
        try:
            job = job_service.get_job(db, job_id, tenant_id=tenant_id)
            if not job:
                yield _sse("error", {"detail": "Job not found"})
                return

            # Send initial snapshot
            steps = job_service.get_job_steps(db, job_id)
            yield _sse("job.started", {
                "job_id": job_id,
                "status": job.status,
                "pipeline": job.pipeline,
                "steps": [_step_dict(s) for s in steps],
            })

            # If the job is already in a terminal state when the client connects,
            # emit the terminal event immediately and close the stream.
            # Without this the diff loop below never fires (last_job_status == job.status
            # from the start) so the stream stays open forever sending heartbeats.
            if job.status == "completed":
                yield _sse("job.completed", {
                    "job_id": job_id,
                    "status": "completed",
                    "result": job.result,
                })
                return
            if job.status == "failed":
                yield _sse("job.failed", {
                    "job_id": job_id,
                    "status": "failed",
                    "error": job.error,
                })
                return
            if job.status == "timed_out":
                yield _sse("job.failed", {
                    "job_id": job_id,
                    "status": "timed_out",
                    "error": "Job timed out",
                })
                return

            # Track last-seen state to emit only diffs
            last_step_statuses: dict[str, str] = {s.step_name: s.status for s in steps}
            last_job_status = job.status
            elapsed = 0.0
            heartbeat_countdown = 15.0
            # Redis token streaming: only active while the 'reason' step is in_progress
            _redis_task: asyncio.Task | None = None
            _agg_partial_last_id: str = "0"

            async def _stream_tokens():
                """Background coroutine: relay Redis tokens as SSE token.stream events."""
                try:
                    async for fields in tail_stream(job_id):
                        if fields is None:
                            continue  # Redis poll timeout — loop again
                        token = fields.get("token")
                        if token:
                            # We yield into a shared queue; the main loop drains it
                            _token_queue.put_nowait(token)
                        if fields.get("done") == "1":
                            break
                except asyncio.CancelledError:
                    pass

            _token_queue: asyncio.Queue = asyncio.Queue()

            while elapsed < _SSE_MAX_SECONDS:
                await asyncio.sleep(_SSE_POLL_INTERVAL)
                elapsed += _SSE_POLL_INTERVAL
                heartbeat_countdown -= _SSE_POLL_INTERVAL

                # Re-query in the same session (expire_on_commit keeps it fresh)
                db.expire_all()
                job = job_service.get_job(db, job_id)
                if not job:
                    break

                steps = job_service.get_job_steps(db, job_id)

                # Emit step-level diffs
                for step in steps:
                    prev = last_step_statuses.get(step.step_name)
                    if prev != step.status:
                        last_step_statuses[step.step_name] = step.status
                        if step.status == "in_progress":
                            yield _sse("step.started", {
                                "job_id": job_id,
                                "step": step.step_name,
                                "agent": step.agent_name,
                            })
                            # Start Redis token stream when the reason step begins
                            if step.step_name == "reason" and _redis_task is None:
                                _redis_task = asyncio.create_task(_stream_tokens())
                        elif step.status == "completed":
                            yield _sse("step.completed", {
                                "job_id": job_id,
                                "step": step.step_name,
                                "status": "completed",
                            })
                        elif step.status == "failed":
                            yield _sse("step.failed", {
                                "job_id": job_id,
                                "step": step.step_name,
                                "error": step.error,
                            })

                # Drain token queue and emit token.stream events
                while not _token_queue.empty():
                    token = _token_queue.get_nowait()
                    yield _sse("token.stream", {"job_id": job_id, "step": "reason", "token": token})

                # Emit aggregator.partial events (non-blocking poll)
                _agg_partial_last_id, partial_events = await read_aggregator_partial(job_id, _agg_partial_last_id)
                for evt in partial_events:
                    yield _sse("aggregator.partial", evt)

                # Emit job-level terminal events
                if job.status != last_job_status:
                    last_job_status = job.status
                    if job.status == "completed":
                        yield _sse("job.completed", {
                            "job_id": job_id,
                            "status": "completed",
                            "result": job.result,
                        })
                        return
                    elif job.status == "failed":
                        yield _sse("job.failed", {
                            "job_id": job_id,
                            "status": "failed",
                            "error": job.error,
                        })
                        return

                # Heartbeat
                if heartbeat_countdown <= 0:
                    yield _sse("heartbeat", {"job_id": job_id})
                    heartbeat_countdown = 15.0

            # Timeout
            yield _sse("error", {"detail": "SSE stream timeout"})

        except asyncio.CancelledError:
            pass  # client disconnected — normal
        finally:
            if _redis_task and not _redis_task.done():
                _redis_task.cancel()
            db.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # disables nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.post("/{job_id}/feedback", status_code=status.HTTP_201_CREATED)
def submit_feedback(
    job_id: str,
    body: FeedbackRequest,
    db: Session = Depends(get_app_db),
    user: dict = Depends(get_current_user),
):
    """Submit clinician feedback (star rating + optional correction) for a result section."""
    from app.models.feedback import OutputFeedback
    job = job_service.get_job(db, job_id, tenant_id=_tenant_id_for(user))
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "completed":
        raise HTTPException(status_code=400, detail="Feedback can only be submitted for completed jobs")
    if not (1 <= body.rating <= 5):
        raise HTTPException(status_code=422, detail="Rating must be between 1 and 5")
    fb = OutputFeedback(
        job_id=job_id,
        tenant_id=str(user.get("sub", "")),
        output_type=body.output_type,
        field=body.field,
        rating=body.rating,
        correction=body.correction,
        submitted_by=str(user.get("sub", "")),
    )
    db.add(fb)
    db.commit()
    return {"ok": True}


@router.post("/refresh-cache", tags=["internal"])
async def refresh_pipeline_cache(user=Depends(get_current_user)):
    """Reload agent registry + pipeline graphs from ConfigService."""
    role = user.get("role", "user")
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin required")
    await _load_registry()
    return {"ok": True, "message": "Pipeline cache refreshed"}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _step_dict(step) -> dict:
    return {
        "step_name": step.step_name,
        "agent_name": step.agent_name,
        "status": step.status,
        "error": step.error,
    }
