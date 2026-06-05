# Multi-Domain Data Platform — Configurable Data Dictionary + CRUD APIs

## Goal

Stop hardcoding civic tables. Make the **schema itself data** (a per-domain *data dictionary*),
store records generically, and drive everything — validation, CRUD, agent reads — from config.
Civic stops being special; it becomes the **first seeded domain**. New domains (finance, logistics,
clinical, energy…) are added at runtime through APIs — no SQLAlchemy models, no migration, no
container rebuild.

Supersedes `civic_data_crud_plan.md`: the six civic tables + expanded fields from that plan become
**dictionary rows**, not columns. Same owner (`DataQueryAgent`), same JWT-gated REST lane, same
Kafka read path — generalized.

---

## Core idea — schema-as-data

```
DOMAIN ─┬─ ENTITY DEFINITIONS  (what "tables" exist)      ← data dictionary
        ├─ FIELD DEFINITIONS   (columns + type/validation)   (config, CRUD-able)
        ├─ QUERY DEFINITIONS   (named read-only queries)
        └─ RECORDS             (actual JSONB rows, validated against dictionary)
```

Add a domain → POST a domain + its entities + fields. Records validated against that dictionary on
write. Agents read via registered query keys. Zero code per new domain.

### Phase 0 — Decisions to lock
| Question | Recommended |
|---|---|
| Storage model | **Generic JSONB store** (`domain_records.data JSONB`) validated by dictionary. Flexible, no per-domain DDL. Alt = native tables per entity (rejected: needs runtime DDL, risky). |
| Validation strictness | Strict by default — unknown fields rejected, required enforced, types/bounds checked from dictionary. Per-entity `strict=false` escape hatch for freeform. |
| Civic migration | Re-seed civic as a domain via dictionary + records (drop the 6 native tables, or keep read-only during cutover). |
| Query surface | Config-driven `query_definitions` (whitelist stays) + a generic `query_records` filter API. |
| Tenancy | Per-domain membership. Tenant = existing JWT user (reuse login/auth — do **not** build a new user system). Cross-domain access → 403. Superadmin sees all. |

---

## Phase 1 — Schema-as-data tables

New `DomainBase` models in `DataQueryAgent/app/db/models.py` (replace the 6 civic models):

```python
class Domain(DomainBase):
    __tablename__ = "domains"
    domain_key  = Column(String(50), primary_key=True)      # "civic", "finance"
    name        = Column(String(200), nullable=False)
    description = Column(Text)
    status      = Column(String(20), default="active")      # active | draft | archived
    owner_user_id = Column(String(64), index=True)          # JWT sub of creator (tenant owner)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class DomainMember(DomainBase):
    __tablename__ = "domain_members"
    id         = Column(Integer, primary_key=True, autoincrement=True)
    domain_key = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    user_id    = Column(String(64), index=True)             # JWT sub
    role       = Column(String(20), default="viewer")       # owner | editor | viewer
    __table_args__ = (UniqueConstraint("domain_key", "user_id"),)

class EntityDefinition(DomainBase):
    __tablename__ = "entity_definitions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    domain_key    = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    entity_key    = Column(String(80), nullable=False)      # "icu_capacity", "region"
    display_name  = Column(String(200))
    description   = Column(Text)
    is_root       = Column(Boolean, default=False)          # region-like top of hierarchy
    parent_entity = Column(String(80))                      # entity_key of parent (same domain)
    strict        = Column(Boolean, default=True)
    __table_args__ = (UniqueConstraint("domain_key", "entity_key"),)

class FieldDefinition(DomainBase):
    __tablename__ = "field_definitions"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    entity_id     = Column(Integer, ForeignKey("entity_definitions.id", ondelete="CASCADE"), index=True)
    field_key     = Column(String(80), nullable=False)      # "total_beds"
    data_type     = Column(String(20), nullable=False)      # string|int|float|bool|datetime|enum|json|ref
    required      = Column(Boolean, default=False)
    default_value = Column(JSON)
    enum_values   = Column(JSON)                            # data_type=enum
    ref_entity    = Column(String(80))                      # data_type=ref → entity_key
    min_value     = Column(Float)                           # numeric bound
    max_value     = Column(Float)
    max_length    = Column(Integer)                         # string bound
    unit          = Column(String(40))                      # "beds", "usd" (display/LLM hint)
    description   = Column(Text)
    __table_args__ = (UniqueConstraint("entity_id", "field_key"),)

class DomainRecord(DomainBase):
    __tablename__ = "domain_records"
    id            = Column(Integer, primary_key=True, autoincrement=True)
    domain_key    = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"))
    entity_key    = Column(String(80), nullable=False)
    record_key    = Column(String(120))                     # natural key, e.g. "metro" (optional)
    parent_id     = Column(Integer, ForeignKey("domain_records.id", ondelete="CASCADE"))  # hierarchy
    data          = Column(JSONB, nullable=False)           # validated against field_definitions
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    __table_args__ = (
        Index("ix_records_domain_entity", "domain_key", "entity_key"),
        Index("ix_records_data_gin", "data", postgresql_using="gin"),
    )

class QueryDefinition(DomainBase):
    __tablename__ = "query_definitions"
    id          = Column(Integer, primary_key=True, autoincrement=True)
    domain_key  = Column(String(50), ForeignKey("domains.domain_key", ondelete="CASCADE"), index=True)
    query_key   = Column(String(80), nullable=False)        # "icu_capacity_by_region"
    entity_key  = Column(String(80), nullable=False)
    filter_spec = Column(JSON)     # {"region_id": "{{region}}"} → JSONB/record_key filters
    projection  = Column(JSON)     # ["total_beds","occupied_beds"] (null = all)
    join_spec   = Column(JSON)     # optional: pull child entities (region_snapshot style)
    description = Column(Text)
    __table_args__ = (UniqueConstraint("domain_key", "query_key"),)
```

