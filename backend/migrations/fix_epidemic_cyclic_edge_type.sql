-- Fix: epidemic_containment cyclic feedback edge was seeded with edge_type='sequential'
-- instead of 'cyclic_feedback'. This caused get_entry_node() to include Epidemiologist
-- in the targets set, making it invisible as the pipeline entry node.
UPDATE pipeline_edges pe
SET edge_type = 'cyclic_feedback'
FROM pipeline_nodes src,
     pipeline_nodes tgt,
     pipeline_definitions pd
WHERE pd.name = 'epidemic_containment'
  AND pe.pipeline_id = pd.id
  AND pe.source_node_id = src.id
  AND src.node_key = 'policy_aggregator'
  AND tgt.node_key = 'Epidemiologist'
  AND pe.target_node_id = tgt.id
  AND pe.edge_type = 'sequential';
