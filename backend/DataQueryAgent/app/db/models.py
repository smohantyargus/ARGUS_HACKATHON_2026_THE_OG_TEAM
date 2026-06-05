"""
Civic domain tables — the ground-truth facts specialist agents reason over.

Owned by DataQueryAgent (this service is the only writer/creator). Mapped from the
pandemic-response scenario in assets/seed_city_state.json. Strictly read-only at
query time — see app/services/queries.py.
"""
from __future__ import annotations

from sqlalchemy import Column, Integer, BigInteger, Float, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.sql import func


class DomainBase(DeclarativeBase):
    """Separate metadata from ConfigService Base / Orchestrator AppBase."""
    pass


class Region(DomainBase):
    __tablename__ = "regions"

    region_id = Column(String(50), primary_key=True)   # e.g. "metro"
    name = Column(String(200), nullable=False)
    population = Column(BigInteger, nullable=True)


class IcuCapacity(DomainBase):
    __tablename__ = "icu_capacity"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(String(50), ForeignKey("regions.region_id"), nullable=False, index=True)
    total_beds = Column(Integer, nullable=False)
    occupied_beds = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime(timezone=True), server_default=func.now())


class EconomicIndicator(DomainBase):
    __tablename__ = "economic_indicators"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(String(50), ForeignKey("regions.region_id"), nullable=False, index=True)
    daily_loss_usd = Column(BigInteger, nullable=False)
    hourly_worker_pct = Column(Float, nullable=True)


class SupplyInventory(DomainBase):
    __tablename__ = "supply_inventory"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(String(50), ForeignKey("regions.region_id"), nullable=False, index=True)
    item = Column(String(100), nullable=False)
    days_remaining = Column(Integer, nullable=False)
    source_terminal = Column(String(100), nullable=True)


class ComplianceMetric(DomainBase):
    __tablename__ = "compliance_metrics"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(String(50), ForeignKey("regions.region_id"), nullable=False, index=True)
    cooperation_break_day = Column(Integer, nullable=True)
    note = Column(Text, nullable=True)


class HealthcareOps(DomainBase):
    __tablename__ = "healthcare_ops"

    id = Column(Integer, primary_key=True, autoincrement=True)
    region_id = Column(String(50), ForeignKey("regions.region_id"), nullable=False, index=True)
    medical_staff = Column(Integer, nullable=True)
    absenteeism_pct = Column(Float, nullable=True)
    school_policy = Column(String(200), nullable=True)
