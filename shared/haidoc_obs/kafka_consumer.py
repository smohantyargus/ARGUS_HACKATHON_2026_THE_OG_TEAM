"""
BaseKafkaAgent — shared consumer loop boilerplate.

Subclass, set class variables, implement process(). Done.

    class MyAgent(BaseKafkaAgent):
        agent_name = "my_agent"
        input_topic = "my.input"
        group_id = "my-group"

        async def on_startup(self) -> None:
            await load_rules()   # optional

        async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
            result = do_work(data)
            await producer.send_and_wait("my.output", result)

    _agent = MyAgent()

    async def start():
        await _agent.run()

Concurrency (AS-1 / AS-3):
    N concurrent process() calls run simultaneously via _ResizableSemaphore.
    Initial limit = AGENT_CONCURRENCY env var → class max_concurrent → 5.

    The limit is live-adjustable without restart (AS-3):
      1. ConfigService PUT /agent-runtime-config/{name} writes Redis key
         `agent:{name}:concurrency` and publishes to `agent.config.{name}`.
      2. _watch_config() background task reads the key on (re)connect and
         listens for pub/sub messages, calling sem.resize() on each update.

    REDIS_URL env var must be set for live updates; absent → env-var concurrency only.

    Offset note: aiokafka auto-commits the last *fetched* offset, not last *processed*.
    A crash under concurrent load can cause reprocessing. All agents must be idempotent.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from abc import ABC, abstractmethod
from contextlib import suppress
from typing import ClassVar

from aiokafka import AIOKafkaProducer

from .kafka_utils import get_consumer, get_producer
from .logging_config import set_job_context, clear_job_context
from .metrics import (
    agent_messages_consumed_total,
    agent_processing_duration_seconds,
    agent_errors_total,
)
from .token_tracker import set_token_context, clear_token_context

logger = logging.getLogger(__name__)


# ── Resizable semaphore ────────────────────────────────────────────────────────

class _ResizableSemaphore:
    """
    Semaphore whose concurrency limit can be adjusted at runtime.

    Increasing the limit immediately unblocks waiting tasks.
    Decreasing the limit takes effect as in-flight tasks complete —
    no running task is ever cancelled by a resize.

    asyncio-safe: only the event loop thread touches internal state,
    so no explicit locking is needed.
    """

    def __init__(self, initial: int) -> None:
        self._limit = initial
        self._in_use = 0
        self._slot_freed = asyncio.Event()
        self._slot_freed.set()

    async def acquire(self) -> None:
        while self._in_use >= self._limit:
            self._slot_freed.clear()
            await self._slot_freed.wait()
        self._in_use += 1

    def release(self) -> None:
        self._in_use = max(0, self._in_use - 1)
        self._slot_freed.set()

    def resize(self, new_limit: int) -> None:
        self._limit = max(1, new_limit)
        self._slot_freed.set()   # wake waiters; they re-check _in_use >= _limit

    @property
    def limit(self) -> int:
        return self._limit

    @property
    def in_use(self) -> int:
        return self._in_use


# ── Base class ─────────────────────────────────────────────────────────────────

class BaseKafkaAgent(ABC):
    agent_name: ClassVar[str]
    input_topic: ClassVar[str | list[str]]
    group_id: ClassVar[str]
    reconnect_delay: ClassVar[float] = 5.0
    max_concurrent: ClassVar[int] = 5   # override per agent; AGENT_CONCURRENCY env takes precedence

    async def on_startup(self) -> None:
        """Override for one-time setup before first connect (register_self, load_rules, etc.)."""

    @abstractmethod
    async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
        """Handle one message. Publish output(s) via producer. Raise on unrecoverable error."""

    # ── Internal: metrics wrapper ────────────────────────────────────────────

    async def _process_guarded(
        self,
        data: dict,
        source_topic: str,
        producer: AIOKafkaProducer,
        sem: _ResizableSemaphore,
    ) -> None:
        """
        Metrics + error-catching shell around process().
        Caller must have already acquired sem; this releases it in finally.
        """
        started = time.monotonic()
        job_id = data.get("job_id", "unknown")
        pipeline_id = data.get("pipeline_id") or data.get("pipeline_definition_id")
        request_id = data.get("request_id") or data.get("trace_id")
        set_job_context(job_id=job_id, trace_id=request_id)
        set_token_context(
            pipeline_id=pipeline_id,
            agent_name=self.agent_name,
            request_id=request_id,
        )
        outcome = "success"
        try:
            await self.process(data, producer)
        except Exception as exc:
            outcome = "error"
            agent_errors_total.labels(self.agent_name, type(exc).__name__).inc()
            logger.exception("[%s] error processing job %s", self.agent_name, job_id)
        finally:
            agent_messages_consumed_total.labels(
                self.agent_name, source_topic, outcome
            ).inc()
            agent_processing_duration_seconds.labels(self.agent_name).observe(
                time.monotonic() - started
            )
            clear_job_context()
            clear_token_context()
            sem.release()

    # ── Internal: live config watcher (AS-3) ─────────────────────────────────

    async def _watch_config(self, sem: _ResizableSemaphore) -> None:
        """
        Background task: subscribe to Redis pub/sub channel `agent.config.{name}`
        and resize sem on each concurrency update.

        On (re)connect also reads `agent:{name}:concurrency` key so agents that
        restart pick up the latest persisted value.

        Exits silently if REDIS_URL is not set. Reconnects on Redis errors.
        """
        redis_url = os.environ.get("REDIS_URL")
        if not redis_url:
            logger.debug("[%s] REDIS_URL not set — live concurrency updates disabled", self.agent_name)
            return

        import redis.asyncio as aioredis  # lazy — only agents with REDIS_URL need this

        channel = f"agent.config.{self.agent_name}"
        key = f"agent:{self.agent_name}:concurrency"

        while True:
            r: aioredis.Redis | None = None
            try:
                r = aioredis.from_url(redis_url, decode_responses=True)

                # Read persisted value on (re)connect
                raw = await r.get(key)
                if raw:
                    try:
                        sem.resize(int(raw))
                        logger.info("[%s] concurrency=%s (from Redis key)", self.agent_name, raw)
                    except ValueError:
                        logger.warning("[%s] invalid Redis key value: %r", self.agent_name, raw)

                pubsub = r.pubsub()
                await pubsub.subscribe(channel)
                logger.debug("[%s] subscribed to %s", self.agent_name, channel)

                async for message in pubsub.listen():
                    if message["type"] != "message":
                        continue
                    try:
                        data = json.loads(message["data"])
                        new_c = int(data["concurrency"])
                        if new_c > 0:
                            sem.resize(new_c)
                            logger.info(
                                "[%s] concurrency → %d (pub/sub)", self.agent_name, new_c
                            )
                    except (KeyError, ValueError, json.JSONDecodeError) as e:
                        logger.warning("[%s] bad config message: %s — %s", self.agent_name, message["data"], e)

            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("[%s] config watcher error, reconnecting in 30s", self.agent_name, exc_info=True)
                await asyncio.sleep(30)
            finally:
                if r is not None:
                    with suppress(Exception):
                        await r.aclose()

    # ── Main loop ─────────────────────────────────────────────────────────────

    async def run(self) -> None:
        """Main loop — call from FastAPI lifespan or asyncio.create_task()."""
        await self.on_startup()

        concurrency = int(os.environ.get("AGENT_CONCURRENCY", str(self.max_concurrent)))
        logger.info("[%s] starting — concurrency=%d", self.agent_name, concurrency)
        sem = _ResizableSemaphore(concurrency)

        # AS-3: live config watcher runs for the lifetime of this agent
        config_task = asyncio.create_task(self._watch_config(sem))

        try:
            while True:
                consumer = None
                producer = None
                pending: set[asyncio.Task] = set()
                try:
                    await asyncio.sleep(self.reconnect_delay)
                    consumer = await get_consumer(self.input_topic, self.group_id)
                    producer = await get_producer()

                    async for msg in consumer:
                        # Acquire before spawning — backpressures the consumer loop
                        # when all slots are busy instead of accumulating tasks.
                        await sem.acquire()
                        task = asyncio.create_task(
                            self._process_guarded(msg.value, msg.topic, producer, sem)
                        )
                        pending.add(task)
                        task.add_done_callback(pending.discard)

                except asyncio.CancelledError:
                    _cancel_and_drain(pending)
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)
                    raise
                except Exception as exc:
                    _cancel_and_drain(pending)
                    if pending:
                        await asyncio.gather(*pending, return_exceptions=True)
                    agent_errors_total.labels(self.agent_name, type(exc).__name__).inc()
                    logger.exception(
                        "[%s] consumer error, reconnecting in 10s", self.agent_name
                    )
                    await asyncio.sleep(10)
                finally:
                    if consumer:
                        await consumer.stop()
                    if producer:
                        await producer.stop()

        finally:
            config_task.cancel()
            with suppress(asyncio.CancelledError):
                await config_task


def _cancel_and_drain(tasks: set[asyncio.Task]) -> None:
    for t in tasks:
        t.cancel()
