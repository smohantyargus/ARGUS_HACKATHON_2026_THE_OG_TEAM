# PLAN: CIVIS Core Orchestration

## 1. ARCHITECTURAL FOUNDATION

### Objective
Establish the technical "plumbing" and state machine that governs the collaboration between independent agents. This plan focuses on the backend-agnostic flow of data from input to final decision.

### System Invariants
- **Kafka as the Backbone:** All inter-agent communication must flow through Kafka topics.
- **Validation Gates:** No agent output shall reach the next node in the pipeline without passing through the `GenericValidator`.
- **Atomic State:** The `OrchestratorAgent` remains the single source of truth for job lifecycle state (Pending, Running, Completed, Failed).

---

## 2. DATA FLOW ARCHITECTURE

### The Pipeline Pattern
We implement a **Parallel-Fanout / Fan-in** pattern:
1. **Trigger:** User Input -> `decision.input` topic.
2. **Specialization:** N independent agents (Discovery, Risk, Budget) consume `decision.input` in parallel.
3. **Challenge:** `GenericValidator` challenges each specialist's output for schema compliance.
4. **Synchronization:** `ResponseMerger` waits for all N validated outputs.
5. **Synthesis:** `ContextAggregator` arbitrates conflicts and generates the **Final Playbook**.

### State Transitions
| Current State | Event | Next State | Action |
| ------------- | ----- | ---------- | ------ |
| Idle | UI Trigger | Processing | Emit `decision.input` |
| Processing | Agent Result | Processing | Update Timeline (SSE) |
| Processing | All Agents Done | Aggregating | Trigger Merger -> Aggregator |
| Aggregating | Aggregator Done | Completed | Emit Final Playbook (SSE) |

---

## 3. SHARED MODELS (DART)
All agents and the UI must adhere to these core schemas:

### AgentStep
```json
{
  "job_id": "uuid",
  "step_name": "Discovery",
  "payload": { "recommendation": "...", "confidence": 0.9 },
  "metadata": { "latency": 1.2, "tokens": 450 }
}
```

### FinalDecision
```json
{
  "job_id": "uuid",
  "verdict": "Proceed",
  "rationale": "...",
  "conflicts_resolved": ["Risk vs Budget on Timeline"],
  "playbook": { "steps": [...] }
}
```

---

## 4. INFRASTRUCTURE REQUIREMENTS
- **Redis:** Used for merger quorum buffering and SSE event relay.
- **Postgres:** Stores `job_steps` for historical audit and "Seeding" retrieval.
- **Prometheus:** Tracks "Agent Influence" metrics (how often an agent's view was accepted).
