# Dynamic Routing & Cyclic Agents — Phase-wise Implementation Plan

Two features built in sequence (each phase shippable independently):
- **Track A:** `cyclic_feedback` edge — agents loop back with iteration budget
- **Track B:** `agent_routed` edge — LLM DecisionAgent picks next agent at runtime

---

## Phase 0 — Baseline Audit (Day 0, ~2h)

Ensure existing stack works before touching anything. Gate all later phases on this passing.

### Tasks
- [ ] `./dev-up.sh && ./dev-up.sh status` — all containers healthy
- [ ] Login, submit a text job via `POST /v1/process/text`, verify it reaches `task.completed`
- [ ] Confirm `generic_agent` + `generic_validator` subscribe/validate at least one definition
- [ ] Check Grafana at `:3001` — Kafka lag table shows 0 lag for active agents

### Test Cases
```python
# OrchestratorAgent/tests/test_baseline_routing.py

async def test_sequential_job_completes():
    """Full pipeline: submit → specialist → validator → aggregator → task.completed"""
    resp = client.post("/v1/process/text", json={"text": "hello", "pipeline_id": PIPELINE_ID})
    job_id = resp.json()["job_id"]
    await poll_until(job_id, status="completed", timeout=30)
    job = client.get(f"/v1/jobs/{job_id}").json()
    assert job["status"] == "completed"
    assert job["result"] is not None

async def test_validation_retry_flow():
    """Validator rejects → orchestrator re-publishes with feedback → agent retries"""
    # use a definition whose prompt produces intentionally invalid JSON on first attempt
    # verify job_steps has retry_count >= 1 before completing

async def test_fanin_merger_quorum():
    """3 parallel agents → merger → aggregator. Merger waits for all 3."""
    # submit job on parallel pipeline, assert merger only fires after all 3 validated outputs arrive
```

### Definition of Done
All 3 tests pass. Kafka consumer groups at 0 lag.

---

## Phase 1 — Schema Migration (Day 0–1, ~2h)

Add new columns. No code changes to router yet — just schema prep.

### Files
- `migrations/add_dynamic_routing_edges.sql` ← new file

```sql
-- migrations/add_dynamic_routing_edges.sql

-- 1. Extend edge_type CHECK constraint
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

-- 2. Cyclic feedback columns
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS max_iterations   INT     DEFAULT 3;
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS break_field      TEXT;   -- e.g. "done"
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS break_value      TEXT;   -- e.g. "true"

-- 3. Agent-routed columns
ALTER TABLE pipeline_edges
  ADD COLUMN IF NOT EXISTS candidate_agents JSONB;  -- ["AgentA","AgentB","AgentC"]

-- 4. Iteration counter on pipeline_nodes (for cycle state persistence across restarts)
ALTER TABLE pipeline_nodes
  ADD COLUMN IF NOT EXISTS cycle_budget INT DEFAULT 3;
```

### Apply
```bash
docker exec -i app-db psql -U civis -d civis \
  < migrations/add_dynamic_routing_edges.sql
```

### ConfigService model update
- `ConfigService/app/models/pipeline_definition.py` — add 4 new columns to `PipelineEdge`

```python
# PipelineEdge additions
max_iterations    = Column(Integer, nullable=True, default=3)
break_field       = Column(String(100), nullable=True)
break_value       = Column(String(100), nullable=True)
candidate_agents  = Column(JSONB, nullable=True)
```

### Test Cases
```python
# ConfigService tests (test_pipeline_edge_schema.py)

def test_create_cyclic_edge():
    resp = client.post("/pipelines/edges", json={
        "pipeline_id": PIPELINE_ID,
        "source_node_id": NODE_A,
        "target_node_id": NODE_B,
        "edge_type": "cyclic_feedback",
        "max_iterations": 3,
        "break_field": "done",
        "break_value": "true",
    })
    assert resp.status_code == 201
    assert resp.json()["max_iterations"] == 3

def test_create_agent_routed_edge():
    resp = client.post("/pipelines/edges", json={
        "pipeline_id": PIPELINE_ID,
        "source_node_id": ROUTER_NODE,
        "target_node_id": NODE_B,
        "edge_type": "agent_routed",
        "candidate_agents": ["AgentB", "AgentC"],
    })
    assert resp.status_code == 201
    assert "AgentB" in resp.json()["candidate_agents"]

def test_invalid_edge_type_rejected():
    resp = client.post("/pipelines/edges", json={
        "edge_type": "made_up_type", ...
    })
    assert resp.status_code == 422

def test_old_edge_types_unaffected():
    """sequential, parallel_fanout, merger_input still work"""
    for etype in ["sequential", "parallel_fanout", "merger_input"]:
        resp = client.post("/pipelines/edges", json={"edge_type": etype, ...})
        assert resp.status_code == 201
```

