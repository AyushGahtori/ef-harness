---
task_id: "Task-191"
branch: "task/191-metalab-eval-promotion"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/meta-lab/src/evals/**"
  - "packages/meta-lab/tests/evals/**"
  - ".agent-handoffs/task-191.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 191 handoff

Meta-Lab 3-level evaluation runner, exact McNemar + Bootstrap 95% CI paired promotion engine, `>= 15%` efficiency tie rule, artifact lifecycle manager, scorecards, and CLI. Commit stays on `task/191-metalab-eval-promotion`.

## Exports Provided

Public entry: `packages/meta-lab/src/evals/index.ts`.

- `ThreeLevelEvalRunner` — Level 1 unit (futility gate `> 5%` drop), Level 2 component, Level 3 held-out E2E against local mock ports.
- `PairedStatisticalPromotionEngine` — `decide()` applies exact McNemar, bootstrap CIs, efficiency tie rule, and hard vetoes.
- `McNemarAndBootstrapCalculator` — `exactMcNemarPValue`, seeded `B = 10_000` bootstrap CIs from `sha256(evalRunId)`.
- `ArtifactLifecycleManager` — `draft → evaluated → active → deprecated`, blocks `draft → active`, `rollback()`.
- `buildPromotionScorecard` — Markdown + JSON paired comparison tables (`PROMOTE | REJECT | NEED_MORE_SAMPLES`).
- `runMetaLabEvalCli`, `parseMetaLabEvalArgv` — semantic exit codes `0 | 1 | 2`.
- Local Task 189/190 ports in `ports.ts`: `MetaLabBenchmarkRegistryPort`, `PromptContaminationScannerPort`, `ExactInputModelResponseCachePort`, `SimDevDriverPort`, plus `createMockEvalDependencies()` for offline tests.

## Shared Wiring Needs (Root / Index Barrels)

`packages/meta-lab/src/index.ts` and root `package.json` are frozen and were not edited. On integration:

```ts
export {
  ThreeLevelEvalRunner,
  PairedStatisticalPromotionEngine,
  McNemarAndBootstrapCalculator,
  ArtifactLifecycleManager,
  buildPromotionScorecard,
  runMetaLabEvalCli,
} from "./evals/index.js";
export type {
  PromotionDecision,
  PromotionVerdict,
  EvalLevel,
  ArtifactLifecycleState,
} from "./evals/index.js";
```

Add root script when unfrozen:

```json
"meta-lab:eval": "node --import tsx packages/meta-lab/src/evals/cli-entry.ts"
```

(Thin `cli-entry.ts` can call `parseMetaLabEvalArgv` + `runMetaLabEvalCli` and `process.exit(exitCode)`.)

## Dependency Intents (New Packages Requested)

None. Uses Node `crypto` only.

## Contract Change Requests

None.

Sibling swaps (Tasks 189–190 not on base `6497730`):

- `createMockEvalDependencies()` stands in for `MetaLabBenchmarkRegistry`, `PromptContaminationScanner`, `ExactInputModelResponseCache`, and `SimDevDriver`. Wire real implementations from `.agent-handoffs/task-189.md` and `task-190.md` when those branches integrate.
- Task 193 `runRedTeamGate()` should feed `PromotionVetoes.redTeamFailures` on the real promotion path.

## Exact Verification Commands & Results

Commands run from `C:\Users\Ayush\Desktop\ef-wt\task-191-metalab-eval-promotion`.

- `pnpm --filter @ef-harness/meta-lab typecheck` — passed (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/meta-lab lint` — passed (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/meta-lab test -- evals` — passed (Vitest v5.1.1, 4 files, 13 tests, exit 0). Covers McNemar tables `(7,0)→0.015625`, `(3,0)→0.25`, `(2,2)→1.0`; deterministic `10_000`-resample bootstrap reproducibility; quality/efficiency promotion paths; hard vetoes; lifecycle transitions and rollback; Level 1 futility early-stop; Level 2 mocked cache/sim-dev run.
- `node scripts/verify-harmony.mjs --task 191` — passed (`harmony ok for Task-191`, exit 0).

## Known Limitations / Follow-Ups

- Bootstrap analysis runs full `10_000` resamples in-process; acceptable for CI but may be parallelized later.
- `meta-lab/registry.json` persistence is in-memory in `ArtifactLifecycleManager`; file-backed registry lands with Task 200 wiring.
- Level 3 held-out grading uses mock fixtures until Task 189 registry is integrated.