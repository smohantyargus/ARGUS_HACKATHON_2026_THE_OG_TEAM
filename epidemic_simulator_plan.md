# Epidemic Containment Simulator — Phase-wise Execution Plan

Domain 3: Public Health Policy & Epidemic Containment Simulator.
Five config-driven `GenericAgent v2` specialists negotiate a containment policy in a
2–3 round loop until they reach a stable equilibrium, arbitrated by a
`ContextAggregator`. Each specialist **fetches its own domain facts from the
database (via DataQueryAgent) before its LLM call** — the scenario's numbers are no
longer hardcoded into prompts.

Built entirely on the existing infra (GenericAgent v2 + DataQueryAgent,
GenericValidator, ResponseMerger, ContextAggregator, dynamic-routing edges). One
small router change required (Phase 1). Everything else is seed config + docker-compose.

> **Data-aware upgrade (added).** The original draft of this plan baked every civic
> figure into the five system prompts (`1,200-bed limit`, `$45M/day`, `7-day mask
> supply`, `day-10 compliance break`, `14,000 staff`). Those five figures map
> one-to-one onto the civic domain tables now owned by **DataQueryAgent**. By making
> the specialists **GenericAgent v2** definitions with a `data_queries` block, each
> agent pulls its slice live and references it as `{{data}}` in the prompt. Benefits:
> single source of truth (reseed the DB to change the scenario — no prompt edits),
> agents reason over *real* state (incl. live `occupied_beds`/`available_beds`), and
> the demo proves end-to-end DB→agent grounding. The negotiation loop, conflict
> detection, and routing are untouched: v2 has the **identical Kafka contract** to v1,
> so it drops into the same pipeline, validator, and merger.

### Agent → query → table mapping

| Specialist | `query_name` | Table | Replaces hardcoded figure |
|---|---|---|---|
| Epidemiologist | `icu_capacity_by_region` | `icu_capacity` | 1,200-bed ICU limit (+ live occupancy) |
| EconomicImpact | `economic_indicators_by_region` | `economic_indicators` | $45M/day loss, hourly-worker % |
| CitizenCompliance | `compliance_outlook` | `compliance_metrics` | day-10 cooperation break |
| SupplyChain | `supply_runway` | `supply_inventory` | 7-day mask supply, North Rail Terminal |
| HealthcareOps | `healthcare_ops_by_region` | `healthcare_ops` | 14,000 staff, absenteeism %, school policy |

(The aggregator could also be made data-aware later, but it stays a config-only
`AggregatorDefinition`; its constraints are satisfied by the DB-grounded advisor
outputs it receives.)

---

## Target Pipeline Topology

```
                         ┌──────────── cyclic_feedback ─────────────┐
                         │  break_field = equilibrium_reached=true   │
                         │  max_iterations = 3                       │
                         ▼  (loops back to council head)             │
  USER ──► Epidemiologist ──parallel_fanout──► EconomicImpact ──┐    │
        (Agent A, council head)  │                              │    │
        SIR projection / lockdown├────────────► CitizenCompliance ──┤
                                 │                              │    │
                                 ├────────────► SupplyChain ────┤    │
                                 │                              │    │
                                 └────────────► HealthcareOps ──┤    │
   each specialist is GenericAgent v2:                          │    │
   before its LLM call it does                                  │    │
   await request_data(query_name, {region})                     │    │
        │  data.request ▲ reply (rows)                          │    │
        ▼               │                                       │    │
   ┌─────────────────────────┐   SELECT (named, read-only)      │    │
   │ DataQueryAgent          │ ───────────────────────────────► app-db
   │ NAMED_QUERIES whitelist │   icu_capacity / economic_…      (civic
   └─────────────────────────┘   supply / compliance / ops       tables)
                                                                │    │
                                            merger_input ×4     ▼    │
                                                       ResponseMerger │
                                                            │         │
                                                            ▼         │
                                                     PolicyAggregator ┘
                                                  (conflict + LLM arbitration,
                                                   emits equilibrium_reached)
                                                            │
                                              equilibrium → task.completed
```

**Loop semantics:** the cyclic edge has `source = PolicyAggregator`,
`target = Epidemiologist`. When the aggregator completes, the router checks
`equilibrium_reached`. If false and iteration < `max_iterations`, the aggregator's
candidate policy is re-injected at the council head (Epidemiologist), and all five
agents re-evaluate against the amended policy. On `equilibrium_reached=true` (or
budget exhaustion) → `task.completed`.

