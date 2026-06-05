# CIVIS Epidemic Council — Flutter Mobile App Plan

A native mobile (phone-portrait) app that drives the **Epidemic Containment Simulator**
backend (`epidemic_simulator_plan.md`): submit a scenario, watch 5 specialist agents
negotiate a containment policy over 2–3 rounds, and render the final arbitrated playbook
with conflict resolution.

**Locked decisions** (2026-06-05):
| Decision | Choice |
|---|---|
| State management | **Riverpod** (`flutter_riverpod`, `AsyncNotifier`) |
| Live trace strategy | **Poll `/v1/jobs/{id}/steps` every ~1.5s** until terminal |
| Auth | **Username + password** → JWT in secure storage |
| Target | **Phone portrait**, single-column |

This app is the **Agent Trace View** deliverable (mandatory; 40% of scoring is on
agent collaboration/conflict-resolution — lead the demo with it).

---

## 0. Backend prerequisites (2 tiny additive changes — do FIRST)

The current API can't cleanly drive a *live* mobile trace. Two small, backward-compatible
backend additions are required. Both are in `backend/OrchestratorAgent/`.

### 0.1 — Async trigger endpoint (REQUIRED for live polling)

`POST /v1/process/text` **blocks** until the whole pipeline finishes (60–180s for a
3-round negotiation) and only then returns a `job_id`. To show a live timeline we need the
`job_id` *immediately*, then poll. Add a non-blocking sibling.

**File:** `backend/OrchestratorAgent/app/api/routes/process_router.py`

```python
@router.post("/text/async", status_code=202)
async def process_text_async(
    body: TextProcessRequest,
    principal: dict = Depends(get_principal),
    db: Session = Depends(get_app_db),
):
    """Submit a text job and return job_id immediately (no blocking wait).
    Client polls GET /v1/jobs/{job_id} + /steps for progress."""
    if not body.text or not body.text.strip():
        raise HTTPException(400, "'text' is required")
    if not body.pipeline_id:
        raise HTTPException(400, "'pipeline_id' is required")
    job_id = str(uuid4())
    try:
        _, pipeline_name = await ProcessingHelper.process(
            db=db, principal=principal, input_type="text",
            content=body.text, pipeline_id=body.pipeline_id,
            model_name=body.model_name, target_lang=body.target_lang,
            job_id=job_id,
        )
    except (PermissionError, ValueError) as e:
        raise HTTPException(400 if isinstance(e, ValueError) else 403, str(e))
    return JSONResponse(status_code=202, content={
        "job_id": job_id,
        "pipeline": pipeline_name,
        "poll_url": f"/v1/jobs/{job_id}",
        "stream_url": f"/v1/jobs/{job_id}/stream",
    })
```

