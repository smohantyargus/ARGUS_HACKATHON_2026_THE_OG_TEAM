import asyncio
import logging
from uuid import uuid4
from fastapi import HTTPException, UploadFile, status
from app.schemas.config_schema import JobType, Action
from app.utils.kafka import get_producer
from app.services.job_result_store import job_result_store
from app.utils.config_client import get_config
from pathlib import Path

logger = logging.getLogger(__name__)

ALLOWED_AUDIO_TYPES = {
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/flac",
    "audio/aac",
    "audio/aiff",
    "audio/alac",
    "audio/ogg",
}

async def upload_service(
    file: UploadFile,
    text: str,
    job: list[str],
    action: list[str],
    model_name: str = "whisperx",
    target_lang: str | None = None,
):
    producer = None
    try:
        producer = await get_producer()
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
                    detail=f"{j} is not a valid job type. Valid Job Types are: summarise, transcribe",
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
                        detail=f"{a} is not a valid action. Valid actions are: soap, prescription",
                    )

        # --- Validate and publish based on job type ---
        if "transcribe" in job:
            if not file:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Specify audio file for transcription",
                )
            if file.content_type not in ALLOWED_AUDIO_TYPES:
                raise HTTPException(
                    status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                    detail=f"Unsupported file type: {file.content_type}",
                )
            if action == [] and "summarise" in job:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Specify action soap or prescription for summary",
                )

            UPLOAD_DIR = Path("/app/uploads/audio")
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            filename = f"{job_id}_{file.filename}"
            path = UPLOAD_DIR / filename

            file_bytes = await file.read()
            if not file_bytes:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Uploaded file is empty",
                )

            with open(path, "wb") as f:
                f.write(file_bytes)

            # Register future BEFORE publishing so we never miss the response
            future = job_result_store.register(job_id)

            await producer.send_and_wait(
                "audio.uploaded",
                {
                    "job": job,
                    "job_id": job_id,
                    "file_path": str(path),
                    "model_name": model_name,
                    "target_lang": target_lang,
                    "action": action,
                },
            )

        elif "summarise" in job:
            if not text or len(text.strip()) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Specify text for summarisation",
                )
            if action == []:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Specify action soap or prescription for summary",
                )

            future = job_result_store.register(job_id)

            await producer.send_and_wait(
                "transcript.generated",
                {
                    "job_id": job_id,
                    "job": job,
                    "transcript": text,
                    "action": action,
                },
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid job specified. Provide 'transcribe' or 'summarise'.",
            )

        # --- Wait for the pipeline result ---
        job_timeout = get_config("job_timeout_seconds", 120)
        try:
            result = await asyncio.wait_for(future, timeout=float(job_timeout))
        except asyncio.TimeoutError:
            job_result_store.cancel(job_id)
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Processing timed out",
            )

        if result.get("status_code") and result["status_code"] != 200:
            return {
                "job_id": job_id,
                "status_code": result["status_code"],
                "detail": result.get("error_detail"),
            }

        return {
            "job_id": job_id,
            "data": result.get("data"),
        }

    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error in upload_service")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error",
        )
    finally:
        if producer:
            await producer.stop()
