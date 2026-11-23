---
task_id: "Task-189"
branch: "task/189-metalab-benchmark-registry"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/meta-lab/src/benchmarks/**"
  - "packages/meta-lab/tests/benchmarks/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 189 handoff

Meta-Lab frozen benchmark registry with seven SHA-256 pinned suites, integrity loader, prompt contamination scanner, and offline resume-changer manifest parity. Commit stays on `task/189-meta-lab-benchmark-registry`; never merge.

Sibling branches `105`, `175`, `182`–`185`, and `193` are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). This branch wires them through compact offline fixtures and local ports documented below until those packages land on `harness/integration`.

The pinned brownfield manifest is read only from `resume-changer-benchmark.json` via `CANONICAL_ASSETS.resumeChangerBenchmark`. This branch does not edit it.

## Exports Provided

Import from `packages/meta-lab/src/benchmarks/index.ts` until the package root barrel is allowed to re-export.

- `MetaLabBenchmarkRegistry` — registers all 7 canonical suites (`kitchen-web`, `resume-changer-brownfield`, `expense-cli`, `booking-api`, `ten-bug-set`, `sweep-set`, `red-team-security`) with dev vs held-out splits, smoke/tag filtering, and `manifestLedger()`.
- `FrozenSuiteIntegrityLoader` — `load(registry)` verifies SHA-256 fixture pins; `verifyTenBugBaselines(registry)` materializes each bug fixture and proves graders fail on untouched baselines; `assertComparableVersions` / `stampReceipt` bind split + digest on receipts.
- `PromptContaminationScanner` — scans candidate prompt/skill text against held-out fixture fingerprints (exact strings + n-grams); `hardFail: true` throws `BenchmarkContaminationError`.
- `SEVEN_SUITE_DEFINITIONS` / `SUITE_IDS` / `buildSevenSuiteDefinitions()` — version `suite_v1.0` definitions with computed manifest digests.
- `materializeBenchmarkCase` / `cleanupAllHermeticWorkspaces` — hermetic temp workspaces copying fixtures to `repo.json`; resume-changer sets `liveCloneSkippedOffline`.
- `loadResumeChangerBenchmarkManifest` / `verifyResumeChangerManifestParity` — offline parity for commit `497831ec`, 73 docs, 17 plan files, 4906 plan lines.
- `BenchmarkVersionLedger` — rejects comparisons across mismatched manifest digests.
- `GradeResult` / `BenchmarkReceipts` / `SuiteId` types and grader contract (`grade(builtRepoPath, receipts)`).
- `createCanonicalHash` — local Task 007 hash port (`sha256`, `sha256Utf8`, `stableJson`).

## Shared Wiring Needs (Root / Index Barrels)

When `packages/meta-lab/src/index.ts` can change, re-export the benchmarks barrel:

```ts
export * from "./benchmarks/index.js";
```

When `packages/meta-lab/package.json` exports can change, add a subpath:

```json
"./benchmarks": {
  "types": "./dist/benchmarks/index.d.ts",
  "import": "./dist/benchmarks/index.js"
}
```

No root `package.json` script changes required for this task.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Consumes `canonicalAssetAbsolute("resumeChangerBenchmark")` from `@ef-harness/shared-contracts` read-only.

## Sibling swaps (branches not on this base)

| Local port | Missing sibling | Swap |
| --- | --- | --- |
| Self-contained JSON fixtures under `packages/meta-lab/src/benchmarks/fixtures/**` | `KitchenHiddenAcceptanceSuite` (Task 105), full kitchen seed repo | Replace fixture JSON with real hidden-suite metadata + repo materialization when Task 105 lands. |
| `gradeResumeChanger` + manifest parity helper | `ResumeChangerBenchmarkVerifier` (Task 175) | Call Task 175 verifier for live clone paths; keep offline manifest parity in CI. |
| `gradeBugFixture` baselines | Tasks 182–183 investigation engines | Swap grader bodies; keep registry IDs and manifest pins stable. |
| `gradeSweepFixture` | Tasks 184–185 sweep engines | Same pattern. |
| `gradeRedTeamFixture` | Task 193 red-team execution | Replace fixture grades with live hostile-run receipts. |

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/shared-contracts build
pnpm --filter @ef-harness/meta-lab test -- benchmarks
pnpm --filter @ef-harness/meta-lab typecheck
pnpm --filter @ef-harness/meta-lab lint
node scripts/verify-harmony.mjs --task 189
```

Results (2026-11-23, worktree `task/189-metalab-benchmark-registry`):

- `pnpm --filter @ef-harness/meta-lab test -- benchmarks` — 9/9 passed
- `pnpm --filter @ef-harness/meta-lab typecheck` — exit 0
- `pnpm --filter @ef-harness/meta-lab lint` — exit 0
- `node scripts/verify-harmony.mjs --task 189` — run at commit gate

## Known Limitations / Follow-Ups

- Graders operate on compact offline `repo.json` slices; Task 190–191 should drive full harness runs once sim-dev and paired eval runners exist.
- Resume-changer materialization does not clone GitHub; `liveCloneSkippedOffline` is explicit on materialized cases.
- Kitchen hidden acceptance (`>= 25` checks from Task 105) is represented by held-out kitchen fixture fingerprints only on this base.