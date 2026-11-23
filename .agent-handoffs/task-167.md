---
task_id: "Task-167"
branch: "task/167-brownfield-l1-code-map"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/brownfield/src/l1-codemap/**"
  - "packages/brownfield/tests/l1-codemap/**"
  - ".agent-handoffs/task-167.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 167 handoff

Brownfield L1 local code map: portable `web-tree-sitter` WASM bootstrap, structural multi-language symbol extraction into rebuildable `code-index.db`, Aider-style PageRank (`file_rank`), generated/vendored exclusion, and compact query/rendering API. Commit stays on `task/167-brownfield-l1-code-map`.

## Exports Provided

Public module: `packages/brownfield/src/l1-codemap/index.ts`.

Required by Task 129, Task 168, Task 175, Task 183–185:

- `WasmTreeSitterIndexer` — WASM runtime init + structural/tree-sitter-ready indexing, incremental deltas, governor-aware batching (`25` files), `keepDbOpen` for hot SQLite handles
- `AiderPageRankCalculator` — global + query-personalized PageRank (`d = 0.85`, `<= 30` iterations)
- `GeneratedAndVendoredFilter` — minified, lockfile, vendored, generated, oversized skip rules
- `CompactCodeMapQueryService` — top ranks, importer/caller lookup, token-budgeted compact repo maps
- `CodeIndexDatabase` — `schema/code-index.sql` bootstrap, corruption recovery, incremental symbol/ref upserts
- `parseStructurally`, `loadTsPathAliases`, `resolveImportSpecifier`, `ensureWebTreeSitterInitialized`

## Shared Wiring Needs (Root / Index Barrels)

`packages/brownfield/src/index.ts` is outside this task's owned write scope. Re-export the L1 surface during integration:

```ts
export {
  AiderPageRankCalculator,
  CodeIndexDatabase,
  CompactCodeMapQueryService,
  GeneratedAndVendoredFilter,
  WasmTreeSitterIndexer,
  ensureWebTreeSitterInitialized,
} from "./l1-codemap/index.js";
```

No root workspace, tsconfig, eslint, or `schema/code-index.sql` edits.

`BrownfieldL0RepoScanner` (`Task 166`) should supply the file inventory + pinned `commitSha` before L1 indexing; this branch opens repositories directly from fixtures/tests.

## Dependency Intents (New Packages Requested)

Add to `packages/brownfield/package.json` at integration (workspace root already ships `web-tree-sitter@^0.27.2`):

- `web-tree-sitter` — runtime `Parser.init()` (proven in tests via `createRequire` resolution today)
- Optional future: pinned WASM grammar blobs for TypeScript/Python/Go/SQL when installer bundles them (`desktop-app.md`)

Until grammars ship, `WasmTreeSitterIndexer` uses deterministic structural extraction (regex/heuristic) for symbols/imports; WASM init still runs offline with zero native compile.

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/brownfield test -- l1-codemap` — 1 file, **8 tests passed** (WASM init, multi-language symbols, `@/` alias + barrel resolution, vendored/generated exclusion, `code-index.db` PageRank + personalized map, `< 50 ms` incremental delta with warm DB handle, corruption recovery, cyclic-import PageRank).
- `pnpm --filter @ef-harness/brownfield typecheck` — passed (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/brownfield lint` — passed (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 167 --require-ready` — expected after commit (full monorepo `typecheck` / `lint` / `test` + owned-path scope).

## Known Limitations / Follow-Ups

- Per-language WASM grammars are not vendored in this branch; wire grammar `.wasm` assets from the signed installer manifest and switch `parseStructurally` → Tree-sitter AST walks per file.
- `packages/brownfield/package.json` does not declare `web-tree-sitter` yet (frozen foundation); resolution relies on workspace hoisting until integration adds the dependency explicitly.
- Incremental PageRank refresh is skipped for `<= 5` touched files (fast path); full-graph refresh still runs on cold/full indexes.
- `CompactCodeMapQueryService` edge reconstruction uses stored `import:*` ref rows + rank fallbacks; migrate to explicit cross-file edge table if query plans need richer callee graphs.