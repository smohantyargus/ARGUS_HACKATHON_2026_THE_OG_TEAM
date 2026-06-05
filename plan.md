# Multi-Agent Decision Intelligence System — Integration Plan

Built on the **civis orchestration core** (Kafka event bus, config-driven agents,
pipeline graph router, fan-in synthesis). Medical domain stripped — the plumbing is
generic and reusable for **any** multi-agent decision problem.

---

## 1. What was migrated (and what was dropped)

### Kept — orchestration skeleton

| Component | Role in the decision system |
|---|---|
| `shared/civis_obs` | Shared lib: Kafka consumer base class, unified `chat_completion()` LLM client, Prometheus metrics, health checks, JSON logging, token tracking |
| `ConfigService` | Source of truth — define agents, pipelines (graph), prompts, LLM instances, aggregator/merger configs. **Agents are created here, not in code.** |
| `OrchestratorAgent` | API gateway + **Pipeline Router** (graph traversal over Kafka) + job state machine + SSE stream (the Agent Trace data) |
| `GenericAgent` | **Config-driven specialist agents** — one container runs N agents defined in ConfigService. This is how we build Destination/Risk/Budget/etc. agents with zero code. |
| `GenericValidator` | Shared output validator — gates/**challenges** every agent output before it flows on (4 rule types) |
| `ResponseMerger` | **Fan-in quorum** — waits for N parallel specialists, merges outputs into one JSON |
| `ContextAggregatorAgent` | **Final synthesis + conflict resolution** — detects disagreement between agents, arbitrates with an LLM, emits the system's decision |
| `ReasoningAgent` + `ReasoningValidator` | *(optional, off by default)* Claude streaming + Redis SSE token relay — a live-streamed "deliberation" agent |
| `frontend` | Admin dashboard + **PipelineBuilder** (React Flow) = the **Agent Trace View** deliverable |
| `ops/` | Prometheus + Grafana (per-agent metrics, Kafka lag) — the "observability" handover bonus |
| `migrations/` | Raw SQL ConfigService migrations |
| Infra | Kafka, Postgres (`app-db`), Redis, all in `docker-compose.yml` |

### Dropped (medical / not needed)

SpeechToText, STTValidator, AudioPreprocessor, AudioChunker, TranscriptStitcher,
NLPAgent, NLPValidator, SentimentAgent/Validator, LLMServer (local llama.cpp),
LoggerAgent, **Authentik** (OIDC stack — replaced by built-in local HS256 auth).

These were removed from `docker-compose.yml`, `services.yaml`, `pyproject.toml`
workspace members, and `ops/prometheus/prometheus.yml` scrape targets.

---

## 2. Why this maps cleanly onto the hackathon brief

| Brief requirement | How the civis core satisfies it |
|---|---|
| ≥3 specialized agents | Define N `AgentDefinition`s in ConfigService — each with distinct prompt/expertise |
| Agent-to-agent communication | Kafka topics. Agent A's `output_topic` → validator → router → Agent B's `input_topic` |
| Structured outputs exchanged | Every agent emits JSON; `GenericValidator` enforces `json_schema`/`required_fields` |
| Challenge / validate each other | `GenericValidator` gates outputs; `ContextAggregator` detects + arbitrates conflicts |
| Resolve conflicting viewpoints | `ContextAggregatorAgent` — `_CONFLICT_FIELDS` detection + weighted LLM arbitration |
| Custom orchestration logic | Pipeline graph (sequential / `parallel_fanout` / `merger_input` edges) in ConfigService |
| **Agent Trace View** (mandatory) | `PipelineBuilder.tsx` (DAG) + `GET /v1/jobs/:id` (per-step input/output) + SSE stream |
| Final recommendation | `ContextAggregator` output = the system's decision |
| Maintainability / handover bonus | New agents = config rows, no code. Observability built in. |

**Evaluation weight is 40% on collaboration/interdependency** — the merger + aggregator
conflict-resolution path is exactly what scores here. Lead the demo with it.

---

## 3. Reference architecture (parallel-fanout decision pattern)

```
                          POST /v1/process/text  {prompt, pipeline_id}
                                       │
                                  Orchestrator
                                  (creates job, emits decision.input)
                                       │
              ┌────────────────────────┼────────────────────────┐  parallel_fanout
              ▼                        ▼                        ▼
       Specialist A             Specialist B             Specialist C
       (GenericAgent)           (GenericAgent)           (GenericAgent)
       e.g. Discovery           e.g. Risk                e.g. Budget
              │                        │                        │
        a.completed              b.completed              c.completed
              ▼                        ▼                        ▼
       GenericValidator (challenges each output → *.validated)
              └────────────────────────┼────────────────────────┘  merger_input
                                       ▼
                              ResponseMerger (quorum: wait for all 3)
                                       │ merged.input
                                       ▼
                          ContextAggregatorAgent
                          (conflict detection + LLM arbitration)
                                       │ aggregator.completed.validated
                                       ▼
                                 Orchestrator
                          (DB write, SSE job.completed = DECISION)
```

Optional refinement loop (scores higher — "iterative refinement"): route the merged
output back through a critic GenericAgent that returns `feedback`, re-publish to
specialists with that feedback (the retry-with-feedback mechanism already exists).

---

## 4. Step-by-step integration

### Step 0 — Bring the stack up (verify skeleton works)
```bash
cd /home/shivansh/Documents/hackathon
cp .env.example .env            # fill ANTHROPIC_API_KEY (and/or GEMINI_API_KEY)
./dev-up.sh                     # starts kafka, db, redis, config-service, orchestrator,
                                # generic_agent, generic_validator, merger, aggregator,
                                # prometheus, grafana, frontend
./dev-up.sh status
```
Login: `admin` / `12345678`. Dashboard at http://localhost:5173, API at http://localhost:8000.

> **dev-up.sh note:** it contains Authentik first-run setup. Since Authentik is not in
> `services.yaml`, confirm `dev-up.sh` skips `setup-authentik.sh` when those services are
> inactive. If it errors, comment the Authentik block in `dev-up.sh` (see Step 6).

### Step 1 — Reseed ConfigService for the new domain
`ConfigService/seed.py` still seeds medical agents/pipelines/prompts. Replace the seed
data (or wipe and define via UI). Two options:
- **UI path (fastest for demo):** skip medical seed, create everything in the dashboard.
- **Code path (reproducible handover):** rewrite the `seed_agents` / `seed_pipelines` /
  `seed_prompts` blocks in `seed.py` with your specialist definitions, then
  `docker compose run --rm config-seed python seed.py --force`.

### Step 2 — Define specialist agents (GenericAgent definitions)
Dashboard → **Agents → Generic Agents → New**, one per specialist. For each:
- `name` (e.g. `DiscoveryAgent`)
- `input_fields` (e.g. `["prompt"]`) — `{{prompt}}` placeholders in the template
- `output_topic` (e.g. `discovery.completed`)
- `prompt` — the specialist's system+user prompt; **demand JSON output**
- `llm_instance_name` — `anthropic` or `gemini` (mix providers across agents → "different
  reasoning approaches" bonus)
- `validation_rules` — e.g. `{"type":"required_fields","fields":["recommendation","confidence","rationale"]}`

Restart: `docker compose restart generic_agent generic_validator`.
(One container loads all definitions. To pin one specialist per container for isolation,
duplicate the `generic_agent` compose block with `AGENT_NAME=<DefinitionName>`.)

### Step 3 — Create the Kafka topics
Add each specialist's `output_topic` + `.validated` to the `kafka-init-topics` block in
`docker-compose.yml` (and create live once — see CLAUDE-style note below). Topics needed:
`decision.input`, `<specialist>.completed`, `<specialist>.validated` (×N), merger input,
`aggregator.completed.validated`.

```bash
docker exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server kafka:29092 \
  --create --if-not-exists --topic discovery.completed --replication-factor 1 --partitions 1
```

### Step 4 — Configure the ResponseMerger
Dashboard → Mergers (or ConfigService API). Define `input_topic_map`:
```json
{
  "discovery.validated": "discovery",
  "risk.validated":      "risk",
  "budget.validated":    "budget"
}
```
`output_topic` → the aggregator's input topic. `timeout_seconds` generous (LLM latency).

### Step 5 — Configure the ContextAggregator (the decision-maker)
1. Create an `AggregatorDefinition` named to match `AGGREGATOR_NAME` in `.env`
   (`decision_aggregator`). Set `input_sources`, weights, `synthesis_prompt`,
   `output_schema_type`, `min_required_inputs`.
2. **Edit the conflict fields** — `ContextAggregatorAgent/app/services/aggregator_service.py`
   line 26: `_CONFLICT_FIELDS` is currently clinical
   (`diagnosis, assessment, urgency, ...`). Change to your domain, e.g.
   `["recommendation", "risk_level", "verdict", "budget_fit", "priority"]`.
   These are the fields the aggregator compares across agents to detect disagreement.
3. Rewrite `_DEFAULT_SYSTEM_PROMPT` (same file) from "senior clinical AI synthesizer" to
   your domain's chief decision-maker persona.
4. `docker compose build context_aggregator && docker compose up -d context_aggregator`.

### Step 6 — Auth (local, no Authentik)
A recent commit added **local HS256 fallback** for seeded users when Authentik is down —
that is the auth mode here. Ensure:
- `JWT_SECRET` set in `.env` (must match between orchestrator and config-service).
- `ADMIN_REGISTRATION_KEY` = bcrypt hash of your chosen registration secret:
  ```bash
  python -c "import bcrypt; print(bcrypt.hashpw(b'mysecret', bcrypt.gensalt()).decode())"
  ```
- Remove/disable the Authentik branch in `dev-up.sh` and any RS256-only assumptions in
  `OrchestratorAgent/app/services/auth_service.py` if startup complains about missing
  `CLIENT_ID`/`AUTHENTIK_*`. The tri-modal `auth.py` already tolerates HS256-only.

### Step 7 — Build the pipeline graph (PipelineBuilder)
Dashboard → **Pipelines → New** (or PipelineBuilder canvas):
- Input node → fan out (`parallel_fanout` edges) to the 3 specialist nodes.
- Specialist nodes → merger node via `merger_input` edges (same `wait_for_group`).
- Merger → aggregator node (`sequential`).
- Save. Restart orchestrator to refresh the graph cache.
Grab the `pipeline_id` (UUID) for the API call.

### Step 8 — Run a decision
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"12345678"}' | jq -r .access_token)

curl -N -X POST http://localhost:8000/v1/process/text \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"text":"I have ₹10 lakh to invest, moderate risk, maximize returns.","pipeline_id":"<uuid>"}'
```
Response → `{job_id, stream_url, poll_url}`. Stream the trace:
```bash
curl -N "http://localhost:8000/v1/jobs/<job_id>/stream?token=$TOKEN"
```

---

## 5. Agent Trace View (mandatory deliverable)

Three layers already exist — pick/combine for the demo:
1. **DAG view** — `PipelineBuilder.tsx` renders the agent graph (nodes = agents, edges =
   topics). Shows the orchestration topology.
2. **Execution log** — `GET /v1/jobs/:id` returns every `job_step` with input + output
   payloads = "input received / output generated by each agent."
3. **Live SSE** — `JobDetail.tsx` / `JobConsole.tsx` consume the SSE stream
   (`step.started`, `step.completed`, `aggregator.partial`, `job.completed`) showing
   outputs flowing between agents in real time.

To strengthen "how outputs influenced other agents," surface the aggregator's
`_conflicts[]` and `_aggregator{inputs_used, conflict_fields}` metadata in `JobDetail` —
it literally shows which agent's view won and why.

---

## 6. Demo script (what to say — maps to scoring rubric)

1. **Why multiple agents** — single LLM can't hold distinct, weighted expertise; show one
   specialist's narrow JSON output.
2. **Each agent's skill** — point at the 3 GenericAgent definitions (different prompts,
   different LLM providers).
3. **Influence** — run a job, open the trace, show specialist outputs feeding the merger.
4. **Conflict resolution** — craft an input where Risk and Discovery disagree; show
   `_conflicts[]` and the aggregator's arbitrated decision. *(This is the 40% money shot.)*
5. **What's lost if you remove an agent** — disable one specialist, rerun, show the
   degraded/blind-spot decision.
6. **Planned vs executed vs extension** — extension = the refinement loop (§3) and adding
   a 4th "bonus" agent as a pure config row (no deploy).

---

## 7. Open tasks / cleanup checklist

- [ ] `uv lock` — workspace members changed; lockfile must be regenerated before Docker builds (`uv sync --frozen` will fail on a stale lock).
- [ ] Rewrite `ConfigService/seed.py` agent/pipeline/prompt blocks for the new domain (or seed via UI).
- [ ] `_CONFLICT_FIELDS` + `_DEFAULT_SYSTEM_PROMPT` in `aggregator_service.py` → domain-specific.
- [ ] Strip Authentik branch from `dev-up.sh`; verify HS256-only startup.
- [ ] Add new topics to `kafka-init-topics` in `docker-compose.yml` (else they vanish on restart).
- [ ] Trim/rename medical-flavored frontend pages if any copy references removed endpoints (`Webhooks`, `Organisations`, `AccessKeys` are generic and can stay).
- [ ] Create `.env` from `.env.example`; set real `ANTHROPIC_API_KEY`.
- [ ] Decide: keep `ReasoningAgent` (streaming deliberation) on or off — currently `active: false` in `services.yaml`.

---

## 8. Key invariants inherited from civis (don't break)

1. **Agents are atomic** — one input topic, one output topic, no agent calls another via HTTP.
2. **Kafka is the only bus** — all inter-agent data flows through Kafka events.
3. **Validators gate everything** — the router only consumes `*.validated` topics.
4. **GenericAgent = config, not code** — new specialists are ConfigService rows.
5. **LLM is infrastructure** — agents call `chat_completion()` from `shared/civis_obs`,
   never embed their own SDK.
