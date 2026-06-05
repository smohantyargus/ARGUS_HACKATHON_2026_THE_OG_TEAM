"""
Seed the multi-domain data platform.

Creates all meta-tables via DomainBase.metadata.create_all() then inserts:
  1. "civic" domain — full epidemic-response dictionary + metro scenario records
  2. "finance" domain — minimal demo domain (portfolio + risk_metric) to prove multi-domain

Both seeds are idempotent: skipped if their domain_key already exists.
"""
from __future__ import annotations

import logging

from app.db.database import SessionLocal, engine
from app.db.models import (
    Domain, DomainMember, DomainBase, DomainRecord,
    EntityDefinition, FieldDefinition, QueryDefinition,
)

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _entity(db, domain_key, entity_key, display_name, description="", is_root=False, parent_entity=None, strict=True) -> EntityDefinition:
    e = EntityDefinition(
        domain_key=domain_key, entity_key=entity_key,
        display_name=display_name, description=description,
        is_root=is_root, parent_entity=parent_entity, strict=strict,
    )
    db.add(e)
    db.flush()
    return e


def _field(db, entity_id, field_key, data_type="string", required=False,
           unit=None, description=None, min_value=None, max_value=None,
           max_length=None, enum_values=None, ref_entity=None, default_value=None):
    db.add(FieldDefinition(
        entity_id=entity_id, field_key=field_key, data_type=data_type,
        required=required, unit=unit, description=description,
        min_value=min_value, max_value=max_value, max_length=max_length,
        enum_values=enum_values, ref_entity=ref_entity, default_value=default_value,
    ))


def _query(db, domain_key, query_key, entity_key, filter_spec=None,
           projection=None, join_spec=None, description=None):
    db.add(QueryDefinition(
        domain_key=domain_key, query_key=query_key, entity_key=entity_key,
        filter_spec=filter_spec, projection=projection,
        join_spec=join_spec, description=description,
    ))


def _record(db, domain_key, entity_key, data, record_key=None, parent_id=None) -> DomainRecord:
    r = DomainRecord(
        domain_key=domain_key, entity_key=entity_key,
        record_key=record_key, parent_id=parent_id, data=data,
    )
    db.add(r)
    db.flush()
    return r


# ─────────────────────────────────────────────────────────────────────────────
# Civic domain
# ─────────────────────────────────────────────────────────────────────────────

