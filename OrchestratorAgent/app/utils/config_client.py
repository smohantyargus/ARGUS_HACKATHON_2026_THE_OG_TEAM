"""
Lightweight client for the central ConfigService.
Fetches config at startup and caches it in-memory.
"""
import os
import time
import logging
import httpx

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")
AGENT_NAME = os.getenv("AGENT_NAME", "orchestrator")

_cache: dict | None = None
_prompts_cache: dict = {}


def _wait_for_config_service(max_retries: int = 10, delay: float = 3.0):
    """Block until the config service is healthy."""
    for attempt in range(1, max_retries + 1):
        try:
            resp = httpx.get(f"{CONFIG_SERVICE_URL}/health", timeout=5)
            if resp.status_code == 200:
                return
        except (httpx.ConnectError, httpx.TimeoutException):
            pass
        logger.info("Waiting for ConfigService (attempt %d/%d)...", attempt, max_retries)
        time.sleep(delay)
    raise RuntimeError(f"ConfigService not available at {CONFIG_SERVICE_URL} after {max_retries} attempts")


def load_agent_config() -> dict:
    """Fetch all config for this agent (merged with global). Returns {key: value} dict."""
    global _cache
    if _cache is not None:
        return _cache

    _wait_for_config_service()

    # Retry the actual config fetch — ConfigService health may pass but DB may still be reconnecting
    for attempt in range(1, 6):
        try:
            resp = httpx.get(f"{CONFIG_SERVICE_URL}/config/{AGENT_NAME}", timeout=10)
            resp.raise_for_status()
            entries = resp.json()
            _cache = {entry["key"]: entry["value"] for entry in entries}
            logger.info("Loaded %d config entries for agent '%s'", len(_cache), AGENT_NAME)
            return _cache
        except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as e:
            logger.warning("Config fetch attempt %d/5 failed: %s", attempt, e)
            if attempt < 5:
                time.sleep(3)
    raise RuntimeError(f"Failed to load config for '{AGENT_NAME}' after 5 attempts")


def get_config(key: str, default=None):
    """Get a single config value. Loads config if not cached."""
    config = load_agent_config()
    return config.get(key, default)


def load_prompt(action: str) -> dict:
    """Fetch the active prompt template for an action. Returns dict with system_prompt, user_prompt."""
    if action in _prompts_cache:
        return _prompts_cache[action]

    resp = httpx.get(f"{CONFIG_SERVICE_URL}/prompts/{action}", timeout=10)
    resp.raise_for_status()
    data = resp.json()

    _prompts_cache[action] = data
    logger.info("Loaded prompt template for action '%s' (v%d)", action, data.get("version", "?"))
    return data


def reload():
    """Clear caches, forcing next access to re-fetch from ConfigService."""
    global _cache
    _cache = None
    _prompts_cache.clear()