### Definition of Done
Migration idempotent (re-run = no error). All 4 tests pass. Existing pipeline CRUD unaffected.

---

## Phase 2 — `_EdgeInfo` Dataclass Update (Day 1, ~1h)

Router's in-memory graph model needs the new fields before router logic can use them.

### File
`OrchestratorAgent/app/services/pipeline_router.py`

```python
# _EdgeInfo — add 4 fields
@dataclass
class _EdgeInfo:
    edge_id: str
    source_node_id: str
    target_node_id: str
    edge_type: str
    is_parallel: bool
    wait_for_group: str | None
    is_optional: bool
    # NEW
    max_iterations: int = 3
    break_field: str | None = None
    break_value: str | None = None
    candidate_agents: list[str] = field(default_factory=list)
```

```python
# _build_graph_cache — populate new fields
graph.edges.append(_EdgeInfo(
    ...existing fields...,
    max_iterations=e.get("max_iterations") or 3,
    break_field=e.get("break_field"),
    break_value=e.get("break_value"),
    candidate_agents=e.get("candidate_agents") or [],
))
```

### Test Cases
```python
# OrchestratorAgent/tests/test_graph_cache.py

def test_cyclic_edge_loaded_into_cache(mock_config_service):
    """Graph cache correctly populates max_iterations, break_field from API response"""
    mock_config_service.return_value = {
        "nodes": [...],
        "edges": [{
            "edge_type": "cyclic_feedback",
            "max_iterations": 5,
            "break_field": "done",
            "break_value": "true",
            ...
        }]
    }
    await _load_registry()
    edge = _graphs[PIPELINE_ID].edges[0]
    assert edge.edge_type == "cyclic_feedback"
    assert edge.max_iterations == 5
    assert edge.break_field == "done"

def test_agent_routed_edge_loaded(mock_config_service):
    # candidate_agents is a list
    edge = _graphs[PIPELINE_ID].edges[0]
    assert "AgentB" in edge.candidate_agents

def test_missing_new_fields_use_defaults(mock_config_service):
    """Old edge records (no new cols) don't crash graph cache build"""
    # API returns edge without max_iterations/candidate_agents keys
    edge = _graphs[PIPELINE_ID].edges[0]
    assert edge.max_iterations == 3
    assert edge.candidate_agents == []
```

### Definition of Done
Cache builds without errors on both old-format and new-format edge records.

---

## Phase 3 — `cyclic_feedback` Router Logic (Day 1–2, ~3h)

### File
`OrchestratorAgent/app/services/pipeline_router.py` — `route_by_graph()`

#### Redis key for cycle state
```
cyclic:{job_id}:{edge_id}   →  INT (current iteration count)
TTL: 600s (longer than any realistic job)
```

#### Logic added inside `route_by_graph()` direct_targets loop
```python
for edge, node in direct_targets:
    if edge.edge_type == "cyclic_feedback":
        r = await get_redis()
        cycle_key = f"cyclic:{job_id}:{edge.edge_id}"

        # Check break condition first (agent signalled done)
        if edge.break_field:
            actual = str(step_output.get("data", step_output).get(edge.break_field, ""))
            if actual == edge.break_value:
                logger.info("Job %s cyclic edge %s break condition met — exiting loop", job_id, edge.edge_id)
                await _send_completed(job_id, step_output)
                await r.delete(cycle_key)
                continue

        iteration = int(await r.get(cycle_key) or 0)
        if iteration >= edge.max_iterations:
            logger.warning("Job %s cyclic edge %s hit max_iterations=%d — forcing exit", job_id, edge.edge_id, edge.max_iterations)
            await _send_completed(job_id, step_output)
            await r.delete(cycle_key)
            continue

        await r.incr(cycle_key)
        await r.expire(cycle_key, 600)

        # Loop back: re-publish to source node's input topic (not target — we loop TO source)
        src_node = graph.nodes.get(edge.source_node_id)
        loop_msg = _build_forward_msg(job_id, src_node, step_output, original_message)
        loop_msg["_iteration"] = iteration + 1
        loop_msg["_cycle_edge_id"] = edge.edge_id
        await producer.send_and_wait(src_node.input_topic, loop_msg)
        logger.info("Job %s looping back to %s (iteration %d/%d)", job_id, src_node.node_key, iteration + 1, edge.max_iterations)
        continue

    # existing sequential/fanout logic unchanged below
    msg = _build_forward_msg(job_id, node, step_output, original_message)
    await producer.send_and_wait(node.input_topic, msg)
```

