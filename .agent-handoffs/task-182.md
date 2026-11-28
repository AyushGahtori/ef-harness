---
task_id: "Task-182"
branch: "task/182-mystery-bug-investigation"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/investigations/src/pipeline/**"
  - "packages/investigations/tests/pipeline/**"
  - ".agent-handoffs/task-182.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 182 handoff

Six-stage mystery-bug investigation pipeline with stage gates, minimal-flip root-cause proof, investigation receipt store, and deterministic seeded end-to-end tests. Commit stays on `task/182-mystery-bug-investigation`.

## Exports Provided

Public module: `packages/investigations/src/pipeline/index.ts`.

Required by Task 183, Task 189, and Task 200:

- `MysteryBugInvestigationPipeline` — `INTAKE` → `CLEAN_REPRO` → `QUARANTINED_LOCALIZE` → `PROVEN_MINIMAL_FLIP_ROOT_CAUSE` → `SCOPED_FIX` → `PERMANENT_REPRO_AND_MECHANISM_TESTS`
- `StageGateEnforcer` — production `src/` write blocks, baseline failing repro, scratch log leak guard, permanent dual-test red-before-green
- `MinimalFlipRootCauseProver` — causal `RED → GREEN → RED` flip proof
- `InvestigationReceiptStore` — plain-English post-mortem card + `EF-Investigation` / `EF-Root-Cause-Verified` trailers
- `SqliteInvestigationStore` — local `investigations` table projection on `node:sqlite`

Also exported:

- `DEFAULT_INVESTIGATION_BUDGET`, pipeline port types, investigation errors, stage and record types

## Shared Wiring Needs (Root / Index Barrels)

`packages/investigations/src/index.ts` is outside this task's owned write scope. Re-export the pipeline surface during integration:

```ts
export {
  MysteryBugInvestigationPipeline,
  StageGateEnforcer,
  MinimalFlipRootCauseProver,
  InvestigationReceiptStore,
  SqliteInvestigationStore,
  DEFAULT_INVESTIGATION_BUDGET,
  INVESTIGATION_STAGES,
} from "./pipeline/index.js";
export type {
  InvestigationRecord,
  InvestigationReceipt,
  SymptomCard,
  ReproScript,
  InvestigationStage,
} from "./pipeline/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or frozen `schema/state.sql` edits in this branch.

Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. Use these local ports until Task 100, Task 038, Task 050, Task 055, and Task 167 land on `harness/integration`:

| Port | Local stand-in in tests | Integration target |
|---|---|---|
| `SymptomCardStorePort` | `ScriptedSymptomCards` | Task 100 `SymptomCardStore` |
| `CompactCodeMapQueryPort` | `ScriptedCodeMap` | Task 167 L1 code map query |
| `WorktreeSlotPoolPort` | `ScriptedWorktrees` | Task 038 `WorktreeSlotPool` |
| `TestEnvOrchestratorPort` | `ScriptedTestEnv` | Task 050 orchestrator (Vitest/HTTP/Playwright/CLI) |
| `CleanVerifierHarnessPort` | `ScriptedVerifier` | Task 055 `CleanVerifierHarness` |

`SqliteInvestigationStore` uses an inline `investigations` DDL mirror until `schema/state.sql` gains the M6 table (see Contract Change Requests).

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`).

## Contract Change Requests

Add an `investigations` table to `schema/state.sql` with columns matching `SqliteInvestigationStore` (`id`, `symptom_card_json`, `stage`, `hypothesis_ledger`, repro/root-cause/fix/tests/receipt JSON blobs, repro counters, escalation flags, timestamps).

## Exact Verification Commands & Results

```text
> pnpm --filter @ef-harness/investigations typecheck
(exit 0)

> pnpm --filter @ef-harness/investigations lint
(exit 0)

> pnpm --filter @ef-harness/investigations test -- pipeline
Test Files  3 passed (3)
Tests       10 passed (10)

> node scripts/verify-harmony.mjs --task 182 --require-ready
harmony ok for Task-182
```

## Known Limitations / Follow-Ups

- Task 183 hooks (bisect, symptom-patch detector) are not wired inside `MysteryBugInvestigationPipeline` yet; ports are ready for localization toolkit injection.
- Git merge-queue landing (`Task 178`) records trailers on the receipt object only; push/PR automation waits for ship-deploy integration.