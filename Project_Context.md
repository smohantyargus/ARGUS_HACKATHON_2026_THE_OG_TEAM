# Multi-Agent Decision Intelligence System — Project Context

Built on the **haidoc orchestration core**: Kafka event bus, config-driven agents, pipeline graph router, fan-in synthesis. Originally medical-domain; medical agents stripped. The plumbing is generic for any multi-agent decision problem.

---

## Architecture Overview

```
                     POST /v1/process/text  {prompt, pipeline_id}
                                  │
                             Orchestrator
                             (creates job, emits input topic)
                                  │
         ┌────────────────────────┼────────────────────────┐  parallel_fanout
         ▼                        ▼                        ▼
  Specialist A             Specialist B             Specialist C
  (GenericAgent)           (GenericAgent)           (GenericAgent)
         │                        │                        │
   a.completed              b.completed              c.completed
         ▼                        ▼                        ▼
  GenericValidator — challenges each output → *.validated
         └────────────────────────┼────────────────────────┘  merger_input
                                  ▼
                         ResponseMerger (quorum: wait for all N)
                                  │ merged output topic
                                  ▼
                     ContextAggregatorAgent
                     (conflict detection + LLM arbitration)
                                  │ aggregator.completed.validated
                                  ▼
                            Orchestrator
                     (DB write, SSE job.completed = DECISION)
```

**Key invariants:**
1. Agents are atomic — one input topic, one output topic, no agent calls another via HTTP.
2. Kafka is the sole inter-agent bus — all data flows through Kafka events.
3. Validators gate everything — router only consumes `*.validated` topics.
4. GenericAgent = config, not code — new specialists are ConfigService rows.
5. LLM is infrastructure — agents call `chat_completion()` from `shared/haidoc_obs`, never embed their own SDK.

---

## Infrastructure

| Component | Container | Port | Role |
|---|---|---|---|
| Kafka (KRaft mode) | `kafka` | 29092 (internal), 29093 (host) | Sole inter-agent message bus |
| PostgreSQL | `app-db` | 5432 | Jobs, config, users, audit |
| Redis | `redis` | 6379 | SSE token relay, merger quorum buffers, rate-limit |
| Prometheus | `prometheus` | 9090 | Metrics scraper |
| Grafana | `grafana` | 3001 | Dashboards (per-agent metrics, Kafka lag) |

---

## Services

### 1. ConfigService
→ [SERVICE.md](ConfigService/SERVICE.md)

- **Container:** `config-service` | **Port:** 8010
- **Tech:** FastAPI + SQLAlchemy (sync) + raw SQL migrations
- **Role:** Single source of truth for everything that isn't a per-request fact. Defines agents, pipeline graphs, prompt templates, LLM instances, aggregator/merger configs, validation rules, feature flags, navigation. Agents are **created here, not in code**.
- **Schema:** Owns `Base` SQLAlchemy metadata (separate from `AppBase` owned by OrchestratorAgent).
- **Access pattern:** Read-mostly. Every agent fetches config at startup; orchestrator refreshes registry + pipelines every 60s.
- **Auth:** GET routes open (no auth). Mutating routes require HS256 JWT matching `JWT_SECRET`.
- **Key tables:** `agent_registry`, `pipeline_definitions`, `pipeline_nodes`, `pipeline_edges`, `prompt_templates`, `agent_definitions`, `response_mergers`, `aggregator_definitions`, `llm_instances`, `validation_rules`, `feature_flags`, `navigation`
- **13 HTTP routers** covering agents, pipelines, prompts, LLM instances, validation, mergers, aggregators, feature flags, navigation, runtime config.
- **Seed script:** `ConfigService/seed.py` — inserts default agents, pipelines, LLM instances. Idempotent; `--force` truncates first.

---

### 2. OrchestratorAgent
→ [SERVICE.md](OrchestratorAgent/SERVICE.md)

- **Container:** `orchestrator` | **Port:** 8000
- **Tech:** FastAPI + AIOKafka + SQLAlchemy (async) + Alembic
- **Role:** Three responsibilities:
  1. **HTTP gateway** — auth, job submission, SSE streaming, webhooks, admin CRUD.
  2. **Pipeline router** — consumes every `*.validated` Kafka topic, walks the pipeline graph, dispatches next step.
  3. **Background workers** — 7 long-running asyncio tasks (results consumer, DLQ, lag scraper, etc.).