### Test Cases
```python
# OrchestratorAgent/tests/test_cyclic_routing.py

async def test_cycles_n_times_then_exits_on_budget():
    """Router loops back exactly max_iterations times then sends task.completed"""
    max_iter = 3
    completed_count = 0

    # Simulate: agent always returns {"done": false}
    for _ in range(max_iter + 1):  # +1 = the exit call
        await route_by_graph(job_id, pipeline_id, validated_topic, {"done": "false"}, msg)

    r = await get_redis()
    # After max_iterations, cycle key deleted
    assert await r.get(f"cyclic:{job_id}:{EDGE_ID}") is None
    # task.completed published once
    assert mock_producer.send_and_wait.call_args_list[-1][0][0] == "task.completed"

async def test_break_condition_exits_early():
    """Agent returns {"done": "true"} on iteration 1 — exits immediately"""
    await route_by_graph(job_id, pipeline_id, topic, {"done": "true"}, msg)
    # Should NOT loop back — should send task.completed
    assert mock_producer.send_and_wait.call_count == 1
    assert mock_producer.send_and_wait.call_args[0][0] == "task.completed"

async def test_iteration_counter_persists_in_redis():
    """Each call increments Redis counter"""
    for i in range(1, 4):
        await route_by_graph(job_id, pipeline_id, topic, {"done": "false"}, msg)
        r = await get_redis()
        assert int(await r.get(f"cyclic:{job_id}:{EDGE_ID}")) == i

async def test_cyclic_key_cleaned_on_budget_exhaustion():
    """Redis key deleted after budget exhausted (no leak)"""
    for _ in range(4):  # max_iterations=3, so 4th triggers exit
        await route_by_graph(...)
    r = await get_redis()
    assert await r.get(f"cyclic:{job_id}:{EDGE_ID}") is None

async def test_non_cyclic_edges_unaffected():
    """sequential and parallel_fanout edges still route normally"""
    await route_by_graph(job_id, pipeline_id, topic, {}, msg)
    assert mock_producer.send_and_wait.call_args[0][0] == NEXT_AGENT_TOPIC

async def test_iteration_injected_in_loop_message():
    """_iteration field present in looped-back message"""
    await route_by_graph(...)
    msg_sent = mock_producer.send_and_wait.call_args[0][1]
    assert "_iteration" in msg_sent
    assert msg_sent["_iteration"] == 1
```

### Definition of Done
All 6 tests pass. No Redis key leaks. Existing sequential/fanout tests still pass.

---

## Phase 4 — `agent_routed` Router Logic (Day 2, ~3h)

### File
`OrchestratorAgent/app/services/pipeline_router.py` — `route_by_graph()`

