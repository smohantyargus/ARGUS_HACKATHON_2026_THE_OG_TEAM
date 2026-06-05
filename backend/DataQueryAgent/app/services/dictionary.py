"""
Dictionary validation engine.

Loads entity + field definitions from the DB (cached per domain+entity key)
and validates JSONB record data against them. Every record write goes through
validate_record() so the JSONB store stays well-formed.

Cache is an in-process dict keyed (domain_key, entity_key). Invalidate on
any dictionary write (entity/field add/patch/delete).
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import EntityDefinition, FieldDefinition

logger = logging.getLogger(__name__)

_cache: dict[tuple[str, str], dict] = {}
_cache_lock = threading.Lock()

VALID_TYPES = {"string", "int", "float", "bool", "datetime", "enum", "json", "ref"}


class DictionaryValidationError(ValueError):
    """Raised when record data violates the entity's field definitions."""


# ── Cache helpers ─────────────────────────────────────────────────────────────

def invalidate(domain_key: str, entity_key: str | None = None) -> None:
    with _cache_lock:
        if entity_key:
            _cache.pop((domain_key, entity_key), None)
        else:
            for k in [k for k in _cache if k[0] == domain_key]:
                _cache.pop(k, None)


def _field_to_dict(f: FieldDefinition) -> dict:
    return {
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


def load_entity(domain_key: str, entity_key: str, db: Session) -> dict | None:
    """Return cached entity definition with nested field defs; None if not found."""
    cache_key = (domain_key, entity_key)
    with _cache_lock:
        if cache_key in _cache:
            return _cache[cache_key]

    entity = (
        db.query(EntityDefinition)
        .filter_by(domain_key=domain_key, entity_key=entity_key)
        .first()
    )
    if not entity:
        return None

    fields = db.query(FieldDefinition).filter_by(entity_id=entity.id).all()
    result: dict = {
        "id":            entity.id,
        "domain_key":    entity.domain_key,
        "entity_key":    entity.entity_key,
        "display_name":  entity.display_name,
        "is_root":       entity.is_root,
        "parent_entity": entity.parent_entity,
        "strict":        entity.strict,
        "fields":        {f.field_key: _field_to_dict(f) for f in fields},
    }
    with _cache_lock:
        _cache[cache_key] = result
    return result


# ── Validation ────────────────────────────────────────────────────────────────

def _coerce(value: Any, dtype: str, field_key: str) -> Any:
    try:
        if dtype == "int":
            return int(value)
        if dtype == "float":
            return float(value)
        if dtype == "bool":
            if isinstance(value, bool):
                return value
            if isinstance(value, str):
                return value.lower() in ("true", "1", "yes")
            return bool(value)
        if dtype == "string":
            return str(value)
        # datetime, json, enum, ref → pass through (enum validated separately)
        return value
    except (ValueError, TypeError) as exc:
        raise DictionaryValidationError(
            f"Field '{field_key}': cannot coerce {type(value).__name__} to {dtype}: {exc}"
        )


def validate_record(
    domain_key: str,
    entity_key: str,
    data: dict,
    db: Session,
    *,
    partial: bool = False,
) -> dict:
    """
    Validate and return cleaned data dict.

    partial=True relaxes required-field checks (used for PATCH — only supplied
    fields are validated, absent fields are left as-is in the existing record).
    Raises DictionaryValidationError → route returns 422.
    """
    entity = load_entity(domain_key, entity_key, db)
    if entity is None:
        raise DictionaryValidationError(
            f"Entity '{entity_key}' not found in domain '{domain_key}'"
        )

    field_defs: dict[str, dict] = entity["fields"]
    strict: bool = entity.get("strict", True)

    if strict:
        unknown = set(data.keys()) - set(field_defs.keys())
        if unknown:
            raise DictionaryValidationError(
                f"Unknown fields (strict mode): {sorted(unknown)}"
            )

    cleaned: dict = {}

    for field_key, fdef in field_defs.items():
        if field_key not in data:
            if partial:
                continue
            if fdef.get("required"):
                if fdef.get("default_value") is not None:
                    cleaned[field_key] = fdef["default_value"]
                else:
                    raise DictionaryValidationError(
                        f"Required field '{field_key}' is missing"
                    )
            continue

        value = data[field_key]

        if value is None:
            if fdef.get("required") and not partial:
                raise DictionaryValidationError(
                    f"Required field '{field_key}' cannot be null"
                )
            cleaned[field_key] = None
            continue

        dtype = fdef.get("data_type", "string")
        value = _coerce(value, dtype, field_key)

        if dtype == "enum":
            allowed = fdef.get("enum_values") or []
            if value not in allowed:
                raise DictionaryValidationError(
                    f"Field '{field_key}' must be one of {allowed}, got {value!r}"
                )

        if dtype in ("int", "float"):
            if fdef.get("min_value") is not None and value < fdef["min_value"]:
                raise DictionaryValidationError(
                    f"Field '{field_key}' = {value} < min {fdef['min_value']}"
                )
            if fdef.get("max_value") is not None and value > fdef["max_value"]:
                raise DictionaryValidationError(
                    f"Field '{field_key}' = {value} > max {fdef['max_value']}"
                )

        if dtype == "string" and fdef.get("max_length") and len(str(value)) > fdef["max_length"]:
            raise DictionaryValidationError(
                f"Field '{field_key}' length {len(str(value))} > max_length {fdef['max_length']}"
            )

        cleaned[field_key] = value

    # In non-strict mode, pass through extra fields unchanged
    if not strict:
        for k, v in data.items():
            if k not in cleaned:
                cleaned[k] = v

    return cleaned
