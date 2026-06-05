-- Add data_queries column to agent_definitions (GenericAgent v2 inline DB fetch).
-- Safe to run on existing databases; v1 agents ignore the column.
-- Run against the config-service DB (same Postgres instance, database: civis).
-- Apply:  docker exec -i app-db psql -U civis -d civis < backend/migrations/add_agent_definition_data_queries.sql

ALTER TABLE agent_definitions
    ADD COLUMN IF NOT EXISTS data_queries JSON;