```python
elif edge.edge_type == "agent_routed":
    # DecisionAgent output must contain: {"next_agent": "Name", "payload": {...}}
    output_data = step_output.get("data", step_output)
    next_agent_name = output_data.get("next_agent")
    payload = output_data.get("payload", output_data)

    if not next_agent_name:
        logger.error("Job %s agent_routed edge: output missing 'next_agent' field — DLQ", job_id)
        await _route_to_dlq(job_id, edge.edge_id, "missing_next_agent", step_output, original_message)
        continue

    # Guardrail: next_agent must be in candidate_agents
    if edge.candidate_agents and next_agent_name not in edge.candidate_agents:
        logger.error(
            "Job %s agent_routed: '%s' not in candidates %s — DLQ",
            job_id, next_agent_name, edge.candidate_agents
        )
        await _route_to_dlq(job_id, edge.edge_id, "invalid_next_agent", step_output, original_message)
        continue

    # Find target node whose agent_name matches
    target_node = next(
        (n for n in graph.nodes.values() if n.agent_name == next_agent_name),
        None,
    )
    if not target_node:
        logger.error("Job %s agent_routed: no node found for agent '%s'", job_id, next_agent_name)
        await _route_to_dlq(job_id, edge.edge_id, "no_node_for_agent", step_output, original_message)
        continue

    routed_msg = {
        "job_id": job_id,
        "step_name": target_node.node_key,
        "payload": payload,
        "config": target_node.config_override or {},
        "_routed_by": edge.edge_id,
        "_router_reason": output_data.get("reason", ""),
    }
    await producer.send_and_wait(target_node.input_topic, routed_msg)
    logger.info(
        "Job %s agent_routed → '%s' (topic: %s, reason: %s)",
        job_id, next_agent_name, target_node.input_topic, output_data.get("reason", "")[:80],
    )
```

Add helper (reuse existing DLQ publish pattern):
```python
async def _route_to_dlq(job_id, edge_id, reason, step_output, original_message):
    producer = await get_producer()
    try:
        await producer.send_and_wait("agent.deadletter", {
            "job_id": job_id,
            "edge_id": edge_id,
            "error": reason,
            "step_name": "agent_routed",
            "original_message": original_message,
        })
    finally:
        await producer.stop()
```

### Test Cases
```python
# OrchestratorAgent/tests/test_agent_routed.py

async def test_routes_to_correct_agent():
    """DecisionAgent outputs next_agent=AgentB → message lands on AgentB.input_topic"""
    output = {"next_agent": "AgentB", "payload": {"data": "x"}, "reason": "risk is low"}
    await route_by_graph(job_id, pipeline_id, topic, output, msg)
    assert mock_producer.send_and_wait.call_args[0][0] == "agentb.input"

async def test_reason_propagated_in_message():
    """router_reason field present in forwarded message for audit trail"""
    output = {"next_agent": "AgentB", "payload": {}, "reason": "test reason"}
    await route_by_graph(...)
    sent = mock_producer.send_and_wait.call_args[0][1]
    assert sent["_router_reason"] == "test reason"

async def test_invalid_agent_goes_to_dlq():
    """next_agent not in candidate_agents → DLQ, not forwarded"""
    output = {"next_agent": "MaliciousAgent", "payload": {}}
    await route_by_graph(job_id, pipeline_id, topic, output, msg)
    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"

async def test_missing_next_agent_goes_to_dlq():
    """Output missing next_agent field → DLQ"""
    output = {"payload": {}}  # no next_agent
    await route_by_graph(...)
    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"

async def test_empty_candidate_agents_allows_any():
    """candidate_agents=[] means no guardrail — any agent name accepted"""
    # edge.candidate_agents = []
    output = {"next_agent": "AnyAgent", "payload": {}}
    await route_by_graph(...)
    # should route, not DLQ

async def test_node_not_found_goes_to_dlq():
    """next_agent is valid candidate but no matching node in graph → DLQ"""
    output = {"next_agent": "AgentX", "payload": {}}
    # AgentX in candidate_agents but not in graph.nodes
    await route_by_graph(...)
    assert mock_producer.send_and_wait.call_args[0][0] == "agent.deadletter"

async def test_routed_by_field_in_message():
    """_routed_by field contains edge_id for traceability"""
    output = {"next_agent": "AgentB", "payload": {}}
    await route_by_graph(...)
    sent = mock_producer.send_and_wait.call_args[0][1]
    assert sent["_routed_by"] == EDGE_ID
```

### Definition of Done
All 7 tests pass. Phase 3 tests still pass. DLQ entries visible via `GET /v1/dlq/`.

---

## Phase 5 — DecisionAgent Definition (Day 2–3, ~2h)

No code. Config-only. Create via ConfigService UI or seed script.

### RouterDecisionAgent definition (ConfigService UI → Agent Definitions → New)

