# ConfigService

> **Status:** Active
> **Flavor:** service
> **Container:** `config-service`
> **Port:** 8010 (HTTP), `/metrics` on 8010
> **Tech:** FastAPI + SQLAlchemy (sync) + raw SQL migrations

---

## Role

Single source of truth for **everything that isn't a per-request fact**:

- Agent registry, pipeline graphs, prompt templates
- LLM instance registry + per-agent LLM assignments
- Generic agent definitions, response merger definitions, aggregator definitions
- Validation rules, feature flags, navigation, runtime concurrency config

Owns the `Base` SQLAlchemy metadata in `app-db` (separate from `AppBase` owned by [[OrchestratorAgent]]).

Read-mostly: every agent fetches config at startup; orchestrator refreshes registry + pipelines every 60s.

---

## Position in Pipeline

```mermaid
flowchart TB
    Frontend[[frontend]] -->|/config-api/*| CS[ConfigService]
    Orch[[OrchestratorAgent]] -->|GET /pipelines /agents /llm-instances| CS
    Agents[Every agent] -->|GET /prompts/:action, /agent-definitions| CS
    CS <-->|Base tables| AppDB[(app-db)]
    CS -->|publish agent.config.{name}| Redis[(Redis)]
    GA[[GenericAgent]] -->|GET /agent-definitions| CS
    GV[[GenericValidator]] -->|GET /agent-definitions on boot| CS
    RM[[ResponseMerger]] -->|GET /response-mergers| CS
    Agg[[ContextAggregatorAgent]] -->|GET /aggregator-definitions| CS
```

Not on the Kafka bus — read by everything via HTTP.

---

## Contracts

### HTTP endpoints (13 routers)

| Router | Prefix | Purpose |
|---|---|---|
| `config_routes.py` | `/config-entries` | Generic `config_entries` table CRUD (legacy generic KV) |
| `agent_routes.py` | `/agents` | `agent_registry` CRUD + LLM assignment |
| `pipeline_graph_routes.py` | `/pipelines` | Graph pipeline CRUD: nodes + edges, version, duplicate, test-run (Phase C) |
| `prompt_routes.py` | `/prompts` | Prompt template CRUD by `action` + version + activate |
| `validation_routes.py` | `/validation-rules` | Validator rule config per step |
| `llm_routes.py` | `/llm-instances` | LLM instance registry + agent assignments + activate (Phase B) |
| `agent_definition_routes.py` | `/agent-definitions` | GenericAgent definitions (Phase B3) |
| `response_merger_routes.py` | `/response-mergers` | Merger definitions: input topic map, timeout, output topic |
| `aggregator_routes.py` | `/aggregator-definitions` | ContextAggregator definitions (AG-1) |
| `feature_routes.py` | `/feature-flags` | Feature flags + bulk role assign (Phase F) |
| `agent_runtime_config_routes.py` | `/internal/agent-runtime-config` | Live concurrency push: upsert DB row + SET Redis key + PUBLISH `agent.config.{name}` (AS-2) |
| `navigation_routes.py` | `/nav` | Frontend navigation items (per-category) |

