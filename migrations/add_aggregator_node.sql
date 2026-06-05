-- AG-1: Add context_aggregator support to pipeline_nodes
-- Run: docker exec -i app-db psql -U civis -d civis < migrations/add_aggregator_node.sql

-- aggregator_definitions table (ConfigService creates via create_all; this is a guard)
CREATE TABLE IF NOT EXISTS aggregator_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(200),
    description TEXT,
    input_topic VARCHAR(200) NOT NULL,
    output_topic VARCHAR(200) NOT NULL DEFAULT 'aggregator.completed',
    input_sources JSONB NOT NULL DEFAULT '[]',
    synthesis_prompt TEXT,
    output_schema_type VARCHAR(50) NOT NULL DEFAULT 'freeform',
    output_persona VARCHAR(50) NOT NULL DEFAULT 'clinician',
    llm_instance_name VARCHAR(100),
    max_tokens INTEGER NOT NULL DEFAULT 2048,
    temperature FLOAT NOT NULL DEFAULT 0.3,
    min_required_inputs INTEGER NOT NULL DEFAULT 1,
    timeout_seconds INTEGER NOT NULL DEFAULT 60,
    conflict_threshold FLOAT NOT NULL DEFAULT 0.4,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add aggregator_id FK to pipeline_nodes
ALTER TABLE pipeline_nodes
    ADD COLUMN IF NOT EXISTS aggregator_id UUID REFERENCES aggregator_definitions(id) ON DELETE RESTRICT;

-- Extend node_agent_type to allow 'context_aggregator'
-- (VARCHAR — no enum to alter, value is validated at application layer)
COMMENT ON COLUMN pipeline_nodes.node_agent_type IS
    'registry | generic_llm | output_merger | context_aggregator';