```json
{
  "name": "RouterDecisionAgent",
  "input_fields": ["current_output", "available_agents", "goal", "iteration"],
  "output_topic": "router_decision",
  "llm_instance_name": "anthropic",
  "prompt": "You are a routing coordinator.\n\nCurrent agent output:\n{{current_output}}\n\nGoal:\n{{goal}}\n\nAvailable next agents and their roles:\n{{available_agents}}\n\nCurrent iteration: {{iteration}}\n\nAnalyze the output and decide which agent should handle the next step.\nReturn ONLY valid JSON:\n{\n  \"next_agent\": \"<agent name from available_agents>\",\n  \"reason\": \"<one sentence why>\",\n  \"payload\": <the data the next agent needs>\n}",
  "validation_rules": {
    "type": "required_fields",
    "fields": ["next_agent", "reason", "payload"]
  }
}
```

### Kafka topic creation
```bash
docker exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:29092 --create --if-not-exists \
  --topic router_decision.completed --replication-factor 1 --partitions 1

docker exec kafka /opt/kafka/bin/kafka-topics.sh \
  --bootstrap-server kafka:29092 --create --if-not-exists \
  --topic router_decision.validated --replication-factor 1 --partitions 1
```

Add both to `docker-compose.yml` `kafka-init-topics` block (permanent).

### Test Cases
```python
# Integration test — manual or automated

async def test_decision_agent_produces_valid_routing_output():
    """Send a realistic output to router_decision.input, verify output shape"""
    msg = {
        "job_id": TEST_JOB_ID,
        "current_output": {"recommendation": "low risk", "confidence": 0.6},
        "available_agents": {"AgentB": "deep risk analysis", "AgentC": "budget optimizer"},
        "goal": "maximize ROI under low risk constraint",
        "iteration": 1,
    }
    await produce("router_decision.input", msg)
    result = await consume_one("router_decision.validated", timeout=15)
    assert result["data"]["next_agent"] in ["AgentB", "AgentC"]
    assert "reason" in result["data"]
    assert "payload" in result["data"]

async def test_decision_agent_validation_rejects_missing_fields():
    """If LLM omits next_agent → generic_validator fires validation.failed"""
    # Mock LLM to return output without next_agent
    result = await consume_one("validation.failed", timeout=10)
    assert result["step_name"] == "RouterDecisionAgent"
```

### Definition of Done
RouterDecisionAgent produces `router_decision.validated` messages with correct shape. Validation rejects malformed outputs.

---

## Phase 6 — Frontend: Pipeline Edge Config Panel (Day 3, ~3h)

### File
`frontend/src/components/PipelineEdgeConfigPanel.tsx`

Add conditional sections based on `edge.edge_type`:

```tsx
{/* Cyclic feedback section — shown only for cyclic_feedback edges */}
{edgeType === 'cyclic_feedback' && (
  <div className="edge-config-section">
    <label>Max Iterations</label>
    <input type="number" min={1} max={10}
      value={edge.max_iterations ?? 3}
      onChange={e => updateEdge({ max_iterations: +e.target.value })} />

    <label>Break Field (optional)</label>
    <input type="text" placeholder="e.g. done"
      value={edge.break_field ?? ''}
      onChange={e => updateEdge({ break_field: e.target.value })} />

    <label>Break Value</label>
    <input type="text" placeholder="e.g. true"
      value={edge.break_value ?? ''}
      onChange={e => updateEdge({ break_value: e.target.value })} />
  </div>
)}

{/* Agent routed section — shown only for agent_routed edges */}
{edgeType === 'agent_routed' && (
  <div className="edge-config-section">
    <label>Candidate Agents (comma-separated)</label>
    <input type="text" placeholder="AgentA,AgentB,AgentC"
      value={(edge.candidate_agents ?? []).join(',')}
      onChange={e => updateEdge({
        candidate_agents: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
      })} />
    <p className="hint">Router can only pick from this list. Empty = no guardrail.</p>
  </div>
)}
```

Add `cyclic_feedback` and `agent_routed` to the edge type dropdown options.

### File
`frontend/src/components/JobDetail.tsx` (or equivalent trace view)

Surface routing metadata in Agent Trace View:
```tsx
{step._router_reason && (
  <div className="routing-info">
    <span className="label">Routed by DecisionAgent:</span>
    <span>{step._router_reason}</span>
  </div>
)}
{step._iteration !== undefined && (
  <div className="cycle-info">
    <span className="label">Cycle iteration:</span>
    <span>{step._iteration}</span>
  </div>
)}
```

