# PLAN: CIVIS Frontend Interface (Command Center)

## 1. OBJECTIVE
Implement a Flutter-based "Situation Room" UI that allows end users to trigger complex simulations and visualize agent collaboration without needing to manage the underlying agent infrastructure.

---

## 2. CORE RESPONSIBILITIES

### A. Pipeline Triggering
- **Scenario Input Panel:** A high-fidelity input area where users enter the prompt or select a simulation scenario.
- **Goal Definition:** Explicitly capturing what the user wants to achieve (e.g., "Minimize Risk," "Maximize ROI").
- **Job Orchestration:** Direct integration with `OrchestratorAgent` (POST /v1/process/text).
- **Flawless Reset Toggle:** Implement `ResetState()` methods in the BLoC layer to clear all buffers, stop SSE listeners, and return the UI to the primary input state for repeatable demonstrations.

### B. Environment Seeding
- **Simulation Seeder:** A utility to load `assets/seed_city_state.json`. Specifically, it must support the **Historical Pandemic Trace** (Agents A-E).
- **Demo Mode:** A specialized playback engine that injects the historical sequence into the `SimulationBloc` stream to simulate a "perfect run" for demos.

### C. Real-time Visualization
- **Agent Collaboration Timeline:** A vertical stream showing agent arrivals (Epidemiologist -> Economic -> Compliance -> Supply -> Healthcare).
- **Policy Evolution:** Visualizing how the initial "Hard Lockdown" is amended and overridden by subsequent agents in real-time.
- **Final Playbook Renderer:** A clean, authoritative synthesis of the final pandemic response plan.

---

## 3. UI ARCHITECTURE

### Component Tree
```text
AdaptiveShell
├── Sidebar (Navigation & History)
└── CommandCenterView (Main)
    ├── Header (System Health & Simulation Stats)
    ├── InputRegion (Scenario Input & Trigger)
    └── ResultsRegion (Conditional Rendering)
        ├── Loading (SSE Stream / Timeline)
        └── Success (Final Playbook + Conflict Analysis)
```

### State Management (BLoC/Provider)
- **`SimulationBloc`:** Manages the lifecycle of a single job.
  - `event: TriggerSimulation(input)`
  - `event: ReceiveSSEEvent(data)`
  - `state: Idle, Processing, Finished`
- **`SeedDataBloc`:** Handles loading and managing pre-defined simulation contexts.

---

## 4. DESIGN PRINCIPLES
1. **Simplicity Over Speed:** Provide a clean, white-space heavy UI.
2. **Transparency:** Show *which* agent said *what*, but hide *how* they said it (hide Kafka/Topics).
3. **Actionable Outputs:** The "Final Playbook" must be the most prominent element after completion.

---

## 5. VALIDATION CHECKLIST
- [ ] User can submit a text scenario.
- [ ] UI shows agents appearing on the timeline as they finish.
- [ ] UI displays the Final Playbook once the Aggregator finishes.
- [ ] "Reset" button clears the current simulation state.
