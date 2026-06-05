"""
Create + seed the civic domain tables. Idempotent — safe to run on every boot.

Figures lifted from assets/seed_city_state.json (pandemic_response_01 scenario)
so specialist agents reason over the same facts the demo narrates.
"""
from __future__ import annotations

import logging

from app.db.database import SessionLocal, engine
from app.db.models import (
    DomainBase,
    Region,
    IcuCapacity,
    EconomicIndicator,
    SupplyInventory,
    ComplianceMetric,
    HealthcareOps,
)

logger = logging.getLogger(__name__)

REGION_ID = "metro"


def create_and_seed() -> None:
    """Create domain tables if missing and insert the metro scenario once."""
    DomainBase.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        if db.get(Region, REGION_ID):
            logger.info("DataQueryAgent: civic domain already seeded — skipping")
            return

        db.add(Region(region_id=REGION_ID, name="Metro Region", population=4_000_000))
        db.add(IcuCapacity(region_id=REGION_ID, total_beds=1200, occupied_beds=1040))
        db.add(EconomicIndicator(region_id=REGION_ID, daily_loss_usd=45_000_000, hourly_worker_pct=38.0))
        db.add(SupplyInventory(
            region_id=REGION_ID, item="PPE / mask sets",
            days_remaining=7, source_terminal="North Rail Terminal",
        ))
        db.add(ComplianceMetric(
            region_id=REGION_ID, cooperation_break_day=10,
            note="Public cooperation breaks by Day 10 unless protective equipment is subsidized.",
        ))
        db.add(HealthcareOps(
            region_id=REGION_ID, medical_staff=14000, absenteeism_pct=22.0,
            school_policy="Primary schools open, secondary remote",
        ))
        db.commit()
        logger.info("DataQueryAgent: seeded civic domain for region '%s'", REGION_ID)
    finally:
        db.close()