def _seed_civic(db) -> None:
    if db.get(Domain, "civic"):
        logger.info("seed: civic domain already seeded — skipping")
        return

    logger.info("seed: seeding civic domain …")
    db.add(Domain(
        domain_key="civic",
        name="Civic & Public Health",
        description="Ground-truth facts for epidemic-response specialist agents.",
        status="active",
        owner_user_id="system",
    ))
    db.add(DomainMember(domain_key="civic", user_id="system", role="owner"))
    db.flush()

    # ── Entities ──────────────────────────────────────────────────────────────

    region_e = _entity(db, "civic", "region", "Region", is_root=True,
                       description="Top-level geographic unit")
    _field(db, region_e.id, "region_id",   "string", required=True, max_length=50,  description="Natural PK, e.g. 'metro'")
    _field(db, region_e.id, "name",        "string", required=True, max_length=200)
    _field(db, region_e.id, "population",  "int",    unit="people")
    _field(db, region_e.id, "area_sqkm",   "float",  unit="km²")
    _field(db, region_e.id, "density_per_sqkm", "float", unit="people/km²")
    _field(db, region_e.id, "median_age",  "float",  unit="years")
    _field(db, region_e.id, "hospital_count", "int")
    _field(db, region_e.id, "gdp_annual_usd", "int", unit="usd")
    _field(db, region_e.id, "status",      "enum", enum_values=["monitoring", "alert", "critical", "stable"],
           default_value="monitoring")

    icu_e = _entity(db, "civic", "icu_capacity", "ICU Capacity", parent_entity="region",
                    description="ICU bed and ventilator availability")
    _field(db, icu_e.id, "region_id",           "string", required=True, ref_entity="region")
    _field(db, icu_e.id, "total_beds",          "int",    required=True, min_value=0, unit="beds")
    _field(db, icu_e.id, "occupied_beds",       "int",    required=True, min_value=0, unit="beds")
    _field(db, icu_e.id, "available_beds",      "int",    min_value=0, unit="beds")
    _field(db, icu_e.id, "surge_capacity_beds", "int",    min_value=0, unit="beds")
    _field(db, icu_e.id, "ventilators_total",   "int",    min_value=0, unit="units")
    _field(db, icu_e.id, "ventilators_in_use",  "int",    min_value=0, unit="units")
    _field(db, icu_e.id, "isolation_beds",      "int",    min_value=0, unit="beds")
    _field(db, icu_e.id, "staffed_bed_pct",     "float",  min_value=0, max_value=100, unit="%")
    _field(db, icu_e.id, "avg_length_of_stay_days", "float", unit="days")

    econ_e = _entity(db, "civic", "economic_indicators", "Economic Indicators", parent_entity="region")
    _field(db, econ_e.id, "region_id",            "string", required=True, ref_entity="region")
    _field(db, econ_e.id, "daily_loss_usd",        "int",   required=True, unit="usd/day")
    _field(db, econ_e.id, "hourly_worker_pct",     "float", unit="%")
    _field(db, econ_e.id, "gdp_daily_usd",         "int",   unit="usd/day")
    _field(db, econ_e.id, "unemployment_pct",      "float", unit="%")
    _field(db, econ_e.id, "small_business_count",  "int")
    _field(db, econ_e.id, "transit_daily_revenue_usd", "int", unit="usd/day")
    _field(db, econ_e.id, "fiscal_buffer_usd",     "int",   unit="usd")
    _field(db, econ_e.id, "sector_most_affected",  "string")

    supply_e = _entity(db, "civic", "supply_inventory", "Supply Inventory", parent_entity="region",
                       description="PPE and critical supply stockpiles")
    _field(db, supply_e.id, "region_id",             "string", required=True, ref_entity="region")
    _field(db, supply_e.id, "item",                  "string", required=True)
    _field(db, supply_e.id, "days_remaining",        "int",    min_value=0, unit="days")
    _field(db, supply_e.id, "current_stock_units",   "int",    min_value=0)
    _field(db, supply_e.id, "daily_consumption_units","int",   min_value=0)
    _field(db, supply_e.id, "reorder_lead_time_days","int",    min_value=0, unit="days")
    _field(db, supply_e.id, "source_terminal",       "string")
    _field(db, supply_e.id, "supplier_name",         "string")
    _field(db, supply_e.id, "unit_cost_usd",         "float",  unit="usd")
    _field(db, supply_e.id, "criticality",           "enum",
           enum_values=["low", "medium", "high", "critical"], default_value="medium")

    compliance_e = _entity(db, "civic", "compliance_metrics", "Compliance Metrics", parent_entity="region",
                           description="Public cooperation and behavioural signals")
    _field(db, compliance_e.id, "region_id",              "string", required=True, ref_entity="region")
    _field(db, compliance_e.id, "cooperation_break_day",  "int",    unit="day")
    _field(db, compliance_e.id, "current_compliance_pct", "float",  min_value=0, max_value=100, unit="%")
    _field(db, compliance_e.id, "mask_adherence_pct",     "float",  min_value=0, max_value=100, unit="%")
    _field(db, compliance_e.id, "mobility_reduction_pct", "float",  min_value=0, max_value=100, unit="%")
    _field(db, compliance_e.id, "public_trust_index",     "float",  min_value=0, max_value=10)
    _field(db, compliance_e.id, "fatigue_score",          "float",  min_value=0, max_value=10)
    _field(db, compliance_e.id, "protest_risk",           "enum",
           enum_values=["low", "medium", "high"])
    _field(db, compliance_e.id, "misinformation_index",   "float",  min_value=0, max_value=10)
    _field(db, compliance_e.id, "note",                   "string")

    healthcare_e = _entity(db, "civic", "healthcare_ops", "Healthcare Operations", parent_entity="region")
    _field(db, healthcare_e.id, "region_id",               "string", required=True, ref_entity="region")
    _field(db, healthcare_e.id, "medical_staff",           "int",    unit="people")
    _field(db, healthcare_e.id, "absenteeism_pct",         "float",  min_value=0, max_value=100, unit="%")
    _field(db, healthcare_e.id, "staff_on_leave",          "int",    unit="people")
    _field(db, healthcare_e.id, "burnout_index",           "float",  min_value=0, max_value=10)
    _field(db, healthcare_e.id, "ppe_days_remaining",      "int",    min_value=0, unit="days")
    _field(db, healthcare_e.id, "childcare_dependency_pct","float",  min_value=0, max_value=100, unit="%")
    _field(db, healthcare_e.id, "shift_coverage_pct",      "float",  min_value=0, max_value=100, unit="%")
    _field(db, healthcare_e.id, "secondary_staff_reserve", "int",    unit="people")
    _field(db, healthcare_e.id, "school_policy",           "string")

    epi_e = _entity(db, "civic", "epidemic_indicators", "Epidemic Indicators", parent_entity="region",
                    description="Live disease spread metrics")
    _field(db, epi_e.id, "region_id",                "string", required=True, ref_entity="region")
    _field(db, epi_e.id, "variant_name",             "string")
    _field(db, epi_e.id, "r0",                       "float",  min_value=0, description="Basic reproduction number")
    _field(db, epi_e.id, "active_cases",             "int",    min_value=0)
    _field(db, epi_e.id, "new_cases_daily",          "int",    min_value=0)
    _field(db, epi_e.id, "growth_rate_pct",          "float",  unit="%")
    _field(db, epi_e.id, "doubling_time_days",        "float",  unit="days")
    _field(db, epi_e.id, "case_fatality_rate_pct",   "float",  min_value=0, max_value=100, unit="%")
    _field(db, epi_e.id, "hospitalization_rate_pct", "float",  min_value=0, max_value=100, unit="%")
    _field(db, epi_e.id, "test_positivity_pct",      "float",  min_value=0, max_value=100, unit="%")
    _field(db, epi_e.id, "incubation_period_days",   "float",  unit="days")
    _field(db, epi_e.id, "vaccination_coverage_pct", "float",  min_value=0, max_value=100, unit="%")
    _field(db, epi_e.id, "deaths_total",             "int",    min_value=0)

    sector_e = _entity(db, "civic", "sector_impact", "Sector Economic Impact", parent_entity="region",
                       description="Per-sector economic breakdown — powers targeted vetoes/amendments")
    _field(db, sector_e.id, "region_id",          "string", required=True, ref_entity="region")
    _field(db, sector_e.id, "sector_name",        "string", required=True)
    _field(db, sector_e.id, "daily_revenue_usd",  "int",    unit="usd/day")
    _field(db, sector_e.id, "workforce_size",     "int",    unit="people")
    _field(db, sector_e.id, "essential",          "bool",   default_value=False)
    _field(db, sector_e.id, "closure_sensitivity","enum",
           enum_values=["low", "medium", "high"])

    routes_e = _entity(db, "civic", "supply_routes", "Supply Routes", parent_entity="region",
                       description="Logistics routes — supports re-route decisions")
    _field(db, routes_e.id, "region_id",             "string", required=True, ref_entity="region")
    _field(db, routes_e.id, "route_name",            "string", required=True)
    _field(db, routes_e.id, "origin_terminal",       "string")
    _field(db, routes_e.id, "destination",           "string")
    _field(db, routes_e.id, "transport_mode",        "enum",
           enum_values=["rail", "road", "air", "sea"])
    _field(db, routes_e.id, "daily_capacity_units",  "int",    min_value=0)
    _field(db, routes_e.id, "lead_time_hours",       "int",    min_value=0, unit="hours")
    _field(db, routes_e.id, "status",               "enum",
           enum_values=["open", "disrupted", "closed"], default_value="open")

    intervention_e = _entity(db, "civic", "intervention_log", "Intervention Log", parent_entity="region",
                             description="History of policy interventions and their effectiveness")
    _field(db, intervention_e.id, "region_id",         "string", required=True, ref_entity="region")
    _field(db, intervention_e.id, "intervention_type", "string")
    _field(db, intervention_e.id, "description",       "string")
    _field(db, intervention_e.id, "started_on_day",    "int",   min_value=0)
    _field(db, intervention_e.id, "status",            "enum",
           enum_values=["proposed", "active", "lifted"], default_value="proposed")
    _field(db, intervention_e.id, "effectiveness_score","float", min_value=0, max_value=10)
    _field(db, intervention_e.id, "decided_by_job_id", "string")

    # ── Query definitions ─────────────────────────────────────────────────────

    _query(db, "civic", "list_regions", "region",
           filter_spec=None,
           description="All regions in the civic domain")

    _query(db, "civic", "icu_capacity_by_region", "icu_capacity",
           filter_spec={"region_id": "{{region}}"},
           description="ICU beds, occupancy, and ventilators for a region")

    _query(db, "civic", "economic_indicators_by_region", "economic_indicators",
           filter_spec={"region_id": "{{region}}"},
           description="Economic loss, workforce, and fiscal buffer for a region")

    _query(db, "civic", "supply_runway", "supply_inventory",
           filter_spec={"region_id": "{{region}}"},
           description="Supply stockpiles and runway for a region")

    _query(db, "civic", "compliance_outlook", "compliance_metrics",
           filter_spec={"region_id": "{{region}}"},
           description="Public compliance and fatigue signals for a region")

    _query(db, "civic", "healthcare_ops_by_region", "healthcare_ops",
           filter_spec={"region_id": "{{region}}"},
           description="Medical staff, absenteeism, and school policy for a region")

    _query(db, "civic", "epidemic_indicators_by_region", "epidemic_indicators",
           filter_spec={"region_id": "{{region}}"},
           description="R0, active cases, CFR, and vaccination coverage for a region")

    _query(db, "civic", "sector_impact_by_region", "sector_impact",
           filter_spec={"region_id": "{{region}}"},
           description="Per-sector revenue and workforce for targeted policy amendments")

    _query(db, "civic", "supply_routes_by_region", "supply_routes",
           filter_spec={"region_id": "{{region}}"},
           description="Active logistics routes for re-routing decisions")

    _query(db, "civic", "intervention_history", "intervention_log",
           filter_spec={"region_id": "{{region}}"},
           description="Past and active policy interventions for a region")

    _query(db, "civic", "region_snapshot", "region",
           filter_spec={"record_key": "{{region}}"},
           join_spec=[
               {"entity_key": "icu_capacity"},
               {"entity_key": "economic_indicators"},
               {"entity_key": "supply_inventory"},
               {"entity_key": "compliance_metrics"},
               {"entity_key": "healthcare_ops"},
               {"entity_key": "epidemic_indicators"},
               {"entity_key": "sector_impact"},
               {"entity_key": "supply_routes"},
           ],
           description="Full snapshot of a region with all child entities merged")

    # ── Records (metro scenario) ───────────────────────────────────────────────

    metro = _record(db, "civic", "region", {
        "region_id": "metro",
        "name": "Metro Region",
        "population": 4_000_000,
        "area_sqkm": 850.0,
        "density_per_sqkm": 4706.0,
        "median_age": 36.5,
        "hospital_count": 24,
        "gdp_annual_usd": 120_000_000_000,
        "status": "critical",
    }, record_key="metro")

    _record(db, "civic", "icu_capacity", {
        "region_id": "metro",
        "total_beds": 1200,
        "occupied_beds": 1040,
        "available_beds": 160,
        "surge_capacity_beds": 200,
        "ventilators_total": 320,
        "ventilators_in_use": 290,
        "isolation_beds": 80,
        "staffed_bed_pct": 78.0,
        "avg_length_of_stay_days": 9.5,
    }, parent_id=metro.id)

    _record(db, "civic", "economic_indicators", {
        "region_id": "metro",
        "daily_loss_usd": 45_000_000,
        "hourly_worker_pct": 38.0,
        "gdp_daily_usd": 328_000_000,
        "unemployment_pct": 6.2,
        "small_business_count": 14_800,
        "transit_daily_revenue_usd": 2_100_000,
        "fiscal_buffer_usd": 380_000_000,
        "sector_most_affected": "transit",
    }, parent_id=metro.id)

    _record(db, "civic", "supply_inventory", {
        "region_id": "metro",
        "item": "PPE / mask sets",
        "days_remaining": 7,
        "current_stock_units": 140_000,
        "daily_consumption_units": 20_000,
        "reorder_lead_time_days": 4,
        "source_terminal": "North Rail Terminal",
        "supplier_name": "MedSupply Co.",
        "unit_cost_usd": 1.20,
        "criticality": "critical",
    }, parent_id=metro.id)

    _record(db, "civic", "supply_inventory", {
        "region_id": "metro",
        "item": "Antiviral medication",
        "days_remaining": 12,
        "current_stock_units": 48_000,
        "daily_consumption_units": 4_000,
        "reorder_lead_time_days": 7,
        "source_terminal": "Central Distribution Hub",
        "supplier_name": "PharmaCo",
        "unit_cost_usd": 45.00,
        "criticality": "high",
    }, parent_id=metro.id)

    _record(db, "civic", "compliance_metrics", {
        "region_id": "metro",
        "cooperation_break_day": 10,
        "current_compliance_pct": 72.0,
        "mask_adherence_pct": 68.0,
        "mobility_reduction_pct": 35.0,
        "public_trust_index": 5.8,
        "fatigue_score": 4.2,
        "protest_risk": "medium",
        "misinformation_index": 3.1,
        "note": "Public cooperation breaks by Day 10 unless protective equipment is subsidized.",
    }, parent_id=metro.id)

    _record(db, "civic", "healthcare_ops", {
        "region_id": "metro",
        "medical_staff": 14_000,
        "absenteeism_pct": 22.0,
        "staff_on_leave": 3_080,
        "burnout_index": 7.1,
        "ppe_days_remaining": 7,
        "childcare_dependency_pct": 34.0,
        "shift_coverage_pct": 71.0,
        "secondary_staff_reserve": 1_200,
        "school_policy": "Primary schools open, secondary remote",
    }, parent_id=metro.id)

    _record(db, "civic", "epidemic_indicators", {
        "region_id": "metro",
        "variant_name": "InfluenzaX",
        "r0": 2.5,
        "active_cases": 18_400,
        "new_cases_daily": 1_240,
        "growth_rate_pct": 7.2,
        "doubling_time_days": 9.9,
        "case_fatality_rate_pct": 1.8,
        "hospitalization_rate_pct": 12.0,
        "test_positivity_pct": 14.3,
        "incubation_period_days": 3.5,
        "vaccination_coverage_pct": 44.0,
        "deaths_total": 312,
    }, parent_id=metro.id)

    for sector in [
        {"sector_name": "transit",     "daily_revenue_usd": 2_100_000, "workforce_size": 18_000, "essential": True,  "closure_sensitivity": "high"},
        {"sector_name": "retail",      "daily_revenue_usd": 8_400_000, "workforce_size": 42_000, "essential": False, "closure_sensitivity": "high"},
        {"sector_name": "healthcare",  "daily_revenue_usd": 5_200_000, "workforce_size": 14_000, "essential": True,  "closure_sensitivity": "low"},
        {"sector_name": "education",   "daily_revenue_usd": 1_800_000, "workforce_size": 22_000, "essential": True,  "closure_sensitivity": "medium"},
        {"sector_name": "hospitality", "daily_revenue_usd": 3_900_000, "workforce_size": 31_000, "essential": False, "closure_sensitivity": "high"},
    ]:
        _record(db, "civic", "sector_impact", {"region_id": "metro", **sector}, parent_id=metro.id)

    _record(db, "civic", "supply_routes", {
        "region_id": "metro",
        "route_name": "North Rail Corridor",
        "origin_terminal": "North Rail Terminal",
        "destination": "Central Distribution Hub",
        "transport_mode": "rail",
        "daily_capacity_units": 80_000,
        "lead_time_hours": 6,
        "status": "open",
    }, parent_id=metro.id)

    _record(db, "civic", "supply_routes", {
        "region_id": "metro",
        "route_name": "East Road Express",
        "origin_terminal": "East Logistics Park",
        "destination": "City Medical Depot",
        "transport_mode": "road",
        "daily_capacity_units": 30_000,
        "lead_time_hours": 3,
        "status": "open",
    }, parent_id=metro.id)

    logger.info("seed: civic domain seeded (metro scenario)")


