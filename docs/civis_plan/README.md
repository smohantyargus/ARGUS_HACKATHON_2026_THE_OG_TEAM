# CIVIS Implementation Plan: Modular Roadmap

## 1. OVERVIEW
This document serves as the entry point for the CIVIS Command Center implementation. The project is split into independent modules to ensure separation of concerns between the **Orchestration Engine**, the **End-User Interface**, and the **Specialized Agents**.

---

## 2. MODULAR PLANS

### [00. Core Orchestration](./00_CORE_ORCHESTRATION.md)
**Responsibility:** Backend plumbing, Kafka data flow, and state management.
**Target Audience:** DevOps & Backend Engineers.

### [01. Frontend Interface](./01_FRONTEND_INTERFACE.md)
**Responsibility:** User Triggering, Environment Seeding, and real-time Visualization.
**Target Audience:** Frontend & UX Engineers.

### [02. Agent Specifications](./agents/)
**Responsibility:** Independent expertise definitions for the simulation.
**Target Audience:** Prompt Engineers & Domain Specialists.

- [Discovery Agent](./agents/DISCOVERY_AGENT.md) - Entity and Fact extraction.
- [Risk Agent](./agents/RISK_AGENT.md) - Threat and Security evaluation.
- [Budget Agent](./agents/BUDGET_AGENT.md) - Financial and Resource feasibility.
- [Decision Aggregator](./agents/DECISION_AGGREGATOR.md) - Final synthesis and conflict resolution.

---

## 3. EXECUTION ORDER
1. **Infrastructure:** Bring up the `civis` core via `dev-up.sh`.
2. **Agent Deployment:** Configure agents in `ConfigService` based on their independent specs.
3. **Frontend Shell:** Scaffolding the Flutter app and implementing the `AdaptiveShell`.
4. **Integration:** Connecting the `SimulationBloc` to the `OrchestratorAgent` API.
5. **Seeding:** Populating `assets/seed_city_state.json` with domain-specific mock data.

---

## 4. UI SCOPE LIMITATION
The UI is strictly focused on:
1. **Triggering:** Submitting scenarios to the pipeline.
2. **Observing:** Visualizing the agent timeline and conflict detection.
3. **Synthesis:** Presenting the Final Playbook.
4. **Seeding:** Managing simulation context data.

*Note: Agent creation and configuration are handled independently via the `ConfigService` or direct configuration files, keeping the end-user UI clean and intuitive.*
