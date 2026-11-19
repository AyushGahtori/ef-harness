---
task_id: "Task-017"
branch: "task/017-knowledge-graph-repo"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/db/src/knowledge/**
  - packages/db/tests/knowledge/**
  - .agent-handoffs/task-017.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 017 handoff

`KnowledgeGraphRepo` commits knowledge change sets on their own `BEGIN IMMEDIATE` barrier, keeps temporal node and edge history, validates optimistic read sets, allocates never-reused entity ids, and bounds reverse impact walks. Commit stays on `task/017-knowledge-graph-repo`.

## Exports Provided

`packages/db/src/knowledge/index.ts`:

- `KnowledgeGraphRepo` with `commitChangeSet`, `getNode`, `getNodeAsOf`, `getEdgesAsOf`, `getSnapshotAsOf`, `impactWalk`, `allocateEntityId`, `recordTurn`, `recordEvidence`, `exportDirtyNodes`, `getDirtyNodesSince`, `getEdgeSetVersion`, `currentRevision`, `close`
- `openKnowledgeGraph` — opens `schema/state.sql` on `node:sqlite`, registers `ef_search_text`, and loads `schema/queries.sql`
- `ChangeSetProposal`, `ChangeSetRead`, `CommitChangeSetResult`, `NodeRecord`, `NodeAsOf`, `EdgeAsOf`, `SnapshotPage`, `EdgePage`, `ImpactWalkResult`, `ImpactNode`, `TurnRecord`, `EvidenceRecord`
- `StaleReadSetError` (`entries` are `{ target, readVersion, currentVersion }` for nodes and add `dir` plus `edgeType` for edge sets), `KnowledgeBarrierError`, `InvalidBasisError`, `InvalidProposalError`, `InvalidCursorError`, `NodeVersionGuardError`, `NodeDeletionForbiddenError`, `DanglingReferenceError`, `DuplicateNodeIdError`, `DuplicateCurrentEdgeError`, `DuplicateLogicalNameError`, `EdgeIntervalError`, `EdgeNotCurrentError`, `UnknownNodeError`, `UnknownNodeVersionError`, `QueryCatalogError`, `EntityIdError`, `HistoryDriftError`, `KnowledgeGraphError`
- `StaleRead`, `StaleNodeRead`, `StaleEdgeRead`, `ImpactPartialReason` (`node_cap_exceeded`, `depth_cap`, `time_budget_exceeded`)

`commitChangeSet` returns `{ rev, changeSetId, noop, idempotent }`. A content-identical update does not bump `nodes.version`. Repeating an explicit change-set id returns the original receipt. `impactWalk` defaults to depth 6, clamps deeper requests to 6, and on 5001 walk rows returns the first 5000 nodes with `partial: true` and `reason: "node_cap_exceeded"` plus the unwalked inbound frontier.

## Shared Wiring Needs (Root / Index Barrels)

wiring_needs:

- `packages/db/src/index.ts` is frozen by Task 001. Add this barrel export so later tasks import the repository from `@ef-harness/db`:

```ts
export {
  DanglingReferenceError,
  DuplicateCurrentEdgeError,
  DuplicateLogicalNameError,
  DuplicateNodeIdError,
  EdgeIntervalError,
  EdgeNotCurrentError,
  EntityIdError,
  HistoryDriftError,
  InvalidBasisError,
  InvalidCursorError,
  InvalidProposalError,
  KnowledgeBarrierError,
  KnowledgeGraphError,
  KnowledgeGraphRepo,
  NodeDeletionForbiddenError,
  NodeVersionGuardError,
  QueryCatalogError,
  StaleReadSetError,
  UnknownNodeError,
  UnknownNodeVersionError,
  openKnowledgeGraph,
} from "./knowledge/index.js";
export type {
  ChangeSetProposal,
  ChangeSetRead,
  CommitChangeSetResult,
  EdgeAsOf,
  EdgePage,
  EvidenceRecord,
  ImpactNode,
  ImpactPartialReason,
  ImpactWalkResult,
  NodeAsOf,
  NodeRecord,
  SnapshotPage,
  StaleEdgeRead,
  StaleNodeRead,
  StaleRead,
  TurnRecord,
} from "./knowledge/index.js";
```

Do not re-export `computeNodeContentHash`, `normalizeNfc`, `formatEntityId`, `NODE_KINDS`, `EDGE_TYPES`, or `loadQueryCatalog` from `@ef-harness/db`. Those names belong to Tasks 007, 010, and 012. `packages/db/package.json` stays unchanged.

## Dependency Intents (New Packages Requested)

None. The implementation uses built-in `node:sqlite` and `node:crypto` plus the existing `@ef-harness/shared-contracts` barrel (`canonicalAssetAbsolute` for `schema/state.sql` and `schema/queries.sql`).

## Contract Change Requests

None. No schema, root manifest, or shared-contract edits.

Upstream bindings, used because Tasks 007, 010, 012, and 013 are not on `harness/integration`:

- `computeNodeContentHash`, `normalizeNfc`, `formatEntityId`, and `splitSearchText` in `packages/db/src/knowledge/canonical.ts` match the Task 007 algorithms (`sha256:` + RFC 8785 NFC `{ kind, title, text, fields }`, and the same zero-padded id specs, including `T07`, `R17`, and `A0014`).
- `NODE_KINDS`, `EDGE_TYPES`, and `SETTLED_BASES` in `packages/db/src/knowledge/vocab.ts` match the seeded rows and the six bases.
- `loadQueryCatalog` in `packages/db/src/knowledge/query-catalog.ts` parses `-- name:` blocks from `schema/queries.sql`. `commitChangeSet` and the readers call `validate_change_set_reads`, `impact_walk`, `asof_nodes`, `asof_edges`, `export_dirty_nodes`, and `allocate_id` through that catalog.
- `openKnowledgeGraph` / `openStateConnection` stand in for `ProjectStateDb` until Task 013 exports a writer connection. `KnowledgeGraphRepo` takes any connection with `exec`, `prepare` (bare `:name` parameters), and `close`.

After those barrels land, point the knowledge package at the upstream modules and delete the local copies.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-017-knowledge-graph-repo`:

- `pnpm --filter @ef-harness/db test -- knowledge` — pass. Vitest 5.1.1: 3 files, 18 tests passed (disjoint commits, stale node reads, negative edge-set reads at v=0, non-invalidating comment edges, NFC and no-op updates, basis rejection, dangling-edge rollback, knowledge barrier, id allocation after retirement, turns and evidence, duplicate names, as-of snapshots, keyset pages, edge re-add at revisions 5 and 8, dirty export, cyclic impact, depth cap, 5,100-node fanout, trigger guards).
- `pnpm --filter @ef-harness/db typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/db lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 017` — pass (`harmony ok for Task-017`).

## Known Limitations / Follow-Ups

- The 50 ms impact budget is applied when the synchronous `impact_walk` returns. `node:sqlite` `DatabaseSync` does not expose a progress handler, so a query cannot be aborted mid-flight. A finished walk that took longer than 50 ms and did not already hit the node cap or depth cap is returned with `partial: true` and `reason: "time_budget_exceeded"`.
- `node_versions` is still written only by `nodes_ai` / `nodes_au`. This package never updates or deletes those rows.
- `openKnowledgeGraph` applies `schema/state.sql` itself. Swap that opener for `ProjectStateDb` when Task 013 is integrated, and swap `loadQueryCatalog` for the Task 012 driver catalog without changing the query names.