### Test Cases (manual — run dev server)
- [ ] Create a `cyclic_feedback` edge → panel shows Max Iterations, Break Field, Break Value inputs
- [ ] Create a `agent_routed` edge → panel shows Candidate Agents input
- [ ] Create `sequential` edge → neither cyclic nor routed section visible
- [ ] Save pipeline with cyclic edge → reload → max_iterations value persists
- [ ] Agent Trace View shows `_router_reason` for jobs that went through DecisionAgent
- [ ] Agent Trace View shows `_iteration` counter for cyclic jobs

### Definition of Done
New edge type fields visible, editable, and persist via ConfigService API. No TypeScript errors (`./node_modules/.bin/tsc --noEmit`).

---

## Phase 7 — Integration Tests: End-to-End (Day 3–4, ~4h)

Full pipeline tests covering both new edge types together.

### File
`OrchestratorAgent/tests/test_e2e_dynamic_routing.py`

```python
# Prerequisites: stack running, 3 specialist GenericAgent definitions seeded,
# RouterDecisionAgent definition seeded, pipelines created via ConfigService.

async def test_cyclic_loop_terminates_and_completes():
    """
    Pipeline: SpecialistA →[cyclic_feedback max=3 break=done]→ SpecialistA (loop)
    SpecialistA returns done=true on 2nd iteration.
    Expect: job completes after 2 iterations, not 3.
    """
    job = await submit_job(text="test input", pipeline_id=CYCLIC_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=60)
    steps = await get_job_steps(job["job_id"])
    # SpecialistA ran twice (iterations 0 and 1)
    specialist_steps = [s for s in steps if s["step_name"] == "SpecialistA"]
    assert len(specialist_steps) == 2
    assert specialist_steps[1]["input"].get("_iteration") == 1

async def test_cyclic_budget_exhaustion_completes_not_hangs():
    """
    Agent never sets done=true. Must complete after max_iterations, not hang.
    """
    job = await submit_job(text="loop forever", pipeline_id=CYCLIC_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=120)
    steps = await get_job_steps(job["job_id"])
    specialist_steps = [s for s in steps if s["step_name"] == "SpecialistA"]
    assert len(specialist_steps) == MAX_ITERATIONS

async def test_dynamic_routing_picks_correct_agent():
    """
    Pipeline: SpecialistA → RouterDecisionAgent →[agent_routed]→ {AgentB or AgentC}
    Input designed so DecisionAgent should pick AgentB.
    """
    job = await submit_job(text="low risk scenario", pipeline_id=DYNAMIC_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=60)
    steps = await get_job_steps(job["job_id"])
    step_names = [s["step_name"] for s in steps]
    assert "AgentB" in step_names
    assert "AgentC" not in step_names

async def test_dynamic_routing_reason_in_trace():
    """_router_reason visible in job steps output"""
    job = await submit_job(text="test", pipeline_id=DYNAMIC_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=60)
    steps = await get_job_steps(job["job_id"])
    routed_step = next(s for s in steps if s["step_name"] == "AgentB")
    assert routed_step["input"].get("_router_reason")

async def test_invalid_route_goes_to_dlq_job_fails():
    """
    Patch RouterDecisionAgent to return next_agent="NonExistentAgent".
    Expect job fails, DLQ entry created.
    """
    job = await submit_job(text="invalid route test", pipeline_id=DYNAMIC_PIPELINE_ID)
    await poll_until(job["job_id"], "failed", timeout=30)
    dlq = client.get("/v1/dlq/").json()
    assert any(e["job_id"] == job["job_id"] for e in dlq)

async def test_cyclic_then_dynamic_pipeline():
    """
    Chained: SpecialistA loops 2x → RouterDecisionAgent → picks AgentB → Merger → Aggregator
    Tests both features in one pipeline.
    """
    job = await submit_job(text="complex test", pipeline_id=COMBINED_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=120)
    steps = await get_job_steps(job["job_id"])
    step_names = [s["step_name"] for s in steps]
    assert step_names.count("SpecialistA") == 2    # cyclic loop ran twice
    assert "RouterDecisionAgent" in step_names
    assert "AgentB" in step_names

async def test_sse_stream_shows_cycle_events():
    """SSE stream emits step.started / step.completed for each cycle iteration"""
    job = await submit_job(text="sse test", pipeline_id=CYCLIC_PIPELINE_ID)
    events = await collect_sse_events(job["stream_url"], until="job.completed", timeout=60)
    specialist_events = [e for e in events if e.get("step_name") == "SpecialistA"]
    assert len(specialist_events) >= 2  # started + completed per iteration

async def test_redis_keys_cleaned_after_completion():
    """No cyclic:{job_id}:* keys linger after job completes"""
    job = await submit_job(text="cleanup test", pipeline_id=CYCLIC_PIPELINE_ID)
    await poll_until(job["job_id"], "completed", timeout=60)
    r = get_redis_sync()
    keys = r.keys(f"cyclic:{job['job_id']}:*")
    assert keys == []
```

