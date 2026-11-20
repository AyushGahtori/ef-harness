---
task_id: "Task-092"
branch: "task/092-deterministic-graph-compiler"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/graph-compiler/**"
  - "packages/planner/tests/graph-compiler/**"
  - ".agent-handoffs/task-092.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 092 handoff

Deterministic 9-pass graph compiler. It refuses a wave plan that has a cycle, a concurrent write-scope collision, a shadowed name, an oversized leaf or MUST band, a traceability gap, an unknown touches tag, a missing cross-cutting rule, a shared-contract or migration-slot violation, a budget shortfall, or a non-waivable waiver. A passing plan gets an immutable `compiled_plan_snapshot` fingerprint. Commit stays on `task/092-deterministic-graph-compiler`.

## Exports Provided

Import from `packages/planner/src/graph-compiler/index.ts` until the package barrel is wired.

- `DeterministicGraphCompiler` — `compile(input)` runs all 9 passes. On success it returns `snapshot` with `fingerprint`, `planEpoch`, `compiledAt`, `passCount: 9`, and one stamp per task (`compiledSliceSha256`, `compiledAt`, `planEpoch`, `passedAllNinePasses`, `state: "READY"`). On failure it returns the diagnostic list, `repairRounds`, and `escalated: true`. Optional `GraphCompilerPorts` inject the sibling services below. Auto-fixable defects are sent to `JitFeaturePlanner.repair` for at most 2 rounds.
- `WriteScopeDisjointnessChecker` — case-folded Windows glob intersection. Exact paths are bucketed. `**/*`, `*`, and a single directory plus `/**` (`src/**`) are broad leaf wildcards. A shared path is legal only when a task or feature dependency path orders the writers. Sweep tasks use that same rule. Tasks whose features already have a dependency path are not treated as concurrent.
- `TraceabilitySqlGate` — loads `requirements_without_task`, `requirements_without_check`, and `tasks_without_requirement` from `schema/queries.sql` and executes them on an in-memory projection. Also reports unresolved `contradicts` edges, unsettled blocking `must_ask` criteria, features with no Step 3b sealed checks, and sensitive requirements (`auth`, `payments`, `pii`) with no sealed verifying check. A low-risk approved requirement waiver is inserted into the SQL `waivers` projection. A sensitive requirement cannot be waived that way.
- `CompilationWaiverGuard` — permits an audited, user-approved, low-risk `generated_scaffold_file_count` waiver for a scaffold task with exactly 6 primary files. Rejects `cycle_check`, `parallel_write_overlap`, `unresolved_contradiction`, `missing_sealed_check`, `missing_sealed_auth_check`, `missing_sealed_payments_check`, `missing_sealed_pii_check`, `must_truncation`, and `oversized_must` as `NON_WAIVABLE_SAFETY_INVARIANT`.
- `assertTaskReadyForDispatch` / `taskMayEnterReady` / `UncompiledDispatchError` — a task cannot enter `READY` without a stamp from a passing snapshot.
- `createKitchenAppWavePlan` — the valid Kitchen App wave used by the tests.
- `compilationInputFromKnowledgeGraph` — projects a `KnowledgeGraphRepo` node/edge snapshot into `CompilationInput`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/planner/src/index.ts` is frozen by Task 001. When wiring the barrel, re-export:

```ts
export {
  CompilationWaiverGuard,
  DeterministicGraphCompiler,
  LocalFiveLayerContradictionEngine,
  LocalIndependentOracleAuthorSealer,
  LocalKnowledgePacketSlicer,
  LocalNameRegistryRepo,
  LocalOversizedMustAutoSplitGuard,
  OversizedMustTaskError,
  TraceabilitySqlGate,
  UncompiledDispatchError,
  WriteScopeDisjointnessChecker,
  assertTaskReadyForDispatch,
  compilationInputFromKnowledgeGraph,
  createKitchenAppWavePlan,
  taskMayEnterReady,
} from "./graph-compiler/index.js";
export type {
  CompilationDiagnostic,
  CompilationInput,
  CompilationResult,
  CompiledPlanSnapshot,
  CompiledTaskStamp,
  GraphCompilerPorts,
  JitFeaturePlanner,
} from "./graph-compiler/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

None. The compiler uses `node:sqlite`, `node:crypto`, and `@ef-harness/shared-contracts` (`canonicalAssetAbsolute("queriesSql")`), which are already available.

## Contract Change Requests

None in this branch. Sibling notes for the integrator:

1. Task 081 already asked for `edges.type = 'contradicts'`. This compiler treats a current unresolved `contradicts` edge as a hard stop. The in-memory projection accepts that type before the schema seed does.
2. `exported_symbol` is checked here as a logical name. Task 019 `NAME_KINDS` does not list it yet. Keep the collision behavior when that vocabulary grows.
3. Closed touches tags and `X-01`–`X-14` scopes live in `vocabulary.ts` as a local port of Tasks 010 and 077. Replace that catalog with the shared vocabulary when those barrels publish the same 28 tags and the same `any` / `all` scopes.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-092-deterministic-graph-compiler`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/planner lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/planner test -- graph-compiler` — exit 0. Vitest 5.1.1: 3 files, 14 tests passed. Covers the Kitchen App wave, sequential versus parallel shared files, cycles, Windows case collision, broad `src/**`, shadowed routes and symbols, orphan requirements, missing `REQ-12` oracle, oversized junior MUST (3,900 tokens), unresolved contradictions, budget shortfall, audited 6-file scaffold waiver, non-waivable waivers, the 2-round repair loop, sibling ports, the canonical traceability SQL text, a Task 017 graph projection, and a warmed 500-task / 20-feature compile under 100 ms.
- `node scripts/verify-harmony.mjs --task 092` — exit 0, printed `harmony ok for Task-092`. That command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. These local ports must be swapped at integration. Do not import unpublished packages as if they were already on `harness/integration`.

- **Task 017 `KnowledgeGraphRepo`:** `KnowledgeGraphRepo.listNodes()` / `listEdges()` is the local snapshot port. `compilationInputFromKnowledgeGraph` reads task fields `write_scope`, `primary_files`, `touches`, `level`, `must_band_tokens`, `must_band_rule_ids`, `migration_intent_slot`, and edges `depends_on`, `implements`, `obeys`, `handles_edge_case`, `verifies`, and `contradicts`. Swap the port for `KnowledgeGraphRepo` once the package barrel exports it. The repo's edge pages are keyset-paged; this port expects the current as-of set.
- **Task 019 `NameRegistryService`:** `NameRegistryRepo.detectCollisions` is implemented locally by `LocalNameRegistryRepo` (route shadowing, case-folded DB and env names, brownfield symbols). Inject `NameRegistryService` when `packages/db` exports it. HTTP methods and parameterized routes (`:id`, `{id}`, `[id]`) are compared here.
- **Task 081 `FiveLayerContradictionEngine`:** `LocalFiveLayerContradictionEngine.unresolvedContradictions` returns input edges with `resolved: false`. Replace it with `FiveLayerContradictionEngine` and keep blocking while `blocksGraphCompilation()` is true.
- **Task 088 `KnowledgePacketSlicer` and `OversizedMustAutoSplitGuard`:** `LocalKnowledgePacketSlicer.measureMust` reads the plan's MUST token count. `LocalOversizedMustAutoSplitGuard.assertFits` refuses above 3,000 tokens for Junior and 6,000 for Senior and returns `OversizedMustTaskError` with `split_or_promote_senior` when a Junior band still fits Senior. Swap both classes for the slicer package.
- **Task 091 `JitFeaturePlanner` and `IndependentOracleAuthorSealer`:** repair is `JitFeaturePlanner.repair(input, diagnostics)`. Sealed checks default to check nodes with `visibility: "sealed"`. Swap for `JitFeaturePlanner` and `IndependentOracleAuthorSealer`.
- **Task 023 / Task 090 budget:** `BudgetLedgerPort.remaining` defaults to the plan's `remainingProjectMicroUsd` and `remainingWaveMicroUsd`. Projected minimum cost is the sum of `estimatedMinCostMicroUsd`. Swap for the wave budget ledger.
- **Task 010 / Task 077 vocabulary:** `CLOSED_TOUCHES_TAGS` and `CROSS_CUTTING_RULES` in `vocabulary.ts` are the local copies. A matched `X-01`–`X-14` rule must appear in that task's `mustBandRuleIds`.
- **Dispatch names:** stamps use camelCase `compiledSliceSha256`, `compiledAt`, and `planEpoch`. Those are the `compiled_slice_sha256`, `compiled_at`, and `plan_epoch` values from the task spec.
- **Windows case:** a case-only collision emits `parallel_write_overlap` and `windows_case_collision`. POSIX targets keep case distinct.
- **Repair:** only plans whose diagnostics are all in the auto-fixable set are sent to the planner. More than one unimplemented requirement is not auto-fixed. Cycles, contradictions, missing sealed checks, and MUST truncation escalate immediately.
