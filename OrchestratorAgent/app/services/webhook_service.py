import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timezone, timedelta
from uuid import UUID

import httpx
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models.webhook import Webhook, WebhookDelivery
from app.schemas.webhook_schema import WebhookCreate

logger = logging.getLogger(__name__)

_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = [1, 2, 4]  # delay before attempt 2, 3, 4


def _generate_secret() -> str:
    return secrets.token_hex(32)  # 64-char hex, 256 bits


def create_webhook(db: Session, data: WebhookCreate) -> tuple[Webhook, str]:
    """Create webhook with auto-generated HMAC secret. Returns (webhook, raw_secret)."""
    raw_secret = _generate_secret()
    webhook = Webhook(
        tenant_id=data.tenant_id,
        url=data.url,
        secret=raw_secret,
        events=data.events,
        active=True,
    )
    db.add(webhook)
    db.commit()
    db.refresh(webhook)
    return webhook, raw_secret


def rotate_webhook_secret(db: Session, webhook_id: int) -> tuple[Webhook, str] | None:
    """Generate and store a new secret. Returns (webhook, new_raw_secret) or None if not found."""
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id, Webhook.active.is_(True)).first()
    if not webhook:
        return None
    raw_secret = _generate_secret()
    webhook.secret = raw_secret
    db.commit()
    db.refresh(webhook)
    return webhook, raw_secret


def list_webhooks(db: Session, tenant_id: UUID | None = None) -> list[Webhook]:
    q = db.query(Webhook).filter(Webhook.active.is_(True))
    if tenant_id is not None:
        q = q.filter(
            or_(Webhook.tenant_id == tenant_id, Webhook.tenant_id.is_(None))
        )
    return q.all()


def delete_webhook(db: Session, webhook_id: int) -> bool:
    webhook = db.query(Webhook).filter(Webhook.id == webhook_id).first()
    if not webhook:
        return False
    webhook.active = False
    db.commit()
    return True


def list_deliveries(db: Session, webhook_id: int, limit: int = 50) -> list[WebhookDelivery]:
    return (
        db.query(WebhookDelivery)
        .filter(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
        .all()
    )


async def dispatch_webhooks(
    db: Session,
    event: str,
    payload: dict,
    tenant_id: UUID | None = None,
):
    """
    Send webhook POST to all active webhooks subscribed to this event.

    Tenant scoping: if tenant_id is provided, only fire webhooks where
    webhook.tenant_id matches OR webhook.tenant_id IS NULL (global webhooks).
    Retries up to _MAX_ATTEMPTS times with exponential backoff per webhook.
    Records every attempt in webhook_deliveries.
    """
    q = db.query(Webhook).filter(Webhook.active.is_(True))
    if tenant_id is not None:
        q = q.filter(
            or_(Webhook.tenant_id == tenant_id, Webhook.tenant_id.is_(None))
        )
    webhooks = q.all()

    if not webhooks:
        return

    job_id = payload.get("job_id")
    body = json.dumps({"event": event, "data": payload}, default=str)

    async with httpx.AsyncClient(timeout=10) as client:
        for wh in webhooks:
            if event not in (wh.events or []):
                continue

            headers = {"Content-Type": "application/json"}
            if wh.secret:
                sig = hmac.new(
                    wh.secret.encode(), body.encode(), hashlib.sha256
                ).hexdigest()
                headers["X-civis-Signature"] = f"sha256={sig}"

            last_error: str | None = None
            last_status: int | None = None
            delivered = False

            for attempt in range(1, _MAX_ATTEMPTS + 1):
                if attempt > 1:
                    await asyncio.sleep(_BACKOFF_SECONDS[attempt - 2])

                try:
                    resp = await client.post(wh.url, content=body, headers=headers)
                    last_status = resp.status_code
                    if resp.status_code < 400:
                        delivered = True
                        logger.info(
                            "Webhook %d delivered to %s (attempt=%d status=%d)",
                            wh.id, wh.url, attempt, resp.status_code,
                        )
                        break
                    else:
                        last_error = f"HTTP {resp.status_code}"
                        logger.warning(
                            "Webhook %d got HTTP %d (attempt %d/%d)",
                            wh.id, resp.status_code, attempt, _MAX_ATTEMPTS,
                        )
                except Exception as exc:
                    last_error = str(exc)
                    logger.warning(
                        "Webhook %d delivery error (attempt %d/%d): %s",
                        wh.id, attempt, _MAX_ATTEMPTS, exc,
                    )

            # Record delivery outcome
            try:
                record = WebhookDelivery(
                    webhook_id=wh.id,
                    job_id=job_id,
                    event=event,
                    attempt=attempt,
                    status="success" if delivered else "failed",
                    response_status=last_status,
                    error=last_error if not delivered else None,
                    payload=payload,
                )
                db.add(record)
                db.commit()
            except Exception:
                logger.exception("Failed to record webhook delivery for webhook %d", wh.id)
                try:
                    db.rollback()
                except Exception:
                    pass
