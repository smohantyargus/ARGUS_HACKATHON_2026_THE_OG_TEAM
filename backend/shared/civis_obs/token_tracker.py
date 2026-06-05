"""
Token usage tracker for civis agents.

Records every LLM call to:
  1. Logger (always on) — JSON line with service/model/tokens.
  2. Postgres `token_usage_log` table (when APP_DATABASE_URL is set) —
     mapped to (job_id, pipeline_id, agent_name, request_id).

Context (job_id, pipeline_id, agent_name, request_id) flows from contextvars
populated by `BaseKafkaAgent._process_guarded`. Agents typically don't touch
these directly — they just call `track_response_async(...)` after a
`chat_completion` call.

Usage in an agent:

    from civis_obs import chat_completion, track_response_async

    result = await chat_completion(...)
    await track_response_async(
        service_name=self.agent_name,
        model_name=result.model_name,
        result=result,
    )
    return result.text

The handler list is pluggable:

    TokenTracker.set_handlers([LoggerHandler(), DatabaseHandler()])

`DatabaseHandler` is auto-attached on first `track*` call when
APP_DATABASE_URL is set. Set civis_TOKEN_TRACK_DB=0 to disable.
"""
from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from typing import Any, Optional, Protocol

logger = logging.getLogger(__name__)


# ── Context vars ──────────────────────────────────────────────────────────────

_pipeline_id_var: ContextVar[Optional[str]] = ContextVar("pipeline_id", default=None)
_agent_name_var: ContextVar[Optional[str]] = ContextVar("agent_name", default=None)
_request_id_var: ContextVar[Optional[str]] = ContextVar("request_id", default=None)


def set_token_context(
    *,
    pipeline_id: Optional[str] = None,
    agent_name: Optional[str] = None,
    request_id: Optional[str] = None,
) -> None:
    """Populate per-task context. Called by BaseKafkaAgent before process()."""
    if pipeline_id is not None:
        _pipeline_id_var.set(pipeline_id)
    if agent_name is not None:
        _agent_name_var.set(agent_name)
    if request_id is not None:
        _request_id_var.set(request_id)


def clear_token_context() -> None:
    _pipeline_id_var.set(None)
    _agent_name_var.set(None)
    _request_id_var.set(None)


def get_token_context() -> dict[str, Optional[str]]:
    return {
        "pipeline_id": _pipeline_id_var.get(),
        "agent_name": _agent_name_var.get(),
        "request_id": _request_id_var.get(),
    }


# ── Result + parser ───────────────────────────────────────────────────────────


class _LLMUsageProtocol(Protocol):
    input_tokens: int
    output_tokens: int
    model_name: str


class ResponseParser:
    """
    Extract (input_tokens, output_tokens) from various provider response
    objects. Kept for backward compatibility with raw SDK responses.
    """

    @staticmethod
    def extract(response: Any) -> tuple[int, int]:
        if response is None:
            return (0, 0)

        # civis LLMResult dataclass
        if hasattr(response, "input_tokens") and hasattr(response, "output_tokens"):
            return (int(response.input_tokens or 0), int(response.output_tokens or 0))

        # Anthropic Message / stream final
        if hasattr(response, "usage"):
            usage = response.usage
            if usage is not None:
                if isinstance(usage, dict):
                    return (
                        int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
                        int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0),
                    )
                return (
                    int(getattr(usage, "input_tokens", getattr(usage, "prompt_tokens", 0)) or 0),
                    int(getattr(usage, "output_tokens", getattr(usage, "completion_tokens", 0)) or 0),
                )

        # Gemini SDK
        if hasattr(response, "usage_metadata"):
            meta = response.usage_metadata
            if isinstance(meta, dict):
                return (
                    int(meta.get("prompt_token_count", meta.get("input_tokens", 0)) or 0),
                    int(meta.get("candidates_token_count", meta.get("output_tokens", 0)) or 0),
                )
            return (
                int(getattr(meta, "prompt_token_count", 0) or 0),
                int(getattr(meta, "candidates_token_count", 0) or 0),
            )

        # Plain dict (Ollama etc.)
        if isinstance(response, dict):
            if "prompt_eval_count" in response:
                return (
                    int(response.get("prompt_eval_count", 0) or 0),
                    int(response.get("eval_count", 0) or 0),
                )
            usage = response.get("usage") or {}
            if usage:
                return (
                    int(usage.get("prompt_tokens", usage.get("input_tokens", 0)) or 0),
                    int(usage.get("completion_tokens", usage.get("output_tokens", 0)) or 0),
                )

        return (0, 0)


