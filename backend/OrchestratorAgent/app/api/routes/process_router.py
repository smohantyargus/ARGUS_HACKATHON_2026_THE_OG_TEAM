"""
POST /v1/process — generic processing endpoint.

Pipeline is the single source of truth: client specifies `pipeline_id` (UUID),
each pipeline encodes what it does via per-node `config_override` (e.g.
`{"action": "soap"}` on an NLP node). No more action-based auto-routing.

Examples:

  # Text job
  curl -X POST /v1/process/text \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"text": "Patient reports...", "pipeline_id": "<uuid>"}'

  # Audio job
  curl -X POST /v1/process/audio \
    -H "Authorization: Bearer <token>" \
    -F "file=@consult.wav" \
    -F "pipeline_id=<uuid>"
"""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, UploadFile, Form, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.app_database import get_app_db
from app.core.auth import get_principal
from app.services.processing_helper import ProcessingHelper
from app.services.job_result_store import job_result_store
from app.utils.config_client import get_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/process", tags=["process"])

ALLOWED_AUDIO_TYPES = {
    "audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3",
    "audio/flac", "audio/aac", "audio/aiff", "audio/alac", "audio/ogg",
    "audio/mp4", "audio/m4a", "audio/x-m4a",
}


# ── JSON body schema (text jobs) ─────────────────────────────────────────────

class TextProcessRequest(BaseModel):
    text: str
    pipeline_id: str
    model_name: str = "whisperx"
    target_lang: str = "en"
    region: str = "metro"          # scenario region key; used by DataQueryAgent queries
    extra_context: dict = {}       # arbitrary extra fields threaded into first Kafka message


async def _submit_and_wait(
    db: Session,
    principal: dict,
    input_type: str,
    content: str,
    pipeline_id: str,
    model_name: str = "whisperx",
    target_lang: str = "en",
    filename: str | None = None,
    region: str = "metro",
    extra_context: dict | None = None,
) -> JSONResponse:
    """Submit job, block until pipeline completes, return final result."""
    job_id = str(uuid4())
    future = job_result_store.register(job_id)
    try:
        _, pipeline_name = await ProcessingHelper.process(
            db=db,
            principal=principal,
            input_type=input_type,
            content=content,
            pipeline_id=pipeline_id,
            model_name=model_name,
            target_lang=target_lang,
            filename=filename,
            job_id=job_id,
            region=region,
            extra_context=extra_context or {},
        )
    except (PermissionError, ValueError) as e:
        job_result_store.cancel(job_id)
        raise HTTPException(status_code=400 if isinstance(e, ValueError) else 403, detail=str(e))
    except Exception:
        job_result_store.cancel(job_id)
        logger.exception("process submit failed")
        raise HTTPException(status_code=500, detail="Internal server error")

    timeout = float(get_config("job_timeout_seconds", 300))
    try:
        result = await asyncio.wait_for(future, timeout=timeout)
    except asyncio.TimeoutError:
        job_result_store.cancel(job_id)
        raise HTTPException(status_code=504, detail="Processing timed out")

    if result.get("status_code") and result["status_code"] != 200:
        raise HTTPException(
            status_code=result["status_code"],
            detail=result.get("error_detail", "Pipeline failed"),
        )

    return JSONResponse(status_code=200, content={
        "job_id": job_id,
        "pipeline": pipeline_name,
        "result": result.get("data"),
    })


# ── Text endpoint (JSON body) ─────────────────────────────────────────────────

@router.post("/text")
async def process_text(
    body: TextProcessRequest,
    principal: dict = Depends(get_principal),
    db: Session = Depends(get_app_db),
):
    """Submit a plain-text job. Blocks until pipeline completes, returns result."""
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="'text' field is required and cannot be empty")
    if not body.pipeline_id:
        raise HTTPException(status_code=400, detail="'pipeline_id' is required")
    return await _submit_and_wait(
        db=db, principal=principal, input_type="text",
        content=body.text, pipeline_id=body.pipeline_id,
        model_name=body.model_name, target_lang=body.target_lang,
        region=body.region, extra_context=body.extra_context,
    )


# ── Audio endpoint (multipart) ────────────────────────────────────────────────

@router.post("/audio")
async def process_audio(
    file: UploadFile,
    pipeline_id: str = Form(...),
    model_name: str = Form("whisperx"),
    target_lang: str = Form("en"),
    principal: dict = Depends(get_principal),
    db: Session = Depends(get_app_db),
):
    """Submit an audio file. Blocks until pipeline completes, returns result."""
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Audio file is required")
    if file.content_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported file type: {file.content_type}")
    if not pipeline_id:
        raise HTTPException(status_code=400, detail="'pipeline_id' is required")

    UPLOAD_DIR = Path("/app/uploads/audio")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    path = UPLOAD_DIR / f"{uuid4()}_{file.filename}"
    with open(path, "wb") as f:
        f.write(file_bytes)
    logger.info("Saved upload: %s (%d bytes, content_type=%s)", path, len(file_bytes), file.content_type)

    try:
        return await _submit_and_wait(
            db=db, principal=principal, input_type="audio",
            content=str(path), pipeline_id=pipeline_id,
            model_name=model_name, target_lang=target_lang,
            filename=file.filename,
        )
    except HTTPException:
        path.unlink(missing_ok=True)
        raise
    except Exception:
        logger.exception("process_audio failed")
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Internal server error")


# ── Combined endpoint (auto-detect from file presence) ───────────────────────

@router.post("/")
async def process(
    file: Optional[UploadFile] = None,
    text: Optional[str] = Form(None),
    pipeline_id: str = Form(...),
    model_name: str = Form("whisperx"),
    target_lang: str = Form("en"),
    principal: dict = Depends(get_principal),
    db: Session = Depends(get_app_db),
):
    """Unified endpoint — auto-detects audio vs text. Blocks until result ready."""
    if file and file.filename:
        return await process_audio(
            file=file, pipeline_id=pipeline_id, model_name=model_name,
            target_lang=target_lang, principal=principal, db=db,
        )
    if text and text.strip():
        return await _submit_and_wait(
            db=db, principal=principal, input_type="text",
            content=text, pipeline_id=pipeline_id,
            model_name=model_name, target_lang=target_lang,
        )
    raise HTTPException(status_code=400, detail="Provide either 'file' (audio) or 'text' field")
