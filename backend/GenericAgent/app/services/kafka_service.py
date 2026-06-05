"""
GenericAgent Kafka consumer — multi-agent mode.

Loads ALL active AgentDefinitions from ConfigService at startup.
Spawns one consumer task per definition (each with its own consumer group).
A single container handles any number of agent definitions.
"""
from __future__ import annotations

import asyncio
import logging

from app.utils.config_client import load_all_definitions
from app.utils.kafka import get_consumer, get_producer
from app.services.generic_agent import process_message

logger = logging.getLogger(__name__)


async def _run_agent(definition: dict) -> None:
    """Consumer loop for a single AgentDefinition. Restarts on error."""
    name = definition["name"]
    input_topic: str = definition["input_topic"]
    output_topic: str = definition["output_topic"]
    group_id = f"generic-{name}"

    logger.info("GenericAgent[%s]: starting — input=%s output=%s", name, input_topic, output_topic)

    while True:
        consumer = None
        producer = None
        try:
            await asyncio.sleep(5)

            consumer = await get_consumer(input_topic, group_id)
            producer = await get_producer()

            async for msg in consumer:
                data: dict = msg.value
                job_id = data.get("job_id", "unknown")
                logger.info("GenericAgent[%s]: processing job %s", name, job_id)

                try:
                    result = await process_message(data, definition)
                    await producer.send_and_wait(output_topic, result)
                    logger.info("GenericAgent[%s]: job %s → %s", name, job_id, output_topic)
                except Exception:
                    logger.exception("GenericAgent[%s]: error processing job %s", name, job_id)
                    await producer.send_and_wait(output_topic, {
                        "job_id": job_id,
                        "step_name": data.get("step_name", name),
                        "error": f"GenericAgent[{name}] failed for job {job_id}",
                        "agent": name,
                    })

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("GenericAgent[%s]: consumer error — reconnecting in 10s", name)
            await asyncio.sleep(10)
        finally:
            if consumer:
                await consumer.stop()
            if producer:
                await producer.stop()


async def consume_loop() -> None:
    """Load all definitions, spawn one task per agent, run until cancelled."""
    definitions = load_all_definitions()
    if not definitions:
        logger.warning("GenericAgent: no active agent definitions found — idling")
        await asyncio.Event().wait()
        return

    logger.info("GenericAgent: launching %d agent tasks: %s", len(definitions), [d["name"] for d in definitions])
    tasks = [asyncio.create_task(_run_agent(d)) for d in definitions]
    try:
        await asyncio.gather(*tasks)
    except asyncio.CancelledError:
        for t in tasks:
            t.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise
