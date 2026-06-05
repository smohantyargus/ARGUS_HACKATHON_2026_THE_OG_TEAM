# GenericAgentV2

> **Status:** Active (Enhanced)
> **Flavor:** agent
> **Container:** `generic_agent_v2`
> **Tech:** FastAPI + `BaseKafkaAgent` + `chat_completion` + `request_data`

---

## Role

The **GenericAgentV2** is a data-aware evolution of the standard [[GenericAgent]]. It maintains the same config-driven, zero-code pattern for creating specialist LLM agents but adds the ability to perform **RAG-style ground-truth database lookups** before the LLM call.

It bridges the gap between static LLM reasoning and the live application database by pulling structured facts (via [[DataQueryAgent]]) and injecting them into the prompt context.

---

## Position in Pipeline

```mermaid
flowchart TD
    Router{Pipeline Router} -->|{input_topic}| GAV2[GenericAgentV2]
    GAV2 -->|data.request| DQA[[DataQueryAgent]]
    DQA -->|data.response| GAV2
    GAV2 -->|LLM Synthesis| GAV2
    GAV2 -->|{output_topic}.completed| GV[[GenericValidator]]
    GV -->|{output_topic}.validated| Router
```

---

## Key Features (Superset of v1)

- **Data Queries:** Definitions can include a `data_queries` list. Each query is run against the DB before the prompt is rendered.
- **Context Injection:** Results from data queries are available in the prompt templates as `{{data}}`.
- **Superset Compatibility:** A definition without `data_queries` behaves exactly like a v1 [[GenericAgent]].

---

## Contracts

### Kafka

| Direction | Topic | Purpose |
|---|---|---|
| In | per-definition `input_topic` | Receives orchestration task |
| Out | `data.request` | Requests ground-truth facts from DB |
| In | `data.response` | Receives DB rows |
| Out | per-definition `output_topic`.completed | Publishes final synthesis |

### Data Aware Definition fields

- `data_queries` — List of `{"query_name": "...", "params": {...}}`
- `params` — supports `{{field}}` templates to dynamically build queries from the incoming Kafka message.

---

## Dependencies

- **HTTP:** [[ConfigService]] for data-aware definitions.
- **Kafka:** [[DataQueryAgent]] for ground-truth lookups.
- **External:** LLM via `chat_completion()` ([[shared]]).
- **Internal:** [[shared]] (`request_data` utility).

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `{{data}}` is empty | `DataQueryAgent` timeout or unknown query name | Check [[DataQueryAgent]] logs and `query_name` mapping |
| Prompt fails to render | `data_queries` param template refers to missing field | Check `input_fields` vs upstream message |

---

## Config

| Var | Purpose |
|---|---|
| `CONFIG_SERVICE_URL` | Definition fetch |
| `DATA_QUERY_TIMEOUT` | Default 5.0s for DB lookups |

---

## Cross-links

- [[GenericAgent]] — The v1 predecessor
- [[DataQueryAgent]] — The DB fact provider
- [[shared]] — Provides `request_data()` and `chat_completion()`
