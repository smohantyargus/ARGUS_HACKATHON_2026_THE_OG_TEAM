"""Liveness + readiness health endpoints.

Usage:
    from civis_obs.health import make_health_router, check_http, check_redis, check_postgres

    app.include_router(
        make_health_router({
            "config_service": check_http("http://config-service:8010/health/live"),
            "redis": check_redis("redis://redis:6379"),
        })
    )

Endpoints added:
    GET /health/live   — always 200 while process is running
    GET /health/ready  — 200 when all checks pass, 503 otherwise
    GET /health        — alias for /health/live (backward compat)
"""
from __future__ import annotations

import os
from typing import Awaitable, Callable

import httpx
from fastapi import APIRouter, Response

Check = Callable[[], Awaitable[tuple[bool, str]]]


def make_health_router(checks: dict[str, Check] | None = None) -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get("/health/live", include_in_schema=False)
    @router.get("/health", include_in_schema=False)
    async def liveness() -> dict:
        return {"status": "ok"}

    @router.get("/health/ready", include_in_schema=False)
    async def readiness(response: Response) -> dict:
        if not checks:
            return {"status": "ok", "checks": {}}

        results: dict[str, dict] = {}
        all_ok = True
        for name, fn in checks.items():
            try:
                ok, detail = await fn()
            except Exception as exc:
                ok, detail = False, str(exc)
            results[name] = {"ok": ok, "detail": detail}
            if not ok:
                all_ok = False

        if not all_ok:
            response.status_code = 503
        return {"status": "ok" if all_ok else "degraded", "checks": results}

    return router


# ── Built-in check factories ───────────────────────────────────────────────────

def check_http(url: str, timeout: float = 3.0) -> Check:
    """Check that a URL returns 2xx."""
    async def _check() -> tuple[bool, str]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url)
            ok = r.status_code < 300
            return ok, f"HTTP {r.status_code}" if not ok else "ok"
    return _check


def check_redis(url: str | None = None, timeout: float = 2.0) -> Check:
    """Check Redis connectivity with PING."""
    redis_url = url or os.getenv("REDIS_URL", "redis://redis:6379")

    async def _check() -> tuple[bool, str]:
        import redis.asyncio as aioredis
        client = aioredis.from_url(redis_url, socket_connect_timeout=timeout, decode_responses=True)
        try:
            ok = await client.ping()
            return bool(ok), "ok" if ok else "ping returned false"
        finally:
            await client.aclose()
    return _check


def check_postgres(url: str | None = None) -> Check:
    """Check Postgres with SELECT 1 (synchronous — runs in threadpool)."""
    db_url = url or os.getenv("APP_DATABASE_URL") or os.getenv("DATABASE_URL") or os.getenv("URL_DATABASE")

    async def _check() -> tuple[bool, str]:
        import asyncio
        import sqlalchemy

        def _ping() -> tuple[bool, str]:
            try:
                engine = sqlalchemy.create_engine(db_url, pool_pre_ping=True, pool_size=1, max_overflow=0)
                with engine.connect() as conn:
                    conn.execute(sqlalchemy.text("SELECT 1"))
                engine.dispose()
                return True, "ok"
            except Exception as exc:
                return False, str(exc)

        return await asyncio.to_thread(_ping)
    return _check
