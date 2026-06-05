import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID
from sqlalchemy.orm import Session
from app.models.job import Job, JobStep

logger = logging.getLogger(__name__)


def create_job(
    db: Session,
    job_id: str,
    pipeline: list[str],
    input_meta: dict,
    timeout_seconds: int = 120,
    tenant_id: UUID | None = None,
    access_key_id: str | None = None,
    pipeline_definition_id: UUID | None = None,
) -> Job:
    from uuid import UUID as _UUID
    now = datetime.now(timezone.utc)
    _access_key_uuid = None
    if access_key_id:
        try:
            _access_key_uuid = _UUID(access_key_id)
        except (ValueError, AttributeError):
            pass
    job = Job(
        job_id=job_id,
        tenant_id=tenant_id,
        access_key_id=_access_key_uuid,
        pipeline_definition_id=pipeline_definition_id,
        status="in_progress",
        pipeline=pipeline,
        current_step=pipeline[0] if pipeline else None,
        input_meta=input_meta,
        created_at=now,
        updated_at=now,
        timeout_at=now + timedelta(seconds=timeout_seconds),
    )
    db.add(job)

    # Pre-create step records
    step_objects = []
    for step_name in pipeline:
        step = JobStep(
            job_id=job_id,
            step_name=step_name,
            agent_name=_agent_for_step(step_name),
            status="pending",
        )
        db.add(step)
        step_objects.append(step)

    # Mark first step as in_progress
    if step_objects:
        step_objects[0].status = "in_progress"
        step_objects[0].started_at = now

    db.commit()
    db.refresh(job)
    return job


def list_jobs(
    db: Session,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    tenant_id: UUID | None = None,
) -> dict:
    q = db.query(Job).order_by(Job.created_at.desc())
    if status:
        q = q.filter(Job.status == status)
    if tenant_id is not None:
        q = q.filter(Job.tenant_id == tenant_id)

    total = q.count()
    failed_count = q.filter(Job.status.in_(["failed", "error"])).count()
    items = q.offset(offset).limit(limit).all()

   
    from app.services.pipeline_router import get_pipeline_name_by_id
    for item in items:
        item.pipeline_id = item.pipeline_definition_id
        if item.pipeline_definition_id:
            item.pipeline_name = get_pipeline_name_by_id(item.pipeline_definition_id)
        else:
            
            item.pipeline_name = " → ".join(item.pipeline) if item.pipeline else "Unknown"

    return {"items": items, "total": total, "failed_count": failed_count}


def get_job(db: Session, job_id: str, tenant_id: UUID | None = None) -> Job | None:
    q = db.query(Job).filter(Job.job_id == job_id)
    if tenant_id is not None:
        q = q.filter(Job.tenant_id == tenant_id)
    job = q.first()

    if job:
        from app.services.pipeline_router import get_pipeline_name_by_id
        job.pipeline_id = job.pipeline_definition_id
        if job.pipeline_definition_id:
            job.pipeline_name = get_pipeline_name_by_id(job.pipeline_definition_id)
        else:
            job.pipeline_name = " → ".join(job.pipeline) if job.pipeline else "Unknown"

    return job


def get_job_steps(db: Session, job_id: str) -> list[JobStep]:
    return db.query(JobStep).filter(JobStep.job_id == job_id).order_by(JobStep.id).all()


def complete_step(db: Session, job_id: str, step_name: str, output: dict | None = None):
    """Mark a step as completed and advance the job to the next step."""
    now = datetime.now(timezone.utc)
    step = (
        db.query(JobStep)
        .filter(JobStep.job_id == job_id, JobStep.step_name == step_name)
        .first()
    )
    if step:
        step.status = "completed"
        step.output = output
        step.completed_at = now
    else:
        # Graph-mode job: step wasn't pre-created, upsert it now
        step = JobStep(
            job_id=job_id,
            step_name=step_name,
            agent_name=_agent_for_step(step_name),
            status="completed",
            output=output,
            started_at=now,
            completed_at=now,
        )
        db.add(step)

    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        db.commit()
        return

    pipeline = job.pipeline or []
    try:
        idx = pipeline.index(step_name)
        if idx + 1 < len(pipeline):
            next_step_name = pipeline[idx + 1]
            job.current_step = next_step_name
            next_step = (
                db.query(JobStep)
                .filter(JobStep.job_id == job_id, JobStep.step_name == next_step_name)
                .first()
            )
            if next_step:
                next_step.status = "in_progress"
                next_step.started_at = now
    except ValueError:
        pass

    job.updated_at = now
    db.commit()


def complete_job(db: Session, job_id: str, result: dict | None = None):
    """Mark the entire job as completed with the final result."""
    now = datetime.now(timezone.utc)
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        return

    # Mark any lingering in_progress/pending steps as completed
    db.query(JobStep).filter(
        JobStep.job_id == job_id,
        JobStep.status.in_(["in_progress", "pending"]),
    ).update({"status": "completed", "completed_at": now}, synchronize_session=False)

    job.status = "completed"
    job.result = result
    job.current_step = None
    job.updated_at = now
    db.commit()


def fail_job(db: Session, job_id: str, error: str, status_code: int = 500):
    now = datetime.now(timezone.utc)
    job = db.query(Job).filter(Job.job_id == job_id).first()
    if not job:
        return

    job.status = "failed"
    job.error = error
    job.updated_at = now

    # Mark current step as failed
    if job.current_step:
        step = (
            db.query(JobStep)
            .filter(JobStep.job_id == job_id, JobStep.step_name == job.current_step)
            .first()
        )
        if step:
            step.status = "failed"
            step.error = error
            step.completed_at = now

    db.commit()


def get_step(db: Session, job_id: str, step_name: str) -> "JobStep | None":
    return (
        db.query(JobStep)
        .filter(JobStep.job_id == job_id, JobStep.step_name == step_name)
        .first()
    )


def increment_step_retry(db: Session, job_id: str, step_name: str) -> int:
    """Increment retry_count on a step and return the new count."""
    step = get_step(db, job_id, step_name)
    if step:
        step.retry_count = (step.retry_count or 0) + 1
        db.commit()
        return step.retry_count
    return 0


def fail_step(db: Session, job_id: str, step_name: str, error: str):
    """Mark a specific step as failed."""
    now = datetime.now(timezone.utc)
    step = get_step(db, job_id, step_name)
    if step:
        step.status = "failed"
        step.error = error
        step.completed_at = now
        db.commit()


def _agent_for_step(step_name: str) -> str:
    """Map step names to agent names."""
    mapping = {
        "preprocess": "audio_preprocessor",
        "transcribe": "stt",
        "validate_stt": "stt-validator",
        "summarise": "nlp",
        "validate_nlp": "nlp-validator",
        "reason": "reasoning-agent",
        "validate_reasoning": "reasoning-validator",
    }
    return mapping.get(step_name, step_name)
