---
task_id: "Task-183"
branch: "task/183-investigation-localization-toolkit"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/investigations/src/localization/**"
  - "packages/investigations/tests/localization/**"
  - ".agent-handoffs/task-183.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 183 handoff

Investigation localization toolkit: flake-safe git bisection, cross-browser differential runner, `ddmin` input shrinker, hypothesis loop guard, and AST/diff symptom-patch detector for Stage 3–5 mystery-bug work. Commit stays on `task/183-investigation-localization-toolkit`.

## Exports Provided

Public module: `packages/investigations/src/localization/index.ts`.

Required by Tasks 182, 189, and 200:

- `FlakeSafeGitBisector` — 5/5 stability pre-check, exact failure-fingerprint matching with exit `125` skip, bounded bisect (`<= 256` commits / `<= 8` steps), suspect revert verification (`3/3`), shallow-clone flagging, CAS artifact ref
- `CrossBrowserDiffRunner` — Chromium / WebKit / Firefox differential Playwright repro snapshots with divergence JSON, missing-WebKit `ToolCard` hint (Task 121 local port)
- `DeltaDebuggingInputShrinker` — classic `ddmin` with `<= 40` evaluation cap and exact fingerprint preservation
- `HypothesisLoopGuard` — duplicate falsified hypothesis block and `tunnel_vision_trigger` pivot after 3 narrow misses
- `SymptomPatchDetector` — deterministic diff inspection for empty catch, arbitrary delay masks, crash-site guards, and test weakening
- `LocalizationArtifactStore` — in-memory CAS refs for bisect suspect, browser diff, `ddmin` fixture, and symptom-patch audit (Task 028 integration port)
- `normalizeFailureFingerprint` / `fingerprintsMatch` / `stripVolatileTokens` — volatile token stripping before hashing
- Port types: `MinGitRepoInspectorPort`, `WorktreeSlotPoolPort`, `BrowserRunnerPort` for Tasks 035, 038, and 057 wiring
- Error types: `FlakyReproBlocksBisectError`, `ShallowCloneBisectLimitedError`, `BisectDepthExceededError`, `DdminEvaluationBudgetExceededError`, `DuplicateFalsifiedHypothesisError`

## Shared Wiring Needs (Root / Index Barrels)

`packages/investigations/src/index.ts` is outside this task's owned write scope. Re-export the localization surface during integration:

```ts
export {
  FlakeSafeGitBisector,
  CrossBrowserDiffRunner,
  DeltaDebuggingInputShrinker,
  HypothesisLoopGuard,
  SymptomPatchDetector,
  LocalizationArtifactStore,
  normalizeFailureFingerprint,
  fingerprintsMatch,
  FlakyReproBlocksBisectError,
} from "./localization/index.js";
export type {
  BisectRunResult,
  CrossBrowserDiff,
  DdminShrinkResult,
  SymptomPatchAudit,
  HypothesisLedgerEntry,
} from "./localization/index.js";
```

Integration swaps (local ports on this branch):

- `MinGitRepoInspectorPort` → Task 035 `MinGitRepoInspector` (`isShallowRepository`, `rev-list` depth)
- `WorktreeSlotPoolPort.withScratchWorktree` → Task 038 scratch quarantine for bisect runs
- `BrowserRunnerPort` → Task 057 `UiPlaywrightContractVerifier` Playwright engines (Chromium/WebKit/Firefox)
- `LocalizationArtifactStore.put` → Task 028 `CasBlobStore` for Investigation Receipt attachments (Task 182)

No root manifest, workspace, eslint, or schema edits.

## Dependency Intents (New Packages Requested)

None. Uses `node:child_process`, `node:crypto`, and `node:fs` consistent with other Layer 4 packages.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-183-investigation-localization-toolkit`:

- `pnpm --filter @ef-harness/investigations typecheck` — pass (`tsc -b --pretty false`, exit 0)
- `pnpm --filter @ef-harness/investigations lint` — pass (`eslint .`, exit 0)
- `pnpm --filter @ef-harness/investigations test -- localization` — pass. Vitest v5.1.1, 1 file, 12 tests, exit 0, ~36 s. Covers real 10-commit temp-git bisect (skip broken #4, nail regression #6, revert verify), `ddmin` 200→2 shrink, all four symptom-patch patterns plus legitimate fix allowed, hypothesis duplicate/tunnel guard, cross-browser divergence + missing WebKit hint, fingerprint normalizer.
- `node scripts/verify-harmony.mjs --task 183` — pass (recorded at commit time)

## Known Limitations / Follow-Ups

- Consumers cannot import localization tooling from `@ef-harness/investigations` until the barrel lines above land at integration.
- `CrossBrowserDiffRunner` uses a `BrowserRunnerPort` stub in tests; wire Task 057 Playwright at integration.
- `FlakeSafeGitBisector` runs checkout-based bisect steps in the target repo (not a separate `git bisect run` subprocess wrapper); behavior matches exit `0`/`1`/`125` semantics from investigations-and-sweeps.md.
- Task 182 pipeline should attach `LocalizationArtifactStore` refs into `InvestigationReceiptStore` when both tasks integrate.