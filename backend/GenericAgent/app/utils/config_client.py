"""
Config client for GenericAgent.
Fetches all AgentDefinitions + LLM assignments from ConfigService.
"""
import logging
import time

import os

import httpx

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")

logger = logging.getLogger(__name__)

_prompts_cache: dict = {}


def _wait_for_config_service(max_retries: int = 10, delay: float = 3.0):
    for attempt in range(1, max_retries + 1):
        try:
            resp = httpx.get(f"{CONFIG_SERVICE_URL}/health", timeout=5)
            if resp.status_code == 200:
                return
        except httpx.ConnectError:
            pass
        logger.info("Waiting for ConfigService (attempt %d/%d)...", attempt, max_retries)
        time.sleep(delay)
    raise RuntimeError(f"ConfigService not available after {max_retries} attempts")


def load_all_definitions() -> list[dict]:
    """
    Fetch all active AgentDefinitions and pre-load LLM + prompt data into each.
    Embeds '_resolved_llm' and '_resolved_api_key' so process_message makes zero
    HTTP calls during execution — required for true async parallel processing.
    """
    _wait_for_config_service()
    resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/agent-definitions/", timeout=10)
    resp.raise_for_status()
    all_defs = resp.json()
    active = [d for d in all_defs if d.get("is_active", True)]

    # Fetch all LLM instances once
    try:
        all_instances_resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/instances", timeout=5)
        all_instances: list[dict] = all_instances_resp.json() if all_instances_resp.status_code == 200 else []
    except Exception:
        all_instances = []

    for defn in active:
        name = defn["name"]
        llm = None
        api_key = None

        # Try preferred LLM by name override
        preferred = defn.get("llm_instance_name")
        if preferred:
            llm = next((i for i in all_instances if i["name"] == preferred and i["is_active"]), None)

        # Fall back to per-agent assignments
        if not llm:
            try:
                r = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/by-agent/{name}", timeout=5)
                assignments = r.json() if r.status_code == 200 else []
                if assignments:
                    assigned_name = assignments[0].get("name") or assignments[0].get("model_name")
                    llm = next((i for i in all_instances if i.get("name") == assigned_name), assignments[0])
            except Exception:
                pass

        if llm:
            api_key = get_api_key_for(llm)

        defn["_resolved_llm"] = llm
        defn["_resolved_api_key"] = api_key

        # Pre-cache prompt template if using prompt_action
        action = defn.get("prompt_action")
        if action and not defn.get("system_prompt") and not defn.get("user_prompt_template"):
            try:
                load_prompt(action)  # warms _prompts_cache
            except Exception as exc:
                logger.warning("Could not pre-cache prompt for action '%s': %s", action, exc)

        logger.info(
            "Agent '%s': LLM=%s prompt=%s",
            name,
            llm.get("name", "?") if llm else "NONE",
            "inline" if (defn.get("system_prompt") or defn.get("user_prompt_template")) else action or "?",
        )

    logger.info("Loaded %d active agent definitions", len(active))
    return active


def get_llm_instances_for(agent_name: str) -> list[dict]:
    """Active LLM instances assigned to a specific agent (sorted by priority)."""
    try:
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/by-agent/{agent_name}", timeout=5)
        return resp.json() if resp.status_code == 200 else []
    except Exception as exc:
        logger.warning("Could not fetch LLM assignments for %s: %s", agent_name, exc)
        return []


def get_llm_by_name(name: str) -> dict | None:
    try:
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/instances", timeout=5)
        if resp.status_code == 200:
            return next((i for i in resp.json() if i["name"] == name and i["is_active"]), None)
    except Exception:
        pass
    return None


def get_api_key_for(llm_instance: dict) -> str | None:
    config_key = llm_instance.get("api_key_config_key")
    if not config_key:
        return None
    try:
        agent_part, key_part = config_key.split("/", 1) if "/" in config_key else ("global", config_key)
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/config/{agent_part}", timeout=5)
        if resp.status_code == 200:
            return {e["key"]: e["value"] for e in resp.json()}.get(key_part)
    except Exception:
        pass
    return None


def load_prompt(action: str) -> dict:
    if action in _prompts_cache:
        return _prompts_cache[action]
    resp = httpx.get(f"{CONFIG_SERVICE_URL}/prompts/{action}", timeout=10)
    resp.raise_for_status()
    _prompts_cache[action] = resp.json()
    return _prompts_cache[action]
