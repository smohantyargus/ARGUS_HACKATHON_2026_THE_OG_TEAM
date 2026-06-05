"""
NAMED_QUERIES — the whitelist of read-only queries this agent will run.

Each handler takes (session, params) and returns a list[dict]. Only SELECTs via
the ORM; params are bound, never string-formatted. Any query_name not in this
dict is rejected by the agent, so there is no free-form SQL surface.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.db.models import (
    Region,
    IcuCapacity,
    EconomicIndicator,
    SupplyInventory,
    ComplianceMetric,
    HealthcareOps,
)


def _region(params: dict) -> str:
    return str(params.get("region") or params.get("region_id") or "").strip()


def list_regions(db: Session, params: dict) -> list[dict]:
    rows = db.query(Region).order_by(Region.region_id).all()
    return [{"region_id": r.region_id, "name": r.name, "population": r.population} for r in rows]


def icu_capacity_by_region(db: Session, params: dict) -> list[dict]:
    region = _region(params)
    rows = db.query(IcuCapacity).filter(IcuCapacity.region_id == region).all()
    return [
        {
            "region_id": r.region_id,
            "total_beds": r.total_beds,
            "occupied_beds": r.occupied_beds,
            "available_beds": r.total_beds - r.occupied_beds,
        }
        for r in rows
    ]


def economic_indicators_by_region(db: Session, params: dict) -> list[dict]:
    region = _region(params)
    rows = db.query(EconomicIndicator).filter(EconomicIndicator.region_id == region).all()
    return [
        {"region_id": r.region_id, "daily_loss_usd": r.daily_loss_usd, "hourly_worker_pct": r.hourly_worker_pct}
        for r in rows
    ]


def supply_runway(db: Session, params: dict) -> list[dict]:
    region = _region(params)
    rows = db.query(SupplyInventory).filter(SupplyInventory.region_id == region).all()
    return [
        {
            "region_id": r.region_id,
            "item": r.item,
            "days_remaining": r.days_remaining,
            "source_terminal": r.source_terminal,
        }
        for r in rows
    ]


def compliance_outlook(db: Session, params: dict) -> list[dict]:
    region = _region(params)
    rows = db.query(ComplianceMetric).filter(ComplianceMetric.region_id == region).all()
    return [
        {"region_id": r.region_id, "cooperation_break_day": r.cooperation_break_day, "note": r.note}
        for r in rows
    ]


def healthcare_ops_by_region(db: Session, params: dict) -> list[dict]:
    region = _region(params)
    rows = db.query(HealthcareOps).filter(HealthcareOps.region_id == region).all()
    return [
        {
            "region_id": r.region_id,
            "medical_staff": r.medical_staff,
            "absenteeism_pct": r.absenteeism_pct,
            "school_policy": r.school_policy,
        }
        for r in rows
    ]


def region_snapshot(db: Session, params: dict) -> list[dict]:
    """Everything known about one region, merged into a single row."""
    region = _region(params)
    base = db.get(Region, region)
    if not base:
        return []
    snapshot: dict = {"region_id": base.region_id, "name": base.name, "population": base.population}
    icu = icu_capacity_by_region(db, params)
    econ = economic_indicators_by_region(db, params)
    supply = supply_runway(db, params)
    compliance = compliance_outlook(db, params)
    ops = healthcare_ops_by_region(db, params)
    if icu:
        snapshot["icu_capacity"] = icu[0]
    if econ:
        snapshot["economic_indicators"] = econ[0]
    snapshot["supply_inventory"] = supply
    if compliance:
        snapshot["compliance"] = compliance[0]
    if ops:
        snapshot["healthcare_ops"] = ops[0]
    return [snapshot]


NAMED_QUERIES = {
    "list_regions": list_regions,
    "region_snapshot": region_snapshot,
    "icu_capacity_by_region": icu_capacity_by_region,
    "economic_indicators_by_region": economic_indicators_by_region,
    "supply_runway": supply_runway,
    "compliance_outlook": compliance_outlook,
    "healthcare_ops_by_region": healthcare_ops_by_region,
}
