"""Canonical aiokafka producer/consumer factory — shared by all agents."""
import json
import os
from aiokafka import AIOKafkaConsumer, AIOKafkaProducer

_BOOTSTRAP = os.getenv("KAFKA_BOOTSTRAP", "kafka:29092")


async def get_producer() -> AIOKafkaProducer:
    producer = AIOKafkaProducer(
        bootstrap_servers=_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode(),
        acks="all",
        linger_ms=20,
        request_timeout_ms=60_000,
        retry_backoff_ms=1_000,
    )
    await producer.start()
    return producer


async def get_consumer(topic: str | list[str], group_id: str) -> AIOKafkaConsumer:
    topics = [topic] if isinstance(topic, str) else topic
    consumer = AIOKafkaConsumer(
        *topics,
        bootstrap_servers=_BOOTSTRAP,
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset="earliest",
        retry_backoff_ms=500,
        session_timeout_ms=45_000,
        heartbeat_interval_ms=15_000,
        max_poll_interval_ms=300_000,
        request_timeout_ms=60_000,
    )
    await consumer.start()
    return consumer
