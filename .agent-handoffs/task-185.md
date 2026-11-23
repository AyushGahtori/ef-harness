---
task_id: "Task-185"
branch: "task/185-sweep-safety-guards"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/investigations/src/sweep-guards/**"
  - "packages/investigations/tests/sweep-guards/**"
  - ".agent-handoffs/task-185.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 185 handoff

Sweep safety guards for repo-wide rename/refactor sweeps: six-variant reference inventory, persisted-name boundary gate, risky AST diff detector, post-sweep leftover scanner, queued-brief symbol-map updater, characterization hook, resync planner, and audit scorecard. Commit stays on `task/185-sweep-safety-guards`.

## Exports Provided

Public module: `packages/investigations/src/sweep-guards/index.ts`.

Required by Task 088, Task 184, Task 189, Task 200:

- `VariantExpandedReferenceInventory` — expands camel/Pascal/snake/SCREAMING/kebab/plural variants and scans fixture repos into Zone 1 / Zone 2 / immutable hits
- `PersistedNameBoundaryGate` — default **preserve** for SQL/JSON/env/`localStorage`/route persisted names; explicit approval for expand-then-contract
- `RiskyAstTransformDetector` — dynamic `obj[key]`, duplicate-parameter shadowing, Prisma field rename without `@map`
- `SweepLeftoverScanner` — post-sweep Zone 1 leftover scan with Zone 2 accounting
- `PostSweepBriefSymbolUpdater` — `sweep_symbol_map` persistence, `write_scope[]` rewrite, `<= 300`-token `[RECENT SWEEP SYMBOL MAP]` brief header
- `PreSweepCharacterizationGuard` — optional `CharacterizationSafetyNetPort` (Task 170) before transform
- `PostSweepResyncPlanner`, `SweepAuditScorecardRecorder` — checklist glob rewrite + `sweep_runs` scorecard fields
- `HistoricalMigrationWriteBlockedError` — hard block on `migrations/**` / `prisma/migrations/**` codemod writes

## Shared Wiring Needs (Root / Index Barrels)

`packages/investigations/src/index.ts` is outside owned write scope. Re-export during integration:

```ts
export {
  VariantExpandedReferenceInventory,
  PersistedNameBoundaryGate,
  RiskyAstTransformDetector,
  SweepLeftoverScanner,
  PostSweepBriefSymbolUpdater,
  PreSweepCharacterizationGuard,
  PostSweepResyncPlanner,
  SweepAuditScorecardRecorder,
} from "./sweep-guards/index.js";
```

Task 184 `SweepOrchestrator` should call inventory + gate pre-sweep and leftover scanner + `PostSweepBriefSymbolUpdater` post-sweep on the local sweep branch (`harness/s/<sweep>`).

Task 167 `CompactCodeMapQueryService` and Task 088 `KnowledgePacketSlicer` are consumed via ports/fixtures in tests only on this branch; wire real adapters at integration.

**Local ports / sibling worktrees:** No sibling branches share base `6497730`; sweeps use in-repo temp fixtures under vitest. No extra dev-server ports required for Task 185 verification.

## Dependency Intents (New Packages Requested)

None (pure TypeScript + Node `fs` scanning). Optional integration may add `ripgrep` CLI or `CompactCodeMapQueryService` symbol FTS for production scans (tests use directory walk + line heuristics).

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/investigations test -- sweep-guards` — **7 passed**
- `pnpm --filter @ef-harness/investigations typecheck` — passed
- `pnpm --filter @ef-harness/investigations lint` — passed
- `node scripts/verify-harmony.mjs --task 185 --require-ready` — passed at commit time (scope + monorepo `typecheck` / `lint` / `test`)

## Known Limitations / Follow-Ups

- Production inventory should merge `Task 167` `code-index.db` symbol FTS with ripgrep; this branch uses deterministic filesystem scan for hermetic tests.
- `RiskyAstTransformDetector` uses line/regex heuristics, not full AST — integrate `ast-grep` / `ts-morph` at integration for structural diffs on `harness/s/<sweep>`.
- `PostSweepResyncPlanner.planFullResync` flags refresh intent only; actual `code-index.db` / `state.db` / `name_registry` writers belong to Tasks 017/019/167 at land time.