---
task_id: "Task-019"
branch: "task/019-name-registry-hygiene"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/registry/**"
  - "packages/db/tests/registry/**"
  - ".agent-handoffs/task-019.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 019 handoff

Resource-name registry, prefix enforcement, parameterized route shadowing, wildcard overlap, code-to-registry audit, and `relations_in_fields` normalization. Commit stays on `task/019-name-registry-hygiene`.

## Exports Provided

Import from `packages/db/src/registry/index.ts` until the package barrel is wired.

- `NameRegistryService` with `allocateFeaturePrefix`, `validatePublishedNames`, `validateNamePrefixOwnership`, `detectRouteShadowing`, `detectWildcardOverlap`, `auditCodeNamesAgainstRegistry`, `assertNoRelationsInFields`, `publishNode`, and `retireNode`
- `createNameRegistryService`
- `RouteSegmentParser` (`parse`, `canonicalize`) and `detectRouteShadowing`
- `RelationsNormalizer` (`normalize`), `normalizeRelations`, and `RELATION_FIELD_TO_EDGE_TYPE` (`consumes` maps to edge type `consumes_contract`)
- `NAME_KINDS` (the Task 010 tuple), plus `DuplicateLogicalNameError`, `PrefixOverlapError`, `ForeignPrefixError`, `UnallocatedPrefixError`, `RouteShadowError`, `WildcardOverlapError`, `CodeNameAuditError`, `RelationsInFieldsError`, and `DanglingRelationError`
- `openMemoryStateDb` and `relationsInFieldsSql` (the latter reads `relations_in_fields` verbatim from `schema/queries.sql`)

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's write scope. When wiring the barrel, re-export the registry entry points:

```ts
export {
  NameRegistryService,
  createNameRegistryService,
  RouteSegmentParser,
  detectRouteShadowing,
  RelationsNormalizer,
  normalizeRelations,
  RELATION_FIELD_TO_EDGE_TYPE,
  NAME_KINDS,
  openMemoryStateDb,
  DuplicateLogicalNameError,
  RouteShadowError,
  CodeNameAuditError,
  RelationsInFieldsError,
} from "./registry/index.js";
```

When Task 010 lands, replace the local `NAME_KINDS` tuple in `packages/db/src/registry/name-kinds.ts` with the shared-contracts barrel export if that barrel publishes the same list. Do not keep two divergent copies.

`NameRegistryService` binds the `node:sqlite` `DatabaseSync` writer that `ProjectStateDb` (Task 013) will own. That connection must already have `schema/state.sql` applied, `PRAGMA foreign_keys = ON`, and `ef_search_text` registered (Task 012). `openMemoryStateDb` does those three steps for tests and local callers.

## Dependency Intents (New Packages Requested)

None yet.

## Contract Change Requests

None yet.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-019-name-registry-hygiene`:

- `pnpm --filter @ef-harness/db test -- registry` — 24 passed (1 file).
- `pnpm --filter @ef-harness/db typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/db lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 019` — passed (`harmony ok for Task-019`).

## Known Limitations / Follow-Ups

- Task 010 and Task 013 are not on `harness/integration`, so `NAME_KINDS` is the required Task 010 tuple kept locally, and the service takes a `DatabaseSync` writer rather than a `ProjectStateDb` class.
- Page routes are case-insensitive together with HTTP routes. `db_index` and `db_constraint` are case-folded with tables and columns so SQLite identifier case cannot register two logical names.
- `publishNode` replaces `fields` with the normalized payload. It does not merge onto the previous version's JSON.
- Exact canonical duplicates are left to the `names` primary key and wrapped as `DuplicateLogicalNameError` (the SQLite message is `cause`). Case or slash variants that are not the stored bytes are rejected before insert.
- Same-feature static and dynamic routes coexist only when one side sets `explicitOrder: true`. Equivalent parameter syntax (`[id]`, `:id`, `{id}`, and a single-segment `*`) always conflicts. A cross-feature catch-all always conflicts.
- `json_each` on omitted `$.names` and on `[]` inserts nothing. `names: null` makes the trigger insert a null kind and SQLite raises `NOT NULL`. `publishNode` omits a null or empty list so the trigger stays on the safe path.
