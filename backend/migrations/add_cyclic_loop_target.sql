-- Add loop_to column to pipeline_edges for cyclic_feedback loop direction control.
-- "source" (default) = self-loop back to completing node.
-- "target" = re-enter target node (council-wide negotiation re-entry).
ALTER TABLE pipeline_edges
    ADD COLUMN IF NOT EXISTS loop_to TEXT NOT NULL DEFAULT 'source'
    CHECK (loop_to IN ('source', 'target'));
