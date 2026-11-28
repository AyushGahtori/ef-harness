---
task_id: "Task-169"
branch: "task/169-brownfield-opening-flow"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/brownfield/src/opening/**"
  - "packages/brownfield/tests/opening/**"
  - ".agent-handoffs/task-169.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 169 handoff

Brownfield opening flow: five prefilled change starters, mixed-request splitting, measurable performance interview with SQL `EXPLAIN` plans, Today vs Change confirmation overlays, and repo-native conventions extraction. Commit stays on `task/169-brownfield-opening-flow`.

## Exports Provided

Public module: `packages/brownfield/src/opening/index.ts`.

Required by Task 153, Task 170, and Task 175:

- `BrownfieldOpeningController` — Nonempty-repo opening, L0 summary, quick prompts, observed stack pre-settlement, scope fence, conventions card
- `MixedRequestWorkItemSplitter` — Deterministic bug + perf + feature split into ordered work items
- `MeasurablePerfInterviewFlow` — Surface, baseline (`EXPLAIN QUERY PLAN` + p95), numeric target gate before planning
- `TodayVsChangeConfirmationBuilder` — Confirmation card plus `today` / `change` canvas overlays
- `ExistingConventionsExtractor` — `<= 600` token observed conventions card

Also exported: `BROWNFIELD_QUICK_PROMPTS`, `ObservedStackPresettler`, `AntiRewriteScopeFence`, `ContributorDocIngestion`, `InMemoryWorkItemStore`, `SqliteExplainAnalyzeRunner`, consumer ports in `contracts.ts`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/brownfield/src/index.ts` is outside this task's owned write scope. Re-export the opening surface during integration:

```ts
export {
  BrownfieldOpeningController,
  MixedRequestWorkItemSplitter,
  MeasurablePerfInterviewFlow,
  TodayVsChangeConfirmationBuilder,
  ExistingConventionsExtractor,
  BROWNFIELD_QUICK_PROMPTS,
} from "./opening/index.js";
export type {
  BrownfieldOpeningSummary,
  TodayChangeCanvasProjection,
  ConventionsCard,
  PerfInterviewState,
} from "./opening/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `schema/state.sql` edits.

## Dependency Intents (New Packages Requested)

None. SQLite benchmarks use `node:sqlite` (`DatabaseSync`).

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-169-brownfield-opening-flow`:

- `pnpm --filter @ef-harness/brownfield typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/brownfield lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/brownfield test -- opening` — pass. Vitest v5.1.1, 1 file, 8 tests, exit 0. Covers five quick prompts, observed `basis = 'observed'` stack pre-settlement (zero redundant greenfield stack questions), mixed bug+perf+feature split into three ordered work items, measurable perf interview with SQLite `EXPLAIN QUERY PLAN`, conventions card `<= 600` tokens, Today/Change overlays, hostile `AGENTS.md` fencing, scope read-only fence, and zero-test safety-net flag.
- `node scripts/verify-harmony.mjs --task 169` — pass (`harmony ok for Task-169`, exit 0). The script also ran root `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Consumers cannot import the opening module from `@ef-harness/brownfield` until the barrel lines above are applied. Until then import `packages/brownfield/src/opening/index.ts` only inside this package.
- Task 166 `BrownfieldL0RepoScanner`, Task 167 `CompactCodeMapQueryService`, Task 168 `ModuleCardCacheEngine` / `StaleDocsDetector`, and Task 069 `DiscoverySessionCoordinator` are not on this foundation base. Opening code wires them through local ports in `contracts.ts`; swap to published implementations at integration.
- `pnpm --filter @ef-harness/brownfield test -- opening` only filters vitest file paths containing `opening`; root `pnpm test` still runs the full workspace suite via harmony.