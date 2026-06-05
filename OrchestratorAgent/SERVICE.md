# OrchestratorAgent

> **Status:** Active
> **Flavor:** service
> **Container:** `orchestrator`
> **Port:** 8000 (HTTP), `/metrics` on 8000
> **Tech:** FastAPI + AIOKafka + SQLAlchemy (async) + Alembic

---

## Role

The single entry point for clients and the brain of pipeline execution. Three jobs:

1. **Public HTTP gateway** — auth, job submission, SSE streaming, webhooks, admin CRUD.
2. **Pipeline router** — consumes every `*.validated` Kafka topic, walks the pipeline graph, dispatches the next step.
3. **Background workers** — 7 long-running asyncio tasks (results consumer, DLQ, lag scraper, etc.).

It's the only service that owns the `AppBase` SQLAlchemy metadata (jobs, users, webhooks, access keys, audit, DLQ, token usage).

---

## Position in Pipeline

```mermaid
flowchart LR
    Client[Client] -->|HTTPS| OA[OrchestratorAgent]
    OA -->|audio.uploaded / transcript.generated| Agents[Pipeline Agents]
    Agents -->|*.validated| OA
    OA -->|task.completed| OA
    OA -->|SSE / webhook POST| Client
    OA <-->|AppBase tables| AppDB[(app-db)]
    OA <-->|stream:{job_id}, ratelimit:*, agent.config.*| Redis[(Redis)]
    OA <-->|consumer-group offsets| Kafka[(Kafka)]
    OA -->|GET /pipelines /agents /llm-instances| CS[[ConfigService]]
```

Every `*.validated` topic in haidoc terminates here. Orchestrator is the **only** consumer of routing topics; agents only talk to Kafka.

---

## Contracts

### HTTP endpoints

Grouped by router (under `app/api/routes/`).

