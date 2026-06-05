# PLAN: CIVIS Command Center UI Implementation

## 1. EXECUTIVE SUMMARY

### Objective
The primary objective of this initiative is to design and implement a high-fidelity, Flutter-based **CIVIS Command Center**. This application will serve as the next-generation interface for the CIVIS Multi-Agent Decision Intelligence System, replacing the current React-based administrative dashboard with a responsive, simulation-focused command center capable of visualizing complex agent orchestrations in real-time.

### Business Value
As the CIVIS core moves beyond its original medical domain into generic multi-agent decision problems (e.g., urban simulation, disaster response), the need for a "situation room" interface becomes critical. A Flutter-based implementation offers:
- **Real-time Visualization:** High-performance rendering for agent timelines and DAG traces.
- **Cross-Platform Delivery:** A single codebase for Desktop (Command Center), Tablet (Field Operation), and Web (Remote Audit).
- **Responsive Decision Support:** Adaptive layouts that prioritize "Final Playbook" results while maintaining "Agent Trace" transparency.

### Success Criteria
- Successful initialization of a Clean Architecture Flutter project.
- Implementation of a real-time SSE-driven Agent Timeline.
- Delivery of a "Final Playbook" renderer that synthesizes ContextAggregator outputs.
- Adaptive rendering support for Desktop, Tablet, and Mobile viewport sizes.
- Seed data integration allowing for "Demo Mode" simulation without live Kafka dependencies.

### Scope
- **Included:** Flutter project scaffolding, responsive shell, state management (BLoC/Provider), Mock/Seed data layer, UI components (Timeline, Playbook, Control Panel), and Orchestrator API integration.
- **Excluded:** Modification of the Python backend (ConfigService/Orchestrator), Kafka infrastructure changes, or legacy React code refactoring.

---

## 2. CURRENT ARCHITECTURE ASSESSMENT

### Existing Repository Structure
```text
/
├── ConfigService/          # FastAPI: Agent/Pipeline Registry
├── OrchestratorAgent/      # FastAPI: Routing & SSE Gateway
├── shared/civis_obs/       # Shared Python: LLM Client & Kafka Base
├── frontend/               # React: Current Admin Dashboard (Reference)
├── GenericAgent/           # LLM Agent Runner
├── ContextAggregator/      # Final Synthesis Agent
├── ResponseMerger/         # Quorum Merger
├── GenericValidator/       # Output Gating
└── migrations/             # SQL Schema updates
```

### Existing Backend Analysis
- **Orchestration Flow:** Job submission -> Kafka Fan-out -> Validation -> Merging -> Aggregation -> Result.
- **Agent Lifecycle:** State is transient in Kafka, persisted as `job_steps` in PostgreSQL.
- **State Flow:** Event-driven via Kafka topics (`*.completed`, `*.validated`).
- **Services:** Decoupled FastAPI microservices with a shared `civis_obs` observability layer.
- **APIs:** REST for CRUD (ConfigService); REST + SSE for Job Processing (Orchestrator).

### Existing Frontend Analysis
- **Framework:** React + Vite + TypeScript.
- **Screens:** Dashboard, Job Console, Pipeline Builder (React Flow), Job Detail (Trace).
- **Navigation:** Standard side-rail navigation.
- **State Management:** React Context (Auth, Theme) + Local State.
- **Theme System:** CSS Variables for light/dark mode.

### Architecture Strengths
- **Decoupled Core:** The backend is domain-agnostic and ready for any UI client.
- **Traceability:** The SSE stream provides a rich data source for the new Timeline UI.
- **Config-Driven:** The UI can dynamically render forms based on `agent_definitions`.

### Architecture Risks
- **SSE Overhead:** Heavy real-time streaming might require optimized state management in Flutter to prevent UI jank.
- **API Impedance:** The current React-focused API responses may need slight adaptation or a dedicated BFF (Backend for Frontend) in the future.

---

## 3. GAP ANALYSIS

