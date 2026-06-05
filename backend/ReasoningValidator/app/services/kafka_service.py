"""
ReasoningValidator — Kafka consumer loop.

Consumes:  reasoning.completed
Produces:  reasoning.validated  (pass)
           validation.failed    (fail)
"""
import logging
from aiokafka import AIOKafkaProducer
from civis_obs import BaseKafkaAgent
from app.services.validator import validate

logger = logging.getLogger(__name__)

PASS_TOPIC = "reasoning.completed.validated"
FAIL_TOPIC = "validation.failed"


class ReasoningValidatorAgent(BaseKafkaAgent):
    agent_name = "reasoning_validator"
    input_topic = "reasoning.completed"
    group_id = "reasoning-validator-group"

    async def process(self, data: dict, producer: AIOKafkaProducer) -> None:
        job_id = data.get("job_id")
        step_name = data.get("step_name", "reason")
        output = data.get("output", {})
        action = data.get("action")

        passed, rule_violated, error_detail = validate(output, action)

        if passed:
            # Use model's own overall_confidence if present; fall back to 0.75
            confidence = float(output.get("overall_confidence", 0.75)) if isinstance(output, dict) else 0.75
            await producer.send_and_wait(PASS_TOPIC, {
                "job_id": job_id,
                "step_name": step_name,
                "output": output,
                "action": action,
                "transcript": data.get("transcript", ""),
                "confidence": round(min(max(confidence, 0.0), 1.0), 3),
            })
            logger.info("Job %s: reasoning validation PASSED", job_id)
        else:
            await producer.send_and_wait(FAIL_TOPIC, {
                "job_id": job_id,
                "step_name": step_name,
                "rule_violated": rule_violated,
                "error_detail": error_detail,
                "original_message": data,
            })
            logger.warning(
                "Job %s: reasoning validation FAILED [%s] %s",
                job_id, rule_violated, error_detail,
            )


_agent = ReasoningValidatorAgent()


async def start() -> None:
    await _agent.run()
