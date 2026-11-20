---
task_id: "Task-085"
branch: "task/085-knowledge-views-exporter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/views-export/**"
  - "packages/planner/tests/views-export/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 085 handoff

Knowledge DB view exporter: deterministic `.harness/views/` Markdown, `ef:node` / `ef-fields` framing, `.git/info/exclude`, manifest hashes, and the cold-open / debounced hash scanner. Commit stays on `task/085-knowledge-views-exporter`.

## Exports Provided

Import from `packages/planner/src/views-export/index.ts` (the package barrel does not re-export these yet):

- `KnowledgeViewExporter` — projects a `KnowledgeViewSource` into `<project>/.harness/views/`. `exportAll` rewrites every clean shard. `exportIncremental` rewrites only shards whose nodes are dirty since the manifest revision (`updatedRev` or edge `valid_from_rev` / `valid_to_rev` greater than that revision). Identical bytes are not rewritten. Result fields: `written`, `unchanged`, `paused`, `deferred`, `removed`, `durationMs`.
- `ViewManifestHashScanner` — `scanColdOpen` and `scanOnFocusReturn` hash every manifest file record. `start` / `stop` subscribe with `@parcel/watcher`. Default debounce is `VIEW_WATCH_DEBOUNCE_MS` (300). `onDirty` receives `{ filePath, reason, manifestSha256, diskSha256 }`. A missing views directory or a missing `.manifest.json` is `kind: "missing_views"` (regenerate). One changed file is `kind: "offline_edits"`. Unreadable JSON is `kind: "manifest_unreadable"`.
- `EfNodeMarkerFormatter` — one block per node: `<!-- ef:node id=<id> rev=<version> base_hash=<sha256:hex> -->` … `<!-- /ef:node -->`, with an `ef-fields` YAML fence for `id`, `kind`, `status`, `basis`, `owner`, `touches`, `bounds`, `links`, and other structured fields. Prose stays outside the fence. `parseEfNodeBlocks`, `escapeMarkerText`, and `unescapeMarkerText` round-trip the framing.
- `ExportPauseLock` — `pause(file, reason)`, `resume`, `isPaused`, `reason`, `pausedFiles`. The first reason wins. Task 086 should pause a file when a disk delta, invalid YAML, or conflict card is open, and `resume` only after import or discard.
- `ExportWriteLease` — `acquire(paths)` returns `{ id, paths }`. `covers(path)` is true until `release(token)`. Scanner self-writes are dropped when the lease covers the path or the on-disk SHA-256 still equals the manifest.
- `GitExcludeGuard` — `ensure(projectRoot)` runs `git rev-parse --git-path info/exclude`, creates the file if needed, and appends `.harness/views/` when that line is absent. It never writes `.gitignore`.
- `atomicWriteFile` — `.tmp.<pid>.<nonce><ext>` plus rename. `ATOMIC_RENAME_ATTEMPTS` is 5. `EBUSY`, `EPERM`, and `EACCES` retry with `retryDelayMs` (10, 20, 40, 80, 160 ms plus jitter). A failed rename deletes the temp file and returns `{ ok: false, diagnostic }`. The previous target bytes stay in place.
- `renderViewTree`, `MemoryKnowledgeViewSource`, `LocalArchDocumentSharder` (`FEATURE_SHARD_TOKEN_CEILING` 3000), `computeNodeContentHash`, `digestSha256`.

View files (LF, sorted by `display_order` then `node_id`):

- `decisions.md`, `requirements.md`, `features/<slug>.md`, `rules/cross-cutting.md`
- `architecture/system.md`, `architecture/features/<slug>.md`, `architecture/screens/<slug>.md`, `architecture/contracts/<slug>.md`
- `overview.mmd`, `architecture/overview.mmd`
- `.manifest.json` records `{ filePath, nodeId, exportedRev, contentSha256, fieldsSha256, proseSha256, exportedAt }` (`nodeId` `""` is the file record)

A literal `<!-- /ef:node -->` or `<!-- ef:node ` inside prose, title, YAML, or link text is stored as `\<!-- ...`. The structural closer is the only line that is exactly `<!-- /ef:node -->`. Task 086 should call `unescapeMarkerText` on the captured prose and YAML before diffing.

Paused exports include `dbHead` (`id`, `version`, `contentHash`, `updatedRev`), `dbRevision`, and the disk SHA-256 so Task 086 can three-way merge without another graph read. The exporter does not call an importer.

## Shared Wiring Needs (Root / Index Barrels)

`packages/planner/src/index.ts` is frozen. When wiring is allowed, re-export:

