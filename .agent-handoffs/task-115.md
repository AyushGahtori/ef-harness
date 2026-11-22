---
task_id: "Task-115"
branch: "task/115-multi-interpretation-hold-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/holds/**"
  - "packages/steering/tests/holds/**"
  - ".agent-handoffs/task-115.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 115 handoff

Multi-interpretation hold engine: per-reading affected-set traversal, hard vs soft quarantine, an independent hold-reason stack, additive warm resume, and contradictory fresh-session reconstruction. Commit stays on `task/115-multi-interpretation-hold-engine`.

Import from `packages/steering/src/holds/index.ts`. The package barrel `packages/steering/src/index.ts` is intentionally unchanged.

## Exports Provided

- `MultiInterpretationHoldEngine` — for an ambiguous mid-build message with `k >= 2` readings, calls `ReverseImpactWalkerPort.walkCombined` once per reading, holds only `AffectedUnion`, leaves every other active task running, and emits one clarification card. Place and clear run inside a single `BEGIN IMMEDIATE` transaction. `noteVerificationFinished` parks a soft-hold result in `submission_pending` and does not land it. `resolveClarification` clears only the `ambiguous_message_<id>` reason. `tickReminders` surfaces one calm inbox pill after more than 10 minutes when a held task is on the critical path, and it does not guess a reading. `visibility` lists every active hold for the board and the inspector.
- `HoldModeClassifier` — `continue` when the task is outside the union. `HARD_HOLD` when the pending change is contradictory, or when the task is still under 80% and not verifying. `SOFT_HOLD` with quarantine when the task is at least 80% complete or in `VERIFYING` / `CLEAN_VERIFY` and the change is not contradictory. The Orders-at-20% / Reports-verifying-at-95% case is hard on `T-1` and soft on `T-2`.
- `HoldReasonStackCoordinator` — one row per `(task, reason, source)`. Releasing `ambiguous_message_104` does not delete `user_paused_feature` or `ccr_pending_12`. Resume runs only when `activeCount === 0`.
- `AdditiveVsContradictoryResumer` — equal `sliceSha256` resumes the existing checkpoint. A strict addition injects one SHA-256 signed steering note on that same session and keeps WIP. A contradictory delta (`REST`/`GraphQL`, `SQLite`/`Postgres`, `11:00`/`10:00`, a removed requirement, or `changeKind: "contradictory"`) opens a fresh session. Salvageable files are labeled `Unverified prior draft — verify against new brief`. Files that still contain the contradicted token are discarded. The previous transcript is not appended.
- `openHoldDatabase` / `HoldStore` / `withImmediateTransaction` — in-memory (or file) SQLite fixture. `task_holds` keeps the frozen columns `(task, reason, source, created_at)`.
- `LocalReverseImpactWalker`, `LocalWorkerSession`, `LocalCandidateAcceptanceTx`, `LocalInbox`, `LocalHoldSurfaces` — test doubles and the swap points below.
- Helpers: `ambiguousHoldExplanation`, `selectReadings`, `kernelReasonFor`, `holdKey`, `compileBrief`, `classifyDelta`, `signSteeringNote`.

Quarantine release: when the clarification leaves the soft-held brief unchanged and `feature_heads` still matches the candidate base, `CandidateAcceptancePort.accept` lands it with `workerModelTurn: false` and the measured commit stays under 1 second. If the feature head moved, `reverify` runs first. A failed re-verify does not land the stale commit, and `mergeDecision` stays blocked. "Apply to both" discards the now-stale quarantined commit and runs the delta resumer on each selected reading.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/steering/src/index.ts` on this branch. Integration should add:

```ts
export {
  AdditiveVsContradictoryResumer,
  HoldModeClassifier,
  HoldReasonStackCoordinator,
  MultiInterpretationHoldEngine,
  openHoldDatabase,
} from "./holds/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or `packages/steering/package.json` change. The implementation uses `node:sqlite` and `node:crypto` only.

Wire the engine with the sibling repositories below once their barrels are on `harness/integration`. Until then the engine takes the local ports in its constructor.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for frozen root manifests. These vocabulary and schema additions are required for a later integration pass. This task does not edit `schema/` or package barrels.