| Router file | Prefix | Endpoints (high level) |
|---|---|---|
| `users.py` | `/auth` | `POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, QR endpoints, RS256 introspection |
| `job_router.py` | `/v1/jobs` | `POST /` (submit), `GET /:id` (status), `GET /:id/stream` (SSE), `GET /` (list) |
| `process_router.py` | `/v1/process` | `POST /text`, `POST /audio`, `POST /` (meta-endpoint) — auto-selects pipeline (Phase B4) |
| `upload_router.py` | `/v1/uploads` | Direct audio upload (multipart) — used by `process_router` |
| `access_key_router.py` | `/v1/keys` | `mk_` key CRUD; tenant + org scoped |
| `org_router.py` | `/v1/orgs` | Organisation CRUD, activate, list keys per org (admin) |
| `role_router.py` | `/v1/roles` | Role CRUD, bulk role assignment, user-role management |
| `agent_lag_router.py` | `/v1/agent-lag` | Admin-only Kafka consumer lag snapshot (AS-5) |
| `dlq_router.py` | `/v1/dlq` | List + replay entries from `dead_letter_log` (I7) |
| `webhook_router.py` | `/v1/webhooks` | Tenant webhook CRUD + secret rotate (HMAC) |

SSE event types: see [`CLAUDE.md`](../CLAUDE.md#sse-event-types). Browser `EventSource` cannot set headers — use `?token=<jwt>` query param.

### Kafka topics (consumed by 7 background tasks in `app/main.py` lifespan)

| Task | Topic(s) | Group | Action |
|---|---|---|---|
| `_consume_results` | `task.completed` | `orchestrator-results` | Write final result to `jobs.result`, fire webhook, emit `job.completed` SSE |
| `_route_steps` | all `*.validated` topics | `orchestrator-router` | Walk pipeline graph; produce to next node's input topic |
| `_handle_validation_failures` | `validation.failed` | `orchestrator-validation` | Re-publish to agent input with `feedback` field; bump `retry_count` (max 2) |
| `_consume_dlq` | `agent.deadletter` | `orchestrator-dlq` | Insert into `dead_letter_log` |
| `_consume_aggregator_partial` | `aggregator.partial` | `orchestrator-aggregator` | Relay to SSE (`aggregator.partial` event) |
| `_periodic_cache_refresh` | — | — | 60s reload of agent registry + pipeline definitions from ConfigService |
| `kafka_lag_collector_loop` | — | — | 30s scan committed offsets, set `kafka_consumer_lag` gauge, cache snapshot |

Produces to: every agent input topic, plus webhook delivery side effects.

### ConfigService HTTP calls (read-only)

- `GET /agents` — populate registry cache
- `GET /pipelines/:id` — graph walk inputs
- `GET /llm-instances/:id` — used by agents indirectly; orchestrator only fetches for admin views
- `GET /prompts/:action` — not used by orchestrator (used by agents)

---

## Dependencies

**DB (AppBase via `APP_DATABASE_URL`):**
- `jobs`, `job_steps` — state machine (CRUD per request + Kafka result consumer)
- `users`, `roles` — auth + RBAC
- `webhooks` — tenant dispatch + delivery tracking
- `tenants`, `access_keys` (with `org_id`) — `mk_` key auth
- `organisations` — grouping label (Phase O)
- `audit_log` — fire-and-forget writes from `audit_service.py`
- `usage_log` — per-request usage
- `dead_letter_log` — DLQ store (I7)
- `token_usage_log` — per-LLM-call (TT-1)

Never use `SessionLocal` (legacy `Base`). Use `AppSessionLocal` for everything in this service.

**Redis:**
- `stream:{job_id}` — ReasoningAgent token relay; orchestrator's SSE handler tails via `xread`
- `ratelimit:key:{key_id}:{minute_bucket}` — access-key sliding window (INCR + 120s TTL)
- `ratelimit:ip:{ip}:{minute_bucket}` — login IP limiter (I10.2)
- `ratelimit:user:{username}:{15min_bucket}` — login failure limiter (I10.2)
- `agent:{name}:concurrency` + pub/sub channel `agent.config.{name}` — runtime concurrency push (AS-2 / AS-3)
- `merger:{name}:{job_id}` — read-only here; written by ResponseMerger

**Kafka:** AIOKafka consumers + producers via `shared/haidoc_obs/kafka_utils.py`.

**Internal services:**
- [[ConfigService]] — GET-only; pipelines, agent registry, prompts, LLM instances
- [[shared]] — `BaseKafkaAgent` (background tasks), `chat_completion` (not used here directly), metrics, logging, health

**External APIs:**
- Authentik (OIDC + ROPC) — `auth_service.py`, `authentik_service.py`
- Webhook delivery — tenant-configured URLs (HMAC signed, 3-attempt retry)

---

## Side Effects

- **DB writes:** every job lifecycle event; audit log on auth + key + job events
- **File reads/writes:** `/app/uploads/audio/` — accepts multipart upload, hands path off to AudioPreprocessor via Kafka
- **Network I/O:** webhook POSTs (signed), Authentik OIDC flows
- **Kafka produces:** to every agent input topic
- **Redis writes:** rate-limit buckets, runtime config publish (via ConfigService propagation, not orchestrator itself usually)
- **Metrics emitted:** see Observability section

---

## Failure Modes

| Symptom | Likely cause | Where to look |
|---|---|---|
| Job stuck in `pending` after submit | Initial agent consumer not consuming | `docker logs <first-agent>`; check `agent.deadletter` topic |
| Job stuck after step N | That step's validator dead or never produced `*.validated` | Validator container logs; `kafka_consumer_lag` for that group |
| Validation loop (retry exhaustion) | LLM keeps failing schema; max 2 retries; → terminal `failed` | `job_steps.retry_count`, validator logs |
| SSE stops mid-stream | Reasoning Redis stream key expired or client disconnected | Redis `EXISTS stream:{job_id}`, reasoning_agent logs |
| Webhook never fires | Tenant `webhooks` row inactive, URL unreachable, or HMAC secret missing | `webhooks` delivery columns; `webhook_service.py` logs |
| DLQ filling | Agent throwing past retry | `GET /v1/dlq/`, replay or fix upstream |
| 401 on internal call | `JWT_SECRET` mismatch between orchestrator and ConfigService | env var parity |
| `alg not allowed` | RS256 Authentik token hit HS256-only endpoint | Route through `/auth/login`, not Authentik direct flow |

Retry behaviour:
- **Kafka consumer loops** — auto-reconnect with 10s backoff (`_run_migrations` pattern, see [`CLAUDE.md`](../CLAUDE.md#implementation-patterns))
- **Webhook delivery** — 3 attempts, exponential backoff, terminal failure logged in webhook delivery cols
- **Validation retry** — `retry_count` on `JobStep` capped at 2; then job marked `failed`

---

## PHI Surface

> ⚠️ This is the single biggest PHI surface in haidoc. Every patient input passes through here.

| Path | PHI? | Persists? | Notes |
|---|---|---|---|
| `POST /v1/process/audio` (multipart) | Yes (voice) | Disk + Kafka payload | Audio file path stored on `jobs.input_meta`; raw audio in `/app/uploads/audio/` |
| `POST /v1/process/text` | Yes (transcript) | Kafka payload | Text body passed straight to Kafka |
| `jobs.input_meta` JSONB | Yes | Indefinite | Currently no TTL (INT-0 in [`MASTER_PLAN.md`](../MASTER_PLAN.md) Part 9 addresses this) |
| `jobs.result` JSONB | Yes (SOAP, dx, meds) | Indefinite | Same as above |
| `job_steps.input` / `.output` | Yes | Indefinite | All intermediate text — biggest leak surface |
| SSE stream | Yes | Ephemeral | Tokens streamed in flight; not stored unless caller logs |
| Webhook payload | Yes | Sent to tenant URL | Tenant retention is their problem; HMAC signed |
| `audit_log.detail` TEXT | Risk | Indefinite | Currently free TEXT — careless-logging risk; structure planned |
| Redis `stream:{job_id}` | Yes (tokens) | TTL bound to job, but currently unbounded | EXPIRE planned |

Current state: **no de-identification**, **no TTL on PHI tables**. See [`MASTER_PLAN.md`](../MASTER_PLAN.md) Part 9 INT-0 for retention tiers and de-id plan.

---

## Config

### Required env vars

| Var | Purpose |
|---|---|
| `APP_DATABASE_URL` | AppBase async DB URL (orchestrator-owned tables) |
| `DATABASE_URL` | Legacy `Base` DB URL — needed by some shared imports; do not use for new code |
| `JWT_SECRET` | HS256 signing key; MUST match ConfigService's |
| `KAFKA_BOOTSTRAP_SERVERS` | e.g. `kafka:29092` |
| `REDIS_URL` | e.g. `redis://redis:6379/0` |
| `CONFIG_SERVICE_URL` | e.g. `http://config-service:8010` |
| `AUTHENTIK_BASE_URL`, `AUTHENTIK_API_TOKEN`, `CLIENT_ID`, `CLIENT_SECRET` | Authentik (auto-written by `setup-authentik.sh`) |
| `AUTHORIZATION_FLOW_UUID`, `INVALIDATION_FLOW_UUID` | Authentik flows |
| `SEED_ADMIN_PASSWORD` | Optional override for default admin (default `12345678`) |
| `WEBHOOK_HMAC_HEADER` | Header name (default `X-Haidoc-Signature`) |