```ts
export {
  KnowledgeViewExporter,
  ViewManifestHashScanner,
  EfNodeMarkerFormatter,
  ExportPauseLock,
  ExportWriteLease,
  GitExcludeGuard,
  VIEW_WATCH_DEBOUNCE_MS,
  type KnowledgeViewSource,
  type ExportResult,
  type DirtyView,
  type ColdOpenReport,
} from "./views-export/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or schema edit.

## Dependency Intents (New Packages Requested)

No new package name. `@parcel/watcher` is already a root devDependency (`^2.5.1`, installed 2.6.0). `@ef-harness/planner` `package.json` is frozen, so it does not declare that dependency. `loadParcelWatcher` uses `createRequire` and then walks parent `node_modules/@parcel/watcher`. When planner dependencies can change, add:

```json
"@parcel/watcher": "^2.5.1"
```

to `@ef-harness/planner` `dependencies` and keep the same loader as a fallback. Do not add `yaml`; `ef-fields` is emitted by `yaml-block.ts` (sorted keys, quoted strings, no anchors).

Sibling branches are not on this base. Local ports stand in:

- **Task 007 `CanonicalHash`.** `packages/planner/src/views-export/canonical-hash.ts` implements `digestSha256` (`sha256:` + hex) and `computeNodeContentHash` over NFC canonical `{ kind, title, text, fields }`. Swap those imports to `@ef-harness/shared-contracts` when `packages/shared-contracts/src/index.ts` exports `computeNodeContentHash` and `digestSha256`. Do not deep-import the sibling package.
- **Task 017 `KnowledgeGraphRepo`.** `KnowledgeViewSource` in `knowledge-graph-port.ts` is the read port: `currentRevision`, `listNodes`, `listEdges`, `getDirtyNodesSince`. Dirty ids follow `export_dirty_nodes` (node `updatedRev` or edge `valid_from_rev` / `valid_to_rev` greater than `lastRev`, sorted). `MemoryKnowledgeViewSource` is the in-memory stand-in. Replace it with an adapter over the db-package `KnowledgeGraphRepo` when that barrel exports `currentRevision`, snapshot paging, and `getDirtyNodesSince` / `exportDirtyNodes`. Map `NodeRecord` onto `ViewNode` (`contentHash`, `ownerRole`, `updatedRev`, `fields`).
- **Task 084 `ArchDocumentSharder`.** `LocalArchDocumentSharder` assigns each architectural node to exactly one of `architecture/system.md`, `architecture/features/<slug>.md`, `architecture/screens/<slug>.md`, or `architecture/contracts/<slug>.md`. Feature groups that would pass 3,000 whitespace tokens (plus a 40-token framing allowance) split into `<slug>--2.md`, `<slug>--3.md`, and so on, with a related-shard link line and no copied prose. Swap `sharder` on `KnowledgeViewExporter` for Task 084's `ArchDocumentSharder.assign(nodes)` when `packages/planner/src/feature-arch/**` is exported from the planner barrel. Non-architecture kinds (`decision`, `spec_item`, `edge_case`, `journey`, `rule`, and the remaining node kinds) are routed by this task, not by the sharder.
- **Task 019 name registry.** Not called. Slugs and headings come from `node.feature`, `node.title`, and `node.id`. If the registry's display name diverges from `nodes.title`, pass that string in as `ViewNode.title` at the wiring boundary.

## Contract Change Requests

None. Schema files stay untouched. `.manifest.json` is a generated view, not a `state.db` table. `exportedAt` is an ISO timestamp supplied by the exporter clock; a second export of unchanged bytes keeps the previous timestamp so the manifest file is not rewritten.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-085-knowledge-views-exporter`:

- `pnpm --filter @ef-harness/planner typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/planner lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/planner test -- views-export` — pass, 14 tests, 3 files, exit 0. Covers byte-identical re-export with unchanged mtimes, `ef:node` / `ef-fields` (status, basis, owner, touches, bounds, links), closer-escaping, shard token ceiling and single assignment, `.git/info/exclude` in a normal repo and a linked worktree, offline scan while the watcher is stopped, 12 self-write suppressions, `ExportPauseLock` plus disk drift without clobber, deleted `.harness/views/` regeneration with the graph unchanged, `EBUSY` rename (5 attempts, previous bytes kept, temp removed), and the 300-entity / 1,000-node full export under 500 ms and one-node incremental export under 150 ms.
- `node scripts/verify-harmony.mjs --task 085` — pass (`harmony ok for Task-085`, exit 0). That command also re-ran repository typecheck, lint, and test.

## Known Limitations / Follow-Ups

- Task 086 owns parsing edited files into `state.db`, conflict cards, and `resume` of `ExportPauseLock`. This task only detects the delta, pauses, and returns `dbHead` plus disk hashes. `onDirty` is the handoff point.
- A single node whose own text exceeds 3,000 tokens stays in one shard. Splitting it would truncate prose. Groups of nodes are split before the ceiling.
- A corrupt `.manifest.json` pauses export (`manifest_unreadable`) and does not regenerate over the existing Markdown. A missing manifest or a missing views directory does regenerate.
- `GitExcludeGuard` appends `.harness/views/` and treats `.harness/views`, `/.harness/views`, and `/.harness/views/` as already present. It does not remove other exclude lines.
- Windows replace uses rename-to-backup then rename-into-place when a direct rename returns `EPERM` or `EEXIST` because the target exists. A lock error on that backup rename leaves the original file in place and retries.
- Overview Mermaid is `flowchart LR` with ids sanitized to Mermaid identifiers. It is not a per-feature diagram set.
- The 500 ms / 150 ms bounds were measured on this Windows workstation with parallel writes (up to 32 at a time). They are assertions in `tests/views-export/benchmark.test.ts`, not a separate certificate.
