# ReasoningAgent

> **Status:** Active
> **Flavor:** agent
> **Container:** `reasoning_agent`
> **Port:** 8005
> **Tech:** FastAPI + `BaseKafkaAgent` + Anthropic streaming SDK + Redis token relay

---

## Role

Run Claude (or another streaming-capable LLM) on the validated NLP output to produce structured reasoning — differential diagnosis, lab suggestions, follow-up questions, confidence scoring. Streams tokens to Redis so the SSE consumer in [[OrchestratorAgent]] can relay them to the browser in real time.

---

## Position in Pipeline

```mermaid
flowchart LR
    Router{Pipeline Router} -->|reason input| RA[ReasoningAgent]
    RA -.tokens.-> Redis[(stream:{job_id})]
    Redis -.xread.-> Orch[[OrchestratorAgent]] -.SSE.-> Client
    RA -->|reasoning.completed| RV[[ReasoningValidator]]
```

---

## Contracts

### Kafka

| Direction | Topic | Group |
|---|---|---|
| In | typically `nlp.validated` routed via pipeline (input topic depends on graph) | `reasoning-agent` |
| Out | `reasoning.completed` | — |

Input data: full upstream context (transcript, NLP result, config with action + persona).

Output data:
```json
{"diagnosis": [...], "labs": [...], "follow_up": [...],
 "overall_confidence": 0.82, "rationale": "..."}
```

Must include `overall_confidence` — [[ReasoningValidator]] gates on its presence.

### Redis token relay

- Per-job stream key: `stream:{job_id}`
- Writer: `XADD stream:{job_id} * token "<text>"` per streamed chunk
- Terminator: `XADD stream:{job_id} * done 1`
- TTL: orchestrator sets EXPIRE on job terminal state

Streaming impl: `chat_completion(..., stream_callback=write_to_redis)` from [[shared]].

---

## Dependencies

- **External:** Anthropic API (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`)
- **Redis:** writes `stream:{job_id}` token stream
- **HTTP:** [[ConfigService]] for prompt + LLM instance config
- **Internal:** [[shared]] (`BaseKafkaAgent`, `chat_completion` streaming, token tracker)
- **DB:** `token_usage_log` writes via shared lib

---

## Side Effects

- LLM call to Anthropic (transcript + NLP output egress)
- Redis stream writes per token
- Token usage row per call

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Token stream not showing in UI | Redis not ready or this agent disconnected | `docker logs reasoning_agent redis` |
| `reasoning.completed` stuck | Output missing `overall_confidence` (validator rejects) | Check Claude response in agent logs; tighten prompt |
| `429` from Anthropic | Quota / rate limit | Fallback model in `agent_llm_assignments` priority list |
| Mid-stream cut | Anthropic SSE drop | Retry via validator feedback loop (max 2) |
| `stream:{job_id}` lingers | No EXPIRE set on terminal state | Orchestrator-side fix; not this agent |

---

## PHI Surface

- **Input:** transcript + NLP output (PHI)
- **Output:** reasoning text (PHI-dense — explicit diagnoses)
- **External egress:** full context to Anthropic
- **Redis:** PHI tokens in `stream:{job_id}` — needs explicit EXPIRE (INT-0 in [`MASTER_PLAN.md`](../MASTER_PLAN.md) Part 9)

---

## Config

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required |
| `ANTHROPIC_MODEL` | Default `claude-sonnet-4-6` |
| `REDIS_URL` | Token stream |
| `CONFIG_SERVICE_URL` | Prompt + LLM instance config |
| `APP_DATABASE_URL` | Token usage DB |
| `KAFKA_BOOTSTRAP_SERVERS`, `AGENT_CONCURRENCY` | Standard |

---

## Observability

- `agent_processed_total{agent_name="reasoning_agent"}`
- `llm_call_total{provider="anthropic"}`
- `agent_processing_seconds` histogram
- Per-token write rate not directly metricked (relay is fire-and-forget)

---

## Common Change Recipes

### Add a new reasoning action (e.g. `triage`)
1. Prompt template in [[ConfigService]]
2. Pipeline node `config_override.action = "triage"`
3. Update output schema if different from default

### Switch to a different streaming LLM
- Provider must support streaming via [[shared]] `chat_completion` with `stream_callback`. Currently Anthropic only.
- Add new branch in `llm_client.py` for streaming-capable providers if needed

### Disable streaming for a job
- Drop `stream_callback`; falls back to non-streaming Anthropic SDK
- Frontend SSE will receive only the final `step.completed` for this step

### Tighten confidence threshold
- [[ReasoningValidator]] enforces — change there, not here

---

## Cross-links

- [[NLPValidator]] → router → this agent
- [[ReasoningValidator]] — downstream
- [[OrchestratorAgent]] — Redis stream consumer for SSE relay
- [[shared]] — `chat_completion` streaming path
- [`MASTER_PLAN.md`](../MASTER_PLAN.md) — Part 9 INT-5 (ReAct loop) extends this agent
