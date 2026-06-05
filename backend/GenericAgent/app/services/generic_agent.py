"""
GenericAgent core — processes a Kafka message using a given AgentDefinition.

Prompt rendering:
  {{field}} placeholders replaced with values from the incoming message.
  e.g. input_fields=["transcript"], message has {"transcript": "..."}
  → {{transcript}} filled in prompt.
"""
from __future__ import annotations

import json
import logging
import re

from app.utils.config_client import load_prompt
from civis_obs import chat_completion, track_response_async

logger = logging.getLogger(__name__)


def _render(template: str, context: dict) -> str:
    def replacer(match: re.Match) -> str:
        key = match.group(1).strip()
        val = context.get(key, "")
        if isinstance(val, (list, dict)):
            return json.dumps(val)
        return str(val)
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


def _resolve_llm(definition: dict) -> tuple[dict, str | None]:
    # Use pre-loaded data from load_all_definitions — zero HTTP calls at runtime
    llm = definition.get("_resolved_llm")
    api_key = definition.get("_resolved_api_key")
    if llm:
        return llm, api_key
    raise RuntimeError(f"No active LLM instance pre-loaded for agent '{definition['name']}'")


def _build_messages(definition: dict, inputs: dict) -> list[dict]:
    system_prompt = definition.get("system_prompt") or ""
    user_template = definition.get("user_prompt_template") or ""

    if not system_prompt and not user_template:
        action = definition.get("prompt_action")
        if not action:
            raise ValueError(
                f"AgentDefinition '{definition['name']}' has no prompt and no prompt_action"
            )
        tmpl = load_prompt(action)
        system_prompt = tmpl.get("system_prompt", "")
        user_template = tmpl.get("user_prompt", "")

    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": _render(system_prompt, inputs)})
    if user_template:
        messages.append({"role": "user", "content": _render(user_template, inputs)})
    return messages


def _extract_json_or_text(raw: str):
    """Return first valid JSON dict from LLM output, or stripped text if none found."""
    text = raw.strip()
    # Already valid JSON dict
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    # Strip markdown fences
    fence_stripped = re.sub(r"```[a-zA-Z]*\s*", "", text).replace("```", "").strip()
    try:
        obj = json.loads(fence_stripped)
        if isinstance(obj, dict):
            return obj
    except (json.JSONDecodeError, ValueError):
        pass
    # Extract first {...} block
    match = re.search(r"\{.*\}", fence_stripped or text, re.DOTALL)
    if match:
        try:
            obj = json.loads(match.group(0))
            if isinstance(obj, dict):
                return obj
        except (json.JSONDecodeError, ValueError):
            pass
    return fence_stripped or text


async def process_message(msg: dict, definition: dict) -> dict:
    """Process one Kafka message using the given agent definition."""
    input_fields: list[str] = definition.get("input_fields") or []
    inputs = {field: msg.get(field, "") for field in input_fields}

    messages = _build_messages(definition, inputs)
    llm, api_key = _resolve_llm(definition)

    logger.info(
        "GenericAgent[%s]: LLM provider=%s model=%s",
        definition["name"], llm["provider"], llm.get("model_name", ""),
    )

    result = await chat_completion(
        messages=messages,
        provider=llm["provider"],
        base_url=llm.get("base_url", ""),
        model_name=llm.get("model_name", ""),
        api_key=api_key,
        max_tokens=definition.get("max_tokens") or 1024,
        temperature=definition.get("temperature") or 0.3,
    )

    await track_response_async(
        service_name=f"generic_agent.{definition['name']}",
        result=result,
    )

    raw_output = result.text
    parsed_output = _extract_json_or_text(raw_output)

    return {
        "job_id": msg.get("job_id"),
        "step_name": msg.get("step_name", definition["name"]),
        "output": parsed_output,
        "raw": raw_output,
        "agent": definition["name"],
    }
