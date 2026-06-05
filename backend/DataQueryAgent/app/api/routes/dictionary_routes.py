"""
Dictionary CRUD — domains, entities, fields, query definitions, members, onboarding.

GET routes open (no auth) for internal service-to-service reads.
Mutating routes require JWT. Domain-scoped routes require membership.

Prefix: /api/data
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import require_auth, require_domain_access, require_write_auth
from app.db.database import get_db
from app.db.models import (
    Domain, DomainMember, EntityDefinition, FieldDefinition,
    QueryDefinition,
)
from app.services.dictionary import invalidate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data-dictionary"])


# ── Serialisers ───────────────────────────────────────────────────────────────

def _domain_row(d: Domain) -> dict:
    return {
        "domain_key":    d.domain_key,
        "name":          d.name,
        "description":   d.description,
        "status":        d.status,
        "owner_user_id": d.owner_user_id,
        "created_at":    d.created_at.isoformat() if d.created_at else None,
        "updated_at":    d.updated_at.isoformat() if d.updated_at else None,
    }


def _entity_row(e: EntityDefinition) -> dict:
    return {
        "id":            e.id,
        "domain_key":    e.domain_key,
        "entity_key":    e.entity_key,
        "display_name":  e.display_name,
        "description":   e.description,
        "is_root":       e.is_root,
        "parent_entity": e.parent_entity,
        "strict":        e.strict,
    }


def _field_row(f: FieldDefinition) -> dict:
    return {
        "id":            f.id,
        "entity_id":     f.entity_id,
        "field_key":     f.field_key,
        "data_type":     f.data_type,
        "required":      f.required,
        "default_value": f.default_value,
        "enum_values":   f.enum_values,
        "ref_entity":    f.ref_entity,
        "min_value":     f.min_value,
        "max_value":     f.max_value,
        "max_length":    f.max_length,
        "unit":          f.unit,
        "description":   f.description,
    }


def _query_row(q: QueryDefinition) -> dict:
    return {
        "id":          q.id,
        "domain_key":  q.domain_key,
        "query_key":   q.query_key,
        "entity_key":  q.entity_key,
        "filter_spec": q.filter_spec,
        "projection":  q.projection,
        "join_spec":   q.join_spec,
        "description": q.description,
    }


def _member_row(m: DomainMember) -> dict:
    return {"id": m.id, "domain_key": m.domain_key, "user_id": m.user_id, "role": m.role}


# ── Helpers ───────────────────────────────────────────────────────────────────

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


# ── Domains ───────────────────────────────────────────────────────────────────

@router.get("/domains")
def list_domains(db: Session = Depends(get_db), creds: dict = Depends(require_auth)):
    """List domains the caller has access to (superadmin = all)."""
    if creds.get("role") == "superadmin":
        domains = db.query(Domain).order_by(Domain.domain_key).all()
    else:
        user_id = creds.get("sub")
        member_keys = [
            m.domain_key for m in db.query(DomainMember).filter_by(user_id=user_id).all()
        ]
        domains = (
            db.query(Domain)
            .filter(Domain.domain_key.in_(member_keys))
            .order_by(Domain.domain_key)
            .all()
        )
    return [_domain_row(d) for d in domains]


@router.get("/domains/{domain_key}")
def get_domain(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    return _domain_row(_get_domain_or_404(domain_key, db))


@router.post("/domains", status_code=201)
def create_domain(
    payload: dict,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
):
    key = payload.get("domain_key") or ""
    if not key:
        raise HTTPException(422, "domain_key required")
    if db.get(Domain, key):
        raise HTTPException(409, f"Domain '{key}' already exists")
    owner = payload.get("owner_user_id") or claims.get("sub")
    d = Domain(
        domain_key=key,
        name=payload.get("name") or key,
        description=payload.get("description"),
        status=payload.get("status", "active"),
        owner_user_id=owner,
    )
    db.add(d)
    db.flush()
    db.add(DomainMember(domain_key=key, user_id=owner, role="owner"))
    db.commit()
    db.refresh(d)
    return _domain_row(d)


@router.patch("/domains/{domain_key}")
def update_domain(
    domain_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    d = _get_domain_or_404(domain_key, db)
    for k in ("name", "description", "status"):
        if k in payload:
            setattr(d, k, payload[k])
    db.commit()
    db.refresh(d)
    return _domain_row(d)


@router.delete("/domains/{domain_key}", status_code=204)
def delete_domain(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("own")),
):
    d = _get_domain_or_404(domain_key, db)
    db.delete(d)
    db.commit()
    invalidate(domain_key)


# ── Entities ──────────────────────────────────────────────────────────────────

@router.get("/domains/{domain_key}/entities")
def list_entities(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    _get_domain_or_404(domain_key, db)
    rows = (
        db.query(EntityDefinition)
        .filter_by(domain_key=domain_key)
        .order_by(EntityDefinition.entity_key)
        .all()
    )
    return [_entity_row(e) for e in rows]


@router.get("/domains/{domain_key}/entities/{entity_key}")
def get_entity(
    domain_key: str,
    entity_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    return _entity_row(_get_entity_or_404(domain_key, entity_key, db))


@router.post("/domains/{domain_key}/entities", status_code=201)
def create_entity(
    domain_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    _get_domain_or_404(domain_key, db)
    ekey = payload.get("entity_key") or ""
    if not ekey:
        raise HTTPException(422, "entity_key required")
    if (
        db.query(EntityDefinition)
        .filter_by(domain_key=domain_key, entity_key=ekey)
        .first()
    ):
        raise HTTPException(409, f"Entity '{ekey}' already exists in domain '{domain_key}'")
    e = EntityDefinition(
        domain_key=domain_key,
        entity_key=ekey,
        display_name=payload.get("display_name"),
        description=payload.get("description"),
        is_root=payload.get("is_root", False),
        parent_entity=payload.get("parent_entity"),
        strict=payload.get("strict", True),
    )
    db.add(e)
    db.commit()
    db.refresh(e)
    invalidate(domain_key, ekey)
    return _entity_row(e)


@router.patch("/domains/{domain_key}/entities/{entity_key}")
def update_entity(
    domain_key: str,
    entity_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    for k in ("display_name", "description", "is_root", "parent_entity", "strict"):
        if k in payload:
            setattr(e, k, payload[k])
    db.commit()
    db.refresh(e)
    invalidate(domain_key, entity_key)
    return _entity_row(e)


@router.delete("/domains/{domain_key}/entities/{entity_key}", status_code=204)
def delete_entity(
    domain_key: str,
    entity_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    db.delete(e)
    db.commit()
    invalidate(domain_key, entity_key)


# ── Fields ────────────────────────────────────────────────────────────────────

@router.get("/domains/{domain_key}/entities/{entity_key}/fields")
def list_fields(
    domain_key: str,
    entity_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    rows = db.query(FieldDefinition).filter_by(entity_id=e.id).all()
    return [_field_row(f) for f in rows]


@router.post("/domains/{domain_key}/entities/{entity_key}/fields", status_code=201)
def create_field(
    domain_key: str,
    entity_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    fkey = payload.get("field_key") or ""
    if not fkey:
        raise HTTPException(422, "field_key required")
    if db.query(FieldDefinition).filter_by(entity_id=e.id, field_key=fkey).first():
        raise HTTPException(409, f"Field '{fkey}' already exists on entity '{entity_key}'")
    f = FieldDefinition(
        entity_id=e.id,
        field_key=fkey,
        data_type=payload.get("data_type", "string"),
        required=payload.get("required", False),
        default_value=payload.get("default_value"),
        enum_values=payload.get("enum_values"),
        ref_entity=payload.get("ref_entity"),
        min_value=payload.get("min_value"),
        max_value=payload.get("max_value"),
        max_length=payload.get("max_length"),
        unit=payload.get("unit"),
        description=payload.get("description"),
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    invalidate(domain_key, entity_key)
    return _field_row(f)


@router.patch("/domains/{domain_key}/entities/{entity_key}/fields/{field_key}")
def update_field(
    domain_key: str,
    entity_key: str,
    field_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    f = db.query(FieldDefinition).filter_by(entity_id=e.id, field_key=field_key).first()
    if not f:
        raise HTTPException(404, f"Field '{field_key}' not found")
    allowed = {
        "data_type", "required", "default_value", "enum_values",
        "ref_entity", "min_value", "max_value", "max_length", "unit", "description",
    }
    for k, v in payload.items():
        if k in allowed:
            setattr(f, k, v)
    db.commit()
    db.refresh(f)
    invalidate(domain_key, entity_key)
    return _field_row(f)


@router.delete("/domains/{domain_key}/entities/{entity_key}/fields/{field_key}", status_code=204)
def delete_field(
    domain_key: str,
    entity_key: str,
    field_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    e = _get_entity_or_404(domain_key, entity_key, db)
    f = db.query(FieldDefinition).filter_by(entity_id=e.id, field_key=field_key).first()
    if not f:
        raise HTTPException(404, f"Field '{field_key}' not found")
    db.delete(f)
    db.commit()
    invalidate(domain_key, entity_key)


# ── Query definitions ─────────────────────────────────────────────────────────

@router.get("/domains/{domain_key}/queries")
def list_queries(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    _get_domain_or_404(domain_key, db)
    rows = db.query(QueryDefinition).filter_by(domain_key=domain_key).all()
    return [_query_row(q) for q in rows]


@router.post("/domains/{domain_key}/queries", status_code=201)
def create_query(
    domain_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    _get_domain_or_404(domain_key, db)
    qkey = payload.get("query_key") or ""
    ekey = payload.get("entity_key") or ""
    if not qkey or not ekey:
        raise HTTPException(422, "query_key and entity_key required")
    if db.query(QueryDefinition).filter_by(domain_key=domain_key, query_key=qkey).first():
        raise HTTPException(409, f"Query '{qkey}' already exists in domain '{domain_key}'")
    q = QueryDefinition(
        domain_key=domain_key,
        query_key=qkey,
        entity_key=ekey,
        filter_spec=payload.get("filter_spec"),
        projection=payload.get("projection"),
        join_spec=payload.get("join_spec"),
        description=payload.get("description"),
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    return _query_row(q)


@router.patch("/domains/{domain_key}/queries/{query_key}")
def update_query(
    domain_key: str,
    query_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    q = db.query(QueryDefinition).filter_by(domain_key=domain_key, query_key=query_key).first()
    if not q:
        raise HTTPException(404, f"Query '{query_key}' not found in domain '{domain_key}'")
    for k in ("entity_key", "filter_spec", "projection", "join_spec", "description"):
        if k in payload:
            setattr(q, k, payload[k])
    db.commit()
    db.refresh(q)
    return _query_row(q)


@router.delete("/domains/{domain_key}/queries/{query_key}", status_code=204)
def delete_query(
    domain_key: str,
    query_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("edit")),
):
    q = db.query(QueryDefinition).filter_by(domain_key=domain_key, query_key=query_key).first()
    if not q:
        raise HTTPException(404, f"Query '{query_key}' not found in domain '{domain_key}'")
    db.delete(q)
    db.commit()


# ── Dictionary export/import ──────────────────────────────────────────────────

@router.get("/domains/{domain_key}/dictionary")
def export_dictionary(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    """Export full domain dictionary (entities + fields + queries) as a bundle."""
    d = _get_domain_or_404(domain_key, db)
    entities = db.query(EntityDefinition).filter_by(domain_key=domain_key).all()
    bundle_entities = []
    for e in entities:
        fields = db.query(FieldDefinition).filter_by(entity_id=e.id).all()
        bundle_entities.append({**_entity_row(e), "fields": [_field_row(f) for f in fields]})
    queries = db.query(QueryDefinition).filter_by(domain_key=domain_key).all()
    return {
        "domain": _domain_row(d),
        "entities": bundle_entities,
        "queries": [_query_row(q) for q in queries],
    }


@router.post("/import", status_code=201)
def import_dictionary(
    payload: dict,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
):
    """
    Create a domain from a full bundle (domain + entities + fields + queries).
    Same shape as the export endpoint output. Idempotent: existing entities/fields
    are skipped (409 on duplicate domain_key).
    """
    domain_data = payload.get("domain") or {}
    key = domain_data.get("domain_key") or payload.get("domain_key") or ""
    if not key:
        raise HTTPException(422, "domain.domain_key required")
    if db.get(Domain, key):
        raise HTTPException(409, f"Domain '{key}' already exists")

    owner = domain_data.get("owner_user_id") or claims.get("sub")
    d = Domain(
        domain_key=key,
        name=domain_data.get("name") or key,
        description=domain_data.get("description"),
        status=domain_data.get("status", "active"),
        owner_user_id=owner,
    )
    db.add(d)
    db.flush()
    db.add(DomainMember(domain_key=key, user_id=owner, role="owner"))

    for edata in payload.get("entities") or []:
        ekey = edata.get("entity_key") or ""
        if not ekey:
            continue
        e = EntityDefinition(
            domain_key=key,
            entity_key=ekey,
            display_name=edata.get("display_name"),
            description=edata.get("description"),
            is_root=edata.get("is_root", False),
            parent_entity=edata.get("parent_entity"),
            strict=edata.get("strict", True),
        )
        db.add(e)
        db.flush()
        for fdata in edata.get("fields") or []:
            fkey = fdata.get("field_key") or ""
            if not fkey:
                continue
            db.add(FieldDefinition(
                entity_id=e.id,
                field_key=fkey,
                data_type=fdata.get("data_type", "string"),
                required=fdata.get("required", False),
                default_value=fdata.get("default_value"),
                enum_values=fdata.get("enum_values"),
                ref_entity=fdata.get("ref_entity"),
                min_value=fdata.get("min_value"),
                max_value=fdata.get("max_value"),
                max_length=fdata.get("max_length"),
                unit=fdata.get("unit"),
                description=fdata.get("description"),
            ))

    for qdata in payload.get("queries") or []:
        qkey = qdata.get("query_key") or ""
        ekey = qdata.get("entity_key") or ""
        if not qkey or not ekey:
            continue
        db.add(QueryDefinition(
            domain_key=key,
            query_key=qkey,
            entity_key=ekey,
            filter_spec=qdata.get("filter_spec"),
            projection=qdata.get("projection"),
            join_spec=qdata.get("join_spec"),
            description=qdata.get("description"),
        ))

    db.commit()
    db.refresh(d)
    return _domain_row(d)


# ── Members & onboarding ──────────────────────────────────────────────────────

@router.get("/domains/{domain_key}/members")
def list_members(
    domain_key: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("view")),
):
    _get_domain_or_404(domain_key, db)
    rows = db.query(DomainMember).filter_by(domain_key=domain_key).all()
    return [_member_row(m) for m in rows]


@router.post("/domains/{domain_key}/members", status_code=201)
def add_member(
    domain_key: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("own")),
):
    _get_domain_or_404(domain_key, db)
    user_id = payload.get("user_id") or ""
    if not user_id:
        raise HTTPException(422, "user_id required")
    role = payload.get("role", "viewer")
    if role not in ("owner", "editor", "viewer"):
        raise HTTPException(422, "role must be owner | editor | viewer")
    existing = db.query(DomainMember).filter_by(domain_key=domain_key, user_id=user_id).first()
    if existing:
        raise HTTPException(409, f"User '{user_id}' is already a member of '{domain_key}'")
    m = DomainMember(domain_key=domain_key, user_id=user_id, role=role)
    db.add(m)
    db.commit()
    db.refresh(m)
    return _member_row(m)


@router.patch("/domains/{domain_key}/members/{user_id}")
def update_member(
    domain_key: str,
    user_id: str,
    payload: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("own")),
):
    m = db.query(DomainMember).filter_by(domain_key=domain_key, user_id=user_id).first()
    if not m:
        raise HTTPException(404, f"Member '{user_id}' not found in domain '{domain_key}'")
    role = payload.get("role")
    if role and role not in ("owner", "editor", "viewer"):
        raise HTTPException(422, "role must be owner | editor | viewer")
    if role:
        m.role = role
    db.commit()
    db.refresh(m)
    return _member_row(m)


@router.delete("/domains/{domain_key}/members/{user_id}", status_code=204)
def remove_member(
    domain_key: str,
    user_id: str,
    db: Session = Depends(get_db),
    _: dict = Depends(require_domain_access("own")),
):
    m = db.query(DomainMember).filter_by(domain_key=domain_key, user_id=user_id).first()
    if not m:
        raise HTTPException(404, f"Member '{user_id}' not found in domain '{domain_key}'")
    db.delete(m)
    db.commit()


@router.post("/onboard", status_code=201)
def onboard(
    payload: dict,
    db: Session = Depends(get_db),
    claims: dict = Depends(require_auth),
):
    """
    One-call tenant onboarding: create domain + owner + optional dictionary bundle.

    Body: {domain_key, name, owner_user_id?, description?, dictionary?}
    where dictionary has the same shape as /import body.
    """
    key = payload.get("domain_key") or ""
    if not key:
        raise HTTPException(422, "domain_key required")
    if db.get(Domain, key):
        raise HTTPException(409, f"Domain '{key}' already exists")

    owner = payload.get("owner_user_id") or claims.get("sub")
    d = Domain(
        domain_key=key,
        name=payload.get("name") or key,
        description=payload.get("description"),
        status="active",
        owner_user_id=owner,
    )
    db.add(d)
    db.flush()
    db.add(DomainMember(domain_key=key, user_id=owner, role="owner"))
    db.commit()

    # If dictionary bundle provided, delegate to import logic inline
    dictionary = payload.get("dictionary")
    if dictionary:
        dictionary["domain_key"] = key
        if "domain" not in dictionary:
            dictionary["domain"] = {"domain_key": key, "owner_user_id": owner}
        # Re-use import endpoint logic: call it with a fake claims dict
        # (owner already created, skip domain creation)
        for edata in dictionary.get("entities") or []:
            ekey = edata.get("entity_key") or ""
            if not ekey:
                continue
            e = EntityDefinition(
                domain_key=key, entity_key=ekey,
                display_name=edata.get("display_name"),
                description=edata.get("description"),
                is_root=edata.get("is_root", False),
                parent_entity=edata.get("parent_entity"),
                strict=edata.get("strict", True),
            )
            db.add(e)
            db.flush()
            for fdata in edata.get("fields") or []:
                fkey = fdata.get("field_key") or ""
                if not fkey:
                    continue
                db.add(FieldDefinition(
                    entity_id=e.id, field_key=fkey,
                    data_type=fdata.get("data_type", "string"),
                    required=fdata.get("required", False),
                    default_value=fdata.get("default_value"),
                    enum_values=fdata.get("enum_values"),
                    ref_entity=fdata.get("ref_entity"),
                    min_value=fdata.get("min_value"),
                    max_value=fdata.get("max_value"),
                    max_length=fdata.get("max_length"),
                    unit=fdata.get("unit"),
                    description=fdata.get("description"),
                ))
        for qdata in dictionary.get("queries") or []:
            qkey = qdata.get("query_key") or ""
            ekey = qdata.get("entity_key") or ""
            if not qkey or not ekey:
                continue
            db.add(QueryDefinition(
                domain_key=key, query_key=qkey, entity_key=ekey,
                filter_spec=qdata.get("filter_spec"),
                projection=qdata.get("projection"),
                join_spec=qdata.get("join_spec"),
                description=qdata.get("description"),
            ))
        db.commit()

    db.refresh(d)
    return _domain_row(d)
