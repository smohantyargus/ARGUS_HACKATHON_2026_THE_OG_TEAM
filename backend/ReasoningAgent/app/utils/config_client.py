"""Lightweight client for the central ConfigService."""
import os
import time
import logging
import httpx

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
AGENT_NAME = os.getenv("AGENT_NAME", "reasoning")

_cache: dict | None = None
_llm_cache: list | None = None   # list of LLM instance dicts sorted by priority


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


def load_agent_config() -> dict:
    global _cache
    if _cache is not None:
        return _cache
    _wait_for_config_service()
    resp = httpx.get(f"{CONFIG_SERVICE_URL}/config/{AGENT_NAME}", timeout=10)
    resp.raise_for_status()
    entries = resp.json()
    _cache = {entry["key"]: entry["value"] for entry in entries}
    logger.info("Loaded %d config entries for agent '%s'", len(_cache), AGENT_NAME)
    return _cache


def get_config(key: str, default=None):
    return load_agent_config().get(key, default)


def get_llm_instances() -> list[dict]:
    """
    Return active LLM instances assigned to this agent (sorted by priority).
    Returns [] if no assignment — caller should fall back to env-var defaults.
    Result is cached for the process lifetime.
    """
    global _llm_cache
    if _llm_cache is not None:
        return _llm_cache
    _wait_for_config_service()
    try:
        resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/llm/by-agent/{AGENT_NAME}", timeout=5)
        _llm_cache = resp.json() if resp.status_code == 200 else []
    except Exception as exc:
        logger.warning("Could not fetch LLM assignments: %s — using defaults", exc)
        _llm_cache = []
    logger.info("LLM assignments for '%s': %d instance(s)", AGENT_NAME, len(_llm_cache))
    return _llm_cache


def get_llm_api_key(llm_instance: dict) -> str | None:
    """Resolve the API key for an LLM instance via its api_key_config_key."""
    config_key = llm_instance.get("api_key_config_key")
    if not config_key:
        return None
    return get_config(config_key, None)
