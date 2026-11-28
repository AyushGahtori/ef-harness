---
task_id: "Task-170"
branch: "task/170-brownfield-baseline-test-health"
base_commit: "649773097c387ae534b686ae5825f449f843aa7c"
owned_paths:
  - "packages/brownfield/src/test-health/**"
  - "packages/brownfield/tests/test-health/**"
  - ".agent-handoffs/task-170.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 170 handoff

Brownfield baseline test-health runner: isolated worktree baseline execution, known-failing quarantine, 3× flake detector, broken-build entry gate, zero-test characterization safety-net planner, multi-ecosystem reporter parsing, HEAD+lockfile cache, and dirty-tree leak detection. Commit stays on `task/170-brownfield-baseline-test-health`.

## Exports Provided

Import from `packages/brownfield/src/test-health/index.ts` (not the frozen package barrel):

- `BaselineTestHealthRunner` — `run({ repoRoot, baselineCommitSha })` checks out an isolated worktree slot, runs detected `typecheck` / `build` / `lint` / `test`, classifies results, caches by `(HEAD, lockfileSha256)`, and persists baseline receipts
- `KnownFailingQuarantineStore` — `recordFromBaseline`, `evaluateRegressionGate` (zero new regressions on passing baseline tests), `warnQuarantineInModifiedFiles`
- `ThreeRunFlakeDetector` — `classifyInitialFailures` with `0/3` → `known_failing`, `1/3`–`2/3` → `baseline_flaky`, `3/3` → `passing`
- `BrokenBuildEntryGate` — stops on baseline compile/build/typecheck failure with three honest choices
- `CharacterizationSafetyNetPlanner` — `P0.B-Char` plans 3–8 characterization tests when zero coverage; `verifyBaselineGreen` rejects inaccurate tests on untouched baseline
- `parseTestReporterOutput` — Vitest/Jest JSON, Playwright suites, JUnit, node TAP, Go `-json` lines
- `BaselineHealthCache`, `buildBaselineCacheKey`, `checkWorktreeClean`, `errorFingerprint`, `stableTestId`
- In-memory ports: `InMemoryWorktreeSlotPool`, `ScriptedHarnessRunEngine`, `InMemoryGitWorktreeInspector`, `StubBrownfieldL0RepoScanner`, `InMemoryBaselineTestHealthStore`, `InMemoryQuarantinedTestsStore`

## Shared Wiring Needs (Root / Index Barrels)

`packages/brownfield/src/index.ts` is frozen. Integration should re-export the test-health barrel when allowed:

```ts
export {
  BaselineTestHealthRunner,
  KnownFailingQuarantineStore,
  ThreeRunFlakeDetector,
  CharacterizationSafetyNetPlanner,
  BrokenBuildEntryGate,
  parseTestReporterOutput,
} from "./test-health/index.js";
```

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

Local ports stand in for dependencies not on this base:

- Task 038 `WorktreeSlotPool` → `WorktreeSlotPoolPort` / `InMemoryWorktreeSlotPool`
- Task 048 `HarnessRunEngine` → `HarnessRunEnginePort` / `ScriptedHarnessRunEngine`
- Task 050 `TestEnvOrchestrator` → sandbox runs routed through `HarnessRunEnginePort`
- Task 166 `BrownfieldL0RepoScanner` → `BrownfieldL0RepoScannerPort` / `StubBrownfieldL0RepoScanner` (`detectScripts`)
- `state.db.baseline_test_health` / `baseline_quarantined_tests` → `BaselineTestHealthStorePort` / `QuarantinedTestsStorePort` in-memory stand-ins until Task 013 wiring lands

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-170-brownfield-baseline-test-health`:

- `pnpm --filter @ef-harness/brownfield typecheck` — pass
- `pnpm --filter @ef-harness/brownfield lint` — pass
- `pnpm --filter @ef-harness/brownfield test -- test-health` — pass
- `node scripts/verify-harmony.mjs --task 170` — pass

## Known Limitations / Follow-Ups

- Real git worktree checkout/release and Task 048 sandbox execution are exercised via scripted in-memory ports; wire to production `WorktreeSlotPool` and `HarnessRunEngine` on integration.
- Pytest and Cargo stdout parsers accept JUnit/TAP today; add native pytest-json and cargo `--message-format` collectors when multi-language fixtures land in Task 175.
- Characterization test generation is planner-only (no LLM codegen); Task 175 may attach a worker template for authoring the actual test files.