| Requirement | Exists in React | Needs Modification | New Component (Flutter) |
| ----------- | --------------- | ------------------ | ----------------------- |
| Auth Integration | Yes | Re-implement in Flutter | `AuthService` (HS256) |
| Pipeline Visualization | DAG View | Port to Timeline | `AgentTimelineWidget` |
| Job Submission | Basic Form | Scenario Input | `ScenarioInputPanel` |
| Real-time Updates | SSE | Port to Streams | `SSEStreamController` |
| Seed/Simulation Mode | No | New Requirement | `SeedDataRepository` |
| Responsive Layout | Limited | Mobile/Desktop First | `AdaptiveShell` |
| Playbook Rendering | Raw JSON | Synthesis View | `FinalPlaybookRenderer` |

---

## 4. TARGET ARCHITECTURE

### Folder Structure (Flutter)
```text
lib/
├── core/               # App-wide constants, themes, auth
├── config/             # Environment & Seed loading
├── data/               # Models, Repositories, API Clients
│   ├── models/         # Job, AgentStep, Pipeline models
│   ├── repositories/   # SeedRepository, JobRepository
│   └── providers/      # SSE & HTTP Clients
├── domain/             # Business logic & Entities
├── presentation/       # Screens and BLoCs/ChangeNotifiers
│   ├── dashboard/
│   ├── command_center/ # The main "Simulation" view
│   └── job_detail/
├── widgets/            # Reusable components (Timeline, Cards)
├── services/           # Orchestrator & Config Service wrappers
└── assets/             # seed_city_state.json, icons, styles
```

### State Management Architecture
The application will use a **Reactive Stream Architecture**:
- **Idle State:** Ready for input; displays system health and recent logs.
- **Processing State:** Consuming SSE stream; updating Timeline and partial Aggregator views.
- **Completed State:** Stream closed; Final Playbook rendered and conflict analysis visible.
- **Reset State:** Clears buffers; returns to Idle.
- **Error State:** Displays DLQ/Validation failure context.

### Data Flow Architecture
1. **Input:** `ScenarioInputPanel` captures parameters.
2. **Orchestration:** `JobService` calls `POST /v1/process/text`.
3. **Observation:** `SSEService` listens to `job.completed`, `step.started`, `aggregator.partial`.
4. **Transformation:** Data layer converts JSON events into `AgentStep` domain entities.
5. **UI Update:** `Timeline` and `MetadataCards` react to stream updates.
6. **Finalization:** `ContextAggregator` event triggers the `FinalPlaybookRenderer`.

---

## 5. PHASE-WISE EXECUTION PLAN

---

### PHASE 1: Environment Seeding & Local Configuration

**Objective:** Establish the local simulation foundation.

**Deliverables:**
- `assets/seed_city_state.json`: Mock data representing urban/simulation scenarios.
- Configuration loading layer for environment variables and API endpoints.
- Strongly typed Dart models for the CIVIS core (Jobs, Steps, Agents).

**Files To Create:**
- `lib/data/models/agent_step.dart`
- `lib/data/models/job.dart`
- `lib/data/repositories/seed_repository.dart`
- `assets/seed_city_state.json`

**Architecture Decisions:**
- Use `json_serializable` for robust model generation.
- Implement a `Repository` pattern to toggle between `MockJobRepository` and `LiveJobRepository`.

**Estimated Effort:** 8 Hours | **Complexity:** Medium

---

### PHASE 2: Core Flutter App Setup & Responsive Layout

**Objective:** Build the responsive command-center shell.

**Deliverables:**
- Theme system (Dark/High-Contrast Simulation UI).
- `AdaptiveShell`: 3-pane layout for Desktop; Tabbed for Mobile.
- Navigation and Auth scaffolding.

**Files To Create:**
- `lib/core/theme.dart`
- `lib/presentation/shell/adaptive_shell.dart`
- `lib/presentation/shell/sidebar.dart`

**Layout Strategy:**
- **Desktop:** Sidebar + Control Panel (Left) + Timeline (Center) + Metadata (Right).
- **Mobile:** Bottom Navigation switching between Input, Timeline, and Playbook.

