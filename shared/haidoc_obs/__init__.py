"""Shared observability + Kafka base consumer for haidoc agents."""
from .logging_config import configure_logging, set_job_context, clear_job_context
from .metrics import (
    agent_messages_consumed_total,
    agent_processing_duration_seconds,
    agent_llm_call_duration_seconds,
    agent_errors_total,
    validation_failures_total,
    kafka_consumer_lag,
    mount_metrics_endpoint,
)
from .health import make_health_router, check_http, check_redis, check_postgres
from .kafka_consumer import BaseKafkaAgent
from .kafka_utils import get_consumer, get_producer
from .llm_client import chat_completion, LLMResult
from .token_tracker import (
    TokenTracker,
    LoggerHandler,
    DatabaseHandler,
    ResponseParser,
    TokenCounter,
    TokenUsageHandler,
    track_async,
    track_response_async,
    set_token_context,
    clear_token_context,
    get_token_context,
)

__all__ = [
    "configure_logging",
    "set_job_context",
    "clear_job_context",
    "agent_messages_consumed_total",
    "agent_processing_duration_seconds",
    "agent_llm_call_duration_seconds",
    "agent_errors_total",
    "validation_failures_total",
    "kafka_consumer_lag",
    "mount_metrics_endpoint",
    "make_health_router",
    "check_http",
    "check_redis",
    "check_postgres",
    "BaseKafkaAgent",
    "get_consumer",
    "get_producer",
    "chat_completion",
    "LLMResult",
    "TokenTracker",
    "LoggerHandler",
    "DatabaseHandler",
    "ResponseParser",
    "TokenCounter",
    "TokenUsageHandler",
    "track_async",
    "track_response_async",
    "set_token_context",
    "clear_token_context",
    "get_token_context",
]
