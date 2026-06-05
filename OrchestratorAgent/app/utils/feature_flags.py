"""
Feature flag cache — fetches from ConfigService and caches per role with a 60s TTL.
Used by the require_feature() FastAPI dependency.
"""
import time
import logging
import httpx

logger = logging.getLogger(__name__)

CONFIG_SERVICE_URL = __import__("os").getenv("CONFIG_SERVICE_URL", "http://config-service:8010")

_TTL = 60  # seconds

# Cache: role -> (set_of_enabled_flag_keys, fetched_at_timestamp)
_cache: dict[str, tuple[set[str], float]] = {}


def _fetch(role: str) -> set[str]:
    """Call ConfigService GET /features/ with the role header. Returns set of enabled flag keys."""
    try:
        resp = httpx.get(
            f"{CONFIG_SERVICE_URL}/features/",
            headers={"X-User-Role": role},
            timeout=5,
        )
        resp.raise_for_status()
        return {f["key"] for f in resp.json()}
    except Exception as e:
        logger.warning("Feature flag fetch failed for role=%s: %s", role, e)
        # On failure return empty set — fail closed (deny access rather than allow everything)
        return set()


def get_flags_for_role(role: str) -> set[str]:
    """Return the set of feature keys enabled for a role. Uses in-process TTL cache."""
    cached = _cache.get(role)
    if cached:
        keys, fetched_at = cached
        if time.monotonic() - fetched_at < _TTL:
            return keys

    keys = _fetch(role)
    _cache[role] = (keys, time.monotonic())
    return keys


def invalidate():
    """Clear the cache — forces the next request to re-fetch from ConfigService."""
    _cache.clear()
