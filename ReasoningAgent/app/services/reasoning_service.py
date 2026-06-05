"""
Medical Reasoning Service — LLM-agnostic reasoning with streaming to Redis.

Provider resolution order:
  1. LLM Registry (ConfigService /internal/llm/by-agent/reasoning) — priority sorted
  2. Legacy fallback: ANTHROPIC_API_KEY env var + anthropic provider

Input:  transcript (str) + nlp_output (dict) + action (str) + optional feedback (str)
Output: structured dict with soap, differential, lab_suggestions,
        medication_suggestions, next_questions, flag_for_review, overall_confidence
"""
import json
import logging
import os
import re
from app.utils.config_client import get_config, get_llm_instances, get_llm_api_key
from civis_obs import chat_completion, track_response_async
from app.utils.redis_client import write_token, write_stream_done

logger = logging.getLogger(__name__)


def _resolve_llm() -> dict:
    """
    Return the LLM instance dict to use for this call.
    Falls back to an anthropic default if registry returns nothing.
    """
    instances = get_llm_instances()
    if instances:
        return instances[0]  # highest priority
    # Legacy fallback
    api_key = os.getenv("ANTHROPIC_API_KEY") or get_config("anthropic_api_key", "")
    return {
        "provider": "anthropic",
        "base_url": "https://api.anthropic.com",
        "model_name": get_config("anthropic_model", "claude-sonnet-4-6"),
        "api_key_config_key": None,
        "_direct_api_key": api_key,   # private field for fallback path
    }


def _build_prompt(transcript: str, nlp_output: dict | list, action: str, feedback: str | None) -> tuple[str, str]:
    """Return (system_prompt, user_prompt) from ConfigService or built-in defaults."""
    try:
        import httpx
        from app.utils.config_client import CONFIG_SERVICE_URL
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/prompts/medical_reasoning", timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            system = data["system_prompt"]
            user = (
                data["user_prompt"]
                .replace("{{transcript}}", transcript)
                .replace("{{nlp_output}}", json.dumps(nlp_output, indent=2))
                .replace("{{action}}", action or "soap")
            )
            if feedback:
                user += f"\n\nIMPORTANT CORRECTION REQUIRED:\n{feedback}"
            return system, user
    except Exception:
        pass  # fall through to built-in default

    system = _DEFAULT_SYSTEM_PROMPT
    user = _DEFAULT_USER_PROMPT.format(
        transcript=transcript,
        nlp_output=json.dumps(nlp_output, indent=2),
        action=action or "soap",
        feedback_section=f"\n\nIMPORTANT CORRECTION REQUIRED:\n{feedback}" if feedback else "",
    )
    return system, user


async def run_reasoning(
    job_id: str,
    transcript: str,
    nlp_output: dict | list,
    action: str,
    feedback: str | None = None,
) -> dict:
    """
    Stream LLM response to Redis, then return the parsed final output dict.
    Provider is resolved from LLM registry; falls back to direct Anthropic.
    Raises on API error or JSON parse failure.
    """
    llm = _resolve_llm()
    api_key = llm.get("_direct_api_key") or get_llm_api_key(llm)

    # Validate we have an API key for providers that need one
    if llm["provider"] not in ("llamacpp",) and not api_key:
        raise RuntimeError(
            f"No API key found for LLM '{llm.get('name', llm['provider'])}'. "
            f"Set api_key_config_key on the LLM instance or ANTHROPIC_API_KEY env var."
        )

    temperature = float(get_config("llm_temperature", 0.3))
    max_tokens = int(get_config("llm_max_tokens", 2048))
    model_name = llm.get("model_name") or get_config("anthropic_model", "claude-sonnet-4-6")

    system_prompt, user_prompt = _build_prompt(transcript, nlp_output, action, feedback)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt},
    ]

    logger.info(
        "Job %s: running reasoning via %s/%s",
        job_id, llm["provider"], model_name,
    )

    result = await chat_completion(
        messages,
        provider=llm["provider"],
        base_url=llm.get("base_url", ""),
        model_name=model_name,
        api_key=api_key,
        max_tokens=max_tokens,
        temperature=temperature,
        stream_cb=lambda token: write_token(job_id, token),
    )

    await write_stream_done(job_id)
    await track_response_async(service_name="reasoning_agent", result=result)

    full_text = result.text
    # Extract JSON from the completed text
    parsed = _extract_json(full_text)
    if parsed is None:
        raise ValueError(f"Could not extract JSON from reasoning output: {full_text[:200]}")

    logger.info("Job %s: reasoning complete, confidence=%.2f", job_id, parsed.get("overall_confidence", 0))
    return parsed


def _extract_json(text: str) -> dict | None:
    """Find the outermost { ... } block and parse it."""
    text = text.strip()
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s*```$", "", text, flags=re.MULTILINE)
    text = text.strip()

    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


# ── Built-in prompt defaults (also seeded to ConfigService by seed.py) ──────

_DEFAULT_SYSTEM_PROMPT = """\
You are a clinical decision support system embedded in a healthcare platform.
You analyze patient-provider conversations and produce structured clinical outputs.

IMPORTANT CONSTRAINTS:
- You NEVER diagnose — you surface relevant information and flag uncertainty.
- You ONLY use information explicitly present in the transcript and provided context.
- You DO NOT invent symptoms, findings, drugs, or diagnoses.
- If confidence in a section is below 0.70, set flag_for_review to true.
- For medication_suggestions: only include drugs if confidence >= 0.85.

OUTPUT FORMAT (MANDATORY):
Your response MUST be a single valid JSON object with exactly these top-level keys:

{
  "soap": {
    "subjective": ["..."],
    "objective": ["..."],
    "assessment": ["..."],
    "plan": ["..."],
    "confidence": 0.0
  },
  "differential": [
    {"diagnosis": "...", "confidence": 0.0, "rationale": "..."}
  ],
  "lab_suggestions": [
    {"test": "...", "rationale": "...", "urgency": "routine|urgent|stat"}
  ],
  "medication_suggestions": [
    {"name": "...", "dose": "...", "route": "oral", "duration": "...", "rationale": "..."}
  ],
  "next_questions": ["..."],
  "flag_for_review": false,
  "overall_confidence": 0.0
}

Rules:
- Each array may be empty [] if no information supports it.
- Confidence values are floats from 0.0 to 1.0.
- Do NOT include markdown, code fences, or explanations outside the JSON.
- Do NOT nest extra keys beyond the schema above."""

_DEFAULT_USER_PROMPT = """\
Action requested: {action}

Transcript:
{transcript}

Initial NLP Analysis (reference only — do not copy verbatim, use as context):
{nlp_output}

Generate your full clinical reasoning output as a single JSON object.{feedback_section}"""