### Runtime knobs

- `agent_runtime_config` table — orchestrator publishes pub/sub to `agent.config.{name}` on update (AS-2). Orchestrator itself isn't `BaseKafkaAgent`, so this is propagation only.
- Pipeline + registry cache — 60s TTL via `_periodic_cache_refresh`.

---

## Observability

**Metrics (Prometheus, exposed on `/metrics`):**
- `http_requests_total{method, path, status}`
- `kafka_consumer_lag{agent_name, topic, group_id}` (AS-5 — set by orchestrator for the whole stack)
- `job_state_transitions_total{from, to}`
- `webhook_delivery_total{outcome}`
- `dlq_entries_total{step_name}`
- Standard process metrics from `shared/haidoc_obs`

**Logs:**
- JSON formatted via `shared/haidoc_obs/logging_config.py`
- `mk_` keys auto-redacted by `JsonFormatter`
- `job_id` context propagated via `contextvars` in `set_job_context()` / `clear_job_context()`

**Health:**
- `GET /health/live` — process alive
- `GET /health/ready` — Postgres + Redis + Kafka + ConfigService all reachable

**Dashboard:**
- Grafana `agents_overview.json` — Kafka lag table (per agent), job throughput, error rate, latency

---

## Common Change Recipes

### Add an HTTP endpoint
1. Add route function in the right `app/api/routes/*.py`
2. If it mutates state (jobs / keys / users / orgs), call `audit_service.log_audit(...)` (fire-and-forget)
3. If admin-only, depend on `require_admin` / `require_superadmin` from `app/core/auth.py`
4. If rate-limited, wrap with sliding-window Redis check (mirror `login_limiter.py`)