Migration `backend/migrations/multi_domain_platform.sql` — idempotent `CREATE TABLE IF NOT EXISTS`
for the five; `create_all()` in `seed.py` covers fresh boots.

---

## Phase 2 — Dictionary validation engine

`app/services/dictionary.py`:
- `load_entity(domain_key, entity_key)` → entity + its field defs (cache, invalidate on dict write).
- `validate_record(domain_key, entity_key, data)` → builds checks from field defs:
  type coercion, `required`, `min/max`, `max_length`, `enum_values`, `ref` existence, strict-mode
  unknown-field rejection. Returns cleaned `data` or raises `DictionaryValidationError` (→ 422).
- Optionally build a dynamic Pydantic model per entity from field defs (cached) for speed + clean errors.

This is the heart: every record write goes through it, so JSONB stays well-formed per the dictionary.

---

## Phase 2.5 — Tenancy & tenant onboarding (basic)

Tenant = an existing JWT user (login/auth already issues HS256 tokens with `sub` + `role`). **No new
user system, no orgs, no billing, no email invites.** Just map users → domains with a role.

### Access dependency (replaces blanket `require_write_auth` on domain-scoped routes)
`app/core/auth.py`:
```python
def _claims(creds) -> dict:            # decode JWT → {sub, role}; 401 if bad (existing logic)
    ...

def require_domain_access(level: str):  # level = "view" | "edit"
    def dep(domain_key: str, creds = Depends(_bearer)) -> dict:
        c = _claims(creds)
        if c["role"] == "superadmin":
            return c                                   # superadmin → all domains
        m = db.query(DomainMember).filter_by(domain_key=domain_key, user_id=c["sub"]).first()
        if not m:
            raise HTTPException(403, "No access to this domain")
        if level == "edit" and m.role not in ("owner", "editor"):
            raise HTTPException(403, "Edit role required")
        return c
    return dep
```
- GET (dictionary/records/queries under `/{domain_key}/`) → `require_domain_access("view")`.
- POST/PATCH/DELETE → `require_domain_access("edit")`.
- `GET /api/data/domains` → list filtered to caller's memberships (superadmin = all).
- Create domain → caller auto-inserted as `DomainMember(role="owner")` + `domains.owner_user_id`.

### Onboarding endpoints (the whole feature — small)
```
POST   /api/data/domains/{domain_key}/members      {user_id, role}   add teammate   [owner/superadmin]
GET    /api/data/domains/{domain_key}/members                         list members   [view]
PATCH  /api/data/domains/{domain_key}/members/{user_id}  {role}        change role    [owner/superadmin]
DELETE /api/data/domains/{domain_key}/members/{user_id}                revoke         [owner/superadmin]

# one-call onboard: create domain + owner + optional dictionary bundle
POST   /api/data/onboard   {domain_key, name, owner_user_id?, dictionary?}
```
`onboard` = create domain (owner = `owner_user_id` or caller) + owner membership + optional dictionary
import in one call. That's the entire onboarding surface — basic by design.

### Concurrency note
User A on domain A + User B on domain B run fully parallel — stateless service, Postgres MVCC,
membership filter is per-row. No cross-tenant bleed; dictionary cache keyed `(domain_key, entity_key)`.

> **Out of scope (flagged):** agent Kafka reads have no user context — `domain` comes from
> `AgentDefinition.data_queries`. Tenant isolation on the agent lane = pipeline/job ownership in the
> orchestrator, not this service.

---

## Phase 3 — Dictionary CRUD APIs (manage schema)

`app/api/routes/dictionary_routes.py`. Domain-scoped routes use `require_domain_access` (Phase 2.5):
GET → `view`, writes → `edit`. `/api/data/domains` collection is membership-filtered. Prefix `/api/data`.

