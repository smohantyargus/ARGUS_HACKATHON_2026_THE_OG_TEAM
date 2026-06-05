"""
Multi-domain data platform — schema-as-data models.

Six meta-tables replace the six hardcoded civic tables. Every domain (civic,
finance, logistics, …) is described as rows in these tables; records are stored
as validated JSONB. No per-domain DDL, no container rebuild to add a new domain.

Owner: DataQueryAgent (sole writer/creator). Two read lanes:
  - agents  → Kafka → query_resolver (read-only, query_definitions whitelist)
  - admins  → REST  → CRUD routers   (JWT-gated, validated by dictionary engine)
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Index, Integer, String, Text, UniqueConstraint, JSON,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func


class DomainBase(DeclarativeBase):
    """Separate metadata from ConfigService Base / Orchestrator AppBase."""
    pass


# ── Domain registry ───────────────────────────────────────────────────────────

class Domain(DomainBase):
    __tablename__ = "domains"

    domain_key    = Column(String(50), primary_key=True)   # "civic", "finance"
    name          = Column(String(200), nullable=False)
    description   = Column(Text)
    status        = Column(String(20), default="active")   # active | draft | archived
    owner_user_id = Column(String(64), index=True)         # JWT sub of creator
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class DomainMember(DomainBase):
    __tablename__ = "domain_members"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    domain_key = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    user_id    = Column(String(64), index=True)            # JWT sub
    role       = Column(String(20), default="viewer")      # owner | editor | viewer
    __table_args__ = (UniqueConstraint("domain_key", "user_id"),)


# ── Data dictionary ───────────────────────────────────────────────────────────

class EntityDefinition(DomainBase):
    __tablename__ = "entity_definitions"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    domain_key    = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    entity_key    = Column(String(80), nullable=False)     # "icu_capacity", "region"
    display_name  = Column(String(200))
    description   = Column(Text)
    is_root       = Column(Boolean, default=False)         # region-like top of hierarchy
    parent_entity = Column(String(80))                     # entity_key of parent (same domain)
    strict        = Column(Boolean, default=True)          # reject unknown fields on write
    __table_args__ = (UniqueConstraint("domain_key", "entity_key"),)


class FieldDefinition(DomainBase):
    __tablename__ = "field_definitions"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    entity_id     = Column(Integer, ForeignKey("entity_definitions.id", ondelete="CASCADE"), index=True)
    field_key     = Column(String(80), nullable=False)
    # data_type: string | int | float | bool | datetime | enum | json | ref
    data_type     = Column(String(20), nullable=False, default="string")
    required      = Column(Boolean, default=False)
    default_value = Column(JSON)
    enum_values   = Column(JSON)                           # list of allowed values (data_type=enum)
    ref_entity    = Column(String(80))                     # data_type=ref → entity_key
    min_value     = Column(Float)
    max_value     = Column(Float)
    max_length    = Column(Integer)
    unit          = Column(String(40))                     # "beds", "usd" — display/LLM hint
    description   = Column(Text)
    __table_args__ = (UniqueConstraint("entity_id", "field_key"),)


# ── Query definitions (agent read whitelist) ──────────────────────────────────

class QueryDefinition(DomainBase):
    __tablename__ = "query_definitions"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    domain_key  = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    query_key   = Column(String(80), nullable=False)       # "icu_capacity_by_region"
    entity_key  = Column(String(80), nullable=False)       # primary entity to query
    # filter_spec: {"region_id": "{{region}}"} — JSONB field filters; "record_key" filters record_key col
    filter_spec = Column(JSON)
    # projection: ["total_beds","occupied_beds"] — null = all fields
    projection  = Column(JSON)
    # join_spec: [{"entity_key": "icu_capacity"}] — pull child entities by parent_id
    join_spec   = Column(JSON)
    description = Column(Text)
    __table_args__ = (UniqueConstraint("domain_key", "query_key"),)


# ── Records (generic JSONB store) ─────────────────────────────────────────────

class DomainRecord(DomainBase):
    __tablename__ = "domain_records"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    domain_key  = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"))
    entity_key  = Column(String(80), nullable=False)
    record_key  = Column(String(120))                      # natural/human key e.g. "metro"
    parent_id   = Column(Integer, ForeignKey("domain_records.id", ondelete="CASCADE"))
    data        = Column(JSONB, nullable=False, default=dict)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_records_domain_entity", "domain_key", "entity_key"),
        Index("ix_records_record_key", "domain_key", "entity_key", "record_key"),
        Index("ix_records_data_gin", "data", postgresql_using="gin"),
    )
