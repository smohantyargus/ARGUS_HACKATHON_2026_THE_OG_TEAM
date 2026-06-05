-- Enforce exactly one of {agent_id, generic_agent_id, merger_id, aggregator_id} is set
-- on every pipeline_node row, matching the node_agent_type discriminator.
-- Safe to run multiple times (IF NOT EXISTS guard).

ALTER TABLE pipeline_nodes
    DROP CONSTRAINT IF EXISTS chk_pipeline_node_single_agent;

ALTER TABLE pipeline_nodes
    ADD CONSTRAINT chk_pipeline_node_single_agent CHECK (
        num_nonnulls(agent_id, generic_agent_id, merger_id, aggregator_id) = 1
    );

-- Enforce node_agent_type is one of the known values
ALTER TABLE pipeline_nodes
    DROP CONSTRAINT IF EXISTS chk_pipeline_node_agent_type;

ALTER TABLE pipeline_nodes
    ADD CONSTRAINT chk_pipeline_node_agent_type CHECK (
        node_agent_type IN ('registry', 'generic_llm', 'output_merger', 'context_aggregator')
    );
