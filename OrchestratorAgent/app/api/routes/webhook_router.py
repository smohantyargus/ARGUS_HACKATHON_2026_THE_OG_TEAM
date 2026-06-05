from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.app_database import get_app_db
from app.core.auth import get_current_user, require_admin
from app.schemas.webhook_schema import (
    WebhookCreate, WebhookResponse, WebhookDeliveryResponse,
    WebhookCreateResponse, WebhookRotateResponse,
)
from app.services import webhook_service

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


@router.post("/", response_model=WebhookCreateResponse, status_code=status.HTTP_201_CREATED)
def register_webhook(
    data: WebhookCreate,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Register a webhook. Secret auto-generated and shown once in response. Admin only."""
    webhook, raw_secret = webhook_service.create_webhook(db, data)
    return WebhookCreateResponse(
        id=webhook.id,
        tenant_id=webhook.tenant_id,
        url=webhook.url,
        events=webhook.events,
        active=webhook.active,
        created_at=webhook.created_at,
        secret=raw_secret,
    )


@router.get("/", response_model=list[WebhookResponse])
def list_webhooks(
    db: Session = Depends(get_app_db),
    _user: dict = Depends(get_current_user),
):
    return webhook_service.list_webhooks(db)


@router.delete("/{webhook_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_webhook(
    webhook_id: int,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Soft-delete a webhook. Admin only."""
    deleted = webhook_service.delete_webhook(db, webhook_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Webhook not found")


@router.post("/{webhook_id}/rotate-secret", response_model=WebhookRotateResponse)
def rotate_webhook_secret(
    webhook_id: int,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Generate a new HMAC signing secret. New secret shown once — store it immediately. Admin only."""
    result = webhook_service.rotate_webhook_secret(db, webhook_id)
    if not result:
        raise HTTPException(status_code=404, detail="Webhook not found")
    webhook, raw_secret = result
    return WebhookRotateResponse(id=webhook.id, secret=raw_secret)


@router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryResponse])
def get_webhook_deliveries(
    webhook_id: int,
    limit: int = 50,
    db: Session = Depends(get_app_db),
    _user: dict = Depends(require_admin),
):
    """Return recent delivery attempts for a webhook. Admin only."""
    return webhook_service.list_deliveries(db, webhook_id, limit=limit)
