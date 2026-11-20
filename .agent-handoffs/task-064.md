---
task_id: "Task-064"
branch: "task/064-ai-eval-property-mutation-probes"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/advanced/**"
  - "packages/verifier/tests/advanced/**"
  - ".agent-handoffs/task-064.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 064 handoff

AI feature verification (stub shell, output properties, cross-family judge, replay cassette), selective fast-check property checks, and targeted TypeScript AST boundary-mutation probes. Commit stays on `task/064-ai-eval-property-mutation-probes`.

## Exports Provided

Public entry: `packages/verifier/src/advanced/index.ts`.

- `AiFeatureVerifier` — `runShell`, `checkOutput`, `runJudge`, `verify`. Surface id `ai_eval`. Implements the local `SurfaceVerifierAdapter` port.
- `AiEvalVerdict` — always `{ passedCount, totalCount, threshold, criticalFailures, scoreLabel }` plus rubric author `oracle-author@1`, threshold version, families, sample count, and warnings. `scoreLabel` is `8/10 (threshold 8/10)` form. A critical failure forces `passed: false`.
- `PropertyCheckRunner` — `run`, `reproduce`. Invariants: `conservation_of_totals`, `idempotence`, `sort_order_preservation`, `integer_minor_unit_money_rounding` (`ruleId: "X-04"`). Receipt stores seed, fast-check path, shrunk counterexample, and initial failure size.
- `roundHalfAwayFromZero` — the X-04 integer minor-unit rule (half away from zero).
- `TargetedBoundaryMutationProber` — `probe`. Operators: `flip_comparison`, `invert_role_guard`, `drop_role_guard`, `empty_boundary_return`. Surviving mutants become `weakCheckGaps` routed to `oracle-author@1`.
- `mutantTimeoutMs` — `min(baselineMs * 3, maxTimeoutMs)` with max default `10000`.
- `planTwoTierVerification` — baseline `red_before_green` + `held_back_examples`. Adds `PropertyCheckRunner` for tag `invariant_domain` and `TargetedBoundaryMutationProber` for tag `high_impact_boundary`.
- `FakeModelAdapter`, `StubModel`, `ReplayCassette`, `ReplayCassetteStaleError`, `EvalSetSizeError`, `JudgeFamilyError`.
- `checkOutputProperties`, `RubricScoreSchema`, `parseRubricScore`, `ProductQualityDecisionNode`.
- Local ports in `ports.ts`: `SurfaceVerifierAdapter`, `SurfaceCheckResult`, `SurfaceVerifierContext`, `ModelProtocolAdapter`, `ModelFamilyProfile`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/verifier/src/index.ts` is frozen and was not edited. On integration, re-export the advanced entry from that barrel:

```ts
export {
  AiFeatureVerifier,
  PropertyCheckRunner,
  TargetedBoundaryMutationProber,
  planTwoTierVerification,
  FakeModelAdapter,
  StubModel,
  ReplayCassette,
  ReplayCassetteStaleError,
  roundHalfAwayFromZero,
  checkOutputProperties,
  mutantTimeoutMs,
} from "./advanced/index.js";
export type {
  AiEvalVerdict,
  SurfaceVerifierAdapter,
  SurfaceCheckResult,
  SurfaceVerifierContext,
  ModelProtocolAdapter,
  ModelFamilyProfile,
  ModelCompletionRequest,
  ModelCompletionResult,
  PropertyCheckReceipt,
  PropertyCheckRequest,
  BoundaryProbeReport,
  BoundaryProbeRequest,
  WeakCheckGap,
  TwoTierVerificationPlan,
  ProductQualityDecisionNode,
  EvalCase,
  JudgeRunReport,
  ShellFeature,
  ShellReport,
} from "./advanced/index.js";
```

No root script, workspace, or tsconfig edits.

`AiFeatureVerifier.verify` emits `SurfaceCheckResult` rows `{taskId}:shell`, `{taskId}:output_properties`, and `{taskId}:judge`. Pass `surfaceInput` on `SurfaceVerifierContext` with `{ shell, output, judge }`. Judge outage is status `pending` and task status `verified_except_quality`. `dependentsAllowed` is true only when the caller set `developerAllowsDependents`.

Quality is a versioned `ProductQualityDecisionNode` (`id`, `version`, `minPassed`, `total`, `maxCriticalFailures`). `runJudge(cases, adapter, node)` reads that node, so a product decision can tighten or loosen the threshold without a code change. `criticalFailures > 0` vetoes the aggregate.

## Dependency Intents (New Packages Requested)

`packages/verifier/package.json` is frozen, so these declarations were not added:

- `fast-check` — already a root devDependency (`^4.1.0`, resolved 4.10.3). `PropertyCheckRunner` imports `check`, `property`, and the arbitraries. Add it to `@ef-harness/verifier` dependencies so resolution does not depend on walking up to the workspace root `node_modules`.
- `zod` — already a root devDependency (`^3.25.0`, resolved 3.25.76). The closed rubric schema and output-property checker import it. Add it to `@ef-harness/verifier` dependencies for the same reason.
- `typescript` — already a devDependency of `@ef-harness/verifier`. The prober uses the compiler AST and `transpileModule`. No new package.

## Contract Change Requests

None. No frozen schema or sibling package was edited.

Sibling swaps, recorded here because Tasks 053 and 060 are not on this base:

- `SurfaceVerifierAdapter` in `packages/verifier/src/advanced/ports.ts` is a local port for Task 060. Do not import the unpublished runner. When `packages/verifier/src/runner` is integrated, implement that task's `SurfaceVerifierAdapter` instead of this port and keep passing AI input on `surfaceInput`.
- `ModelProtocolAdapter.complete()` is a local completion port, not Task 053's streaming adapter. Do not import `@ef-harness/worker-loop`. When Task 053 lands, adapt the final streamed text into `ModelCompletionResult` (`stop`, `malformed_json`, `empty`, `rate_limited`, `timeout`, `over_budget`, `unavailable`). `FakeModelAdapter` remains the unit-test double and performs no network I/O.

Judge family rule: if two or more families are connected and the requested judge family equals the generator family, initialization selects the other family (`auto_cross_family`) and `runJudge` rejects an adapter from the generator family. A single connected family records `single_family_judge_warning` on the verifier receipt.

## Exact Verification Commands & Results

Commands were run from `C:\Users\Ayush\Desktop\ef-wt\task-064-ai-eval-property-mutation-probes`.

- `pnpm --filter @ef-harness/verifier typecheck` — passed (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/verifier lint` — passed (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/verifier test -- advanced` — passed. Vitest v5.1.1, 4 files, 26 tests, exit 0. Covers stub-shell malformed JSON, retry, rate-limited and timeout recovery, fallback, and cost cap; judge threshold `8/10 (threshold 8/10)`; critical-failure veto at 9/10; one format-repair retry; `verified_except_quality` when the judge is unavailable; cassette replay at cost 0 and `ReplayCassetteStaleError` on a changed prompt; X-04 shrink plus seed/path replay; 500-line conservation shrink to `[{ label: "A", quantity: 0 }, { label: "A", quantity: 1 }]`; AST flip of `<=` to `<` with `Array<Order>` preserved; surviving mutant without the equality case; killed mutant once `=== cutoff` is checked; infinite-loop mutant timeout marked killed.
- `node scripts/verify-harmony.mjs --task 064` — passed (`harmony ok for Task-064`, exit 0). The gate also ran schema 67/67, diagram integrity, and workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- `fast-check` and `zod` are used but not declared on `@ef-harness/verifier` until the frozen package manifest can be updated. They resolve today through the workspace root install.
- Mutation probes copy the checkout into a temp directory, splice one AST site, emit ESM with `typescript.transpileModule`, and run the acceptance entry with `node`. They do not call Task 060 `CleanVerifierRunner`. The scratch directory is removed in `finally`. The candidate checkout is only read.
- Relational flips apply to boundary comparisons (cutoff, limit, loop conditions such as `i < n`), not to every operator in a repository and not to generic type arguments.
- The X-04 rule implemented here is half away from zero on safe-integer ratios. Task 077 can pass a subject to `PropertyCheckRunner` with invariant `integer_minor_unit_money_rounding`.
- Task 065's fresh-example generator can call `PropertyCheckRunner` later. This branch does not import Task 065.
- Unit tests use `FakeModelAdapter` and `StubModel` only. There are no live model calls.