**Why loop-to-target (not self-loop):** the shipped cyclic_feedback re-runs its
own source node. A self-loop on the aggregator would re-synthesize identical
collected inputs (advisors never re-run) → no negotiation. Looping to the council
head forces the whole council to re-evaluate each round — the actual showcase.

---

## Phase 0 — Prereqs & Decisions (~30m)

### Tasks
- [ ] Stack healthy: `./dev-up.sh && ./dev-up.sh status` (resolve `haidoc` container-name conflict first if present)
- [ ] LLM key present in `.env` (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`) — all 5 agents + aggregator call the LLM
- [ ] **`data_query_agent` + `generic_agent_v2` services up and healthy** (already wired in compose/services.yaml). DataQueryAgent self-creates and seeds the civic domain tables on startup — confirm with `docker exec -i app-db psql -U civis -d civis -c "select * from icu_capacity;"` (expect the metro row, 1,200 beds).
- [ ] Decide loop semantics (see below) — recommendation: **loop-to-target**

### Decision: loop-to-target vs self-loop
| Option | Effect | Verdict |
|---|---|---|
| **loop-to-target** (recommended) | cyclic edge re-publishes to `target_node.input_topic`; whole council re-runs | True multi-agent negotiation |
| self-loop (shipped) | re-runs aggregator on stale inputs | No real negotiation |

### Definition of Done
Stack up, LLM key set, decision recorded.

---

## Phase 1 — Router: cyclic loop-to-target support (~1h)

### File
`backend/OrchestratorAgent/app/services/pipeline_router.py`

Add an opt-in loop target. Default stays self-loop (back-compat); a new edge field
`loop_to` (`"source"` | `"target"`) selects behavior. Epidemic pipeline sets
`loop_to="target"`.

```python
# _EdgeInfo — add one field
loop_to: str = "source"   # "source" (self-loop, default) | "target"
```

```python
# _build_graph_cache — populate
loop_to=e.get("loop_to") or "source",
```

```python
# route_by_graph, inside the cyclic_feedback branch — replace the src_node lookup
loop_node_id = edge.target_node_id if edge.loop_to == "target" else edge.source_node_id
loop_node = graph.nodes.get(loop_node_id)
if not loop_node:
    logger.error("Job %s cyclic edge %s loop node not found", job_id, edge.edge_id)
    continue
loop_msg = _build_forward_msg(job_id, loop_node, step_output, original_message)
loop_msg["_iteration"] = iteration + 1
loop_msg["_cycle_edge_id"] = edge.edge_id
await producer.send_and_wait(loop_node.input_topic, loop_msg)
```

Schema: add `loop_to TEXT DEFAULT 'source'` to `pipeline_edges` (new migration
`backend/migrations/add_cyclic_loop_target.sql`) + `loop_to` column on
`PipelineEdge` model.

### Test Cases
`backend/OrchestratorAgent/tests/test_cyclic_routing.py` (extend)
```python
async def test_loop_to_target_reenters_target_node():
    """loop_to='target' → re-publishes to target node input, not source."""
    # edge: source=Aggregator, target=Epidemiologist, loop_to='target'
    await route_by_graph(job_id, pid, "aggregator.validated", {"equilibrium_reached":"false"}, msg)
    assert mock_producer.send_and_wait.call_args[0][0] == "epidemiologist.input"

async def test_loop_to_source_unchanged_default():
    """Existing self-loop behavior preserved when loop_to absent."""
    # all prior Phase-3 cyclic tests still pass
```

### Definition of Done
New + all existing cyclic tests pass. Self-loop default unchanged.

---

## Phase 2 — Domain conflict fields (~30m)

### File
`backend/ContextAggregatorAgent/app/services/aggregator_service.py`

`_CONFLICT_FIELDS` is hardcoded clinical. Make it additive so policy disagreements
surface in the trace's `_conflicts`.

```python
_CONFLICT_FIELDS = [
    # clinical (existing)
    "diagnosis", "assessment", "urgency", "medications", "follow_up", "impression",
    # epidemic policy
    "recommendation", "action", "amendment", "proposal", "policy_stance",
]
```

(Optional hardening: load `_CONFLICT_FIELDS` from the AggregatorDefinition instead
of the module constant. Not required for the demo.)

### Test Cases
```python
def test_conflict_detected_on_recommendation():
    inputs = {
      "Epidemiologist": {"output": {"recommendation": "21-day hard lockdown"}},
      "EconomicImpact": {"output": {"recommendation": "30% transit capacity"}},
    }
    conflicts = _detect_conflicts(inputs, definition)
    assert any(c["field"] == "recommendation" for c in conflicts)
```

### Definition of Done
Conflict detection fires on policy fields. Clinical pipelines unaffected (additive).

---

## Phase 3 — Agent Definitions (5 GenericAgent v2 specialists) (~2h)

Config only. One `AgentDefinition` row per agent, each with a `data_queries` block →
served by **`generic_agent_v2`** (Phase 7), which fetches the rows from DataQueryAgent
before the LLM call. Source persona/constraints from `docs/civis_plan/agents/AGENT_*.md`.

> **Why v2 (not v1):** the partition rule is `data_queries` truthy → v2, empty → v1.
> Because every definition below carries a `data_queries` block, all five are picked up
> by `generic_agent_v2` and ignored by `generic_agent`. Each definition is still handled
> by exactly one container.

### Common shape
- `input_fields`: `["scenario", "region", "current_policy", "iteration", "peer_feedback"]`
  - **`region`** drives the data fetch (default `"metro"` — the seeded scenario region). The
    orchestrator must populate `region` on entry; on cyclic re-entry it carries through.
  - round 1: `current_policy`/`peer_feedback` empty; round ≥2: filled from aggregator candidate
- `data_queries`: `[{ "query_name": "<agent's query>", "params": { "region": "{{region}}" } }]`
  - the fetched rows are injected into the render context as **`{{data}}`** (JSON) before the LLM call
- `output_topic`: `<agent>.completed`; validated by GenericValidator → `<agent>.validated`
- `llm_instance_name`: `gemini-flash` (or `claude-sonnet`)
- `temperature`: 0.4 (some divergence), `max_tokens`: 768

> **Prompt change for all five:** drop the literal figures from `system_prompt`; instead say
> *"Authoritative live figures for your domain are provided in the DATA block below — reason
> from those, never invent numbers."* and add a `DATA:\n{{data}}` section to each
> `user_prompt_template`. The constraints (ICU ≤ beds, loss ≤ threshold, …) are now read from
> `{{data}}` rather than hardcoded, so a reseed changes the scenario with zero prompt edits.

### A — Epidemiologist (council head)
```json
{
  "name": "Epidemiologist",
  "input_topic": "epidemiologist.input",
  "output_topic": "epidemiologist.completed",
  "input_fields": ["scenario", "region", "current_policy", "iteration", "peer_feedback"],
  "data_queries": [{"query_name": "icu_capacity_by_region", "params": {"region": "{{region}}"}}],
  "system_prompt": "You are a senior pandemic modeler (SIR/SEIR). Authoritative live ICU figures (total/occupied/available beds) are in the DATA block below — reason from those, never invent numbers. Goal: keep projected ICU demand under the available-bed limit and drive R0 below 1. You are biased toward strict suppression (lockdowns, transit closure, contact tracing). Given the scenario and the current candidate policy, project case trajectory and ICU breach timing, then state your recommendation. If a candidate policy is present, critique it from a suppression standpoint and amend it. Respond with valid JSON only.",
  "user_prompt_template": "Scenario:\n{{scenario}}\n\nDATA (live ICU capacity):\n{{data}}\n\nCurrent candidate policy (empty on round 1):\n{{current_policy}}\n\nPeer feedback from last round:\n{{peer_feedback}}\n\nIteration: {{iteration}}\n\nReturn JSON: {\"recommendation\": str, \"target_entities\": [str], \"metric_constraint\": str, \"projected_icu_breach_days\": int, \"confidence\": float}",
  "validation_rules": {"type": "required_fields", "fields": ["recommendation", "confidence"]}
}
```

### B — EconomicImpact
```json
{
  "name": "EconomicImpact",
  "input_topic": "economicimpact.input",
  "output_topic": "economicimpact.completed",
  "input_fields": ["scenario", "region", "current_policy", "iteration", "peer_feedback"],
  "data_queries": [{"query_name": "economic_indicators_by_region", "params": {"region": "{{region}}"}}],
  "system_prompt": "You are a state finance minister. Authoritative live economic figures (daily loss threshold, hourly-worker share) are in the DATA block below — reason from those, never invent numbers. Constraint: keep daily economic loss under the stated threshold; protect hourly workers and essential supply chains. You will veto measures that breach the loss threshold and propose cheaper amendments (e.g. partial transit capacity instead of full closure). Respond with valid JSON only.",
  "user_prompt_template": "Scenario:\n{{scenario}}\n\nDATA (live economic indicators):\n{{data}}\n\nCurrent candidate policy:\n{{current_policy}}\n\nPeer feedback:\n{{peer_feedback}}\n\nIteration: {{iteration}}\n\nReturn JSON: {\"action\": \"ACCEPT|VETO_HARD_LOCKDOWN|AMEND\", \"amendment\": str, \"economic_metric\": str, \"recommendation\": str, \"confidence\": float}",
  "validation_rules": {"type": "required_fields", "fields": ["action", "confidence"]}
}
```

### C — CitizenCompliance
```json
{
  "name": "CitizenCompliance",
  "input_topic": "citizencompliance.input",
  "output_topic": "citizencompliance.completed",
  "input_fields": ["scenario", "region", "current_policy", "iteration", "peer_feedback"],
  "data_queries": [{"query_name": "compliance_outlook", "params": {"region": "{{region}}"}}],
  "system_prompt": "You are a behavioral scientist. The live cooperation-break day for this region is in the DATA block below — reason from it, never invent numbers. You estimate public compliance and fatigue. Flag when cooperation will break (per the DATA) and require enabling conditions (e.g. subsidized masks at transit checkpoints) for a policy to be realistic. Respond with valid JSON only.",
  "user_prompt_template": "Scenario:\n{{scenario}}\n\nDATA (live compliance outlook):\n{{data}}\n\nCurrent candidate policy:\n{{current_policy}}\n\nPeer feedback:\n{{peer_feedback}}\n\nIteration: {{iteration}}\n\nReturn JSON: {\"warning\": str, \"proposal\": str, \"requirement\": str, \"projected_compliance_pct\": int, \"recommendation\": str, \"confidence\": float}",
  "validation_rules": {"type": "required_fields", "fields": ["projected_compliance_pct", "confidence"]}
}
```

### D — SupplyChain
```json
{
  "name": "SupplyChain",
  "input_topic": "supplychain.input",
  "output_topic": "supplychain.completed",
  "input_fields": ["scenario", "region", "current_policy", "iteration", "peer_feedback"],
  "data_queries": [{"query_name": "supply_runway", "params": {"region": "{{region}}"}}],
  "system_prompt": "You are a logistics coordinator. Live stockpile figures (item, days remaining, source terminal) are in the DATA block below — reason from those, never invent numbers. Audit any policy against the stated days-remaining. Issue critical overrides (e.g. re-route transport from the listed source terminal) when supplies would deplete before the policy ends. Respond with valid JSON only.",
  "user_prompt_template": "Scenario:\n{{scenario}}\n\nDATA (live supply runway):\n{{data}}\n\nCurrent candidate policy:\n{{current_policy}}\n\nPeer feedback:\n{{peer_feedback}}\n\nIteration: {{iteration}}\n\nReturn JSON: {\"critical_override\": str, \"inventory_warning\": str, \"target_action\": str, \"recommendation\": str, \"confidence\": float}",
  "validation_rules": {"type": "required_fields", "fields": ["recommendation", "confidence"]}
}
```

### E — HealthcareOps
```json
{
  "name": "HealthcareOps",
  "input_topic": "healthcareops.input",
  "output_topic": "healthcareops.completed",
  "input_fields": ["scenario", "region", "current_policy", "iteration", "peer_feedback"],
  "data_queries": [{"query_name": "healthcare_ops_by_region", "params": {"region": "{{region}}"}}],
  "system_prompt": "You are a medical director. Live workforce figures (active medical staff, current absenteeism %, school policy) are in the DATA block below — reason from those, never invent numbers. Amend policies to prevent staff absenteeism (e.g. keep primary schools open for childcare, move secondary schools remote). Respond with valid JSON only.",
  "user_prompt_template": "Scenario:\n{{scenario}}\n\nDATA (live healthcare ops):\n{{data}}\n\nCurrent candidate policy:\n{{current_policy}}\n\nPeer feedback:\n{{peer_feedback}}\n\nIteration: {{iteration}}\n\nReturn JSON: {\"policy_amendment\": str, \"workforce_constraint\": str, \"intervention_type\": str, \"recommendation\": str, \"confidence\": float}",
  "validation_rules": {"type": "required_fields", "fields": ["recommendation", "confidence"]}
}
```

### Test Cases
```python
def test_all_five_agent_defs_created():
    for name in ["Epidemiologist","EconomicImpact","CitizenCompliance","SupplyChain","HealthcareOps"]:
        r = client.get(f"/agent-definitions/{name}")
        assert r.status_code == 200
        assert r.json()["validation_rules"]["type"] == "required_fields"
        # data-aware → non-empty data_queries → served by generic_agent_v2
        assert r.json()["data_queries"], f"{name} must carry a data_queries block"

def test_data_query_round_trips_per_agent():
    """Each agent's query_name resolves against DataQueryAgent for region=metro."""
    for q in ["icu_capacity_by_region","economic_indicators_by_region","compliance_outlook","supply_runway","healthcare_ops_by_region"]:
        rows = await request_data(q, {"region": "metro"}, timeout=5.0)
        assert rows, f"{q} returned no rows for metro"
```

### Definition of Done
5 AgentDefinition rows present, each with distinct input/output topics **and a non-empty
`data_queries` block** (so all five are claimed by `generic_agent_v2`). Each query name
round-trips through DataQueryAgent for `region=metro`.

---

## Phase 4 — Aggregator Definition (PolicyAggregator) (~1h)

### `AggregatorDefinition` row
```json
{
  "name": "policy_aggregator",
  "input_topic": "policy.collected",
  "output_topic": "policy_aggregator.completed",
  "input_sources": [
    {"agent_name": "Epidemiologist",    "base_weight": 1.0, "label": "Epidemiologist",  "required": true},
    {"agent_name": "EconomicImpact",    "base_weight": 1.0, "label": "Economist",       "required": true},
    {"agent_name": "CitizenCompliance", "base_weight": 1.0, "label": "Behavioral Sci",  "required": true},
    {"agent_name": "SupplyChain",       "base_weight": 1.0, "label": "Logistics",       "required": true},
    {"agent_name": "HealthcareOps",     "base_weight": 1.0, "label": "Medical Director","required": true}
  ],
  "output_schema_type": "structured_json",
  "output_persona": "clinician",
  "min_required_inputs": 5,
  "timeout_seconds": 90,
  "llm_instance_name": "gemini-flash",
  "synthesis_prompt": "You are the policy coordinator for an epidemic response. You receive five advisor outputs (epidemiology, economics, compliance, logistics, healthcare ops), each weighted. Negotiate a single containment policy that (1) keeps projected ICU demand under 1,200 beds, (2) keeps daily economic loss under $45M, (3) keeps projected public compliance >= 40%, (4) respects the 7-day mask supply, (5) prevents medical staff absenteeism. Resolve conflicts explicitly. Decide whether the council has reached a STABLE equilibrium: no agent still vetoes, compliance >= 40%, ICU under limit, supply feasible. Respond with valid JSON only: {\"policy\": str, \"rationale\": str, \"icu_ok\": bool, \"economy_ok\": bool, \"compliance_pct\": int, \"supply_ok\": bool, \"equilibrium_reached\": \"true\"|\"false\", \"_conflicts\": [...], \"_sources\": [...], \"confidence\": float}. Set equilibrium_reached='true' ONLY when all constraints are simultaneously satisfied."
}
```

**Note on break_field:** the cyclic edge reads `step_output["data"][break_field]`.
`equilibrium_reached` must be a top-level string field (`"true"`/`"false"`) in the
aggregator output so the router's string compare matches `break_value="true"`.

### Test Cases
```python
def test_aggregator_emits_equilibrium_flag():
    out = run_aggregator(sample_five_inputs_converged)
    assert out["equilibrium_reached"] in ("true", "false")

def test_aggregator_quorum_waits_for_five():
    # 4 of 5 arrive → no synthesis; 5th arrives → synthesis fires
```

### Definition of Done
PolicyAggregator synthesizes 5 inputs, emits `equilibrium_reached` string flag.

---

## Phase 5 — Validation Rules (~30m)

GenericValidator validates each `<agent>.completed` against the agent's
`validation_rules` → publishes `<agent>.validated`. Rules already inline in each
AgentDefinition (Phase 3). If GenericValidator reads `ValidationRule` table by
`step_name` instead, seed matching rows.

### Tasks
- [ ] Confirm GenericValidator source: inline `validation_rules` vs `ValidationRule` table
- [ ] If table-based: seed one `required_fields`/`json_schema` row per agent step_name

### Test Cases
```python
async def test_missing_required_field_fails_validation():
    # Epidemiologist output without "recommendation" → validation.failed, not .validated
```

### Definition of Done
Each agent's malformed output routes to `validation.failed`; valid output to `.validated`.

---

## Phase 6 — Pipeline Graph Seed (~1.5h)

### File
`backend/ConfigService/seed.py` — add `seed_epidemic_pipeline(db)` (or standalone
`backend/migrations/seed_epidemic.sql`).

Build:
- 1 PipelineDefinition: `epidemic_containment`
- 6 PipelineNodes: Epidemiologist, EconomicImpact, CitizenCompliance, SupplyChain, HealthcareOps, PolicyAggregator
- Edges:
  - Epidemiologist → {Economic, Citizen, Supply, Healthcare} : `parallel_fanout` (4 edges)
  - {Economic, Citizen, Supply, Healthcare} → PolicyAggregator : `merger_input`, `wait_for_group="council"` (4 edges)
  - PolicyAggregator → Epidemiologist : `cyclic_feedback`, `loop_to="target"`, `max_iterations=3`, `break_field="equilibrium_reached"`, `break_value="true"`

```python
edges = [
  # fan-out
  *[(EPI, x, "parallel_fanout", {}) for x in [ECON, CITZ, SUPP, HLTH]],
  # fan-in to aggregator
  *[(x, AGG, "merger_input", {"wait_for_group": "council"}) for x in [ECON, CITZ, SUPP, HLTH]],
  # negotiation loop
  (AGG, EPI, "cyclic_feedback", {
      "loop_to": "target", "max_iterations": 3,
      "break_field": "equilibrium_reached", "break_value": "true",
  }),
]
```

### Gotchas
- ResponseMerger needs the `council` group registered (ResponseMerger model row /
  `get_fanin_required`) so quorum=4 is known. Verify how `get_fanin_required`
  derives required keys — seed accordingly.
- Aggregator `input_topic` (`policy.collected`) must equal the merger's forward
  target topic. Align merger output → aggregator input.
- Epidemiologist is both pipeline entry AND cyclic target. Entry submission must
  hit `epidemiologist.input` with `scenario` **and `region`** populated (the five v2
  agents key their `data_queries` off `{{region}}`; default `"metro"`). Ensure the
  cyclic loop-to-target message (Phase 1 `_build_forward_msg`) carries `region` through
  on re-entry, or every round after the first fetches empty data. If the entry payload
  has no explicit `region`, default it to `"metro"` at submission time.

### Test Cases
```python
def test_pipeline_graph_shape():
    g = client.get(f"/pipelines/{PID}/graph").json()
    assert len([e for e in g["edges"] if e["edge_type"]=="parallel_fanout"]) == 4
    assert len([e for e in g["edges"] if e["edge_type"]=="merger_input"]) == 4
    cyc = [e for e in g["edges"] if e["edge_type"]=="cyclic_feedback"][0]
    assert cyc["loop_to"] == "target" and cyc["break_field"] == "equilibrium_reached"
```

### Definition of Done
Pipeline graph builds in router cache without error; 6 nodes, 9 edges.

---

## Phase 7 — Docker Compose Services + Kafka Topics (~1.5h)

### docker-compose.yml
5 **GenericAgent v2** containers (`GenericAgentV2/Dockerfile`, different `AGENT_NAME` +
health port) + 1 GenericValidator (if not already generic across all agents) +
PolicyAggregator container (`AGGREGATOR_NAME=policy_aggregator`). The shared
`data_query_agent` service is already in compose (Phase wiring from the DataQueryAgent
work) — these five just depend on it.

```yaml
  epidemiologist:
    build: { context: ./backend, dockerfile: GenericAgentV2/Dockerfile }
    environment: { AGENT_NAME: Epidemiologist, KAFKA_BOOTSTRAP: ..., CONFIG_SERVICE_URL: ..., REDIS_URL: ..., <LLM keys> }
    depends_on: { data_query_agent: { condition: service_healthy }, config-service: { condition: service_healthy } }
  economicimpact:    { ..., environment: { AGENT_NAME: EconomicImpact } }
  citizencompliance: { ..., environment: { AGENT_NAME: CitizenCompliance } }
  supplychain:       { ..., environment: { AGENT_NAME: SupplyChain } }
  healthcareops:     { ..., environment: { AGENT_NAME: HealthcareOps } }
  policy-aggregator:
    build: { context: ./backend, dockerfile: ContextAggregatorAgent/Dockerfile }
    environment: { AGGREGATOR_NAME: policy_aggregator, ... }
```

> Each container runs the **GenericAgent v2** loop, which loads *only* definitions whose
> `data_queries` is non-empty (the partition rule). The `data.request`/`data.response`
> topics are already created by `kafka-init-topics` from the DataQueryAgent wiring — no new
> topics needed for the fetch path. If you instead run one shared `generic_agent_v2`
> container for all five definitions (no per-agent `AGENT_NAME`), confirm its consumer-group
> strategy loads all five — the per-`AGENT_NAME` split above keeps it symmetric with the v1 plan.

### Kafka topics (add to `kafka-init-topics`)
For each of the 5 agents: `<agent>.input`, `<agent>.completed`, `<agent>.validated`.
Plus `policy.collected`, `policy_aggregator.completed`, `policy_aggregator.validated`.

### Test Cases (smoke)
- [ ] `docker compose up` → all 7 new containers healthy
- [ ] `kafka-topics.sh --list` shows all new topics

### Definition of Done
All containers healthy, topics present, agents subscribed (0 consumer lag).

---

## Phase 8 — Seed Wiring & Apply (~30m)

### Tasks
- [ ] Add agent/aggregator/pipeline seed funcs to `seed.py` `main()`
- [ ] Apply migrations: `add_cyclic_loop_target.sql` (Phase 1)
- [ ] Run `python seed.py --force` inside ConfigService container
- [ ] Verify rows: 5 agent_definitions, 1 aggregator_definition, 1 pipeline_definition

### Definition of Done
Single `seed.py` run provisions the whole domain idempotently.

---

## Phase 9 — End-to-End Run & Trace Verification (~2h)

### Trigger
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"12345678"}' | jq -r .access_token)

curl -N -X POST http://localhost:8000/v1/process/text \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text": "A new influenza variant with an estimated R0 of 2.5 has been detected spreading through public transit hubs in a city of 5 million people.", "region": "metro", "pipeline_id": "<epidemic_pipeline_uuid>"}'
```

> `region` defaults to `"metro"` (the seeded scenario) if the entry payload omits it.
> To run a *different* scenario, reseed the civic tables with another `region_id` and pass it
> here — **no prompt or agent-definition edits required**. That reseed-to-rescenario property is
> the headline benefit of the data-aware upgrade; worth showing in the demo.

### Test Cases
`backend/OrchestratorAgent/tests/test_e2e_epidemic.py`
```python
async def test_negotiation_converges_and_completes():
    job = await submit(SCENARIO, EPIDEMIC_PID)
    await poll_until(job["job_id"], "completed", timeout=180)
    steps = await get_job_steps(job["job_id"])
    # council ran more than once (loop fired)
    assert sum(1 for s in steps if s["step_name"]=="Epidemiologist") >= 2

async def test_budget_caps_at_three_rounds():
    # force non-convergence (constraints unsatisfiable) → exits at max_iterations=3
    epi_runs = [s for s in steps if s["step_name"]=="Epidemiologist"]
    assert len(epi_runs) <= 3

async def test_each_round_fans_out_to_all_five():
    # per iteration, all 4 advisors + aggregator fired
    assert {"EconomicImpact","CitizenCompliance","SupplyChain","HealthcareOps"} <= {s["step_name"] for s in steps}

async def test_iteration_counter_in_trace():
    assert any(s["input"].get("_iteration") for s in steps)

async def test_final_policy_satisfies_constraints():
    final = job["result"]
    assert final["equilibrium_reached"] == "true" or len(epi_runs) == 3

async def test_no_redis_cycle_key_leak():
    assert get_redis_sync().keys(f"cyclic:{job['job_id']}:*") == []

async def test_specialists_grounded_in_db_figures():
    """Each round-1 specialist step's input carries the fetched DATA, and the
    Epidemiologist reasons against the DB's available_beds — not a prompt-baked 1,200."""
    epi = next(s for s in steps if s["step_name"] == "Epidemiologist")
    assert "data" in epi["input"]            # {{data}} was injected pre-LLM
    assert epi["input"]["data"]              # non-empty rows from DataQueryAgent
    # reseed icu_capacity.total_beds → output's metric_constraint tracks the new number
```

### Definition of Done
Job completes via convergence or budget cap. Council re-runs ≥2 rounds. No key leaks.

---

## Phase 10 — Frontend Trace & Demo Polish (~1.5h)

### Files
`admin/frontend/src/pages/JobDetail.tsx` (already surfaces `_iteration` /
`_router_reason` from the dynamic-routing work).

### Tasks
- [ ] Group steps by `_iteration` (Round 1 / Round 2 / Round 3 headers) in the trace
- [ ] Render `_conflicts` from aggregator output (which agent vetoed what)
- [ ] Show per-round constraint badges: ICU ok / economy ok / compliance% / supply ok
- [ ] Highlight final `equilibrium_reached` banner

### Test Cases (manual)
- [ ] Trace shows 2–3 round groupings
- [ ] Conflicts visible per round; final policy banner shown
- [ ] `tsc --noEmit` clean

### Definition of Done
Agent Trace View reads as a readable negotiation transcript.

---

## Phase 11 — Observability (~30m)

### Tasks
- [ ] `cycle_iteration_total` already emitted — confirm it increments per round for this pipeline
- [ ] Add Grafana panel: rounds-to-convergence per job (from `cycle_iteration_total`)
- [ ] Optional: counter `equilibrium_reached_total{pipeline,outcome="converged|capped"}`

### Definition of Done
Round count visible in Grafana for epidemic jobs.

---

## Summary

| Phase | Effort | Type | Deliverable |
|---|---|---|---|
| 0 — Prereqs | 0.5h | ops | Stack up, key set, decision made |
| 1 — Router loop-to-target | 1h | code | Council-wide negotiation loop |
| 2 — Domain conflict fields | 0.5h | code | Policy conflicts in trace |
| 3 — Agent definitions | 2h | config | 5 GenericAgent **v2** specialists (DB-grounded via `data_queries`) |
| 4 — Aggregator definition | 1h | config | PolicyAggregator + equilibrium flag |
| 5 — Validation rules | 0.5h | config | Per-agent output validation |
| 6 — Pipeline graph seed | 1.5h | config | 6 nodes, 9 edges (entry carries `region`) |
| 7 — Compose + topics | 1.5h | ops | 7 containers (5 on `GenericAgentV2`), all topics; depends on `data_query_agent` |
| 8 — Seed wiring | 0.5h | ops | One-command provision |
| 9 — E2E run | 2h | test | Convergence verified |
| 10 — Frontend polish | 1.5h | code | Negotiation transcript UI |
| 11 — Observability | 0.5h | ops | Round metrics |

**Total: ~13h (~2 days)**

Only Phase 1 + Phase 2 touch shipped code (both additive, back-compatible).
Phases 3–8 are pure config/compose. Critical path: 1 → 3 → 4 → 6 → 7 → 8 → 9.

**Data-aware net change:** zero added phases. The DataQueryAgent + GenericAgent v2 services
already exist and are wired (compose, workspace, `services.yaml`, `data.request`/`data.response`
topics, the `data_queries` column on `agent_definitions`, civic domain tables self-seeded by
DataQueryAgent). The upgrade is entirely **config** — add a `data_queries` block + a `region`
input field to the five definitions and point their containers at `GenericAgentV2/Dockerfile`.
Effort is unchanged; the payoff is real DB grounding, reseed-to-rescenario without prompt edits,
and a demonstrable DATA→agent→policy chain in the trace.
