---
task_id: "Task-086"
branch: "task/086-markdown-direct-edit-importer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/views-import/**"
  - "packages/planner/tests/views-import/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 086 handoff

Markdown direct-edit importer for `.harness/views/` files. Structured `ef-fields` merge in deterministic code. Prose and unmarked sections go through a local `doc-import@1` port. Export stays paused until the file commits or the user discards the disk edit. Commit stays on `task/086-markdown-direct-edit-importer`.

## Exports Provided

From `packages/planner/src/views-import/index.ts`:

- `MarkdownDirectEditImporter` — batch reconcile, conflict resolution, discard, re-export
- `ThreeWayNodeMerger` — base / local / remote field, prose, and title decisions
- `ImportConflictCardBuilder` — Base vs Your Markdown Edit vs Current Chat Value cards (`keep_mine`, `keep_current`, `edit_merged`)
- `SafeDeleteRenameHandler` — removal confirmation, title rename in `fields.names`, cut-and-paste move cards, damaged-marker matching
- `writeCanonicalViews` — local canonical re-export used after a clean commit
- `LocalSqliteKnowledgeGraph`, `LocalExportPauseLock`, `LocalViewManifestHashScanner`, `FakeModelAdapter`, `LocalRevisionFeed`
- `parseDocImportPayload`, `validateEfFields`, `parseViewFile`, `renderViewFile`

Importer behavior that Task 087, Task 127, and Task 171 can call:

- `MarkdownDirectEditImporter.reconcile()` acquires `ExportPauseLock` as soon as `ViewManifestHashScanner` reports a disk delta, then parses.
- `commitResolved(sessionId, resolutions)` applies `keep_mine` / `keep_current` / `edit_merged`, `deprecate` / `restore`, `confirm` / `reject`, `confirm_move` / `cancel_move`, and `reattach` / `create_new`.
- `discard(sessionId)` rewrites the canonical file from `state.db` and releases the lock. The database is not changed.
- Accepted mutations are handed to `RevisionFeedPort.accept` with `changeClass` and `invalidateTasks`. Cosmetic prose sets `invalidateTasks: false` and does not touch `task_runtime`.
- Change sets use `origin = 'markdown_edit'`, `author = 'user:markdown_view'`, the unified diff in `summary`, and `created_at` from the injected clock. `node_versions` rows are written by the schema triggers.
- Local field applies set `fields.basis = 'explicit'` and `fields.source = 'markdown_direct_edit'` unless `basis` was taken from the remote head.
- A removed `ef:node` block never deletes the row. The card text is `You removed '<title>' from <file> — Mark as removed/deprecated or Restore block?` and the prompt is `Restore or Deprecate?`. Deprecate sets `status = 'retired'` and leaves tasks in place.
- YAML syntax banners use `Fix YAML syntax on line <n> to import`. Anchors, aliases, merge keys, and deep or huge documents are rejected. Unknown `touches` tags, bad statuses, and unknown node ids fail schema checks. Any syntax or schema error in the batch writes nothing and keeps every scanned file locked.
- Pure `ef-fields` edits do not call `doc-import@1`. Prose edits and unmarked headings do. Semantic field deltas and new unmarked headings wait for confirmation. `changeClass: 'cosmetic'` with zero field pairs updates prose only.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. The integrator should add:

```ts
export {
  MarkdownDirectEditImporter,
  ThreeWayNodeMerger,
  ImportConflictCardBuilder,
  SafeDeleteRenameHandler,
} from "./views-import/index.js";
```

No root `package.json`, lockfile, workspace, tsconfig, or eslint change.

Wire `MarkdownDirectEditImporter` to the coordinator that already owns `state.db` writes. Construct it with the integrated ports below. Call `reconcile()` on cold open after the manifest scan, and `commitResolved` / `discard` from the inbox conflict cards (Task 127).

`writeCanonicalViews` is the local re-export. Replace that call with `KnowledgeViewExporter` from Task 085 when that branch lands, and keep the same manifest fields (`filePath`, `nodeId`, `exportedRev`, `contentSha256`, `fieldsSha256`, `proseSha256`, `exportedAt`) plus `nodeVersion` (the `ef:node` `rev`) and per-file `featureId` / `efFile` / `title` / `nodeIds`.

Marker bytes this branch parses and writes:

```text
<!-- ef:node id=<node_id> rev=<node_version> base_hash=<sha256 hex of the block interior> -->
## Title

prose

```ef-fields
key: "value"
```
<!-- /ef:node -->
```

A literal `<!-- /ef:node -->` inside prose is stored as `<!-- ef:escaped /ef:node -->` and restored on parse. Paths in the manifest are relative to `.harness/views/` (`features/orders.md`).

## Dependency Intents (New Packages Requested)

None. No package.json edits.

`zod` and `yaml` exist at the repo root but are not dependencies of `@ef-harness/planner`. This task does not import them. `parseDocImportPayload` and `validateEfFields` are the local stand-ins. When Task 009 and Task 010 are on the planner's dependency graph, swap those functions for `DocImportV1Schema` and `TouchesTagSchema` from `@ef-harness/shared-contracts`. Do not add a direct dependency until the barrel export exists.