### Add an `AppBase` table
1. Create model in `app/models/`
2. Generate Alembic migration: `alembic revision --autogenerate -m "<desc>"` (run inside container)
3. Edit migration if autogen misses anything (FK across `Base`/`AppBase`, defaults, indexes)
4. `entrypoint.sh` will `alembic upgrade head` on next start
5. Update [`CLAUDE.md`](../CLAUDE.md) Alembic migrations list

### Add a new Kafka topic to consume
1. Add a background task in `app/main.py` lifespan
2. Use `get_consumer(topic, "orchestrator-<purpose>")` from `shared/haidoc_obs/kafka_utils.py`
3. Wrap loop body in the canonical `while True:` reconnect pattern (see [`CLAUDE.md`](../CLAUDE.md#implementation-patterns))
4. Create the topic in two places — `docker-compose.yml` `kafka-init-topics` block + live `kafka-topics.sh --create` (else topic vanishes on restart)

### Add a new pipeline routing rule
- Don't. Route logic is graph-driven from `pipeline_definitions` + `pipeline_edges` (in ConfigService). Add the pipeline via the UI builder; orchestrator routes automatically.

### Wire a new Kafka-consuming agent
- The agent itself uses `BaseKafkaAgent` from [[shared]]; orchestrator side just needs:
  1. Add row to `agent_registry` (input/output topic, optional LLM)
  2. Add agent to pipeline via builder
  3. Confirm consumer group lag scraper picks it up (auto, via `kafka_lag_service.py`)

### Add a new SSE event type
1. Producer (usually a background task here) calls SSE writer with new event name
2. Add to [`CLAUDE.md`](../CLAUDE.md#sse-event-types) docs
3. Frontend SSE consumer (`useEventStream` hook) adds case in switch

---

## Cross-links

- [[shared]] — `BaseKafkaAgent`, `chat_completion`, metrics, logging — orchestrator depends on all four
- [[ConfigService]] — sole source of pipeline / agent / prompt config; orchestrator reads via HTTP
- [[frontend]] — admin dashboard hits orchestrator's `/v1/*` routes via `/api/` nginx prefix
- [[ResponseMerger]] — quorum merges that orchestrator routes through; orchestrator only reads `*.validated`
- [[ContextAggregatorAgent]] — self-validating; orchestrator consumes `aggregator.partial` for SSE relay
- [`MASTER_PLAN.md`](../MASTER_PLAN.md) — Part 9 INT-0 retention + de-id work touches this service first
- [`CLAUDE.md`](../CLAUDE.md) — canonical reference for invariants, gotchas, and patterns