# ─────────────────────────────────────────────────────────────────────────────
# Finance demo domain (proves multi-domain — minimal)
# ─────────────────────────────────────────────────────────────────────────────

def _seed_finance(db) -> None:
    if db.get(Domain, "finance"):
        logger.info("seed: finance domain already seeded — skipping")
        return

    logger.info("seed: seeding finance demo domain …")
    db.add(Domain(
        domain_key="finance",
        name="Financial Risk (Demo)",
        description="Minimal demo domain proving multi-domain runtime addition.",
        status="active",
        owner_user_id="system",
    ))
    db.add(DomainMember(domain_key="finance", user_id="system", role="owner"))
    db.flush()

    portfolio_e = _entity(db, "finance", "portfolio", "Portfolio", is_root=True)
    _field(db, portfolio_e.id, "portfolio_id", "string", required=True)
    _field(db, portfolio_e.id, "name",         "string", required=True)
    _field(db, portfolio_e.id, "aum_usd",      "int",    unit="usd")
    _field(db, portfolio_e.id, "asset_class",  "enum",   enum_values=["equity", "fixed_income", "mixed", "commodity"])

    risk_e = _entity(db, "finance", "risk_metric", "Risk Metric", parent_entity="portfolio")
    _field(db, risk_e.id, "portfolio_id",    "string", required=True, ref_entity="portfolio")
    _field(db, risk_e.id, "var_95_usd",      "int",    unit="usd",    description="Value at Risk 95%")
    _field(db, risk_e.id, "sharpe_ratio",    "float")
    _field(db, risk_e.id, "beta",            "float")
    _field(db, risk_e.id, "max_drawdown_pct","float",  unit="%")
    _field(db, risk_e.id, "risk_rating",     "enum",   enum_values=["low", "medium", "high", "critical"])

    _query(db, "finance", "risk_metric_by_portfolio", "risk_metric",
           filter_spec={"portfolio_id": "{{portfolio}}"},
           description="Risk metrics for a given portfolio")

    _query(db, "finance", "list_portfolios", "portfolio",
           description="All portfolios in the finance domain")

    # Demo records
    p = _record(db, "finance", "portfolio", {
        "portfolio_id": "demo-01",
        "name": "Metro Infrastructure Fund",
        "aum_usd": 500_000_000,
        "asset_class": "mixed",
    }, record_key="demo-01")

    _record(db, "finance", "risk_metric", {
        "portfolio_id": "demo-01",
        "var_95_usd": 12_000_000,
        "sharpe_ratio": 1.4,
        "beta": 0.82,
        "max_drawdown_pct": 18.5,
        "risk_rating": "medium",
    }, parent_id=p.id)

    logger.info("seed: finance demo domain seeded")


# ─────────────────────────────────────────────────────────────────────────────
# Entry point
# ─────────────────────────────────────────────────────────────────────────────

def create_and_seed() -> None:
    """Create all meta-tables then seed civic + finance domains. Idempotent."""
    DomainBase.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        _seed_civic(db)
        _seed_finance(db)
        db.commit()
        logger.info("seed: complete")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