SQLite uses `node:sqlite`, which is already required by the foundation. Schema SQL is loaded through `canonicalAssetAbsolute("stateSql")` from `@ef-harness/shared-contracts`.

## Contract Change Requests

None. Sibling branches are not merged. Local ports and the swap:

| Local port | Replace with | Notes |
| --- | --- | --- |
| `LocalSqliteKnowledgeGraph` / `KnowledgeGraphRepo` | Task 017 `KnowledgeGraphRepo.commitChangeSet` and `getNode` | Same origin enum, node version bump, `node_versions` triggers, and `names` maintenance. Map `expectedVersion` onto the Task 017 read set. Content hash here is `sha256:` plus canonical JSON of `{kind,title,text,fields}`. Swap for Task 007 `computeNodeContentHash` if the digest must be RFC 8785. |
| `parseDocImportPayload` / `FakeModelAdapter` | Task 009 `DocImportV1Schema` | Task 009 success is `{ proposals }` or `{ blocked: true, reason }`. This port also requires `changeClass: 'cosmetic' \| 'semantic'` because Task 086 separates typo fixes from semantic edits. Extend the shared schema or wrap it. Proposal rules match Task 009: `new_node` has no target and a node type; `update` / `new_edge` name a target; `note` has no node type. |
| `TOUCHES_TAGS`, workflow status checks | Task 010 closed vocabularies | 28 touches tags, copied in order. `status` in ef-fields allows `draft`, `active`, `retired`, `superseded`, and `in_progress`. Only the first four are written to `nodes.status`, and only when that field actually changed. `in_progress` stays inside `fields` because it is not a `nodes.status` value. The example disjoint merge uses it that way. |
| `LocalExportPauseLock` | Task 085 `ExportPauseLock` | `acquire(file, reason)`, `release`, `isHeld`, `heldFiles`, `reason`. Held from the scan until commit or discard, including invalid YAML and open cards. |
| `LocalViewManifestHashScanner` | Task 085 `ViewManifestHashScanner` | Cold-open SHA-256 compare only. Debounced `@parcel/watcher` stays in Task 085. |
| `writeCanonicalViews` | Task 085 `KnowledgeViewExporter` | Deterministic LF Markdown, sorted node ids, manifest hashes. |
| `LocalRevisionFeed` | Task 087 revision engine | `accept({ changeSetId, mutations })`. Each mutation has `changeClass`, `invalidateTasks`, and the unified diff. This package does not run `impact_walk` or change `task_runtime`. Delete cards include a direct-edge impact preview and say the full walk is Task 087. |
| Fresh ids (`SI-001`, `R18`, …) | Task 017 `formatEntityId` | Prefixes follow the entity id table used by Task 017. |

`nodes` are never deleted. Retire uses `status = 'retired'`. `belongs_to` is retired and recreated only after a move is confirmed.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-086-markdown-direct-edit-importer`.

- `pnpm --filter @ef-harness/planner typecheck` — exit 0
- `pnpm --filter @ef-harness/planner lint` — exit 0
- `pnpm --filter @ef-harness/planner test -- views-import` — exit 0, 4 files, 20 tests passed
- `node scripts/verify-harmony.mjs --task 086` — exit 0, `harmony ok for Task-086`

Covered by those tests: disjoint field merge with zero model calls, same-field conflict cards (`11:00` / `10:30` / `11:30`) and keep-mine / keep-current / edit-merged, YAML line 42 banner, anchor rejection, unknown touches tag with zero partial writes, discard, delete confirmation and retire without dropping the task, restore, title rename keeping `node_id` and edges and updating `names`, cut-and-paste move with `belongs_to` reassignment, damaged-marker reattach, cosmetic typo with `invalidateTasks: false`, semantic cutoff confirmation, new unmarked `## Print Summary Button` confirmed as `SI-001` with `basis = explicit`, five-file atomic audit under `user:markdown_view`, schema failure aborting the batch, and export, edit, import, re-export with a clean second scan. Prose that contains a literal node closer round-trips through the escape.

## Known Limitations / Follow-Ups

- Task 085's watcher, `.git/info/exclude`, and atomic temp-rename are not in this package. The scanner is a full hash compare. Self-writes are avoided by updating `.manifest.json` to the bytes just written before the lock is released.
- `doc-import@1` is not called for a real model. `FakeModelAdapter` records `(baseProse, editedProse, currentFields, validNodeIds)` and checks the local schema. A blocked or invalid model result holds the file and does not commit it.
- Semantic prose with zero structured field pairs commits without a card and is fed to Task 087 as `breaking` with `invalidateTasks: true`. Cards are required when semantic proposals carry field pairs, or when the section is a new unmarked heading.
- Damaged-marker `create_new` allocates a second node and leaves the original row in place. Reattach restores the marker. The required tests use reattach.
- Impact text lists current edges only. Task 087 still owns reverse `impact_walk`, holds, and rework.
- `ef_revision` in the file front matter is the graph revision. The marker `rev` and manifest `nodeVersion` are the node version used as the three-way base. If Task 085 stores only one `exportedRev`, map it in the adapter described above.
