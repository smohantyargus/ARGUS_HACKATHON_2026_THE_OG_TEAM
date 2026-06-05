-- Add edge_type column to pipeline_edges (I6 — fan-out routing)
-- Safe to run on existing databases. Backfills from is_parallel + wait_for_group.
-- Run against config-service DB (same Postgres instance as app-db, database: civis).

ALTER TABLE pipeline_edges
    ADD COLUMN IF NOT EXISTS edge_type VARCHAR(20) NOT NULL DEFAULT 'sequential';

-- Backfill: merger_input if wait_for_group is set, parallel_fanout if is_parallel=true
UPDATE pipeline_edges
    SET edge_type = CASE
        WHEN wait_for_group IS NOT NULL THEN 'merger_input'
        WHEN is_parallel = true         THEN 'parallel_fanout'
        ELSE                                 'sequential'
    END;
