"""
Core synthesis logic for ContextAggregatorAgent.

Receives collected inputs from all upstream agents, applies dynamic
confidence-based weights, and calls the LLM once to produce a synthesized
output that handles conflict detection, uncertainty, persona, and citations
all in a single prompt.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.utils.config_client import (
    get_api_key_for,
    get_llm_by_name,
    get_llm_instances,
    load_definition,
)
from haidoc_obs import chat_completion, track_response_async

logger = logging.getLogger(__name__)

# Fields compared cross-agent for conflict detection
_CONFLICT_FIELDS = ["diagnosis", "assessment", "urgency", "medications", "follow_up", "impression"]

# ── Default synthesis prompt ───────────────────────────────────────────────────

_DEFAULT_SYSTEM_PROMPT = """You are a senior clinical AI synthesizer. You receive outputs from
multiple specialized AI agents, each with a reliability weight between 0 and 1.
A higher weight means the agent's output is more reliable for this case.

Your task:
1. Synthesize all inputs into a single high-quality clinical output.
2. If agents disagree on a key field (diagnosis, medication, urgency), flag the
   conflict explicitly in a "_conflicts" key and state which source you trusted and why.
3. Assign an overall "confidence" score (0.0–1.0) based on agreement level and weights.
4. For each clinical claim, cite the source agent and any relevant transcript evidence.
5. If any agent signals urgency="critical", set "urgency": "critical" in your output.