This reuses `ProcessingHelper.process` (same call the blocking endpoint makes) but **skips**
`job_result_store.register` + `asyncio.wait_for`. The job row + steps are persisted to the DB
by the pipeline as it runs (that's why `GET /v1/jobs/{id}` already works mid-run), so polling
sees live progress.
> Verify once: `ProcessingHelper.process` writes the `jobs` row before returning. (It must —
> the existing SSE stream reads the job from the DB during execution.)

### 0.2 — Expose `input` on job steps (REQUIRED for round grouping)

The `JobStep` model **already has** an `input` JSONB column, but `JobStepResponse` doesn't
return it. We need it to read `_iteration` (round number) and `_router_reason`.

**File:** `backend/OrchestratorAgent/app/schemas/job_schema.py`

```python
class JobStepResponse(BaseModel):
    id: int
    job_id: UUID
    step_name: str
    agent_name: Optional[str]
    status: str
    input: Optional[Any] = None      # ← ADD THIS LINE
    output: Optional[Any]
    error: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    model_config = {"from_attributes": True}
```

That's the entire backend delta. Everything else below is pure Flutter.

---

## 1. Verified backend API contract (ground truth)

Two base URLs. On a physical device use the dev machine's **LAN IP** (not `localhost`);
on the Android emulator use `10.0.2.2`.

| Concern | Method & path | Base | Auth | Returns |
|---|---|---|---|---|
| Login | `POST /auth/login` | `:8000` | none | `{access_token, token_type, expires_in}` |
| List pipelines | `GET /pipelines/graph/` | `:8010` | none | `[{id, name, description, input_type, is_active, ...}]` |
| **Trigger (async)** | `POST /v1/process/text/async` | `:8000` | Bearer | `202 {job_id, pipeline, poll_url, stream_url}` *(new, §0.1)* |
| Trigger (blocking) | `POST /v1/process/text` | `:8000` | Bearer | `{job_id, pipeline, result}` *(fallback)* |
| Poll job | `GET /v1/jobs/{id}` | `:8000` | Bearer | `{job_id, status, pipeline[], current_step, result, error, created_at, updated_at}` |
| Poll steps | `GET /v1/jobs/{id}/steps` | `:8000` | Bearer | `[{id, step_name, agent_name, status, input, output, error, started_at, completed_at}]` |
| (stretch) SSE | `GET /v1/jobs/{id}/stream?token=<jwt>` | `:8000` | query token | `event: job.started/step.started/step.completed/job.completed/...` |

**Request bodies**
- Login: `{"username": "admin", "password": "12345678"}`
- Trigger: `{"text": "<scenario>", "pipeline_id": "<uuid>"}` (`model_name`/`target_lang` optional, ignore)

**Job `status` values:** `pending`, `in_progress`, `completed`, `failed`, `timed_out`.
Terminal = `{completed, failed, timed_out}`.

**Auth header:** `Authorization: Bearer <access_token>` on everything except login & pipeline-list.

---

## 2. Data shapes the UI consumes

### 2.1 Each agent's `output` (per `epidemic_simulator_plan.md` Phase 3)

| Agent (`step_name`) | Headline field | Full output keys |
|---|---|---|
| `Epidemiologist` | `recommendation` | recommendation, target_entities[], metric_constraint, projected_icu_breach_days, confidence |
| `EconomicImpact` | `action` (+ `amendment`) | action (ACCEPT/VETO_HARD_LOCKDOWN/AMEND), amendment, economic_metric, recommendation, confidence |
| `CitizenCompliance` | `projected_compliance_pct` | warning, proposal, requirement, projected_compliance_pct, recommendation, confidence |
| `SupplyChain` | `critical_override` | critical_override, inventory_warning, target_action, recommendation, confidence |
| `HealthcareOps` | `policy_amendment` | policy_amendment, workforce_constraint, intervention_type, recommendation, confidence |

### 2.2 Final aggregator `result` (per Phase 4 synthesis prompt)

```json
{
  "policy": "string — the agreed containment policy",
  "rationale": "string",
  "icu_ok": true,
  "economy_ok": true,
  "compliance_pct": 55,
  "supply_ok": true,
  "equilibrium_reached": "true",
  "_conflicts": [ { "field": "recommendation", "agents": ["Epidemiologist","EconomicImpact"], "...": "..." } ],
  "_sources": [ ... ],
  "confidence": 0.9
}
```
Note `equilibrium_reached` is a **string** `"true"`/`"false"`.

### 2.3 Rounds

Each negotiation round re-runs the whole council, so there are multiple `Epidemiologist`
steps (one per round). Group steps by `step.input["_iteration"]`:
`round = (input?["_iteration"] as int) ?? 1`. Round 1 may lack the field → default 1.
*(Confirm the exact base — 1 vs 2 on first loop — during integration.)*

---

## 3. Architecture (Riverpod, feature-first)

```
lib/
  main.dart                       # runApp(ProviderScope(child: CivisApp()))
  app.dart                        # MaterialApp.router, theme, auth-gate redirect
  core/
    config/
      app_config.dart             # base URLs, poll interval, epidemic pipeline name
      theme.dart                  # color scheme, typography, agent palette
    network/
      api_client.dart             # Dio + auth interceptor (injects Bearer, 401 → logout)
      api_exception.dart
    storage/
      token_store.dart            # flutter_secure_storage read/write/clear
  features/
    auth/
      data/auth_repository.dart            # POST /auth/login
      application/auth_controller.dart     # Notifier<AuthState>, login/logout
      domain/auth_state.dart
      presentation/login_screen.dart
    pipeline/
      data/pipeline_repository.dart        # GET /pipelines/graph/, find epidemic id
      application/pipeline_provider.dart   # FutureProvider<String> epidemicPipelineId
      domain/pipeline.dart
    simulation/
      data/simulation_repository.dart      # trigger async, get job, get steps
      domain/
        job.dart
        job_step.dart
        final_policy.dart
        agent_catalog.dart                 # static metadata for the 5 agents
      application/
        simulation_controller.dart         # AsyncNotifier<SimulationState>, poll loop
        simulation_state.dart
      presentation/
        command_center_screen.dart
        widgets/
          scenario_input.dart
          round_section.dart
          agent_card.dart
          constraint_badges.dart
          conflict_list.dart
          equilibrium_banner.dart
          final_policy_card.dart
  shared/widgets/                          # status dot, loading shimmer, pill, etc.
```

**Provider graph**
- `tokenStoreProvider` → `apiClientProvider` (reads token) → repositories.
- `authControllerProvider : NotifierProvider<AuthController, AuthState>`.
- `epidemicPipelineIdProvider : FutureProvider<String>` (resolves once, cached).
- `simulationControllerProvider : AsyncNotifierProvider<SimulationController, SimulationState>`.

---

## 4. Domain models (Dart)

```dart
// pipeline.dart
class Pipeline {
  final String id, name;
  final String? description;
  final bool isActive;
  factory Pipeline.fromJson(Map<String, dynamic> j) => Pipeline(
    id: j['id'], name: j['name'],
    description: j['description'], isActive: j['is_active'] ?? false);
}

// job_step.dart
enum StepStatus { pending, inProgress, completed, failed }

class JobStep {
  final int id;
  final String stepName;
  final String? agentName;
  final StepStatus status;
  final Map<String, dynamic>? input;
  final Map<String, dynamic>? output;
  final String? error;

  int get round => (input?['_iteration'] as num?)?.toInt() ?? 1;
  factory JobStep.fromJson(Map<String, dynamic> j) => ...;
}

// job.dart
class Job {
  final String jobId, status;       // pending | in_progress | completed | failed | timed_out
  final String? currentStep, error;
  final Map<String, dynamic>? result;
  bool get isTerminal =>
      const {'completed','failed','timed_out'}.contains(status);
}

// final_policy.dart  (parsed from Job.result)
class FinalPolicy {
  final String policy, rationale;
  final bool icuOk, economyOk, supplyOk, equilibriumReached;
  final int compliancePct;
  final double confidence;
  final List<PolicyConflict> conflicts;
  factory FinalPolicy.fromResult(Map<String, dynamic> r) => FinalPolicy(
    policy: r['policy'] ?? '',
    rationale: r['rationale'] ?? '',
    icuOk: r['icu_ok'] == true,
    economyOk: r['economy_ok'] == true,
    supplyOk: r['supply_ok'] == true,
    compliancePct: (r['compliance_pct'] as num?)?.toInt() ?? 0,
    equilibriumReached: r['equilibrium_reached'].toString() == 'true',
    confidence: (r['confidence'] as num?)?.toDouble() ?? 0,
    conflicts: (r['_conflicts'] as List? ?? []).map(PolicyConflict.fromJson).toList(),
  );
}

// agent_catalog.dart — static metadata, drives card visuals
class AgentMeta {
  final String key, displayName, role, headlineField;
  final Color color; final IconData icon;
}
const kAgents = <String, AgentMeta>{
  'Epidemiologist':    AgentMeta('Epidemiologist','Pandemic Modeler','recommendation', Colors.red, Icons.coronavirus),
  'EconomicImpact':    AgentMeta('Economist','Finance Minister','action', Colors.amber, Icons.payments),
  'CitizenCompliance': AgentMeta('Behavioral Sci','Social Psychologist','projected_compliance_pct', Colors.teal, Icons.groups),
  'SupplyChain':       AgentMeta('Logistics','Supply Coordinator','critical_override', Colors.indigo, Icons.local_shipping),
  'HealthcareOps':     AgentMeta('Medical Director','Hospital Ops','policy_amendment', Colors.green, Icons.local_hospital),
};
```

---

## 5. Simulation state machine (the core)

```dart
enum SimPhase { idle, triggering, running, completed, failed }

class SimulationState {
  final SimPhase phase;
  final String? jobId;
  final String jobStatus;             // mirrors backend status
  final List<JobStep> steps;
  final FinalPolicy? finalPolicy;
  final String? error;

  // derived
  Map<int, List<JobStep>> get byRound { ... };   // group steps by round, ordered
  int get currentRound => byRound.keys.isEmpty ? 1 : byRound.keys.reduce(max);
}
```

`SimulationController extends AsyncNotifier<SimulationState>`:
- `Future<void> trigger(String scenario)`:
  1. `phase = triggering`
  2. `final pid = await ref.read(epidemicPipelineIdProvider.future);`
  3. `final res = await repo.triggerAsync(scenario, pid);  // {job_id}`
  4. `phase = running`, store `jobId`, start `Timer.periodic(1.5s, _tick)`
- `_tick()`:
  1. `final job = await repo.getJob(jobId);`
  2. `final steps = await repo.getSteps(jobId);`
  3. emit updated state (`steps`, `jobStatus = job.status`)
  4. if `job.isTerminal`: cancel timer; if completed → `finalPolicy = FinalPolicy.fromResult(job.result)`, `phase = completed`; else `phase = failed`, `error = job.error`
- `reset()`: cancel timer → fresh `idle` state.
- Always cancel the timer in `ref.onDispose`.

Guard against overlapping ticks (skip a tick if the previous request is still in flight).

---

## 6. Screens & widgets (phone portrait)

### LoginScreen
Centered card: title, username + password fields, "Log in" button, inline error.
Prefill `admin` / `12345678` for the demo. On success → CommandCenter.

### CommandCenterScreen (main)
```
┌──────────────────────────────┐
│ CIVIS · Epidemic Council  ●  │  ← AppBar + system status dot, overflow: Logout
├──────────────────────────────┤
│ ScenarioInput                │  ← multiline TextField
│  [chip: Load sample R0=2.5]  │  ← fills the influenza scenario
│  [ Run Simulation ]          │  ← disabled while running
├──────────────────────────────┤
│ ── Round 1 ───────────────── │  ← RoundSection header (only when running/done)
│  ▸ Epidemiologist   conf .95 │  ← AgentCard: icon, name, headline value, confidence,
│  ▸ Economist  VETO  conf .92 │     status chip (pending→pulsing / running / ✓ done)
│  ▸ Behavioral   42% comply   │
│  ▸ Logistics  override       │
│  ▸ Medical Dir  schools amend│
│ ── Round 2 ───────────────── │
│  ...                         │
├──────────────────────────────┤
│ ⚑ Consensus reached (R2)     │  ← EquilibriumBanner (green) / "Capped at 3 rounds" (amber)
│ ┌ Final Policy ───────────┐  │  ← FinalPolicyCard
│ │ <policy text>           │  │
│ │ ICU ✓  Econ ✓  55% ✓ Sup✓│  │  ← ConstraintBadges
│ │ Conflicts resolved: ... │  │  ← ConflictList (A vs E schools, A vs B transit)
│ │ rationale…  conf 0.90   │  │
│ └─────────────────────────┘  │
│              [ Reset ]       │
└──────────────────────────────┘
```

**AgentCard** maps `step.status` → visual: `pending` (greyed, dotted), `in_progress`
(colored border + pulse/shimmer), `completed` (full color + check, shows headline value
from `output[meta.headlineField]` + confidence), `failed` (red).

**ConstraintBadges** — 4 pills from FinalPolicy: ICU, Economy, Compliance (shows `%`),
Supply. Green check if ok, red if not.

**ConflictList** — render `_conflicts[]`: "*Schools*: Epidemiologist (close all) vs
HealthcareOps (keep primary open)". This is the money shot — make it prominent.

**EquilibriumBanner** — green "Consensus reached in Round N" if `equilibriumReached`,
else amber "No consensus — capped at 3 rounds".

---

## 7. Phase-wise build plan

| Phase | Effort | Deliverable / DoD |
|---|---|---|
| **0 — Backend prep** | 0.5h | Async endpoint (§0.1) + `input` on JobStepResponse (§0.2). `curl` the async endpoint → 202 with `job_id`; `/steps` returns `input`. |
| **1 — Scaffold & config** | 0.5h | `flutter create`, pubspec deps, `app_config.dart` (base URLs + poll interval), theme + agent palette, `token_store`. App boots to a placeholder. |
| **2 — Networking & auth** | 1h | `ApiClient` (Dio + Bearer interceptor, 401→logout), `AuthRepository`, `AuthController`, `LoginScreen`. **DoD:** login persists JWT, relaunch stays logged in, logout clears. |
| **3 — Pipeline discovery** | 0.5h | `PipelineRepository.list()` → find `epidemic_containment` → `epidemicPipelineIdProvider`. **DoD:** app resolves the pipeline UUID at startup. |
| **4 — Models & repo** | 1h | All domain models + `SimulationRepository` (triggerAsync, getJob, getSteps). **DoD:** a temporary debug button triggers a job and prints steps. |
| **5 — Simulation controller** | 1.5h | `SimulationController` AsyncNotifier with the 1.5s poll loop, round grouping, terminal detection, finalPolicy parse, reset. **DoD:** state goes idle→running→completed against a live backend. |
| **6 — Live timeline UI** | 2h | `ScenarioInput`, `RoundSection`, `AgentCard` with status animation. **DoD:** agents light up round-by-round during a real run. |
| **7 — Final policy UI** | 1.5h | `EquilibriumBanner`, `ConstraintBadges`, `ConflictList`, `FinalPolicyCard`. **DoD:** final decision + conflicts render clearly on completion. |
| **8 — Polish & demo** | 1.5h | Sample-scenario chip, reset, loading/error/empty states, app icon + splash, status dot, animations. **DoD:** clean end-to-end demo on a phone. |
| **9 — Stretch** | — | SSE upgrade for instant transitions; job history list; per-agent detail bottom sheet; QR login. |

**Critical path:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. **Total ≈ 10h** (~1.5 days).
Only Phase 0 touches backend (additive). Phases 1–9 are the Flutter app.

---

## 8. pubspec dependencies

```yaml
dependencies:
  flutter_riverpod: ^2.5.0
  dio: ^5.4.0
  flutter_secure_storage: ^9.0.0
  google_fonts: ^6.2.0
  intl: ^0.19.0
  # stretch: qr_code_scanner / mobile_scanner (only if QR login)
```

`app_config.dart`:
```dart
class AppConfig {
  // Physical device: dev-machine LAN IP. Android emulator: 10.0.2.2.
  static const orchestratorBase = 'http://192.168.1.X:8000';
  static const configServiceBase = 'http://192.168.1.X:8010';
  static const epidemicPipelineName = 'epidemic_containment';
  static const pollInterval = Duration(milliseconds: 1500);
}
```
> Native mobile makes raw HTTP — **no CORS** concern. (Only Flutter *web* would need backend CORS.)
> Android cleartext HTTP: add `android:usesCleartextTraffic="true"` for the dev LAN IP.

---

## 9. Sample scenario (demo seed)

> "A new influenza variant with an estimated R0 of 2.5 has been detected spreading
> through public transit hubs in a city of 5 million people."

Expected arc: Round 1 — Epidemiologist demands hard lockdown; Economist VETOs (→30%
transit cap); Behavioral flags Day-10 compliance break; Logistics issues a 7-day mask
override; Medical Dir keeps primary schools open. Aggregator flags conflicts (**Schools:**
A vs E, **Transit:** A vs B). Round 2 — council converges on the amended policy →
`equilibrium_reached = "true"`, constraint badges green.

---

## 10. Demo script (maps to scoring rubric)

1. **Why multiple agents** — one specialist's narrow JSON can't hold all five expert lenses.
2. **Each agent's skill** — point at the 5 cards, distinct roles/colors.
3. **Influence & conflict (40% money shot)** — Round 1 disagreement → `_conflicts` → Round 2
   re-negotiation → consensus banner. Show the Schools (A vs E) and Transit (A vs B) resolution.
4. **What's lost without an agent** — (stretch) disable one in ConfigService, rerun, show the blind spot.
5. **Planned vs executed** — this app = the Agent Trace View; extension = SSE/live tokens.

---

## 11. Open items to confirm at integration
- Exact `_iteration` base value (1 on first council run, or only set from round 2+).
- `ProcessingHelper.process` persists the `jobs` row before returning (needed for async polling).
- Final aggregator field names match §2.2 once the PolicyAggregator is live (they come from
  its `synthesis_prompt`).
- Dev-machine LAN IP for `app_config.dart`.