# ── Token counting (tiktoken, with fallback) ──────────────────────────────────


class TokenCounter:
    """Approximate tokenisation when a provider doesn't return usage."""

    @staticmethod
    def count(text: str, model_name: str = "gpt-4o") -> int:
        if not text:
            return 0
        try:
            import tiktoken  # type: ignore
        except ImportError:
            return max(1, len(text) // 4)
        try:
            try:
                enc = tiktoken.encoding_for_model(model_name)
            except KeyError:
                enc = tiktoken.get_encoding("cl100k_base")
            return len(enc.encode(text))
        except Exception as exc:  # pragma: no cover — fallback path
            logger.debug("tiktoken count failed (%s); using char/4 estimate", exc)
            return max(1, len(text) // 4)


# ── Handler protocol ──────────────────────────────────────────────────────────


class TokenUsageHandler(Protocol):
    def handle_usage(
        self,
        service_name: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        context: dict[str, Optional[str]],
    ) -> None:
        ...


class LoggerHandler:
    """Emits a single structured log line per LLM call."""

    def __init__(self, logger_name: str = "civis_obs.token_usage") -> None:
        self.logger = logging.getLogger(logger_name)

    def handle_usage(
        self,
        service_name: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        context: dict[str, Optional[str]],
    ) -> None:
        total = input_tokens + output_tokens
        self.logger.info(
            "token_usage",
            extra={
                "service_name": service_name,
                "model_name": model_name,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total,
                "pipeline_id": context.get("pipeline_id"),
                "agent_name": context.get("agent_name"),
                "request_id": context.get("request_id"),
            },
        )


# ── Database handler (sync engine in thread pool) ─────────────────────────────


class DatabaseHandler:
    """
    Writes a row to `token_usage_log`. Sync SQLAlchemy core engine reused
    across calls; INSERTs offloaded to a thread pool so the event loop is
    never blocked on Postgres I/O.

    Fail-open: any DB error is logged and swallowed — token tracking must
    never crash an agent.
    """

    _engine = None
    _table = None
    _executor: Optional[ThreadPoolExecutor] = None

    @classmethod
    def _ensure(cls) -> bool:
        if cls._engine is not None and cls._table is not None:
            return True

        url = os.getenv("APP_DATABASE_URL") or os.getenv("DATABASE_URL")
        if not url:
            return False

        try:
            from sqlalchemy import (
                BigInteger,
                Column,
                DateTime,
                Integer,
                MetaData,
                String,
                Table,
                create_engine,
            )
            from sqlalchemy.dialects.postgresql import UUID
            from sqlalchemy.sql import func
        except ImportError:
            logger.warning("sqlalchemy not installed; DB token tracking disabled")
            return False

        try:
            cls._engine = create_engine(url, pool_size=2, max_overflow=3, pool_pre_ping=True)
            md = MetaData()
            cls._table = Table(
                "token_usage_log",
                md,
                Column("id", BigInteger, primary_key=True, autoincrement=True),
                Column("job_id", UUID(as_uuid=False), nullable=True),
                Column("pipeline_id", UUID(as_uuid=False), nullable=True),
                Column("agent_name", String(100), nullable=True),
                Column("service_name", String(100), nullable=True),
                Column("model_name", String(150), nullable=True),
                Column("input_tokens", Integer, nullable=False),
                Column("output_tokens", Integer, nullable=False),
                Column("total_tokens", Integer, nullable=False),
                Column("request_id", String(64), nullable=True),
                Column("created_at", DateTime(timezone=True), server_default=func.now()),
            )
            cls._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tokentrk")
            return True
        except Exception:
            logger.exception("DatabaseHandler init failed; DB token tracking disabled")
            cls._engine = None
            cls._table = None
            return False

    def handle_usage(
        self,
        service_name: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        context: dict[str, Optional[str]],
    ) -> None:
        if not self._ensure():
            return

        executor = type(self)._executor
        if executor is None:
            return
        executor.submit(
            self._insert,
            service_name,
            model_name,
            input_tokens,
            output_tokens,
            context,
        )

    @classmethod
    def _insert(
        cls,
        service_name: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
        context: dict[str, Optional[str]],
    ) -> None:
        engine = cls._engine
        table = cls._table
        if engine is None or table is None:
            return
        try:
            with engine.begin() as conn:
                conn.execute(
                    table.insert().values(
                        job_id=_safe_uuid(context.get("job_id")),
                        pipeline_id=_safe_uuid(context.get("pipeline_id")),
                        agent_name=context.get("agent_name"),
                        service_name=service_name,
                        model_name=str(model_name)[:150] if model_name else None,
                        input_tokens=int(input_tokens),
                        output_tokens=int(output_tokens),
                        total_tokens=int(input_tokens + output_tokens),
                        request_id=context.get("request_id"),
                    )
                )
        except Exception as exc:
            logger.warning("token_usage insert failed: %s", exc)


def _safe_uuid(val: Any) -> Any:
    """Return val if it parses as UUID, else None — table column is UUID."""
    if val is None:
        return None
    import uuid

    try:
        return str(uuid.UUID(str(val)))
    except (ValueError, AttributeError, TypeError):
        return None


# ── Tracker ───────────────────────────────────────────────────────────────────


class TokenTracker:
    """Static dispatcher. Add/replace handlers via class methods."""

    _handlers: list[TokenUsageHandler] = [LoggerHandler()]
    _db_attached: bool = False

    @classmethod
    def set_handlers(cls, handlers: list[TokenUsageHandler]) -> None:
        cls._handlers = list(handlers)
        cls._db_attached = any(isinstance(h, DatabaseHandler) for h in cls._handlers)

    @classmethod
    def add_handler(cls, handler: TokenUsageHandler) -> None:
        if handler not in cls._handlers:
            cls._handlers.append(handler)
        if isinstance(handler, DatabaseHandler):
            cls._db_attached = True

    @classmethod
    def _maybe_attach_db(cls) -> None:
        if cls._db_attached:
            return
        if os.getenv("civis_TOKEN_TRACK_DB", "1") == "0":
            cls._db_attached = True
            return
        if not (os.getenv("APP_DATABASE_URL") or os.getenv("DATABASE_URL")):
            cls._db_attached = True
            return
        cls.add_handler(DatabaseHandler())

    @classmethod
    def track(
        cls,
        service_name: str,
        model_name: str,
        input_tokens: int,
        output_tokens: int,
    ) -> None:
        cls._maybe_attach_db()
        ctx = {
            **get_token_context(),
            "job_id": _job_id_from_logging_ctx(),
        }
        for handler in cls._handlers:
            try:
                handler.handle_usage(
                    service_name, model_name, input_tokens, output_tokens, ctx
                )
            except Exception as exc:  # pragma: no cover
                logger.error("token handler %s failed: %s", type(handler).__name__, exc)


# ── Public async helpers ──────────────────────────────────────────────────────


_default_executor: Optional[ThreadPoolExecutor] = None


def _executor() -> ThreadPoolExecutor:
    global _default_executor
    if _default_executor is None:
        _default_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="tokentrk-async")
    return _default_executor


async def track_async(
    service_name: str,
    model_name: str,
    input_tokens: int,
    output_tokens: int,
) -> None:
    """Run TokenTracker.track in a thread pool (handlers may be sync)."""
    if input_tokens <= 0 and output_tokens <= 0:
        return
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            _executor(),
            TokenTracker.track,
            service_name,
            model_name,
            input_tokens,
            output_tokens,
        )
    except Exception as exc:
        logger.error("track_async failed: %s", exc)


async def track_response_async(
    *,
    service_name: str,
    model_name: Optional[str] = None,
    result: Any = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
) -> None:
    """
    Convenience wrapper. Pass either:
      - `result`  — an LLMResult or raw SDK response object, OR
      - explicit `input_tokens` + `output_tokens`.

    `model_name` is read from the result if not provided.
    """
    if input_tokens is None or output_tokens is None:
        in_tok, out_tok = ResponseParser.extract(result)
    else:
        in_tok, out_tok = input_tokens, output_tokens

    name = model_name
    if not name and result is not None:
        name = getattr(result, "model_name", None) or getattr(result, "model", None) or ""

    await track_async(service_name, name or "unknown", in_tok, out_tok)


# ── Bridge to logging contextvar (job_id) ─────────────────────────────────────


def _job_id_from_logging_ctx() -> Optional[str]:
    """Read the job_id ContextVar that `set_job_context` populates."""
    try:
        from .logging_config import _job_id_var  # type: ignore[attr-defined]

        return _job_id_var.get()
    except Exception:
        return None
