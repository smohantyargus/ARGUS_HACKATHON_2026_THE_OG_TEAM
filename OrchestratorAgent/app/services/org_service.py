"""
Organisation service — simple CRUD for org grouping labels.

Orgs are grouping containers for mk_ access keys.
No key generation or auth here — keys are managed via access_key_service.
"""
import logging
from sqlalchemy.orm import Session

from app.models.organisation import Organisation
from app.models.access_key import AccessKey

logger = logging.getLogger(__name__)


def create_org(
    db: Session,
    *,
    name: str,
    created_by: str | None = None,
) -> Organisation:
    org = Organisation(name=name, is_active=True, created_by=created_by)
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


def list_orgs(db: Session) -> list[Organisation]:
    return db.query(Organisation).order_by(Organisation.created_at.desc()).all()


def get_org(db: Session, org_id: str) -> Organisation | None:
    return db.query(Organisation).filter(Organisation.id == org_id).first()


def update_org(db: Session, org_id: str, *, name: str | None = None) -> Organisation | None:
    org = get_org(db, org_id)
    if not org:
        return None
    if name is not None:
        org.name = name
    db.commit()
    db.refresh(org)
    return org


def deactivate_org(db: Session, org_id: str) -> bool:
    org = get_org(db, org_id)
    if not org:
        return False
    org.is_active = False
    db.commit()
    return True


def activate_org(db: Session, org_id: str) -> bool:
    org = get_org(db, org_id)
    if not org:
        return False
    org.is_active = True
    db.commit()
    return True


def list_keys_for_org(db: Session, org_id: str) -> list[AccessKey]:
    return (
        db.query(AccessKey)
        .filter(AccessKey.org_id == org_id)
        .order_by(AccessKey.created_at.desc())
        .all()
    )
