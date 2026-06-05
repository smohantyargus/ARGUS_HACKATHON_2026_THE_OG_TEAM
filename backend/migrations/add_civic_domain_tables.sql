-- Civic domain tables — ground-truth facts queried by DataQueryAgent.
-- Owned by DataQueryAgent (it also create_all()s + seeds these on boot); this
-- file is the documented manual path / parity with backend/migrations convention.
-- Run against the app-db Postgres (database: civis).
-- Apply:  docker exec -i app-db psql -U civis -d civis < backend/migrations/add_civic_domain_tables.sql

CREATE TABLE IF NOT EXISTS regions (
    region_id   VARCHAR(50)  PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    population  BIGINT
);

CREATE TABLE IF NOT EXISTS icu_capacity (
    id            SERIAL PRIMARY KEY,
    region_id     VARCHAR(50) NOT NULL REFERENCES regions(region_id),
    total_beds    INTEGER NOT NULL,
    occupied_beds INTEGER NOT NULL DEFAULT 0,
    updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_icu_capacity_region_id ON icu_capacity(region_id);

CREATE TABLE IF NOT EXISTS economic_indicators (
    id                SERIAL PRIMARY KEY,
    region_id         VARCHAR(50) NOT NULL REFERENCES regions(region_id),
    daily_loss_usd    BIGINT NOT NULL,
    hourly_worker_pct DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS ix_economic_indicators_region_id ON economic_indicators(region_id);

CREATE TABLE IF NOT EXISTS supply_inventory (
    id              SERIAL PRIMARY KEY,
    region_id       VARCHAR(50) NOT NULL REFERENCES regions(region_id),
    item            VARCHAR(100) NOT NULL,
    days_remaining  INTEGER NOT NULL,
    source_terminal VARCHAR(100)
);
CREATE INDEX IF NOT EXISTS ix_supply_inventory_region_id ON supply_inventory(region_id);

CREATE TABLE IF NOT EXISTS compliance_metrics (
    id                    SERIAL PRIMARY KEY,
    region_id             VARCHAR(50) NOT NULL REFERENCES regions(region_id),
    cooperation_break_day INTEGER,
    note                  TEXT
);
CREATE INDEX IF NOT EXISTS ix_compliance_metrics_region_id ON compliance_metrics(region_id);

CREATE TABLE IF NOT EXISTS healthcare_ops (
    id              SERIAL PRIMARY KEY,
    region_id       VARCHAR(50) NOT NULL REFERENCES regions(region_id),
    medical_staff   INTEGER,
    absenteeism_pct DOUBLE PRECISION,
    school_policy   VARCHAR(200)
);
CREATE INDEX IF NOT EXISTS ix_healthcare_ops_region_id ON healthcare_ops(region_id);

-- Seed the metro scenario (pandemic_response_01). Idempotent on regions PK.
INSERT INTO regions (region_id, name, population)
    VALUES ('metro', 'Metro Region', 4000000)
    ON CONFLICT (region_id) DO NOTHING;

-- The child-table seeds below assume a fresh 'metro' region (guarded by the
-- NOT EXISTS so re-running won't duplicate rows).
INSERT INTO icu_capacity (region_id, total_beds, occupied_beds)
    SELECT 'metro', 1200, 1040
    WHERE NOT EXISTS (SELECT 1 FROM icu_capacity WHERE region_id = 'metro');

INSERT INTO economic_indicators (region_id, daily_loss_usd, hourly_worker_pct)
    SELECT 'metro', 45000000, 38.0
    WHERE NOT EXISTS (SELECT 1 FROM economic_indicators WHERE region_id = 'metro');

INSERT INTO supply_inventory (region_id, item, days_remaining, source_terminal)
    SELECT 'metro', 'PPE / mask sets', 7, 'North Rail Terminal'
    WHERE NOT EXISTS (SELECT 1 FROM supply_inventory WHERE region_id = 'metro');

INSERT INTO compliance_metrics (region_id, cooperation_break_day, note)
    SELECT 'metro', 10, 'Public cooperation breaks by Day 10 unless protective equipment is subsidized.'
    WHERE NOT EXISTS (SELECT 1 FROM compliance_metrics WHERE region_id = 'metro');

INSERT INTO healthcare_ops (region_id, medical_staff, absenteeism_pct, school_policy)
    SELECT 'metro', 14000, 22.0, 'Primary schools open, secondary remote'
    WHERE NOT EXISTS (SELECT 1 FROM healthcare_ops WHERE region_id = 'metro');
