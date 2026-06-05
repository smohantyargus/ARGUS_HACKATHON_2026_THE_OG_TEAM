import json
from aiokafka import AIOKafkaProducer, AIOKafkaConsumer
import os
from dotenv import load_dotenv

load_dotenv()

KAFKA_BOOTSTRAP = os.getenv('KAFKA_BOOTSTRAP')


async def get_producer() -> AIOKafkaProducer:
    """Create and start a new producer. Caller is responsible for stopping it."""
    producer = AIOKafkaProducer(
        bootstrap_servers=KAFKA_BOOTSTRAP,
        value_serializer=lambda v: json.dumps(v).encode(),
        acks="all",
        linger_ms=20,
        request_timeout_ms=60000,
        retry_backoff_ms=1000,
    )
    await producer.start()
    return producer


async def get_consumer(topic: str | list[str], group_id: str) -> AIOKafkaConsumer:
    """Create and start a new consumer. Caller is responsible for stopping it."""
    topics = [topic] if isinstance(topic, str) else topic
    consumer = AIOKafkaConsumer(
        *topics,
        bootstrap_servers=KAFKA_BOOTSTRAP,
        group_id=group_id,
        value_deserializer=lambda v: json.loads(v.decode()),
        auto_offset_reset='earliest',
        retry_backoff_ms=500,
        session_timeout_ms=45000,
        heartbeat_interval_ms=15000,
        max_poll_interval_ms=300000,
        request_timeout_ms=60000,
    )
    await consumer.start()
    return consumer