1. Frozen `task_holds` is `(task, reason, source, created_at)` with reasons `user_pause | requirement_change | budget | ccr | governor`. This engine maps `ambiguous_message_*` and other requirement changes to `requirement_change`, `user_paused_*` to `user_pause`, and `ccr_*` to `ccr`. The full identity (`ambiguous_message_104`, `user_paused_feature`, `ccr_pending_12`) is stored in `source`, so rows stay independent. `mode` is not a column on `task_holds`. `hold_reason_details` stores `reason_type`, `reason_ref_id`, `mode` (`HARD_HOLD` | `SOFT_HOLD`), and `quarantine`. Swap `HoldReasonStackCoordinator.stage` / `deleteWithinTransaction` for `TaskHoldAndSubmissionRepo.placeHold` / `releaseHold` once that vocabulary and a mode column (or a side table) exist.
2. `openHoldDatabase` also creates `task_checkpoints`, `feature_heads`, `ambiguous_readings`, `hold_reading_hits`, `clarification_cards`, `quarantined_candidates`, and `ambiguity_reminders`. Those tables are local until a migration adds them. The fixture's `task_runtime` matches the frozen column list but omits the foreign keys to `nodes` and `task_states` so the package can run without Task 013. Integration should use the real `state.db` connection.
3. `VERIFYING` is the spec phase name. The frozen task state for that phase is `CLEAN_VERIFY`. The classifier treats both as verifying.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-115-multi-interpretation-hold-engine`:

- `pnpm --filter @ef-harness/steering typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/steering lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/steering test -- holds` — exit 0. Vitest 5.1.1: 1 file, 13 tests passed. Covers union traversal (hard hold on `T-1` at 20%, soft quarantine on `T-2` verifying at 95%, `T-3` F-Auth unheld), one clarification card, the exact sentence `Held: waiting to confirm whether 'export timestamps' applies to Orders or Reports` on the board and the inspector, merge blocked while the soft hold is open, favorable quarantine land in under 1 second with zero model turns, base-drift re-verify, failed re-verify refusing the stale commit, `user_paused_feature` surviving clearance of `ambiguous_message_104`, additive warm resume with a signed aria-label note, contradictory fresh session that does not append onto the SQLite transcript and labels `ui.css` as an unverified draft, "apply to both" discarding `T-2`'s quarantined commit, 12 holds in one `BEGIN IMMEDIATE` with full rollback on a mid-set fault (place and clear), and a single calm reminder only after more than 10 minutes on a critical-path hold.
- `node scripts/verify-harmony.mjs --task 115` — exit 0, `harmony ok for Task-115` (schema 67/67, diagram check, workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not merged. Base is `649773097c387ae534b686ea5825f449f843aa7c` (`foundation/task-001-complete`). `harness/integration` had moved to `30f2e9c` and `pnpm install --frozen-lockfile` fails there because `packages/shared-contracts/package.json` depends on `zod` while `pnpm-lock.yaml` does not. This worktree was created with `node scripts/agent-worktree.mjs create 115 multi-interpretation-hold-engine --base 6497730`. These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

| Local port | Replace with |
|---|---|
| `ReverseImpactWalkerPort` / `LocalReverseImpactWalker.walkCombined` | Task 087 `ReverseImpactWalker.walkCombined`. Use `affectedActiveTasks` as the per-reading impact. |
| `HoldReasonStackCoordinator` + `task_holds` writes in `HoldStore` | Task 021 `TaskHoldAndSubmissionRepo.placeHold` / `releaseHold` / `listActiveHolds`. Map `source` to the reason ref and keep modes in `hold_reason_details` until `mode` is a real column. |
| `WorkerSessionPort` / `LocalWorkerSession` | Task 053 `NativeWorkerLoop` checkpoint interrupt, resume, and signed steer injection. `reconstructFreshSession` swaps to Task 150 foreign-runtime fresh resume and Task 088's newly compiled brief. |
| `CandidateAcceptancePort` / `LocalCandidateAcceptanceTx` | Task 060 `CandidateAcceptanceTx`. Call it only after the ambiguous hold row is cleared and the base head is fresh or re-verified. |
| `compileBrief` | Task 088 knowledge-packet slicer. The resumer already compares `sliceSha256` with the compiled brief. |
| Ambiguous `alternateReadings` on `AmbiguousMidBuildMessage` | Task 113 `OrderedMultiClauseExecutor` / `router@1` output. This engine does not classify the message; it consumes `k >= 2` readings. |
| `InboxPort.publishReminder` | Task 116 / Task 127 calm inbox pill. `autoGuessed` is fixed `false`. |
| `HoldSurfacePort.publish` / `visibility` | Task 124 board held-lane reasons and Task 126 inspector. Both surfaces receive the same explanation rows. |
| `openHoldDatabase` | Task 013 `ProjectStateDb` once the extra tables and the hold-mode vocabulary are migrated. |

Early affected work is a hard hold even when only one of the readings touches it, so a 20% Orders task stops at the step boundary. Soft quarantine is the nearly finished or verifying task whose reading might turn out not to apply. A contradictory change is always a hard hold, including during verification, so obsolete work does not keep spending tokens.

`AdditiveVsContradictoryResumer` treats an unlabeled hash change that is not a strict extension as contradictory. That keeps a confused session from receiving a mixed instruction. Point token pairs at the Task 081 contradiction engine if integration wants a richer delta than `REST`/`GraphQL`, `SQLite`/`Postgres`, and `11:00`/`10:00`.
