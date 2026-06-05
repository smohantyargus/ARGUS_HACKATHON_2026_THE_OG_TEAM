-- Multi-domain data platform schema migration.
-- Idempotent: safe to run on an already-provisioned DB.
-- DataQueryAgent also runs DomainBase.metadata.create_all() on boot,
-- which covers fresh databases without needing this file.
-- Use this file for already-running DBs that have the old civic tables.

-- ── Drop old hardcoded civic tables (only if migration needed) ────────────────
-- Uncomment if migrating from the original six civic tables:
-- DROP TABLE IF EXISTS healthcare_ops CASCADE;
-- DROP TABLE IF EXISTS compliance_metrics CASCADE;
-- DROP TABLE IF EXISTS supply_inventory CASCADE;
-- DROP TABLE IF EXISTS economic_indicators CASCADE;
-- DROP TABLE IF EXISTS icu_capacity CASCADE;
-- DROP TABLE IF EXISTS regions CASCADE;

-- ── Domain registry ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS domains (
    domain_key    VARCHAR(50)  PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    description   TEXT,
    status        VARCHAR(20)  NOT NULL DEFAULT 'active',
    owner_user_id VARCHAR(64),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_domains_owner ON domains(owner_user_id);

CREATE TABLE IF NOT EXISTS domain_members (
    id         SERIAL      PRIMARY KEY,
    domain_key VARCHAR(50) NOT NULL REFERENCES domains(domain_key) ON DELETE CASCADE,
    user_id    VARCHAR(64) NOT NULL,
    role       VARCHAR(20) NOT NULL DEFAULT 'viewer',
    UNIQUE (domain_key, user_id)
);

CREATE INDEX IF NOT EXISTS ix_domain_members_domain ON domain_members(domain_key);
CREATE INDEX IF NOT EXISTS ix_domain_members_user   ON domain_members(user_id);

-- ── Data dictionary ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entity_definitions (
    id            SERIAL       PRIMARY KEY,
    domain_key    VARCHAR(50)  NOT NULL REFERENCES domains(domain_key) ON DELETE CASCADE,
    entity_key    VARCHAR(80)  NOT NULL,
    display_name  VARCHAR(200),
    description   TEXT,
    is_root       BOOLEAN      NOT NULL DEFAULT FALSE,
    parent_entity VARCHAR(80),
    strict        BOOLEAN      NOT NULL DEFAULT TRUE,
    UNIQUE (domain_key, entity_key)
);

CREATE INDEX IF NOT EXISTS ix_entity_def_domain ON entity_definitions(domain_key);

CREATE TABLE IF NOT EXISTS field_definitions (
    id            SERIAL      PRIMARY KEY,
    entity_id     INTEGER     NOT NULL REFERENCES entity_definitions(id) ON DELETE CASCADE,
    field_key     VARCHAR(80) NOT NULL,
    data_type     VARCHAR(20) NOT NULL DEFAULT 'string',
    required      BOOLEAN     NOT NULL DEFAULT FALSE,
    default_value JSONB,
    enum_values   JSONB,
    ref_entity    VARCHAR(80),
    min_value     FLOAT,
    max_value     FLOAT,
    max_length    INTEGER,
    unit          VARCHAR(40),
    description   TEXT,
    UNIQUE (entity_id, field_key)
);

CREATE INDEX IF NOT EXISTS ix_field_def_entity ON field_definitions(entity_id);

-- ── Query definitions ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_definitions (
    id          SERIAL      PRIMARY KEY,
    domain_key  VARCHAR(50) NOT NULL REFERENCES domains(domain_key) ON DELETE CASCADE,
    query_key   VARCHAR(80) NOT NULL,
    entity_key  VARCHAR(80) NOT NULL,
    filter_spec JSONB,
    projection  JSONB,
    join_spec   JSONB,
    description TEXT,
    UNIQUE (domain_key, query_key)
);

CREATE INDEX IF NOT EXISTS ix_query_def_domain ON query_definitions(domain_key);

-- ── Records (JSONB store) ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS domain_records (
    id         SERIAL       PRIMARY KEY,
    domain_key VARCHAR(50)  NOT NULL REFERENCES domains(domain_key) ON DELETE CASCADE,
    entity_key VARCHAR(80)  NOT NULL,
    record_key VARCHAR(120),
    parent_id  INTEGER      REFERENCES domain_records(id) ON DELETE CASCADE,
    data       JSONB        NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_records_domain_entity ON domain_records(domain_key, entity_key);
CREATE INDEX IF NOT EXISTS ix_records_record_key    ON domain_records(domain_key, entity_key, record_key);
CREATE INDEX IF NOT EXISTS ix_records_data_gin      ON domain_records USING GIN(data);
