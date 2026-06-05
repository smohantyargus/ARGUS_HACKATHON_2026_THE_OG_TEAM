import json
import logging
from typing import Any
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


def log_audit(
    db: Session,
    *,
    actor_type: str,
    action: str,
    resource: str | None = None,
    user_id: str | None = None,
    tenant_id: Any = None,
    ip_address: str | None = None,
    detail: dict | str | None = None,
) -> None:
    """Fire-and-forget audit write. Never raises — logs warning on failure."""
    try:
        detail_str = json.dumps(detail) if isinstance(detail, dict) else detail
        entry = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            actor_type=actor_type,
            action=action,
            resource=resource,
            ip_address=ip_address,
            detail=detail_str,
        )
        db.add(entry)
        db.commit()
    except Exception:
        logger.warning("audit log write failed for action=%s", action, exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
