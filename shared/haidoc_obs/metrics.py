"""Prometheus metrics exposed by every service.

Mount `/metrics` via `mount_metrics_endpoint(app)` in FastAPI lifespan setup.
"""
from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest
from fastapi import FastAPI, Response


agent_messages_consumed_total = Counter(
    "agent_messages_consumed_total",
    "Kafka messages consumed by an agent, labelled by outcome.",
    labelnames=("agent", "topic", "status"),
)

agent_processing_duration_seconds = Histogram(
    "agent_processing_duration_seconds",
    "End-to-end wall-clock time to process one Kafka message.",
    labelnames=("agent",),
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300),
)

agent_llm_call_duration_seconds = Histogram(
    "agent_llm_call_duration_seconds",
    "Time spent in LLM calls initiated by an agent.",
    labelnames=("agent", "llm_instance"),
    buckets=(0.1, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300),
)

agent_errors_total = Counter(
    "agent_errors_total",
    "Errors raised inside an agent, labelled by error class.",
    labelnames=("agent", "error_class"),
)

validation_failures_total = Counter(
    "validation_failures_total",
    "Validation failures emitted by a validator.",
    labelnames=("validator", "rule_type"),
)

kafka_consumer_lag = Gauge(
    "kafka_consumer_lag",
    "Kafka consumer group lag by agent input topic.",
    labelnames=("agent_name", "topic", "group_id"),
)


def mount_metrics_endpoint(app: FastAPI, path: str = "/metrics") -> None:
    """Expose Prometheus metrics on the given FastAPI app."""

    @app.get(path, include_in_schema=False)
    def _metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