```
# domains
GET    /api/data/domains
POST   /api/data/domains
GET    /api/data/domains/{domain_key}
PATCH  /api/data/domains/{domain_key}
DELETE /api/data/domains/{domain_key}            # cascades entities+fields+records

# entities (data dictionary)
GET    /api/data/domains/{domain_key}/entities
POST   /api/data/domains/{domain_key}/entities
GET    /api/data/domains/{domain_key}/entities/{entity_key}
PATCH  /api/data/domains/{domain_key}/entities/{entity_key}
DELETE /api/data/domains/{domain_key}/entities/{entity_key}

# fields
GET    /api/data/domains/{domain_key}/entities/{entity_key}/fields
POST   /api/data/domains/{domain_key}/entities/{entity_key}/fields
PATCH  .../fields/{field_key}
DELETE .../fields/{field_key}

# query definitions
GET    /api/data/domains/{domain_key}/queries
POST   /api/data/domains/{domain_key}/queries
PATCH  /api/data/domains/{domain_key}/queries/{query_key}
DELETE /api/data/domains/{domain_key}/queries/{query_key}

# whole-dictionary import/export (one-call domain bootstrap)
GET    /api/data/domains/{domain_key}/dictionary     # domain+entities+fields+queries bundle
POST   /api/data/domains/import                       # create domain from a bundle
```

Guard: deleting/altering a field that records use → warn (count affected) or block; pick in Phase 0.

---

## Phase 4 — Records CRUD APIs (manage data)

`app/api/routes/record_routes.py` — generic, dictionary-validated:

```
GET    /api/data/{domain_key}/{entity_key}                 # list, ?<field>=<val> filters, ?parent=<id>
GET    /api/data/{domain_key}/{entity_key}/{id}
POST   /api/data/{domain_key}/{entity_key}                 # validate_record → 422 on bad shape   [auth]
PATCH  /api/data/{domain_key}/{entity_key}/{id}            # partial, re-validate merged data     [auth]
DELETE /api/data/{domain_key}/{entity_key}/{id}            # cascades children via parent_id       [auth]

# convenience: seed a whole root + children in one call (new scenario in one POST)
POST   /api/data/{domain_key}/{entity_key}/bulk
```

- Filters compile to JSONB ops (`data->>'field' = :val`) + `record_key`/`parent_id` columns.
- POST validates entity exists in dictionary, `ref` fields resolve, parent exists.
- All record routes domain-scoped via `require_domain_access` (view/edit) — caller only touches domains they're a member of.
- Sync `def` handlers + `Depends(get_db)` → FastAPI threadpool, never blocks Kafka loop.

---

## Phase 5 — Dynamic query resolver (agent read path)

Replace hardcoded `NAMED_QUERIES` dict with a resolver over `query_definitions`:

`app/services/query_resolver.py`:
- `run_query(domain_key, query_key, params)`:
  1. load `QueryDefinition` (404/`status:"error"` if absent → whitelist preserved: only registered keys run).
  2. render `filter_spec` from `params` (bound, never string-formatted).
  3. build JSONB SELECT on `domain_records` (+ `join_spec` to merge children → `region_snapshot` style).
  4. apply `projection`. Return rows.

Kafka envelope gains **`domain`**:
- in:  `{request_id, job_id, reply_topic, domain, query_name, params}`
- out: `{request_id, job_id, domain, query_name, status, rows, error}`

`DataQueryAgent.process()` routes via `run_query(domain, query_name, params)`. Read path still
read-only + whitelist (now config whitelist).

Also expose a **generic ad-hoc query** (optional, JWT-gated): `POST /api/data/{domain}/query`
`{entity, filters, projection}` for tooling — separate from the agent whitelist path.

---

## Phase 6 — request_data + GenericAgentV2 domain-aware

- `civis_obs.request_data(query_name, params, *, domain, job_id=None, timeout=5.0)` — add `domain`,
  put it in the envelope. Default `domain="civic"` for back-compat.
- `agent_definitions.data_queries` items gain `domain`:
  `{"domain": "civic", "query_name": "icu_capacity_by_region", "params": {"region": "{{region}}"}}`.
- `GenericAgentV2._fetch_data` passes `domain` through. No other agent change — rows still land as `{{data}}`.

---

## Phase 7 — Seed civic as a domain

`seed.py` `create_and_seed()` now inserts:
1. `Domain("civic", ...)`.
2. `EntityDefinition` rows: `region` (root), `icu_capacity`, `economic_indicators`, `supply_inventory`,
   `compliance_metrics`, `healthcare_ops`, `epidemic_indicators`, `sector_impact`, `supply_routes`,
   `intervention_log` (the expanded set from `civic_data_crud_plan.md`).
