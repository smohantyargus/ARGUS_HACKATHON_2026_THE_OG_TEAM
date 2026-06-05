# GenericAgent

> **Status:** Active
> **Flavor:** agent
> **Container:** `generic_agent` (catch-all) + per-definition instances like `generic_agent_diarization`
> **Port:** 8120 (catch-all), 8121+ (per-definition)
> **Tech:** FastAPI + `BaseKafkaAgent` + `chat_completion`

---

## Role

Config-driven text-to-text LLM agent. **No Python code per new agent** — a new agent is created by inserting a row into `agent_definitions` (via [[ConfigService]] UI) and restarting the container. Phase B3.

Powers all custom pipeline nodes that don't need bespoke logic (diarization-style routing, simple summarisation, classification, etc.).

---

## Position in Pipeline

```mermaid
flowchart LR
    Router{Pipeline Router} -->|{input_topic}| GA[GenericAgent]
    GA -->|{output_topic}.completed| GV[[GenericValidator]]
    GV -->|{output_topic}.validated| Router
```

The container loads either **all** active `agent_definitions` (no `AGENT_NAME` env) or **one** definition (`AGENT_NAME=<name>` env). Each definition subscribes to its own `input_topic` and produces to its own `{output_topic}.completed`.

---

## Contracts

### Kafka

| Direction | Topic | Source |
|---|---|---|
| In | per-definition `input_topic` (e.g. `diarization.input`) | each row in `agent_definitions` |
| Out | per-definition `{output_topic}.completed` (e.g. `diarization.completed`) | same |

Output convention: `{output_topic}.completed` → [[GenericValidator]] → `{output_topic}.validated`.

### Definition fields (`agent_definitions` table)

- `name` — agent identity
- `input_topic` / `output_topic` — Kafka contract
- `input_fields` — list; each becomes a `{{field}}` placeholder in the prompt
- `prompt` — template with `{{field}}` placeholders
- `llm_instance_name` — selects provider
- `validation_rules` — passed through to [[GenericValidator]]

### Prompt rendering (`app/services/generic_agent.py`)

`{{field}}` placeholders are substituted from the Kafka message's `data` dict. Missing field → render as empty string; loud-fail option not yet implemented.

---

## Dependencies

- **HTTP:** [[ConfigService]] for `agent_definitions` (loaded on boot)
- **External:** LLM via `chat_completion()` ([[shared]])
- **Internal:** [[shared]]
- **DB:** `token_usage_log` writes

---

## Side Effects

- LLM calls per message
- Standard metrics + logs

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Container crashes at boot | `AGENT_NAME` set but no matching definition | Create definition in UI first |
| New definition not picked up | Container started before row inserted | Restart `generic_agent` |
| Placeholder renders empty | Field name typo or upstream omits it | Check `input_fields` vs upstream message keys |
| All definitions silent | DB unreachable; falls back to no subscriptions | Check DB connection |

---

## PHI Surface

- **Input:** whatever upstream sends (typically transcript-derived PHI)
- **Output:** LLM result (PHI-dense)
- **External egress:** rendered prompt sent to provider
- **DB:** token usage only

---

## Config

| Var | Purpose |
|---|---|
| `AGENT_NAME` | Optional; if set, load only that definition |
| `CONFIG_SERVICE_URL` | Definition fetch |
| `APP_DATABASE_URL`, `REDIS_URL`, `KAFKA_BOOTSTRAP_SERVERS` | Standard |

---

## Observability

- `agent_processed_total{agent_name="<definition-name>"}` — note the label is the **definition** name, not the container
- `llm_call_total{provider, model_name}`

---

## Common Change Recipes

### Add a new text-to-text agent (zero code)
1. UI → Agents → Generic Agents → New — name, input topic, output topic, input fields, prompt, LLM instance, validation rules
2. Either:
   - Restart `generic_agent` to pick it up among all definitions, OR
   - Add a dedicated container in `docker-compose.yml` with `AGENT_NAME=<name>` (mirrors `generic_agent_diarization`)
3. Pipeline builder — add a Generic Agent node referencing the new definition (`agent_type: 'generic_llm'`)
4. Restart [[GenericValidator]] — it re-fetches definitions on boot

### Change prompt / inputs
- Edit definition row via UI; restart `generic_agent` (definitions cached at boot)

### Run a definition in isolation
- `AGENT_NAME=<name>` + separate container — good for high-traffic agents that need their own concurrency budget

---

## Cross-links

- [[GenericValidator]] — downstream gate for every generic agent output
- [[ConfigService]] — `agent_definitions` storage + UI
- [[shared]] — `chat_completion`
- [`CLAUDE.md`](../CLAUDE.md) — Phase B3, `AGENT_NAME` semantics, prompt rendering pattern
