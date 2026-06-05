-- Phase A Migration: ALTER TABLE on existing tables
-- Safe to run multiple times (IF NOT EXISTS / DO $$ guards).
-- Run against app-db (the shared PostgreSQL instance).
--
-- Usage:
--   docker exec -i app-db psql -U civis -d civis < migrations/phase_a_alter.sql
--
-- New tables (pipeline_definitions, pipeline_nodes, pipeline_edges, llm_instances,
-- agent_llm_assignments, tenants, access_keys, audit_log, usage_log) are created
-- automatically by SQLAlchemy create_all on service startup / config-seed run.
-- Only existing table column additions are handled here.

-- ─────────────────────────────────────────────────────────────────────────────
-- agent_registry (ConfigService DB — same physical DB, public schema)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE agent_registry
    ADD COLUMN IF NOT EXISTS capability_tags  TEXT[]  NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS max_concurrency  INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS llm_required     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS llm_instance_id  UUID    DEFAULT NULL;

COMMENT ON COLUMN agent_registry.capability_tags  IS 'e.g. ARRAY[''stt'', ''transcription'']';
COMMENT ON COLUMN agent_registry.max_concurrency  IS 'Max simultaneous jobs this agent instance handles';
COMMENT ON COLUMN agent_registry.llm_required     IS 'True if agent calls an LLM backend';
COMMENT ON COLUMN agent_registry.llm_instance_id  IS 'Default LLM for this agent (FK to llm_instances.id, app-layer only)';

-- ─────────────────────────────────────────────────────────────────────────────
-- jobs (OrchestratorAgent DB — same physical DB, public schema)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS pipeline_definition_id  UUID DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS access_key_id           UUID DEFAULT NULL;

COMMENT ON COLUMN jobs.pipeline_definition_id IS 'FK to pipeline_definitions.id; null = legacy inline pipeline JSONB';
COMMENT ON COLUMN jobs.access_key_id          IS 'FK to access_keys.id; null = job created by dashboard user';

CREATE INDEX IF NOT EXISTS idx_jobs_pipeline_definition_id ON jobs (pipeline_definition_id);
CREATE INDEX IF NOT EXISTS idx_jobs_access_key_id          ON jobs (access_key_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: ensure existing rows have consistent nulls (already null by DEFAULT)
-- No data migration needed — pipeline_definition_id null = use inline pipeline JSONB.
-- ─────────────────────────────────────────────────────────────────────────────

-- Verify
DO $$
BEGIN
    ASSERT (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = 'agent_registry' AND column_name = 'capability_tags') = 1,
        'agent_registry.capability_tags missing';
    ASSERT (SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = 'jobs' AND column_name = 'pipeline_definition_id') = 1,
        'jobs.pipeline_definition_id missing';
    RAISE NOTICE 'Phase A migration verified OK';
END $$;
