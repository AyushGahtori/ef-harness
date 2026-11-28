---
task_id: "Task-166"
branch: "task/166-brownfield-l0-repo-scanner"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/brownfield/src/l0-scan/**"
  - "packages/brownfield/tests/l0-scan/**"
  - ".agent-handoffs/task-166.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 166 handoff

Brownfield L0 deterministic repo scanner (zero LLM): gitignore-respecting tree walk, stack/framework/CI/schema detection, docs inventory, git churn hotspots, monorepo workspace picker, sensitive-file skip boundary, and `l0_snapshot_hash` cache. Commit stays on `task/166-brownfield-l0-repo-scanner`.

## Exports Provided

Import from `packages/brownfield/src/l0-scan/index.ts` (not the frozen package barrel):

- `BrownfieldL0RepoScanner` — `scan(options)` orchestrates L0; honors `.gitignore` via `git ls-files` + untracked listing; skips `node_modules`, build outputs, binaries, and sensitive paths without reading secret bytes
- `StackAndFrameworkDetector` — languages, package managers, frameworks (incl. Next.js router mode), scripts, CI workflows (`ciLinuxCaseSensitive`), schemas, `.env.example` names, Docker files
- `GitChurnHotspotAnalyzer` — bounded `git log --numstat` hotspots, co-change pairs, commit/branch samples; `churnAvailable: false` on non-git or 0–1 commits
- `MonorepoWorkspacePicker` — `pnpm-workspace.yaml` / npm·yarn workspaces / turbo·nx·cargo signals; package list, internal `workspace:*` edges; `buildScopePicker(selected)`
- `ObservedRepoFactsPersister` — `l0_snapshot_hash` + JSON cache in `state.meta` port; persists `basis: observed` nodes via graph port
- `SafetyScanner` — path gate (`shouldSkipRead`); local stand-in for Task 036
- `createMinGitRepoInspector`, `InMemoryKnowledgeGraphRepo`, `InMemoryStateMetaStore` — local ports for Tasks 035 / 017 until wired
- Types: `L0ScanResult`, `StackDetection`, `ChurnAnalysis`, `MonorepoFacts`, `ScopePickerOption`, `SensitivePathMeta`, `KnowledgeGraphRepoPort`, `MinGitRepoInspectorPort`

Fast re-open: when callers pass explicit `dirtyMtimes` (e.g. `[]`) and the remembered `HEAD` matches cache, reload is sub-millisecond without re-running git.

## Shared Wiring Needs (Root / Index Barrels)

`packages/brownfield/src/index.ts` is frozen. Integration should re-export the L0 barrel when allowed:

```ts
export {
  BrownfieldL0RepoScanner,
  StackAndFrameworkDetector,
  GitChurnHotspotAnalyzer,
  MonorepoWorkspacePicker,
  ObservedRepoFactsPersister,
} from "./l0-scan/index.js";
```

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Local ports stand in for dependencies not on this base:

- Task 017 `KnowledgeGraphRepo` → `KnowledgeGraphRepoPort` / `InMemoryKnowledgeGraphRepo` (`upsertObservedNode`, `basis: observed`)
- Task 035 `MinGitRepoInspector` → `MinGitRepoInspectorPort` / `createMinGitRepoInspector` (read-only `ls-files`, `rev-parse`, `log`)
- Task 036 `SafetyScanner` → `SafetyScanner.shouldSkipRead` (never opens `.env`, `*.pem`, `*.key`, `credentials.json`, `secrets.*`)

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-166-brownfield-l0-repo-scanner`:

- `pnpm --filter @ef-harness/brownfield typecheck` — pass (`tsc -b`)
- `pnpm --filter @ef-harness/brownfield lint` — pass
- `pnpm --filter @ef-harness/brownfield test -- l0-scan` — pass, 9 tests (Next.js hybrid, Express+Prisma, Python manifests, pnpm monorepo edges, non-git, sensitive skip canary, symlink/EPERM fallback, snapshot cache fast path, churn hotspots)
- `node scripts/verify-harmony.mjs --task 166` — pass (`harmony ok for Task-166`, exit 0) at commit via `agent-worktree commit 166`

## Known Limitations / Follow-Ups

- `InMemoryKnowledgeGraphRepo` and `InMemoryStateMetaStore` are stand-ins; wire to `packages/db` `KnowledgeGraphRepo` and real `state.db` `meta` rows on integration.
- Doc last-touch uses per-file `git log` when fewer than 80 doc paths; larger doc trees batch-null dates until a batched git strategy lands (Task 168 / 175).
- Symlink-loop proof depends on OS symlink permission; Windows `EPERM` falls back to a normal scan smoke check.
- Monorepo glob expansion covers `parent/*` workspace patterns; exotic globs may need Task 167 scope hints.