- **Schema:** Owns `AppBase` SQLAlchemy metadata (jobs, users, webhooks, access keys, audit, DLQ, token usage). Migrations via Alembic (auto-run on `entrypoint.sh`).
- **Key Kafka consumers:**
  - `task.completed` → writes final result, fires webhook, emits `job.completed` SSE
  - All `*.validated` topics → graph walk, produce to next node's input topic
  - `validation.failed` → re-publish with `feedback` (max 2 retries)
  - `agent.deadletter` → insert into `dead_letter_log`
  - `aggregator.partial` → relay as SSE
- **Key HTTP routes:** `POST /v1/process/text`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/stream` (SSE), `/auth/login`, `/auth/register`
- **SSE:** Browser `EventSource` can't set headers — JWT passed as `?token=<jwt>`.
- **Auth:** Local HS256 fallback (Authentik dropped). Admin user: `admin` / `12345678`.

---

### 3. GenericAgent
→ [SERVICE.md](GenericAgent/SERVICE.md)

- **Container:** `generic_agent` (catch-all) | **Port:** 8120
- **Tech:** FastAPI + `BaseKafkaAgent` + `chat_completion`
- **Role:** Config-driven text-to-text LLM agent. **No Python code per new agent.** A new specialist is created by inserting a row into `agent_definitions` (via ConfigService UI) and restarting the container.
- **Behavior:** Loads either **all** active `agent_definitions` (no `AGENT_NAME` env) or **one** (`AGENT_NAME=<name>` env). Each definition subscribes to its own `input_topic`, renders prompt with `{{field}}` placeholders from Kafka message, calls LLM, publishes to `{output_topic}.completed`.
- **Definition fields:** `name`, `input_topic`, `output_topic`, `input_fields`, `prompt` (with `{{placeholder}}`), `llm_instance_name`, `validation_rules`.
- **Scale-out:** Run a dedicated container per high-traffic definition with `AGENT_NAME=<name>`.

---

### 4. GenericValidator
→ [SERVICE.md](GenericValidator/SERVICE.md)

- **Container:** `generic_validator` | **Port:** —
- **Tech:** FastAPI + `BaseKafkaAgent` (dynamic-topic subscriber)
- **Role:** Single shared validator for every GenericAgent definition. Subscribes to all `{output_topic}.completed` topics, applies per-definition rules, produces `{output_topic}.validated` or `validation.failed`.
- **Rule types:**
  - `not_empty` — non-null, non-empty string (default)
  - `required_fields` — JSON object with all listed keys present
  - `json_schema` — full JSON Schema validation
  - `none` — always passes (bypass)
- **No DB, no Redis, no LLM.** Stateless pass/fail routing only.
- **Restart required** when new agent definitions are added (fetches definitions once at boot).

---

### 5. ResponseMerger
→ [SERVICE.md](ResponseMerger/SERVICE.md)

- **Container:** `response_merger` | **Port:** 8022
- **Tech:** FastAPI + `BaseKafkaAgent` + Redis quorum buffer
- **Role:** Fan-in quorum. Waits for N parallel agent outputs sharing a `job_id`, merges them into a single JSON, publishes to downstream topic. Used after `edge_type="parallel_fanout"` pipeline edges.
- **Merge algorithm:**
  1. `HSET merger:{name}:{job_id} <field> <json_dumps(value)>` on each arrival
  2. Sliding `EXPIRE` set to `timeout_seconds`
  3. When `HLEN >= expected_count` → read all, `DEL` key, publish merged JSON
- **Definition fields:** `name`, `input_topic_map` (topic → field name), `output_topic`, `timeout_seconds`.
- **No DB, no LLM.** Pure Redis-backed quorum gate.

---

### 6. ContextAggregatorAgent
→ [SERVICE.md](ContextAggregatorAgent/SERVICE.md)

- **Container:** `context_aggregator` | **Port:** 8011
- **Tech:** FastAPI + `BaseKafkaAgent` + LLM synthesis + per-job quorum tracker
- **Role:** Final synthesis + conflict resolution — the system's decision-maker. Detects disagreements between agents, arbitrates via LLM, emits the system's final decision. Self-validating (publishes directly to `{output_topic}.validated`).
- **Synthesis flow:**
  1. Wait for `≥ min_required_inputs` arrivals (5s timeout watchdog)
  2. Python-side conflict detection on `_CONFLICT_FIELDS` list
  3. Effective weight: `base_weight * agent_confidence` per source
  4. Conflicts present → LLM arbitration with `synthesis_prompt`
  5. No conflicts → weighted merge + single LLM polish call
  6. Apply `output_persona` + `output_schema_type`
- **Output metadata:** `_conflicts[]`, `_aggregator{inputs_used, conflict_fields, conflicts_detected}` — surfaced in Agent Trace View.
- **Partial SSE:** every input arrival publishes to `aggregator.partial` → orchestrator relays as SSE for progressive frontend updates.
- **Loaded by `AGGREGATOR_NAME` env** — one container per aggregator definition.

---

### 7. ReasoningAgent *(optional, off by default)*
→ [SERVICE.md](ReasoningAgent/SERVICE.md)

- **Container:** `reasoning_agent` | **Port:** 8005
- **Tech:** FastAPI + `BaseKafkaAgent` + Anthropic streaming SDK + Redis token relay
- **Role:** Streaming deliberation agent. Runs Claude on upstream output, streams tokens to Redis, orchestrator relays via SSE to browser in real time. Produces `reasoning.completed` → gated by ReasoningValidator.
- **Status:** `active: false` in `services.yaml`. Enable for live-streamed deliberation.
- **Redis relay:** `XADD stream:{job_id} * token "<text>"` per chunk; `done 1` terminator.
- **Required output fields:** `diagnosis`, `labs`, `follow_up`, `overall_confidence`, `rationale`.

---

### 8. ReasoningValidator *(optional, off by default)*
→ [SERVICE.md](ReasoningValidator/SERVICE.md)

- **Container:** `reasoning_validator` | **Port:** 8006
- **Tech:** FastAPI + `BaseKafkaAgent`
- **Role:** Gates ReasoningAgent output. JSON Schema check + `overall_confidence` required field (0–1) + optional `min_confidence` threshold from validation rules.
- **Status:** `active: false` in `services.yaml` (paired with ReasoningAgent).

---

### 9. shared / haidoc_obs
→ [SERVICE.md](shared/SERVICE.md)

- **Package:** `haidoc-obs` (importable as `haidoc_obs`)
- **Role:** Shared Python lib for every service. Three responsibilities:
  1. `BaseKafkaAgent` — ABC; every agent extends it (consumer loop, semaphore, DLQ, runtime config watch).
  2. `chat_completion()` — the **only** sanctioned LLM call path. Supports Anthropic, Gemini, llama-cpp, OpenAI-compat.
  3. Observability primitives — Prometheus metrics, JSON logging, health endpoints, token usage tracking.
- **`BaseKafkaAgent` provides:** consumer loop with 10s reconnect backoff, `_ResizableSemaphore` for backpressure, `_watch_config()` for live concurrency updates via Redis pub/sub, DLQ publish on uncaught exception.
- **`chat_completion()` providers:** `anthropic` (streaming, tool-calling), `gemini` (sync wrapped in threadpool), `llamacpp`/`openai_compat` (httpx to OpenAI-compat endpoint).
- **Standard metrics emitted:** `agent_processed_total`, `agent_processing_seconds`, `agent_in_flight`, `kafka_consumer_lag`, `dlq_publish_total`, `llm_call_total`.
- Leaf in dependency graph — nothing internal depends on.

---

### 10. frontend
→ [SERVICE.md](frontend/SERVICE.md) | [README.md](frontend/README.md)

- **Container:** `frontend` | **Port:** 5173 (host)
- **Tech:** React + Vite + TypeScript + nginx
- **Role:** Admin + user dashboard. CRUD over every config table, job submission console, live SSE event viewer, dead-letter inspector, Agent Trace View.
- **nginx routing:**
  - `/api/*` → `http://orchestrator:8000/` (prefix stripped)
  - `/config-api/*` → `http://config-service:8010/` (prefix stripped)
  - `/` → serves Vite-built `dist/` (SPA fallback)
- **Key pages:** `PipelineBuilder.tsx` (React Flow DAG builder), `JobConsole.tsx` (submit + watch), `JobDetail.tsx` (per-job trace + SSE), `Agents.tsx`, `Prompts.tsx`, `LLMInstances.tsx`, `FeatureFlags.tsx`, `FailedJobs.tsx` (DLQ inspector).
- **Auth:** JWT stored in localStorage (access) + httpOnly cookie (refresh). 401 interceptor silently refreshes.
- **SSE:** `EventSource` via `?token=<jwt>` query param (can't set headers).

---

### 11. migrations
→ [SERVICE.md](migrations/SERVICE.md)

- **Path:** `migrations/*.sql`
- **Role:** Raw SQL migrations for ConfigService-owned (`Base`) tables. Applied manually. OrchestratorAgent uses Alembic (auto-run on start).
- **Apply order:**
  1. `phase_a_alter.sql`
  2. `add_prompt_template_fields.sql`
  3. `add_generic_agent_to_pipeline_nodes.sql`
  4. `add_pipeline_node_agent_check.sql`
  5. `add_edge_type.sql`
  6. `add_aggregator_node.sql`
  7. `add_nav_item_is_external.sql`
  8. `add_webhook_secret_notnull.sql`
- **Apply command:** `docker exec -i app-db psql -U haidoc -d haidoc < migrations/<file>.sql`

---

## Data Flow — Kafka Topics

| Topic | Producer | Consumer | Purpose |
|---|---|---|---|
| `{specialist}.input` | Orchestrator (router) | GenericAgent | Specialist work item |
| `{specialist}.completed` | GenericAgent | GenericValidator | Raw LLM output |
| `{specialist}.validated` | GenericValidator | Orchestrator (router) | Validated output |
| `validation.failed` | GenericValidator | Orchestrator | Retry with feedback (max 2) |
| `merged.input` (configurable) | ResponseMerger | ContextAggregator | Fan-in result |
| `aggregator.partial` | ContextAggregator | Orchestrator | Progressive SSE relay |
| `aggregator.completed.validated` | ContextAggregator | Orchestrator | Final decision |
| `task.completed` | ContextAggregator | Orchestrator | Terminal job result |
| `agent.deadletter` | BaseKafkaAgent (any) | Orchestrator | DLQ entries |
| `reasoning.completed` | ReasoningAgent (opt.) | ReasoningValidator (opt.) | Streaming deliberation |
| `reasoning.validated` | ReasoningValidator (opt.) | Orchestrator (router) | Validated reasoning |

---

## Database Schema Split

| Owner | Tables | Migration system | Auto-applied? |
|---|---|---|---|
| ConfigService (`Base`) | `agent_registry`, `pipeline_*`, `prompt_templates`, `agent_definitions`, `response_mergers`, `aggregator_definitions`, `llm_instances`, `validation_rules`, `feature_flags`, `navigation`, `config_entries` | Raw SQL in `migrations/` + `create_all()` on boot | Partial — `create_all()` won't ALTER existing tables |
| OrchestratorAgent (`AppBase`) | `jobs`, `job_steps`, `users`, `roles`, `webhooks`, `access_keys`, `organisations`, `audit_log`, `usage_log`, `dead_letter_log`, `token_usage_log`, `tenants` | Alembic (`OrchestratorAgent/alembic/`) | Yes, via `entrypoint.sh` |

---

## Pipeline Graph — Edge Types

| `edge_type` | Semantics |
|---|---|
| `sequential` | One-to-one; router dispatches immediately on validated output |
| `parallel_fanout` | One-to-many; same job dispatched to all successor nodes simultaneously |
| `merger_input` | Many-to-one; ResponseMerger quorum gate; uses `wait_for_group` |

Defined in `pipeline_edges` table in ConfigService. Router logic lives in `OrchestratorAgent/app/services/pipeline_router.py`.

---

## LLM Registry

All LLM instances defined in ConfigService `llm_instances` table. Agents are assigned instances via `agent_llm_assignments`. `chat_completion()` in `shared/haidoc_obs/llm_client.py` handles dispatch. Mixing providers across agents (e.g. Anthropic + Gemini) is supported and counts as "different reasoning approaches."

---

## Runtime Concurrency Control

- `PUT /internal/agent-runtime-config/{name}` on ConfigService → DB upsert + Redis SET `agent:{name}:concurrency` + PUBLISH `agent.config.{name}`.
- `BaseKafkaAgent._watch_config()` consumes pub/sub → resizes semaphore live.
- No restart required for concurrency changes.

---

## Observability Stack

- **Prometheus** (port 9090): scrapes `/metrics` on every service. All metrics defined in `shared/haidoc_obs/metrics.py`.
- **Grafana** (port 3001): `ops/grafana/dashboards/agents_overview.json` — Kafka lag table, job throughput, error rate, latency.
- **Kafka lag** scraped by orchestrator's `kafka_lag_collector_loop` every 30s → `kafka_consumer_lag` gauge.
- **JSON logs** via `shared/haidoc_obs/logging_config.py`. `job_id` propagated via contextvars. `mk_` access keys auto-redacted.

---

## Agent Trace View (Mandatory Deliverable)

Three layers:
1. **DAG view** — `PipelineBuilder.tsx` renders the agent graph (nodes = agents, edges = topics). Shows orchestration topology.
2. **Execution log** — `GET /v1/jobs/:id` returns every `job_step` with `input` + `output` payloads per agent.
3. **Live SSE** — `JobDetail.tsx` / `JobConsole.tsx` consume SSE stream (`step.started`, `step.completed`, `aggregator.partial`, `job.completed`) showing outputs flowing between agents in real time.

The aggregator's `_conflicts[]` and `_aggregator{inputs_used, conflict_fields}` metadata surfaces which agent's view won and why — the "conflict resolution" money shot for demos.

---

## Quick Start

```bash
cd /home/shivansh/Documents/hackathon
cp .env.example .env          # fill ANTHROPIC_API_KEY
./dev-up.sh                   # starts full stack
```

- Dashboard: http://localhost:5173
- API: http://localhost:8000
- Grafana: http://localhost:3001
- Login: `admin` / `12345678`

---

## Adding a New Specialist Agent (Zero Code)

1. Dashboard → Agents → Generic Agents → New (set name, input/output topics, prompt, LLM instance, validation rules)
2. Restart `generic_agent` (or add a dedicated container with `AGENT_NAME=<name>`)
3. Restart `generic_validator` to pick up new definition
4. Dashboard → Pipelines → connect new node in PipelineBuilder
5. Add new topics to `kafka-init-topics` in `docker-compose.yml`

---

## Related Documents

| Document | Content |
|---|---|
| [plan.md](plan.md) | Integration plan, reference architecture, step-by-step setup, demo script, open tasks |
| [ConfigService/SERVICE.md](ConfigService/SERVICE.md) | Full ConfigService API, tables, failure modes, change recipes |
| [OrchestratorAgent/SERVICE.md](OrchestratorAgent/SERVICE.md) | HTTP routes, Kafka consumers, AppBase tables, failure modes |
| [GenericAgent/SERVICE.md](GenericAgent/SERVICE.md) | Config-driven agent patterns, definition fields, scale-out |
| [GenericValidator/SERVICE.md](GenericValidator/SERVICE.md) | Validation rule types, failure modes |
| [ResponseMerger/SERVICE.md](ResponseMerger/SERVICE.md) | Quorum merge algorithm, Redis key structure, timeout behaviour |
| [ContextAggregatorAgent/SERVICE.md](ContextAggregatorAgent/SERVICE.md) | Synthesis flow, conflict detection, partial SSE, output schema |
| [ReasoningAgent/SERVICE.md](ReasoningAgent/SERVICE.md) | Streaming deliberation, Redis token relay, Anthropic streaming |
| [ReasoningValidator/SERVICE.md](ReasoningValidator/SERVICE.md) | Confidence threshold gating |
| [shared/SERVICE.md](shared/SERVICE.md) | BaseKafkaAgent contract, chat_completion() API, metrics registry |
| [frontend/SERVICE.md](frontend/SERVICE.md) | Pages, nginx routing, auth flow, SSE pattern |
| [frontend/README.md](frontend/README.md) | Frontend setup |
| [migrations/SERVICE.md](migrations/SERVICE.md) | SQL migration files, apply order, conventions |
| [services.yaml](services.yaml) | Which containers are active; toggle services here |
| [docker-compose.yml](docker-compose.yml) | Full container definitions, Kafka topic init, port mappings |