Respond with valid JSON only. No markdown fences."""

_PERSONA_SUFFIX = {
    "clinician": "Format as a clinical SOAP note using standard medical terminology.",
    "patient": (
        "Explain in plain language a patient with no medical background can understand. "
        "Avoid jargon. Be reassuring but accurate."
    ),
    "ehr_import": (
        "Output valid HL7 FHIR R4 JSON. Include all structured fields. "
        "Use standard codes (SNOMED, ICD-10, RxNorm) where applicable."
    ),
}

_SCHEMA_SUFFIX = {
    "freeform": "",
    "soap": (
        'Include keys: "subjective", "objective", "assessment", "plan", '
        '"diagnosis", "confidence", "_conflicts", "_sources".'
    ),
    "structured_json": (
        'Include keys: "summary", "diagnosis", "medications", "follow_up", '
        '"confidence", "urgency", "_conflicts", "_sources".'
    ),
    "fhir": "Output a valid FHIR Bundle resource.",
}


# ── Conflict detection ────────────────────────────────────────────────────────

def _extract_structured(msg: dict) -> dict:
    """Pull structured fields from agent output, handling str/dict/JSON."""
    output = msg.get("output", {})
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except Exception:
            return {}
    return output if isinstance(output, dict) else {}


def _detect_conflicts(
    inputs: dict[str, dict],
    definition: dict,
) -> list[dict]:
    """
    Compare key clinical fields across agent outputs (Python-side, no LLM).
    Returns list of conflict dicts ready to inject into the prompt.
    Each: {field, agents: [{name, label, value, effective_weight}]}
    """
    sources = {s["agent_name"]: s for s in definition.get("input_sources", [])}
    field_values: dict[str, dict[str, str]] = {}

    for agent_name, msg in inputs.items():
        structured = _extract_structured(msg)
        for field in _CONFLICT_FIELDS:
            val = structured.get(field)
            if val is None:
                continue
            # Normalise for comparison — strip, lowercase, collapse whitespace
            val_norm = " ".join(str(val).lower().split())
            if val_norm:
                field_values.setdefault(field, {})[agent_name] = val_norm

    conflicts = []
    for field, agent_vals in field_values.items():
        if len(agent_vals) < 2:
            continue
        if len(set(agent_vals.values())) == 1:
            continue  # all agree
        agents_info = []
        for agent_name, val_norm in agent_vals.items():
            src = sources.get(agent_name, {})
            base_w = src.get("base_weight", 1.0)
            confidence = inputs[agent_name].get("confidence", 1.0)
            agents_info.append({
                "name": agent_name,
                "label": src.get("label", agent_name),
                "value": val_norm,
                "effective_weight": round(base_w * confidence, 3),
            })
        conflicts.append({"field": field, "agents": agents_info})

    return conflicts


# ── LLM dispatch ──────────────────────────────────────────────────────────────

def _pick_llm(definition: dict) -> dict | None:
    preferred = definition.get("llm_instance_name")
    if preferred:
        inst = get_llm_by_name(preferred)
        if inst:
            return inst
    instances = get_llm_instances()
    if instances:
        return instances[0]
    return None


# ── Prompt assembly ───────────────────────────────────────────────────────────

def _build_user_prompt(
    inputs: dict[str, dict],
    definition: dict,
    conflicts: list[dict],
) -> str:
    lines = ["AGENT OUTPUTS:\n"]
    for source in definition.get("input_sources", []):
        agent_name = source["agent_name"]
        msg = inputs.get(agent_name)
        if not msg:
            continue
        label = source.get("label", agent_name)
        base_w = source.get("base_weight", 1.0)
        confidence = msg.get("confidence", 1.0)
        effective_w = round(base_w * confidence, 3)
        content = msg.get("content") or json.dumps(msg.get("output", ""))
        urgency = msg.get("urgency", "")
        urgency_note = f"  [URGENCY: {urgency.upper()}]" if urgency == "critical" else ""
        lines.append(
            f"[{label}] (base_weight={base_w}, validator_confidence={confidence:.2f}, "
            f"effective={effective_w:.2f}){urgency_note}\n{content}\n"
        )

    if conflicts:
        lines.append("\n⚠ CONFLICTS DETECTED — ARBITRATION REQUIRED:")
        for c in conflicts:
            lines.append(f"\n  Field \"{c['field']}\":")
            for a in c["agents"]:
                lines.append(
                    f"    [{a['label']}] (effective_weight={a['effective_weight']}): {a['value']}"
                )
        lines.append(
            "\nFor each conflict: decide which source is better supported by the evidence "
            "and explain your reasoning. Populate \"_conflicts\" in your output with the "
            "field name, which agents disagreed, which you chose, and why."
        )

    lines.append("\nINSTRUCTIONS:")
    persona = definition.get("output_persona", "clinician")
    lines.append(_PERSONA_SUFFIX.get(persona, ""))
    schema_type = definition.get("output_schema_type", "freeform")
    schema_hint = _SCHEMA_SUFFIX.get(schema_type, "")
    if schema_hint:
        lines.append(schema_hint)

    return "\n".join(lines)


# ── Main synthesis entry point ────────────────────────────────────────────────

async def synthesize(
    job_id: str,
    inputs: dict[str, dict],
) -> dict[str, Any]:
    """
    Synthesize collected agent inputs into a single output.

    inputs: { agent_name: { content|output, confidence, urgency, ... } }
    Returns the synthesized result dict.
    """
    definition = load_definition()
    llm = _pick_llm(definition)

    if not llm:
        logger.error("Job %s: no active LLM instance available for aggregator", job_id)
        return {
            "error": "No LLM instance available",
            "partial_inputs": {k: v.get("content", "") for k, v in inputs.items()},
        }

    conflicts = _detect_conflicts(inputs, definition)
    if conflicts:
        logger.info(
            "Job %s: %d conflict(s) detected on fields: %s — using arbitration prompt",
            job_id, len(conflicts), [c["field"] for c in conflicts],
        )

    system_prompt = definition.get("synthesis_prompt") or _DEFAULT_SYSTEM_PROMPT
    user_prompt = _build_user_prompt(inputs, definition, conflicts)

    api_key = get_api_key_for(llm)
    provider = llm.get("provider", "anthropic")
    model_name = llm.get("model_name", "claude-sonnet-4-6")
    base_url = llm.get("base_url", "https://api.anthropic.com")
    max_tokens = definition.get("max_tokens", 2048)
    temperature = definition.get("temperature", 0.3)

    logger.info(
        "Job %s: synthesizing %d inputs via %s/%s",
        job_id, len(inputs), provider, model_name,
    )

    llm_result = await chat_completion(
        messages=[
            {"role": "user", "content": user_prompt},
        ],
        provider=provider,
        base_url=base_url,
        model_name=model_name,
        api_key=api_key,
        max_tokens=max_tokens,
        temperature=temperature,
    )

    await track_response_async(service_name="context_aggregator", result=llm_result)

    raw = llm_result.text
    # Parse JSON output
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        # LLM returned non-JSON — wrap as freeform
        result = {"synthesis": raw, "confidence": 0.5}

    # Merge pre-detected conflicts with any the LLM itself produced
    if conflicts:
        detected_fields = {c["field"] for c in conflicts}
        llm_conflicts = result.get("_conflicts") if isinstance(result.get("_conflicts"), list) else []
        llm_conflict_fields = {c.get("field") for c in llm_conflicts if isinstance(c, dict)}
        # Append pre-detected conflicts not already covered by LLM output
        for c in conflicts:
            if c["field"] not in llm_conflict_fields:
                llm_conflicts.append({
                    "field": c["field"],
                    "agents": [a["name"] for a in c["agents"]],
                    "values": {a["name"]: a["value"] for a in c["agents"]},
                    "resolved": False,
                    "resolution": "LLM did not explicitly arbitrate this field",
                })
        result["_conflicts"] = llm_conflicts

    result["_aggregator"] = {
        "job_id": job_id,
        "inputs_used": list(inputs.keys()),
        "llm": model_name,
        "conflicts_detected": len(conflicts),
        "conflict_fields": [c["field"] for c in conflicts],
    }
    return result
