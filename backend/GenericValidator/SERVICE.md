# GenericValidator

> **Status:** Active
> **Flavor:** agent
> **Container:** `generic_validator`
> **Port:** —
> **Tech:** FastAPI + `BaseKafkaAgent` (dynamic-topic subscriber)

---

## Role

Single shared validator for every [[GenericAgent]] definition. Subscribes to **all** `{output_topic}.completed` topics in one consumer group, applies the rules attached to each `agent_definition`, and produces `{output_topic}.validated` or `validation.failed`. Phase G2.

---

## Position in Pipeline

```mermaid
flowchart LR
    GA[[GenericAgent]] -->|{output_topic}.completed| GV[GenericValidator]
    GV -->|{output_topic}.validated| Router{Pipeline Router}
    GV -->|fail| VF[validation.failed]
```

---

## Contracts

### Kafka

| Direction | Topic | Group |
|---|---|---|
| In | all `{output_topic}.completed` for active `agent_definitions` | `generic-validator` |
| Out pass | `{output_topic}.validated` (per-definition) | — |
| Out fail | `validation.failed` | — |

### Rule types (`app/services/validator.py`)

| `type` | Behaviour |
|---|---|
| `not_empty` (default if no rules) | Non-null, non-empty string |
| `required_fields` | JSON object with all listed keys |
| `json_schema` | Full JSON Schema validation |
| `none` | Always passes (forwards immediately) |

Rule config is per-definition in `agent_definitions.validation_rules`.

---

## Dependencies

- **HTTP:** [[ConfigService]] for `agent_definitions` (fetched once at boot)
- **Internal:** [[shared]] (`BaseKafkaAgent`)

No DB, no Redis, no LLM.

---

## Side Effects

- Pass/fail publish
- Standard metrics + logs

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| Not picking up new agent | Started before definition created | Restart `generic_validator` |
| Unknown topic | Topic doesn't exist in Kafka | Create via `kafka-topics.sh` + add to `docker-compose.yml` (see CLAUDE.md) |
| All passes despite bad output | Definition has `"type": "none"` | Add real rule |
| Schema rule slow | Large JSON Schema | Cache compiled schema (already does — verify) |

---

## PHI Surface

- Reads `{output_topic}.completed` payloads (PHI possible)
- No durable store
- Logs only validation outcome — don't log payload bodies

---

## Config

| Var | Purpose |
|---|---|
| `CONFIG_SERVICE_URL` | Boot-time definition fetch |
| Standard agent vars | Kafka, Redis, concurrency |

---

## Observability

- `agent_processed_total{agent_name="generic_validator", status="passed|failed"}`

---

## Common Change Recipes

### Add a new rule type
1. New branch in `app/services/validator.py` rule dispatcher
2. No DB schema change (rules are JSONB)
3. Update [[GenericAgent]] SERVICE.md rule table

### Bypass validation for one agent
- Set definition's `validation_rules` to `{"type": "none"}` — forwards immediately

### Reload definitions without restart
- Not supported today; definitions cached at boot. Restart container after adding/editing.

---

## Cross-links

- [[GenericAgent]] — every output flows through here
- [[ConfigService]] — definition source
- [[OrchestratorAgent]] — `validation.failed` retry loop
