"""Structured JSON logging + job_id / trace_id context propagation.

Usage:
    from civis_obs import configure_logging, set_job_context, clear_job_context
    configure_logging(service="nlp_agent")
    ...
    set_job_context(job_id="abc", trace_id="xyz")
    try:
        ...
    finally:
        clear_job_context()
"""
from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from contextvars import ContextVar
from typing import Any

# Matches raw access keys: mk_{8+alphanum/underscore/dash}
# Real keys are mk_{8hex}_{64hex} (73 chars after mk_); pattern catches any plausible variant.
_ACCESS_KEY_RE = re.compile(r'mk_[A-Za-z0-9_-]{8,}')

_job_id_var: ContextVar[str | None] = ContextVar("job_id", default=None)
_trace_id_var: ContextVar[str | None] = ContextVar("trace_id", default=None)

_SERVICE_NAME: str = "unknown"


def _redact(text: str) -> str:
    """Replace raw access keys (mk_...) with mk_**** in log output."""
    return _ACCESS_KEY_RE.sub("mk_****", text)


class JsonFormatter(logging.Formatter):
    """Emits one JSON object per log record. Redacts raw access keys."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
            + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "service": _SERVICE_NAME,
            "logger": record.name,
            "msg": _redact(record.getMessage()),
        }
        job_id = _job_id_var.get()
        if job_id:
            payload["job_id"] = job_id
        trace_id = _trace_id_var.get()
        if trace_id:
            payload["trace_id"] = trace_id

        if record.exc_info:
            payload["exc"] = _redact(self.formatException(record.exc_info))
        if record.stack_info:
            payload["stack"] = _redact(record.stack_info)

        # Include any extra fields attached via logger.info(..., extra={...})
        reserved = {
            "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
            "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
            "created", "msecs", "relativeCreated", "thread", "threadName",
            "processName", "process", "getMessage", "message", "asctime",
            "taskName",
        }
        for key, value in record.__dict__.items():
            if key not in reserved and not key.startswith("_"):
                if isinstance(value, str):
                    value = _redact(value)
                try:
                    json.dumps(value)
                    payload[key] = value
                except (TypeError, ValueError):
                    payload[key] = _redact(repr(value))

        return json.dumps(payload, separators=(",", ":"), ensure_ascii=False)


def configure_logging(service: str, level: str | None = None) -> None:
    """Initialize root logger with JSON formatter. Call once at process start."""
    global _SERVICE_NAME
    _SERVICE_NAME = service

    lvl = (level or os.getenv("LOG_LEVEL") or "INFO").upper()
    root = logging.getLogger()
    root.setLevel(lvl)

    # Clear any pre-existing handlers from uvicorn/fastapi import side effects
    for h in list(root.handlers):
        root.removeHandler(h)

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)

    # Tame noisy libraries
    logging.getLogger("uvicorn.access").setLevel("WARNING")
    logging.getLogger("aiokafka").setLevel("WARNING")
    logging.getLogger("httpx").setLevel("WARNING")


def set_job_context(job_id: str | None = None, trace_id: str | None = None) -> None:
    if job_id is not None:
        _job_id_var.set(job_id)
    if trace_id is not None:
        _trace_id_var.set(trace_id)


def clear_job_context() -> None:
    _job_id_var.set(None)
    _trace_id_var.set(None)