3. `FieldDefinition` rows = every column from that plan (type/required/unit/bounds).
4. `QueryDefinition` rows: `icu_capacity_by_region`, `region_snapshot`, etc. (same keys agents use).
5. `DomainRecord` rows: the `metro` scenario data.
Idempotent (skip if domain `civic` present).

Ship a second tiny demo domain (e.g. `finance` with `portfolio`/`risk_metric`) to prove
multi-domain in one POST bundle.

---

## Phase 8 — Wiring

- **nginx**: proxy `/api/data/` → `data_query_agent:8020` (mirror `config-service`); forward `Authorization`.
- **compose**: `data_query_agent` gets `JWT_SECRET`; `QUERY_DB_URL` read-write (Postgres for JSONB/GIN).
- **services.yaml**: bump description → "Multi-domain data platform: dictionary + records CRUD + agent query bus".
- **topics**: `data.request`/`data.response` unchanged (envelope adds `domain`).

---

## Phase 9 — Frontend admin (optional)

`admin/frontend` "Data Platform" page:
- Domain switcher.
- **Dictionary editor**: add entity, add/edit fields (type/required/enum/bounds) — builds the schema.
- **Records editor**: forms auto-generated *from the dictionary* (no hardcoded fields) → CRUD records.
- Edit a value live, re-run pipeline, watch specialists shift. Schema-driven forms = zero frontend
  work per new domain.

---

## Phase 10 — Tests & verification

```python
def test_create_domain_entity_fields(): ...
def test_record_rejected_when_required_missing(): ...        # 422
def test_record_rejected_on_enum_violation(): ...            # 422
def test_strict_mode_rejects_unknown_field(): ...            # 422
def test_ref_field_must_resolve(): ...                       # 422
def test_delete_domain_cascades(): ...
def test_query_definition_whitelist_only(): ...              # unknown query_key → error
def test_dict_edit_then_record_accepts_new_field():          # add field → POST with it succeeds
def test_request_data_domain_routing():                      # domain="civic" vs "finance" isolated
def test_edit_record_then_named_query_reflects_it():         # CRUD→agent round-trip
def test_back_compat_default_domain_civic():                 # old data_queries w/o domain still work
# tenancy
def test_non_member_gets_403_on_other_domain(): ...          # user B → domain A = 403
def test_list_domains_filtered_to_memberships(): ...
def test_create_domain_makes_creator_owner(): ...
def test_viewer_cannot_write(): ...                          # 403 on POST
def test_superadmin_sees_all_domains(): ...
def test_onboard_creates_domain_owner_and_dictionary(): ...
```

Manual:
1. `POST /api/data/domains/import` a `finance` bundle → entities/fields/records created, no rebuild.
2. `request_data("risk_metric_by_portfolio", {...}, domain="finance")` → rows.
3. Civic pipeline unchanged: `domain` defaults to civic, specialists still get `{{data}}`.

---

## Rollout summary

| Phase | Effort | Type | Deliverable |
|---|---|---|---|
| 0 — Decisions | 0.25h | ops | Storage=JSONB, strictness, civic cutover |
| 1 — Schema-as-data tables | 1.5h | code | domains/entities/fields/records/queries |
| 2 — Validation engine | 1.5h | code | dictionary-driven record validation |
| 2.5 — Tenancy & onboarding | 1h | code | `domain_members`, `require_domain_access`, member + onboard routes |
| 3 — Dictionary CRUD APIs | 2h | code | manage domains/entities/fields/queries |
| 4 — Records CRUD APIs | 1.5h | code | generic validated record CRUD + bulk |
| 5 — Dynamic query resolver | 2h | code | config queries replace NAMED_QUERIES; domain in envelope |
| 6 — request_data + v2 domain | 0.5h | code | domain-aware fetch, back-compat |
| 7 — Seed civic as domain | 1h | config | civic dictionary + records + demo 2nd domain |
| 8 — Wiring | 0.5h | ops | nginx/compose/auth |
| 9 — Frontend platform admin | 3h | code | schema-driven dict + record editors (optional) |
| 10 — Tests | 1.5h | test | validation + routing + round-trip |

**Total: ~13h core (~16h with frontend).** Net new capability: any domain, defined and populated at
runtime via API, isolated per tenant. Civic = seed data, not code. Agent Kafka contract back-compatible
(`domain` defaults to civic). Critical path: 1 → 2 → 2.5 → 3 → 4 → 5 → 7 → 10.

### Tradeoff (called out)
Generic JSONB store trades native per-column FK/CHECK constraints + typed SQL for runtime flexibility.
Mitigation: dictionary validation engine (Phase 2) enforces types/bounds/refs at the app layer; GIN
index keeps JSONB filters fast. For a domain that later needs heavy relational queries, a materialized
view per entity is the escape hatch — not needed for the agent read patterns here.
```
