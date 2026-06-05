"""
GenericAgent v2 core — config-driven text-to-text agent that can pull ground-truth
data from the database (via DataQueryAgent) before its LLM call.

Superset of v1 (backend/GenericAgent/app/services/generic_agent.py):
  - same {{field}} prompt rendering and LLM dispatch
  - PLUS an optional `data_queries` step: each configured query is run through
    request_data() and the combined results are exposed to the prompt as {{data}}.

A definition with no `data_queries` behaves exactly like v1.
"""
from __future__ import annotations

import json
import logging
import re

from app.utils.config_client import load_prompt
from civis_obs import chat_completion, track_response_async, request_data, DataQueryError

logger = logging.getLogger(__name__)

DATA_QUERY_TIMEOUT = 5.0


def _render(template: str, context: dict) -> str:
    def replacer(match: re.Match) -> str:
        key = match.group(1).strip()
        val = context.get(key, "")
        if isinstance(val, (list, dict)):
            return json.dumps(val)
        return str(val)
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


def _resolve_llm(definition: dict) -> tuple[dict, str | None]:
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


async def _fetch_data(definition: dict, msg: dict, inputs: dict) -> dict:
    """Run each configured data_query and return {query_name: rows}."""
    data_queries: list = definition.get("data_queries") or []
    if not data_queries:
        return {}

    job_id = msg.get("job_id")
    ctx = {**msg, **inputs}   # params templates can reference any message field
    results: dict[str, list] = {}

    for q in data_queries:
        query_name = q.get("query_name")
        if not query_name:
            continue
        params_template = q.get("params") or {}
        params = {
            k: (_render(v, ctx) if isinstance(v, str) else v)
            for k, v in params_template.items()
        }
        try:
            rows = await request_data(query_name, params, job_id=job_id, timeout=DATA_QUERY_TIMEOUT)
            results[query_name] = rows
            logger.info(
                "GenericAgentV2[%s]: data_query '%s' params=%s → %d rows",
                definition["name"], query_name, params, len(rows),
            )
        except (DataQueryError, TimeoutError) as exc:
            logger.warning(
                "GenericAgentV2[%s]: data_query '%s' failed: %s — continuing with empty result",
                definition["name"], query_name, exc,
            )
            results[query_name] = []

    return results


async def process_message(msg: dict, definition: dict) -> dict:
    """Process one Kafka message using the given agent definition."""
    input_fields: list[str] = definition.get("input_fields") or []
    inputs = {field: msg.get(field, "") for field in input_fields}

    # v2 addition: fetch DB facts and expose them to the prompt as {{data}}
    fetched = await _fetch_data(definition, msg, inputs)
    if fetched:
        inputs["data"] = fetched

    messages = _build_messages(definition, inputs)
    llm, api_key = _resolve_llm(definition)

    logger.info(
        "GenericAgentV2[%s]: LLM provider=%s model=%s",
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
        service_name=f"generic_agent_v2.{definition['name']}",
        result=result,
    )

    raw_output = result.text
    try:
        parsed_output = json.loads(raw_output)
    except (json.JSONDecodeError, ValueError):
        parsed_output = raw_output

    # Echo the consumed input fields (scenario/region/current_policy/...) back at the top
    # level so the orchestrator can thread scenario context through fan-out and cyclic
    # re-entry. Exclude the large fetched {{data}} blob; reserved keys below always win.
    passthrough = {k: v for k, v in inputs.items() if k != "data" and v not in (None, "")}

    return {
        **passthrough,
        "job_id": msg.get("job_id"),
        "step_name": msg.get("step_name", definition["name"]),
        "output": parsed_output,
        "raw": raw_output,
        "agent": definition["name"],
    }