### Definition of Done
All 8 integration tests pass. `GET /v1/dlq/` empty for clean runs. Redis no leaked keys. SSE stream reflects cycle iterations.

---

## Phase 8 — Observability & Demo Prep (Day 4, ~2h)

### Metrics to add (`shared/civis_obs/metrics.py`)
```python
cycle_iteration_total = Counter(
    "cycle_iteration_total",
    "Total agent cycle iterations",
    ["job_id", "edge_id"],  # keep cardinality sane — or aggregate by pipeline_id
)

dynamic_route_total = Counter(
    "dynamic_route_total",
    "Dynamic routing decisions",
    ["pipeline_id", "chosen_agent"],
)

dynamic_route_guardrail_violations_total = Counter(
    "dynamic_route_guardrail_violations_total",
    "Attempts to route to non-candidate agents",
    ["pipeline_id"],
)
```

Emit in router:
- `cycle_iteration_total.inc()` on each loop-back
- `dynamic_route_total.labels(pipeline_id, next_agent_name).inc()` on each route
- `dynamic_route_guardrail_violations_total.inc()` on candidate mismatch

### Grafana panel additions (`ops/grafana/dashboards/agents_overview.json`)
- "Cycle iterations by pipeline" — bar chart of `cycle_iteration_total`
- "Dynamic routing decisions" — pie chart of `dynamic_route_total` by `chosen_agent`
- "Guardrail violations" — alert if > 0

### Demo script
```bash
# Submit a job on the combined pipeline (cyclic + dynamic)
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"12345678"}' | jq -r .access_token)

curl -N -X POST http://localhost:8000/v1/process/text \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text": "I need to invest ₹10L with moderate risk", "pipeline_id": "<combined_pipeline_uuid>"}'

# Stream the trace
curl -N "http://localhost:8000/v1/jobs/<job_id>/stream?token=$TOKEN"
```

Show in demo:
1. SSE stream: SpecialistA fires twice (cycle iterations 0→1)
2. RouterDecisionAgent fires, outputs `next_agent` + `reason`
3. Job trace in `JobDetail.tsx` shows `_iteration` and `_router_reason`
4. Grafana: cycle count increments live

### Definition of Done
Metrics visible in Grafana. Demo script runs without errors. `_router_reason` and `_iteration` visible in frontend trace view.

---

## Summary

| Phase | Duration | Risk | Deliverable |
|---|---|---|---|
| 0 — Baseline audit | 2h | None | Existing stack proven healthy |
| 1 — Schema migration | 2h | Low (additive only) | New columns in DB |
| 2 — EdgeInfo update | 1h | None | Cache loads new fields |
| 3 — Cyclic router | 3h | Medium (Redis state) | Agents loop with budget |
| 4 — Agent-routed router | 3h | Medium (DLQ path) | Dynamic dispatch works |
| 5 — DecisionAgent config | 2h | Low | LLM picks next agent |
| 6 — Frontend | 3h | Low | New edge fields in UI + trace view |
| 7 — Integration tests | 4h | Low | E2E coverage of both features |
| 8 — Observability | 2h | None | Grafana panels + demo ready |

**Total: ~22h (~3 days)**

No existing services broken at any phase. Each phase independently deployable. Phases 3 and 4 can run in parallel after Phase 2.
