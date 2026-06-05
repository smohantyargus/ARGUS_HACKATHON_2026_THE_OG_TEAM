-- Dynamic routing edge types: cyclic_feedback + agent_routed (Phase 1)
-- Safe to re-run: all statements use IF NOT EXISTS / IF EXISTS guards.

-- 1. Extend edge_type CHECK constraint to include new types
ALTER TABLE pipeline_edges
  DROP CONSTRAINT IF EXISTS pipeline_edges_edge_type_check;

ALTER TABLE pipeline_edges
  ADD CONSTRAINT pipeline_edges_edge_type_check
  CHECK (edge_type IN (
    'sequential',
    'parallel_fanout',
    'merger_input',
    'cyclic_feedback',
    'agent_routed'
  ));

-- 2. Cyclic-feedback columns
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS max_iterations INT DEFAULT 3;

ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS break_field TEXT;

ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS break_value TEXT;

-- 3. Agent-routed column
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS candidate_agents JSONB;

-- 4. Cycle-budget on pipeline_nodes (persists max iteration budget in graph definition)
ALTER TABLE pipeline_nodes
  ADD COLUMN IF NOT EXISTS cycle_budget INT DEFAULT 3;
