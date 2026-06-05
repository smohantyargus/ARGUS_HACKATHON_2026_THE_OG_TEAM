# migrations

> **Status:** Active
> **Flavor:** data
> **Path:** `migrations/*.sql`
> **Owner:** [[ConfigService]] tables only (`Base` metadata)

---

## Role

Raw SQL migrations for ConfigService-owned tables. Applied **manually** against `app-db`. Separate from [[OrchestratorAgent]] migrations, which are Alembic-driven and auto-run on container start.

Schema split:

| Owner | Migration system | Auto-applied? |
|---|---|---|
| OrchestratorAgent (`AppBase`) | Alembic (`OrchestratorAgent/alembic/`) | Yes, via `entrypoint.sh` |
| ConfigService (`Base`) | Raw SQL here + `create_all()` on boot | Partial — `create_all()` doesn't ALTER existing tables; SQL files needed for column adds, constraint changes, backfills |

---

## Files (current set)

| File | Purpose |
|---|---|
| `phase_a_alter.sql` | ALTER TABLE for Phase A columns (`agent_registry`, `jobs`) |
| `add_edge_type.sql` | Add `edge_type` to `pipeline_edges`; backfill from `is_parallel` + `wait_for_group` (I6) |
| `add_generic_agent_to_pipeline_nodes.sql` | `generic_agent_id`, `merger_id`, `node_agent_type`, `input_type` columns |
| `add_pipeline_node_agent_check.sql` | CHECK constraint on `agent_id` / `generic_agent_id` / `merger_id` exclusivity |
| `add_prompt_template_fields.sql` | `input_variables`, `output_schema` on `prompt_templates` |
| `add_nav_item_is_external.sql` | `is_external` on `navigation` |
| `add_webhook_secret_notnull.sql` | Backfill `NULL` secrets + set NOT NULL on `webhooks.secret` (I10.3) |
| `add_aggregator_node.sql` | `aggregator_id` on `pipeline_nodes` (AG-1) |

Some of these touch `AppBase` tables (e.g. `webhooks.secret`) where the change is operationally simpler as raw SQL than authoring an Alembic revision — pragmatic exceptions to the owner split.

---

## Apply

```bash
docker exec -i app-db psql -U civis -d civis < migrations/<file>.sql
```

`docker exec -i` is required so the SQL file streams via stdin.

### Apply order (when bringing up a fresh DB after seed)

Logical order (newer migrations may assume earlier ones):

1. `phase_a_alter.sql`
2. `add_prompt_template_fields.sql`
3. `add_generic_agent_to_pipeline_nodes.sql`
4. `add_pipeline_node_agent_check.sql`
5. `add_edge_type.sql`
6. `add_aggregator_node.sql`
7. `add_nav_item_is_external.sql`
8. `add_webhook_secret_notnull.sql`

In practice, ordering is forgiving because each file is idempotent (`IF NOT EXISTS` guards) — but ALTER + CHECK constraint files should run after the columns they reference exist.

---

## Conventions

Every file in `migrations/` should:

1. Use `IF NOT EXISTS` for table / column / index creation
2. Use `IF EXISTS` for drops
3. Wrap CHECK constraint adds in `DO $$` blocks so re-runs don't fail
4. Backfill in the same transaction as a NOT NULL flip — never leave NULLs that violate the new constraint
5. Reset sequences after explicit-ID inserts:
   ```sql
   DO $$ BEGIN
     IF to_regclass('public.<table>_id_seq') IS NOT NULL THEN
       PERFORM setval('<table>_id_seq',
         GREATEST((SELECT COALESCE(MAX(id),0) FROM <table>), 1));
     END IF;
   END$$;
   ```

---

## Side Effects

- Postgres schema mutations on `app-db`
- Possibly long-running on large tables (verify locking before applying in prod)
- No app code reload — restart `config-service` if it caches schema

---

## Failure Modes

| Symptom | Cause | Fix |
|---|---|---|
| `Phase A columns missing` | This dir never applied | Run `phase_a_alter.sql` |
| `webhook.secret NULL` | Migration applied to schema but not backfilled | Re-run `add_webhook_secret_notnull.sql` (idempotent) |
| `duplicate key value violates unique constraint` after seed | Sequence not reset after explicit-ID inserts | Add sequence reset block to seed or migration |
| CHECK constraint fails on retry | Constraint already exists with different name | Drop and re-add inside `DO $$` block |
| Long ALTER blocks production | Locking heavy table | Use `ALTER TABLE ... ADD COLUMN ... NULL` first; backfill; then `SET NOT NULL` |

---

## PHI Surface

**None.** Schema definitions only. **Never** put PHI in migration files (no inline patient data, no real test payloads — use synthetic fixtures).

---

## Common Change Recipes

### Add a column to a ConfigService table
1. New file: `migrations/add_<column>_to_<table>.sql`
2. `ALTER TABLE <t> ADD COLUMN IF NOT EXISTS <col> <type>;`
3. (Optional) backfill, then `ALTER ... SET NOT NULL`
4. Update SQLAlchemy model in `ConfigService/app/models/<table>.py`
5. Mention the file in [[ConfigService]] `SERVICE.md` table list
6. Apply manually against running stack; commit file

### Change owner from ConfigService to Orchestrator
- Cross-owner moves are app-layer-only FKs (no DB constraint); migrate carefully — copy data, then drop the old table

### Switch to Alembic for ConfigService (future)
- Would require generating a baseline against the current schema, then converting these SQL files into Alembic revisions
- Not planned today; the manual SQL flow is acceptable for the rate of change

---

## Cross-links

- [[ConfigService]] — owner of the tables these migrate
- [[OrchestratorAgent]] — owns Alembic-driven migrations under `OrchestratorAgent/alembic/versions/`
- [`CLAUDE.md`](../CLAUDE.md) — full migration list + apply notes
