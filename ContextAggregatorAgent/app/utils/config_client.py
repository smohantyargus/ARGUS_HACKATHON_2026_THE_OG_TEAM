"""
Config client for ContextAggregatorAgent.
Fetches AggregatorDefinition + LLM instances from ConfigService.
"""
import os
import time
import logging
import httpx

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
AGGREGATOR_NAME = os.getenv("AGGREGATOR_NAME", "")

_definition_cache: dict | None = None
_llm_cache: list | None = None


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


def load_definition() -> dict:
    global _definition_cache
    if _definition_cache is not None:
        return _definition_cache

    if not AGGREGATOR_NAME:
        raise RuntimeError("AGGREGATOR_NAME env var is required for ContextAggregatorAgent")

    _wait_for_config_service()

    resp = httpx.get(
        f"{CONFIG_SERVICE_URL}/internal/aggregators/{AGGREGATOR_NAME}", timeout=10
    )
    if resp.status_code == 404:
        raise RuntimeError(
            f"No aggregator definition found for AGGREGATOR_NAME={AGGREGATOR_NAME!r}. "
            "Create it via the ConfigService API."
        )
    resp.raise_for_status()
    _definition_cache = resp.json()
    logger.info("Loaded aggregator definition for '%s'", AGGREGATOR_NAME)
    return _definition_cache


def get_llm_instances() -> list[dict]:
    global _llm_cache
    if _llm_cache is not None:
        return _llm_cache
    _wait_for_config_service()
    try:
        resp = httpx.get(
            f"{CONFIG_SERVICE_URL}/internal/llm/by-agent/{AGGREGATOR_NAME}", timeout=5
        )
        _llm_cache = resp.json() if resp.status_code == 200 else []
    except Exception as exc:
        logger.warning("Could not fetch LLM assignments: %s", exc)
        _llm_cache = []
    return _llm_cache


def get_llm_by_name(name: str) -> dict | None:
    try:
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/instances", timeout=5)
        if resp.status_code == 200:
            return next(
                (i for i in resp.json() if i["name"] == name and i["is_active"]), None
            )
    except Exception:
        pass
    return None


def get_api_key_for(llm_instance: dict) -> str | None:
    config_key = llm_instance.get("api_key_config_key")
    if not config_key:
        return None
    try:
        agent_part, key_part = (
            config_key.split("/", 1) if "/" in config_key else ("global", config_key)
        )
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/config/{agent_part}", timeout=5)
        if resp.status_code == 200:
            entries = {e["key"]: e["value"] for e in resp.json()}
            return entries.get(key_part)
    except Exception:
        pass
    return None


def reload():
    global _definition_cache, _llm_cache
    _definition_cache = None
    _llm_cache = None
