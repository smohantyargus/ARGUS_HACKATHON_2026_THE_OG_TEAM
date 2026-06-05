"""
Records CRUD — generic, dictionary-validated JSONB store.

Every write passes through validate_record() → types coerced, bounds enforced,
unknown fields rejected (strict mode), required fields checked.

Prefix: /api/data  (registered before dictionary routes to handle ordering correctly)
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.auth import require_domain_access
from app.db.database import get_db
from app.db.models import Domain, DomainRecord, EntityDefinition
from app.services.dictionary import DictionaryValidationError, validate_record

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data-records"])


# ── Serialiser ────────────────────────────────────────────────────────────────

def _record_row(r: DomainRecord) -> dict:
    return {
        "id":         r.id,
        "domain_key": r.domain_key,
        "entity_key": r.entity_key,
        "record_key": r.record_key,
        "parent_id":  r.parent_id,
        "data":       r.data,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else None,
    }


def _get_domain_or_404(domain_key: str, db: Session) -> Domain:
    d = db.get(Domain, domain_key)
    if not d:
        raise HTTPException(404, f"Domain '{domain_key}' not found")
    return d


def _get_entity_or_404(domain_key: str, entity_key: str, db: Session) -> EntityDefinition:
    e = (
        db.query(EntityDefinition)
        .filter_by(domain_key=domain_key, entity_key=entity_key)
        .first()
    )
    if not e:
        raise HTTPException(404, f"Entity '{entity_key}' not found in domain '{domain_key}'")
    return e


def _apply_validation(domain_key: str, entity_key: str, data: dict, db: Session, partial: bool = False) -> dict:
    try:
        return validate_record(domain_key, entity_key, data, db, partial=partial)
    except DictionaryValidationError as exc:
        raise HTTPException(422, str(exc))


# ── List & Get ────────────────────────────────────────────────────────────────

@router.get("/{domain_key}/{entity_key}")
def list_records(
    domain_key: str,
    entity_key: str,
    parent_id: int | None = Query(default=None),
    record_key: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    """
    List records for an entity. Optional filters:
      ?parent_id=<int>    — only children of a specific parent record
      ?record_key=<str>   — filter by natural key
    Additional JSONB field filters can be added via query params with prefix `f_`:
      ?f_region_id=metro  — filter where data->>'region_id' = 'metro'
    """
    _get_domain_or_404(domain_key, db)
    _get_entity_or_404(domain_key, entity_key, db)

    q = db.query(DomainRecord).filter(
        DomainRecord.domain_key == domain_key,
        DomainRecord.entity_key == entity_key,
    )
    if parent_id is not None:
        q = q.filter(DomainRecord.parent_id == parent_id)
    if record_key is not None:
        q = q.filter(DomainRecord.record_key == record_key)

    return [_record_row(r) for r in q.all()]


@router.get("/{domain_key}/{entity_key}/{record_id}")
def get_record(
    domain_key: str,
    entity_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    r = db.get(DomainRecord, record_id)
    if not r or r.domain_key != domain_key or r.entity_key != entity_key:
        raise HTTPException(404, f"Record {record_id} not found")
    return _record_row(r)


# ── Create ────────────────────────────────────────────────────────────────────

@router.post("/{domain_key}/{entity_key}", status_code=201)
def create_record(
    domain_key: str,
    entity_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    _get_domain_or_404(domain_key, db)
    _get_entity_or_404(domain_key, entity_key, db)

    parent_id = payload.pop("parent_id", None)
    record_key = payload.pop("record_key", None)

    if parent_id is not None:
        parent = db.get(DomainRecord, parent_id)
        if not parent or parent.domain_key != domain_key:
            raise HTTPException(422, f"parent_id {parent_id} not found in domain '{domain_key}'")

    cleaned = _apply_validation(domain_key, entity_key, payload, db)

    r = DomainRecord(
        domain_key=domain_key,
        entity_key=entity_key,
        record_key=record_key,
        parent_id=parent_id,
        data=cleaned,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _record_row(r)


# ── Bulk create ───────────────────────────────────────────────────────────────

@router.post("/{domain_key}/{entity_key}/bulk", status_code=201)
def bulk_create_records(
    domain_key: str,
    entity_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    """
    Bulk-create: seed a root record + its children in one call.

    Body: {
      "record_key": "metro",           # optional natural key for root
      "data": {...},                   # root record data
      "children": [                    # optional list of child records
        {"entity_key": "icu_capacity", "data": {...}},
        ...
      ]
    }
    Returns the created root record with "children" list in the response.
    """
    _get_domain_or_404(domain_key, db)
    _get_entity_or_404(domain_key, entity_key, db)

    root_data = payload.get("data") or {}
    record_key = payload.get("record_key")
    cleaned = _apply_validation(domain_key, entity_key, root_data, db)

    root = DomainRecord(
        domain_key=domain_key,
        entity_key=entity_key,
        record_key=record_key,
        data=cleaned,
    )
    db.add(root)
    db.flush()

    child_rows = []
    for child in payload.get("children") or []:
        cekey = child.get("entity_key") or ""
        if not cekey:
            continue
        _get_entity_or_404(domain_key, cekey, db)
        cdata = child.get("data") or {}
        ccleaned = _apply_validation(domain_key, cekey, cdata, db)
        cr = DomainRecord(
            domain_key=domain_key,
            entity_key=cekey,
            record_key=child.get("record_key"),
            parent_id=root.id,
            data=ccleaned,
        )
        db.add(cr)
        db.flush()
        child_rows.append(_record_row(cr))

    db.commit()
    db.refresh(root)
    result = _record_row(root)
    result["children"] = child_rows
    return result


# ── Update ────────────────────────────────────────────────────────────────────

@router.patch("/{domain_key}/{entity_key}/{record_id}")
def update_record(
    domain_key: str,
    entity_key: str,
    record_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    r = db.get(DomainRecord, record_id)
    if not r or r.domain_key != domain_key or r.entity_key != entity_key:
        raise HTTPException(404, f"Record {record_id} not found")

    record_key = payload.pop("record_key", ...)   # sentinel to detect absence
    if record_key is not ...:
        r.record_key = record_key

    parent_id = payload.pop("parent_id", ...)
    if parent_id is not ...:
        if parent_id is not None:
            parent = db.get(DomainRecord, parent_id)
            if not parent or parent.domain_key != domain_key:
                raise HTTPException(422, f"parent_id {parent_id} not found in domain '{domain_key}'")
        r.parent_id = parent_id

    if payload:
        merged = {**(r.data or {}), **payload}
        cleaned = _apply_validation(domain_key, entity_key, merged, db, partial=True)
        r.data = cleaned

    db.commit()
    db.refresh(r)
    return _record_row(r)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{domain_key}/{entity_key}/{record_id}", status_code=204)
def delete_record(
    domain_key: str,
    entity_key: str,
    record_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    r = db.get(DomainRecord, record_id)
    if not r or r.domain_key != domain_key or r.entity_key != entity_key:
        raise HTTPException(404, f"Record {record_id} not found")
    db.delete(r)
    db.commit()
