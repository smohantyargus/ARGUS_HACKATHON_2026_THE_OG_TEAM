import os
import time
import logging
import httpx

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = os.getenv("CONFIG_SERVICE_URL", "http://config-service:8010")


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
    raise RuntimeError("ConfigService not available")


def fetch_merger_definitions() -> list[dict]:
    """Fetch all active ResponseMerger definitions."""
    _wait_for_config_service()
    resp = httpx.get(f"{CONFIG_SERVICE_URL}/internal/response-mergers/", timeout=10)
    resp.raise_for_status()
    return [m for m in resp.json() if m.get("is_active")]
