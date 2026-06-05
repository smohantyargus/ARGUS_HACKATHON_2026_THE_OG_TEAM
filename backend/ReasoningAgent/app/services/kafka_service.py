"""
ReasoningAgent — Kafka consumer loop.

Consumes:  nlp.validated
Produces:  reasoning.completed  (success)
           task.completed       (on unrecoverable error)
"""
import logging
import time

from aiokafka import AIOKafkaProducer
from civis_obs import BaseKafkaAgent, agent_llm_call_duration_seconds, agent_errors_total
from app.services.reasoning_service import run_reasoning

logger = logging.getLogger(__name__)

OUTPUT_TOPIC = "reasoning.completed"


class ReasoningKafkaAgent(BaseKafkaAgent):
    agent_name = "reasoning_agent"
    input_topic = "nlp.validated"
    group_id = "reasoning-group"

    async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
        job_id = data.get("job_id")
        step_name = data.get("step_name", "reason")
        transcript = data.get("transcript", "")
        nlp_output = data.get("nlp_output", data.get("output", data.get("payload", {})))
        # Prefer node config (set in pipeline builder), fall back to top-level action
        config = data.get("config") or {}
        action = config.get("action") if config.get("action") is not None else data.get("action")
        feedback = data.get("feedback")
        if isinstance(action, list):
            action = action[0] if action else "soap"
        if not action:
            action = "soap"

        try:
            llm_start = time.monotonic()
            result = await run_reasoning(
                job_id=job_id,
                transcript=transcript,
                nlp_output=nlp_output,
                action=action,
                feedback=feedback,
            )
            agent_llm_call_duration_seconds.labels(self.agent_name, "claude").observe(
                time.monotonic() - llm_start
            )
            await producer.send_and_wait(OUTPUT_TOPIC, {
                "job_id": job_id,
                "step_name": step_name,
                "output": result,
                "status_code": 200,
                "action": action,
                "transcript": transcript,
            })
            logger.info("Job %s: reasoning completed, produced to %s", job_id, OUTPUT_TOPIC)
        except Exception as exc:
            agent_errors_total.labels(self.agent_name, type(exc).__name__).inc()
            logger.error("Reasoning failed for job %s: %s", job_id, exc)
            await producer.send_and_wait("task.completed", {
                "job_id": job_id,
                "status_code": 500,
                "error_detail": f"Reasoning agent error: {exc}",
            })


_agent = ReasoningKafkaAgent()


async def start() -> None:
    await _agent.run()
