"""
Dynamic query resolver — replaces the hardcoded NAMED_QUERIES dict.

Queries are now config-driven rows in `query_definitions`. This keeps the
safety property of the old whitelist: only registered query_keys can run,
and all filtering uses bound parameters (no string interpolation into SQL).

filter_spec keys:
  "record_key"   → filter on domain_records.record_key column
  "parent_id"    → filter on domain_records.parent_id column
  anything else  → JSONB field filter: data->>'key' = value

join_spec items:
  {"entity_key": "icu_capacity"}
  → pull child DomainRecords where parent_id = matched parent record's id
  → merged into the parent row under the child entity_key

Template rendering (filter_spec values):
  "{{region}}" → replaced with params["region"] (exact name match)
"""
from __future__ import annotations

import logging
import re

from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.db.models import DomainRecord, QueryDefinition

logger = logging.getLogger(__name__)

_TEMPLATE_RE = re.compile(r"\{\{(\w+)\}\}")


def _render(template: str, params: dict) -> str:
    return _TEMPLATE_RE.sub(lambda m: str(params.get(m.group(1), "")), template)


def _render_filter(filter_spec: dict | None, params: dict) -> dict:
    if not filter_spec:
        return {}
    return {
        k: (_render(v, params) if isinstance(v, str) else v)
        for k, v in filter_spec.items()
    }


def _record_to_dict(r: DomainRecord, projection: list | None = None) -> dict:
    row: dict = {"_id": r.id, "_record_key": r.record_key, **(r.data or {})}
    if projection:
        row = {k: row[k] for k in projection if k in row}
    return row


def run_query(domain_key: str, query_key: str, params: dict) -> tuple[list[dict], str, str | None]:
    """
    Execute a registered named query. Runs synchronously (call via asyncio.to_thread).

    Returns (rows, status, error):
      status = "ok"    → rows contains results
      status = "error" → rows is [], error is a message string
    """
    with SessionLocal() as db:
        return _run_query_with_session(domain_key, query_key, params, db)


def _run_query_with_session(
    domain_key: str, query_key: str, params: dict, db: Session
) -> tuple[list[dict], str, str | None]:
    qdef = (
        db.query(QueryDefinition)
        .filter_by(domain_key=domain_key, query_key=query_key)
        .first()
    )
    if qdef is None:
        return [], "error", f"unknown query '{query_key}' in domain '{domain_key}'"

    try:
        rendered = _render_filter(qdef.filter_spec, params or {})

        q = db.query(DomainRecord).filter(
            DomainRecord.domain_key == domain_key,
            DomainRecord.entity_key == qdef.entity_key,
        )

        for field_key, value in rendered.items():
            if field_key == "record_key":
                q = q.filter(DomainRecord.record_key == value)
            elif field_key == "parent_id":
                q = q.filter(DomainRecord.parent_id == int(value))
            else:
                q = q.filter(DomainRecord.data[field_key].astext == value)

        records = q.all()
        projection: list | None = qdef.projection
        join_spec: list | None = qdef.join_spec

        rows: list[dict] = []
        for r in records:
            row = _record_to_dict(r, projection if not join_spec else None)

            if join_spec:
                for join in join_spec:
                    child_ekey = join.get("entity_key") or ""
                    if not child_ekey:
                        continue
                    children = (
                        db.query(DomainRecord)
                        .filter(
                            DomainRecord.domain_key == domain_key,
                            DomainRecord.entity_key == child_ekey,
                            DomainRecord.parent_id == r.id,
                        )
                        .all()
                    )
                    row[child_ekey] = [_record_to_dict(c) for c in children]

                if projection:
                    row = {k: row[k] for k in projection if k in row}

            rows.append(row)

        logger.debug(
            "query_resolver: domain=%s query=%s params=%s → %d rows",
            domain_key, query_key, params, len(rows),
        )
        return rows, "ok", None

    except Exception as exc:  # noqa: BLE001
        logger.exception("query_resolver: domain=%s query=%s failed", domain_key, query_key)
        return [], "error", f"{type(exc).__name__}: {exc}"