**Estimated Effort:** 12 Hours | **Complexity:** Medium

---

### PHASE 3: UI Panels & Component Construction

**Objective:** Construct all presentation components for the "Simulation" experience.

**Deliverables:**
- **Agent Timeline:** Linear vertical/horizontal visualization of Kafka event flow.
- **Metadata Cards:** Per-agent output cards showing confidence and conflicts.
- **Final Playbook:** High-impact synthesis card for the Aggregator's decision.

**Files To Create:**
- `lib/widgets/timeline/agent_timeline.dart`
- `lib/widgets/cards/agent_output_card.dart`
- `lib/widgets/renderer/playbook_renderer.dart`

**Data Binding Strategy:**
- Use `StreamBuilder` or `flutter_bloc` to bind directly to the SSE stream.

**Estimated Effort:** 20 Hours | **Complexity:** High

---

### PHASE 4: Integration Pipeline Verification & Mock Datasets

**Objective:** Demonstrate complete orchestration visualization.

**Deliverables:**
- Mock Agent State Mapping: Hardcoded states for "Discovery", "Risk", and "Budget" agents.
- Reset Flow: Ability to wipe local state and restart simulation.
- Demo Mode: Pre-recorded sequences of SSE events for pitch presentations.

**Estimated Effort:** 8 Hours | **Complexity:** Low

---

## 6. DETAILED IMPLEMENTATION BACKLOG

| Priority | Task | Phase | Complexity | Dependency |
| -------- | ---- | ----- | ---------- | ---------- |
| P0 | Dart Model Generation (Job/Step) | 1 | Low | None |
| P0 | Seed JSON Creation | 1 | Low | None |
| P1 | Adaptive Layout Shell | 2 | Medium | P0 |
| P1 | SSE Stream Integration | 3 | High | P1 |
| P1 | Agent Timeline Widget | 3 | High | P1 |
| P2 | Final Playbook Renderer | 3 | Medium | P1 |
| P2 | Conflict Metadata Cards | 3 | Medium | P1 |
| P3 | Demo Mode / Seed Toggle | 4 | Low | P1 |

---

## 7. TESTING STRATEGY

### Unit Tests
- JSON Parsing for `seed_city_state.json`.
- State transition logic in BLoCs (Idle -> Processing -> Completed).

### Widget Tests
- Responsive layout verification (checking for overflow on small screens).
- Timeline list rendering with mock step data.

### Integration Tests
- End-to-end "Mock Simulation" run using `SeedRepository`.
- Auth flow (Login -> Token Storage -> Interceptor).

---

## 8. RISK REGISTER

| Risk | Impact | Probability | Mitigation |
| ---- | ------ | ----------- | ---------- |
| Flutter Web SSE | High | Medium | Use `fetch` API via `EventSource` polyfill for web compatibility. |
| State Bloat | Medium | Medium | Implement auto-cleanup for completed job streams in memory. |
| Responsive Layout Complexity | Low | High | Use `LayoutBuilder` and `ScreenTypeLayout` early in Phase 2. |

---

## 9. FUTURE SCALABILITY ROADMAP

- **Near Term:** Support for `agent_routed` and `cyclic_feedback` visualization (dynamic edges).
- **Medium Term:** Native Mobile builds (iOS/Android) for field monitoring.
- **Long Term:** Real-time Grafana metric embedding within the Flutter Timeline.

---

## 10. CTO RECOMMENDATIONS

1. **Prioritize the "Money Shot":** The **Agent Timeline** and **Conflict Resolution** view in the `ContextAggregator` are the most unique features of CIVIS. Build these first.
2. **Avoid Global State:** Keep the job processing state local to the `CommandCenter` BLoC to allow for future multi-job monitoring.
3. **Web-First Flutter:** Ensure all early UI builds are tested in the browser, as this will be the primary demo platform for the hackathon.
4. **Seed Layer:** Do not rely on a live Kafka connection for initial UI development; the `SeedRepository` is critical for parallelizing work.
