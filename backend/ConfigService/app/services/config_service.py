from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.models.config_entry import ConfigEntry
from app.schemas.config_schema import ConfigEntryCreate, ConfigEntryUpdate


def get_agent_config(db: Session, agent_name: str) -> list[ConfigEntry]:
    """Returns all config for an agent, merging global (agent_name=NULL) + agent-specific.
    Agent-specific keys override global keys with the same name."""
    rows = (
        db.query(ConfigEntry)
        .filter(or_(ConfigEntry.agent_name.is_(None), ConfigEntry.agent_name == agent_name))
        .all()
    )
    # Agent-specific overrides global
    merged: dict[str, ConfigEntry] = {}
    for row in rows:
        if row.key not in merged or row.agent_name is not None:
            merged[row.key] = row
    return list(merged.values())


def get_config_by_key(db: Session, agent_name: str, key: str) -> ConfigEntry | None:
    """Returns agent-specific key first, falls back to global."""
    row = (
        db.query(ConfigEntry)
        .filter(ConfigEntry.agent_name == agent_name, ConfigEntry.key == key)
        .first()
    )
    if row:
        return row
    return (
        db.query(ConfigEntry)
        .filter(ConfigEntry.agent_name.is_(None), ConfigEntry.key == key)
        .first()
    )


def upsert_config(db: Session, data: ConfigEntryCreate) -> ConfigEntry:
    """Insert or update a config entry."""
    existing = (
        db.query(ConfigEntry)
        .filter(ConfigEntry.agent_name == data.agent_name, ConfigEntry.key == data.key)
        .first()
    )
    if existing:
        existing.value = data.value
        existing.is_secret = data.is_secret
        if data.description is not None:
            existing.description = data.description
        db.commit()
        db.refresh(existing)
        return existing

    entry = ConfigEntry(**data.model_dump())
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return entry


def update_config(db: Session, agent_name: str | None, key: str, data: ConfigEntryUpdate) -> ConfigEntry | None:
    row = (
        db.query(ConfigEntry)
        .filter(ConfigEntry.agent_name == agent_name, ConfigEntry.key == key)
        .first()
    )
    if not row:
        return None
    row.value = data.value
    if data.is_secret is not None:
        row.is_secret = data.is_secret
    if data.description is not None:
        row.description = data.description
    db.commit()
    db.refresh(row)
    return row


def delete_config(db: Session, agent_name: str | None, key: str) -> bool:
    row = (
        db.query(ConfigEntry)
        .filter(ConfigEntry.agent_name == agent_name, ConfigEntry.key == key)
        .first()
    )
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
