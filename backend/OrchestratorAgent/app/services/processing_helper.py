"""
ProcessingHelper — single entry point for submitting any job.

Pipeline-driven: caller specifies `pipeline_id` (UUID); the pipeline graph's
nodes (with their `config_override` values) drive all per-step behavior.
No action-based pipeline auto-selection.

Callers provide:
  - input_type  : "audio" | "text"
  - pipeline_id : UUID of the pipeline definition to run
  - content     : file_path (audio) or transcript string (text)
  - metadata    : model_name, target_lang, filename

Returns: (job_id, pipeline_name)
"""
from __future__ import annotations

import logging
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services import job_service
from app.services.pipeline_router import (
    get_pipeline_name_by_id,
    get_agent_input_topic,
    get_entry_node,
    get_pipeline_node_order,
    _fallback_topic,
)
from app.utils.config_client import get_config
from app.utils.feature_flags import get_flags_for_role
from app.utils.kafka import get_producer

logger = logging.getLogger(__name__)


class ProcessingHelper:
    """
    Generic job dispatcher.

    Usage:
        job_id, pipeline_name = await ProcessingHelper.process(
            db=db,
            principal=principal,
            input_type="audio",
            pipeline_id="<uuid>",
            content="/app/uploads/audio/abc.wav",
            model_name="whisperx",
            target_lang="en",
            filename="consult.wav",
        )
    """

    @staticmethod
    async def process(
        db: Session,
        principal: dict,
        input_type: str,                   # "audio" | "text"
        content: str,                      # file_path (audio) or transcript (text)
        pipeline_id: str,
        model_name: str = "whisperx",
        target_lang: str = "en",
        filename: str | None = None,
        job_id: str | None = None,         # pre-assigned job_id (caller registers future first)
        region: str = "metro",             # scenario region; threaded into data_queries params
        extra_context: dict | None = None, # arbitrary extra fields injected into first Kafka msg
    ) -> tuple[str, str]:
        """Submit job. Returns (job_id, pipeline_name)."""

        if not pipeline_id:
            raise ValueError("pipeline_id is required")

        # ── Auth metadata ────────────────────────────────────────────────────
        try:
            tenant_id: UUID | None = UUID(principal["sub"])
        except (KeyError, ValueError):
            tenant_id = None
        access_key_id: str | None = principal.get("access_key_id")
        allowed_pipelines: list[str] | None = principal.get("allowed_pipeline_ids")
        role: str = principal.get("role", "user")

        # ── Pipeline lookup ──────────────────────────────────────────────────
        pipeline_name = get_pipeline_name_by_id(pipeline_id)
        if not pipeline_name:
            raise ValueError(f"Pipeline {pipeline_id!r} not found in graph cache")

        try:
            pipeline_definition_id: UUID = UUID(pipeline_id)
        except ValueError:
            raise ValueError(f"Invalid pipeline_id: {pipeline_id!r}")

        # ── Access key restriction ────────────────────────────────────────────
        if allowed_pipelines is not None and pipeline_name not in allowed_pipelines:
            raise PermissionError(f"Access key does not permit pipeline '{pipeline_name}'")

        # ── Entry node from graph drives first_step/topic/config ──────────────
        entry = get_entry_node(pipeline_definition_id)
        if entry:
            first_step = entry.node_key
            first_topic_override = entry.input_topic or None
            first_config = entry.config_override or {}
        else:
            # Fallback: graph not loaded yet (cold start) — best-effort defaults
            first_step = "preprocess" if input_type == "audio" else "summarise"
            first_topic_override = None
            first_config = {}

        # ── Feature flag check (JWT users only) ──────────────────────────────
        if principal.get("auth_type") == "jwt":
            enabled_flags = get_flags_for_role(role)
            if first_step in ("transcribe", "preprocess") and "audio_job" not in enabled_flags:
                raise PermissionError("Feature 'audio_job' is not available for your account.")
            if first_step == "summarise" and "text_job" not in enabled_flags:
                raise PermissionError("Feature 'text_job' is not available for your account.")

        # ── Job record ───────────────────────────────────────────────────────
        job_id = job_id or str(uuid4())
        timeout = int(get_config("job_timeout_seconds", 120))
        input_meta: dict = {
            "model_name": model_name,
            "target_lang": target_lang,
            "input_type": input_type,
        }
        if input_type == "audio":
            input_meta["file_path"] = content
            if filename:
                input_meta["filename"] = filename
        else:
            input_meta["transcript"] = content

        pipeline_steps = get_pipeline_node_order(pipeline_definition_id)
        job_service.create_job(
            db, job_id, pipeline_steps, input_meta, timeout,
            tenant_id=tenant_id,
            access_key_id=access_key_id,
            pipeline_definition_id=pipeline_definition_id,
        )

        # ── Kafka publish ─────────────────────────────────────────────────────
        producer = await get_producer()
        try:
            if input_type == "audio":
                if first_topic_override:
                    topic = first_topic_override
                elif first_step == "preprocess":
                    topic = get_agent_input_topic("audio_preprocessor") or _fallback_topic("preprocess") or "audio.uploaded"
                else:
                    topic = get_agent_input_topic("stt") or _fallback_topic("transcribe") or "audio.uploaded"
                await producer.send_and_wait(topic, {
                    "job_id": job_id,
                    "step_name": first_step,
                    "file_path": content,
                    "model_name": model_name,
                    "target_lang": target_lang,
                    "config": first_config,
                })
            else:
                topic = first_topic_override or get_agent_input_topic("nlp") or _fallback_topic("summarise") or "transcript.generated"
                await producer.send_and_wait(topic, {
                    **(extra_context or {}),
                    "job_id": job_id,
                    "step_name": first_step,
                    "transcript": content,
                    "region": region,
                    "config": first_config,
                })
        finally:
            await producer.stop()

        logger.info("ProcessingHelper: job %s submitted — pipeline=%s first_step=%s", job_id, pipeline_name, first_step)
        return job_id, pipeline_name
