---
task_id: "Task-096"
branch: "task/096-feature-integrator-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/feature-integrator/**"
  - "packages/integrator/tests/feature-integrator/**"
  - ".agent-handoffs/task-096.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 096 handoff

Feature integrator engine for `feature-integrator@1`: zero-checkout `merge-tree` preflight, scoped conflict hunks, one aggregated wiring task, red-before-green feature journey, and `EF-*` trailers. Commit stays on `task/096-feature-integrator-engine`.

## Exports Provided

Import from `packages/integrator/src/feature-integrator/index.ts` until the package barrel is wired:

- `FeatureIntegratorEngine` — claims a feature in `LEAVES_MERGED`, assembles leaf commits onto `refs/heads/harness/f/<feature>`, resolves conflicts, applies one wiring task, runs the journey, and either compare-and-swap lands `refs/heads/harness/integration` (M2 sequential) or returns a Task 111 queue handoff (M3).
- `MergeTreePreflightScanner` — `scan({ repo, ours, theirs })` runs `git merge-tree --write-tree --name-only --messages` and reads conflict hunks from the result tree. No checkout.
- `AggregatedWiringTaskBuilder` — `build(featureId, leaves)` and `repair(task, repair, leaves)`. One `wiring-<featureId>` task owns shared registration files.
- `FeatureJourneyGate` — `evaluate` binds sealed checks, requires red-before-green, runs seam journeys (HTTP, in-memory DB, mailbox), 375 and 1440 viewport checks, and a static-audit pass. `runBoundedFixLoop` stops after 2 repair rounds.
- `parseFeatureIntegratorV1` — local port of `FeatureIntegratorV1Schema` (success object or `{ blocked: true, reason, missing_ids? }`, extra keys rejected).
- `verifyFeatureDoneConditions` — local port of the 7-condition `DONE` gate. Failed ids are `"1"` through `"7"`.
- `InMemoryFeatureLifecycle` — local port of `LifecycleRepo` for `read` / `transition`, including epoch fencing and `FeatureDoneRefusedError` on `MERGED → DONE`.
- `createGitRefCas` — `git update-ref <ref> <new> <expectedOld>` returning `{ ok: false, reason: "cas_mismatch", actualSha }`.
- `assertNoTestWeakening` — AST (`typescript`) plus diff guard for `.skip`, `.only`, deleted assertions, and deleted test files.
- `resolvePreflight`, `resolveConflictText`, `buildScopedConflictPrompt` — hunk packet is conflict bodies plus at most 30 lines of context and the pinned objectives.
- `buildTrailers`, `parseEfTrailers`, `renderCommitMessage`, `receiptSha` — `EF-Feature`, `EF-Tasks`, `EF-Requirements`, `EF-Checks-Passed`, `EF-Harness-Version`.
- Errors: `VacuousSealedCheckError` (`code: "already_green_on_base"`), `DroppedSideError`, `UnrelatedEditError`, `TestWeakeningError`, `ConflictVerificationError`, `FeatureDoneRefusedError`, `StaleEpochError`, `FeatureNotReadyError`, `IntegrationBlockedError`, `CasDriftError`.

The in-engine phase is `INTEGRATING` for the whole claim. `feature_states` has no `INTEGRATING` row. Persisted transitions follow Task 022: `LEAVES_MERGED → WIRED → JOURNEY_PASSED → QUEUED_FOR_MERGE → MERGED → DONE`. M3 stops at `QUEUED_FOR_MERGE` and does not emit `DONE`. `DONE` is written only after `verifyFeatureDoneConditions` returns `{ ok: true, failedConditions: [] }`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is frozen. Re-export the feature integrator from the package barrel:

```ts
export {
  AggregatedWiringTaskBuilder,
  FeatureIntegratorEngine,
  FeatureJourneyGate,
  InMemoryFeatureLifecycle,
  MergeTreePreflightScanner,
  assertNoTestWeakening,
  createGitRefCas,
  parseFeatureIntegratorV1,
  verifyFeatureDoneConditions,
} from "./feature-integrator/index.js";
export type {
  FeatureDoneCheckResult,
  FeatureDoneEvidenceInput,
  FeatureIntegrationRequest,
  FeatureIntegrationResult,
  FeatureIntegratorV1,
  FeatureLifecyclePort,
  RefCasPort,
} from "./feature-integrator/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

## Dependency Intents (New Packages Requested)

None. `assertNoTestWeakening` and `verifyRouteResolution` import `typescript`, which is already a catalog devDependency of `@ef-harness/integrator`. Move `typescript` from devDependencies to dependencies when dependency wiring is allowed. Git is spawned from `PATH`. No new package.

## Contract Change Requests

None. No schema, `.opencode`, or `.githooks` edits.

Sibling branches are not merged. These local ports should be swapped at integration:

- **Task 009.** `parseFeatureIntegratorV1` stands in for `FeatureIntegratorV1Schema` / `FeatureIntegratorV1` from `@ef-harness/shared-contracts`. When that schema is on the barrel, validate model output with it and delete the local parser if the published schema covers the same strict success and blocked shapes.
- **Task 022.** The task text names `FeatureLifecycleManager`. The published sibling export is `LifecycleRepo` (`transitionFeatureState`, `verifyFeatureDoneConditions`, `FeatureDoneEvidenceInput`, `FeatureDoneCheckResult`). `InMemoryFeatureLifecycle` and `verifyFeatureDoneConditions` are the stand-ins. Point `FeatureIntegrationRequest.lifecycle` at `LifecycleRepo`. Do not write `feature_runtime` from this package.
- **Task 039.** The task text names `RefLeaseAndCasManager`. The published sibling export is `RefLeaseManager.advanceRefCas`. `createGitRefCas` performs the compare-and-swap `update-ref` and does not open `ref_leases`. Swap the port so the holder and epoch are fenced in SQLite as well as on `feature_runtime.epoch`.
- **Trailers.** This task's spec requires `EF-Feature`, `EF-Tasks`, `EF-Requirements`, `EF-Checks-Passed`, and `EF-Harness-Version`. Task 039's squash builder emits `Harness-Feature`, `Harness-Task`, `Harness-Attempt`, and `Harness-Checks`. Keep the `EF-*` set here. When the two land together, teach `parseHarnessTrailers` to read the `EF-*` keys (or write both sets from one commit). Do not drop the Task 096 names.
- **Task 055 / Task 060.** The task text names `CleanVerifierHarness` as Task 055. The sibling clean-verifier implementation is Task 060 `CleanVerifierRunner`. `gitSnapshots` (`CleanSnapshotPort.read`) reads the commit tree with `git cat-file` / `git ls-tree`. Swap it for a verifier-slot checkout when Task 060 is wired. Do not deep-import `packages/verifier/src/runner/**`.
- **Task 056 / Task 061.** The task text names `RedBeforeGreenAndBlindBinder` as Task 056. The sibling implementation is Task 061 `RedBeforeGreenGate` and `BlindBinderOrchestrator`. `FeatureJourneyGate` enforces red-before-green itself. `passthroughBinder` is the `BlindBinderPort`. Swap `bind` to `BlindBinderOrchestrator` and, if desired, delegate the base-versus-candidate proof to `RedBeforeGreenGate.evaluate`. `VacuousSealedCheckError.code` stays `already_green_on_base`.
- **Task 054.** `auditTexts` is a local static-audit pass over integrator-owned files (stub markers, `not implemented`, `.skip` / `.only`). Swap for the completeness-gate static audit when that package is exported.
- **Task 057.** Viewport checks execute caller render functions at `375` and `1440`. Swap the render port for `UiPlaywrightContractVerifier` without dropping either width.
- **Task 077.** `SEAM_CATALOG` is an in-memory copy of seam ids `S-01` through `S-10` and their names. Swap for `RulesSeamsCatalogLoader`. Do not deep-import `packages/planner/src/tag-detector/**`.
- **Task 091.** Sealed checks are `SealedCheck.run(snapshot)` supplied by the caller. The gate does not unseal hidden expectations itself.
- **Task 111.** M3 returns `{ target: "Task 111", featureRef, commitSha }` and leaves `feature_runtime.state` at `QUEUED_FOR_MERGE`. M2 sequential mode compare-and-swaps `refs/heads/harness/integration` itself. After Task 111 exists, M2 can hand off the same packet instead of landing.

Wiring-need kinds accepted from leaf packets extend the Task 009 set (`route`, `page`, `export`, `migration`, `env`, `component`) with `nav`, `api`, `seam`, `event`, `queue`, `cron`, `health`, and `di`. Those extensions are integrator input, not `feature-integrator@1` model output.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-096-feature-integrator-engine`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- feature-integrator` — pass. Vitest v5.1.1: 8 files, 28 tests passed, about 53s. Covers real `git merge-tree --write-tree --name-only --messages` conflict paths and hunk ranges, a scoped prompt that keeps 30 lines of context and omits unrelated file text, both-side route resolution with `tsc --noEmit` and `node --test`, dropped-side and unrelated-file rejection, `.skip` / `.only` / deleted-assertion rejection, one wiring task for five leaves, backend queue/cron/health with no UI registration files, red-before-green, `VacuousSealedCheckError` (`already_green_on_base`), the `/api/menu` versus `/api/menu-items` seam repair, local DB and mailbox seam steps, both viewports, a two-round fix cap, all seven `DONE` negatives, squash commits whose parent is the integration base and whose body carries every `EF-*` trailer, preserved history, two isolated M3 queue handoffs that do not move `harness/integration`, compare-and-swap drift that re-runs merge-tree against the new base, open contract-change refusal after `MERGED`, stale epoch fencing, and a blocked model exit.
- `node scripts/verify-harmony.mjs --task 096` — pass (exit 0, `harmony ok for Task-096`, about 78s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- Conflict resolution is deterministic (union of imports, route elements, and export lines) plus an optional `resolutionOverrides` patch. `feature-integrator@1` is given only the scoped hunk packet. A model payload of `{ blocked: true }` stops the claim. A success payload is schema-checked; file bytes still come from the deterministic merge unless overrides are passed. There is no model adapter in this package.
- Route near-miss repair rewrites a mounted path when it is a string prefix of the expected path (`/api/menu` → `/api/menu-items`). Unrelated 404s are reported and not rewritten.
- `MergeTreePreflightScanner.durationMs` is the wall clock of that one `git merge-tree` process. A quiet probe on this host was about 40–58ms. The test allows under 1000ms so a busy Windows spawn during the suite does not flake. Hunk text is then read with `git cat-file` from the result tree, still without a checkout.
- Clean verification reads git trees in-process. It does not create a Task 060 verifier worktree or boot Mailpit, Playwright, or a SQL server. Seam DB and mailbox are process-local. Viewport checks call the supplied render function.
- `createGitRefCas` does not consult `ref_leases`. Epoch fencing is the lifecycle port's `expectedEpoch`.
- `InMemoryFeatureLifecycle` is not `state.db`. It implements the Task 022 edges this engine uses, including the rule that `LEAVES_MERGED` is not reached through `transition`.
- M3 calls on one engine instance do not take a cross-feature lock. Git invocations are synchronous, so overlapping OS parallelism belongs to Task 110. Landing serialization belongs to Task 111.
- Pure backend wiring (no UI route, page, component, or nav need) writes only queue, cron, and health files that were declared. API mounts still write `src/routes.ts`, `src/openapi.ts`, and `src/di-container.ts`, and they do not write `src/app.tsx` or `src/nav.ts`.
