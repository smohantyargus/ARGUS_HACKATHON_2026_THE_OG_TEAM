-- Allow generic and merger agents in pipeline_nodes
-- agent_id (registry FK) becomes nullable; add generic_agent_id + merger_id + node_agent_type

ALTER TABLE pipeline_nodes ALTER COLUMN agent_id DROP NOT NULL;

ALTER TABLE pipeline_nodes ADD COLUMN IF NOT EXISTS generic_agent_id UUID REFERENCES agent_definitions(id) ON DELETE RESTRICT;
ALTER TABLE pipeline_nodes ADD COLUMN IF NOT EXISTS merger_id UUID REFERENCES response_mergers(id) ON DELETE RESTRICT;
ALTER TABLE pipeline_nodes ADD COLUMN IF NOT EXISTS node_agent_type VARCHAR(30) NOT NULL DEFAULT 'registry';

-- Existing rows already have agent_id set (registry agents) — backfill node_agent_type
UPDATE pipeline_nodes SET node_agent_type = 'registry' WHERE node_agent_type = 'registry';

-- Pipeline input type
ALTER TABLE pipeline_definitions ADD COLUMN IF NOT EXISTS input_type VARCHAR(20) NOT NULL DEFAULT 'text';