GET routes are **intentionally open** (no auth). Mutating routes (POST/PATCH/PUT/DELETE) MUST use `Depends(require_write_auth)` from `app/core/auth.py` — checks `JWT_SECRET` (must match orchestrator's).

### Tables owned (`Base` metadata)

- `config_entries` — agent_name, key, value (legacy generic KV)
- `agent_registry` — name, input_topic, output_topic, capability_tags, llm_required, llm_instance_id, max_concurrency
- `pipeline_definitions` — name, description, version, input_type, status
- `pipeline_nodes` — pipeline_id, node_type, `agent_id` OR `generic_agent_id` OR `merger_id` OR `aggregator_id`, `config_override`, position
- `pipeline_edges` — from_node_id, to_node_id, `edge_type` (sequential / parallel_fanout / merger_input / cyclic_feedback / agent_routed), `wait_for_group`, `max_iterations`, `break_field`, `break_value`, `loop_to` ("source" self-loop | "target" council re-entry), `candidate_agents` (JSONB)
- `prompt_templates` — action, version, is_active, system_prompt, user_prompt, `input_variables` (JSON), `output_schema` (JSON)
- `validation_rules` — step_name, rule_type, rule_config
- `feature_flags` — key, enabled_for_roles (ARRAY)
- `llm_instances` — name, provider, model_name, base_url, api_key_config_key, is_active, max_parallel, priority
- `agent_llm_assignments` — agent_name, llm_instance_id, priority
- `agent_definitions` — name, input_fields, output_topic, llm_instance_name, prompt, validation_rules (GenericAgent)
- `response_mergers` — name, `input_topic_map` (JSON), output_topic, timeout_seconds
- `agent_runtime_config` — agent_name PK, max_concurrent, replica_target, updated_at (AS-2)
- `aggregator_definitions` — name, input_topic, output_topic, input_sources (JSON), output_persona, output_schema_type, synthesis_prompt, timeout_seconds, min_required_inputs, max_tokens, temperature, llm_instance_name
- `navigation` — category, item_name, label, icon, route, is_external

Cross-owner FK relationships (e.g. `pipeline_nodes.agent_id` → `agent_registry.id`) stay within `Base`; FKs that cross into `AppBase` are **app-layer only** (no DB constraint).

---

## Dependencies

- **DB:** `app-db` via `DATABASE_URL` (same Postgres as orchestrator, separate `Base`)
- **Redis:** `agent_runtime_config_routes` publishes `agent.config.{name}` and SETs `agent:{name}:concurrency` (AS-2)
- **Internal services:** none consumed; consumed by everyone
- **External APIs:** none
- **Init:** `create_all()` on startup + raw SQL migrations in `migrations/` (manual apply) — see [[migrations]]

---

## Side Effects

- DB writes on every mutating route
- Redis SET + PUBLISH on `PUT /internal/agent-runtime-config/{name}`
- Seed script (`seed.py`) inserts agents / pipelines / prompts / LLM instances on first run or `--force`

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `ValidationRule` table not found at boot | `config-seed` ran before `config-service` created tables | Restart `config-seed` after `config-service` is healthy |
| `Phase A columns missing` | `phase_a_alter.sql` not applied | `docker exec -i app-db psql -U civis -d civis < migrations/phase_a_alter.sql` |
| `loop_to column missing` | `add_cyclic_loop_target.sql` not applied | `docker exec -i app-db psql -U civis -d civis < migrations/add_cyclic_loop_target.sql` |
| 401 on PATCH/PUT/DELETE | `JWT_SECRET` mismatch with orchestrator | Align env vars |
| Agent doesn't see new config | Orchestrator cache 60s TTL; agents fetch only on startup | Wait 60s (router) or restart agent (agent-side cache) |
| `generic_agent` crashes | `AGENT_NAME` env points to non-existent definition | Create in UI first, then start container |
| New pipeline node 422 | Frontend payload missing `agent_type` discriminator | Set `agent_type: 'registry' \| 'generic_llm' \| 'output_merger'` per node |
| Postgres sequence collision after seed | Explicit-ID seed didn't reset sequences | Run `setval('<table>_id_seq', GREATEST(MAX(id), 1))` (already in `_run_migrations`) |
| Schema additive change not visible | `create_all()` doesn't ALTER existing tables | Write `migrations/*.sql` with `IF NOT EXISTS` guards, apply manually |

ConfigService **does not** auto-migrate beyond `create_all()`. Schema changes ship as raw SQL in [[migrations]] and must be applied manually (see that doc for apply order).

---

## PHI Surface

**None** by design. ConfigService stores configuration only — agent names, prompt templates, pipeline graphs, LLM endpoints, feature flags. Prompts may contain placeholder names (`{{patient_name}}`) but never patient data.

> If a future feature requires per-patient config, route it through [[OrchestratorAgent]] (`AppBase`) instead — keep `Base` PHI-free.

---

## Config

### Required env vars

| Var | Purpose |
|---|---|
| `DATABASE_URL` | `Base` DB connection (legacy var name — ConfigService-owned tables only) |
| `REDIS_URL` | For runtime config publish |
| `JWT_SECRET` | HS256 secret; MUST match orchestrator's |
| `SEED_ON_START` | If `true`, runs `seed.py` on boot |

### Seed script (`seed.py`)

- Inserts default agents, pipelines, prompt templates, LLM instances
- Idempotent unless `--force` (truncates relevant tables first)
- Run: `docker compose run --rm config-seed python seed.py --force`

---

## Observability

**Metrics:**
- `http_requests_total{method, path, status}`
- Standard process metrics from [[shared]]

**Logs:**
- JSON via `shared/civis_obs/logging_config.py`

**Health:**
- `/health/live`
- `/health/ready` — Postgres reachable

---

## Common Change Recipes

### Add a new config table
1. Create model in `app/models/`, register on `Base`
2. Create schema(s) in `app/schemas/`
3. Add a router in `app/api/routes/`, mount in `app/main.py`
4. Add raw SQL migration in `migrations/` with `CREATE TABLE IF NOT EXISTS` (because `create_all()` won't update an existing schema if you add columns later)
5. Update [[migrations]] apply-order doc

### Add a new prompt template action
1. UI → Prompts → New (or `POST /prompts`) — set `action`, `version`, `is_active=true`, `input_variables`, `output_schema`
2. Consuming agent (typically [[NLPAgent]]) calls `load_prompt(action)` from its `config_client.py`
3. If the prompt uses `{{var}}` placeholders, the agent must thread those fields through

### Add an LLM instance (new provider or model)
1. UI → LLM Instances → New — set `provider`, `model_name`, `base_url`, `api_key_config_key`
2. Toggle `is_active`
3. Per-agent assignment: UI → Agents → set `llm_instance_id` (priority-ordered if multiple)
4. Provider implementation lives in `shared/civis_obs/llm_client.py` — must already support the provider name

### Add a new GenericAgent definition
1. UI → Agents → Generic Agents → New — name, input_fields, output_topic, prompt template, validation rules, LLM instance
2. Restart `generic_agent` container (or run a second instance with `AGENT_NAME=<name>`)
3. [[GenericValidator]] picks it up on its next restart (re-fetches definitions on boot)

### Push runtime concurrency change
- `PUT /internal/agent-runtime-config/{name}` with `{"max_concurrent": N}` — service handles DB upsert + Redis SET + PUBLISH `agent.config.{name}` (AS-2)
- Receiving `BaseKafkaAgent` resizes semaphore live (AS-3)

### Add a feature flag
1. `POST /feature-flags` — `key`, `enabled_for_roles: ["admin", "user"]`
2. Frontend `useFeatureFlags` hook polls every 60s
3. Server-side check via cache helper if needed (e.g. reasoning gating)

---

## Cross-links

- [[OrchestratorAgent]] — biggest consumer; refreshes pipeline + registry every 60s
- [[shared]] — `_watch_config()` consumes Redis pub/sub published from here
- [[GenericAgent]], [[GenericValidator]] — read `agent_definitions` on startup
- [[ResponseMerger]] — reads `response_mergers` on startup
- [[ContextAggregatorAgent]] — reads `aggregator_definitions` on startup
- [[frontend]] — admin UI for every table here (`/config-api/*` routes)
- [[migrations]] — raw SQL changes apply against `Base` tables only
- [`CLAUDE.md`](../CLAUDE.md) — write-auth pattern, schema split (`Base` vs `AppBase`), seed gotchas
