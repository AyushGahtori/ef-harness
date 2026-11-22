---
task_id: "Task-130"
branch: "task/130-reentry-reconciliation-welcome-back"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/steering/src/reentry/**"
  - "packages/steering/tests/reentry/**"
  - "apps/renderer/src/cockpit/welcome-back/**"
  - "apps/renderer/tests/welcome-back/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 130 handoff

Cold-open reconciliation, the no-run-until-resume gate, commit-answered question detection, and the welcome-back screen. Commit stays on `task/130-reentry-reconciliation-welcome-back`.

## Exports Provided

From `packages/steering/src/reentry/index.ts` (package-local barrel; the frozen package barrel is not edited):

- `ColdOpenReconciler`
- `CommitAnsweredQuestionDetector` and `detectCommitAnsweredQuestions`
- `NoRunUntilResumeGate` and `ReentryBlockedError`
- `reconcileAfterWake` and `classifyWake`
- `ReconciledActionQueue` and `confirmationForResumeBuild`
- `toWelcomeBackModel`
- `InMemoryReentryStore` and `createFileIndexLockPort`
- Read-only adapters: `createReconcilePorts`, `createNodeGitInspector`, `createFileViewScanner`, `createFileLockHasher`, `createDiskHeadroomPort`, `createHumanStepProbeRegistry`, `decideLockSafety`, `assertReadOnlyGitArgs`

From `apps/renderer/src/cockpit/welcome-back/index.ts`:

- `WelcomeBackScreen` and `renderWelcomeBack`
- `WelcomeBackModel`, `WelcomeButton`, `WelcomeChoice`

`NoRunUntilResumeGate` holds `REENTRY_AWAITING_RESUME` until reconciliation has finished and the developer clicks `Resume` or `Resume Build`. `Review Drift First` / `Review changes first` leaves the awaiting phase and still blocks workers, file edits, token spend, and git. `Stay Paused` keeps that block. A missing project folder withholds resume clearance until `ReconciledActionQueue` records a relocate.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit these frozen barrels in this task. Integration should add:

`packages/steering/src/index.ts`

- `export { ColdOpenReconciler, CommitAnsweredQuestionDetector, NoRunUntilResumeGate, ReentryBlockedError, reconcileAfterWake, ReconciledActionQueue, confirmationForResumeBuild, toWelcomeBackModel } from "./reentry/index.js";`
- `export type { ColdOpenInput, ColdOpenReport, WelcomeBackModel, ResumeConfirmation, WakeInput, WakeReconciliation } from "./reentry/index.js";`

`apps/renderer/src/index.ts`

- `export { WelcomeBackScreen, renderWelcomeBack } from "./cockpit/welcome-back/index.js";`
- `export type { WelcomeBackModel, WelcomeChoice } from "./cockpit/welcome-back/index.js";`

Task 131 should call `reconcileAfterWake` from `powerMonitor` resume. Sleep under 10 minutes with no repo, network, or offline change is the fast path (`fullReport === null`, no worker dispatch). Sleep over 30 minutes, or any repo/network/offline change, runs `ColdOpenReconciler` and holds the gate. The shell should render `WelcomeBackScreen` from `toWelcomeBackModel(report, input)` and send `Resume Build` through `ReconciledActionQueue.apply`.

## Dependency Intents (New Packages Requested)

No new package.

`@ef-harness/renderer` should depend on `@ef-harness/steering` so the cockpit can import `ColdOpenReport` and `toWelcomeBackModel` from the steering barrel. `package.json` is frozen here, so `WelcomeBackScreen` takes a structural `WelcomeBackModel` and does not import steering. The field names match `toWelcomeBackModel`.

## Contract Change Requests

No shared-contract schema change. Sibling branches are not on this base. Local ports stand in for them:

- Task 035 `MinGitRepoInspector` → `MinGitRepoInspectorPort` / `createNodeGitInspector` (read-only `status`, `rev-parse`, `log`, `diff-tree`, `rev-list`, `merge-base` only)
- Task 038 `WorktreeSlotPool` → `WorktreeSlotPoolPort` / `createFileWorktreePool` (detects present, stale, locked, deleted; does not recreate during the scan)
- Task 085 `ViewManifestHashScanner` → `ViewManifestHashScannerPort` / `createFileViewScanner` (hashes `.harness/views/**/*.md`)
- Task 116 `SharedQuestionArbiter` → `SharedQuestionArbiterPort.listOpen`
- Task 121 `HumanStepProbeRegistry` → `HumanStepProbeRegistryPort` / `createHumanStepProbeRegistry` (pending and failed steps are reprobed during the scan)
- Task 122 `SingleAppShell` → `SingleAppShellPort.closeReason` (`crash` and `parked` escalate the reopen reason)
- Task 118 disk headroom → `DiskHeadroomPort` / `createDiskHeadroomPort` (`statfs`; below 5 GB is low headroom)
- Task 016 `state.db` → `ReentryStateStore` / `InMemoryReentryStore` (checkpoint salvage, confirmed closes, relocate). SQLite persistence stays with the db package
- Task 151 conformance → `request_cli_conformance` is recorded on resume and not executed
- Task 171 base sync → `include_manual_commits`, `include_lockfile`, and `import_view_edits` are recorded only after explicit confirmation. No merge, checkout, or lockfile rewrite
- Task 173 human-fix bridge → commit-answered matches stay `autoClosed: false` until `verifyMatchIds` confirms them

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-130-reentry-reconciliation-welcome-back`:

- `pnpm --filter @ef-harness/steering typecheck` — passed (`tsc -b`)
- `pnpm --filter @ef-harness/renderer typecheck` — passed (`tsc -b`)
- `pnpm --filter @ef-harness/steering lint` — passed
- `pnpm --filter @ef-harness/renderer lint` — passed
- `pnpm --filter @ef-harness/steering test -- reentry` — passed, 5 files, 30 tests
- `pnpm --filter @ef-harness/renderer test -- welcome-back` — passed, 1 file, 3 tests
- `node scripts/verify-harmony.mjs --task 130` — passed (`harmony ok for Task-130`)

Covered by those tests: the gate blocks worker start, file edits, token spend, and git until explicit Resume; all 7 domains report crash orphans, stale/locked/deleted worktrees, manual commits, dirty files, offline `.harness/views/` edits, lockfile drift, expired tokens, reset allowances, CLI upgrades, and auto-verified human steps in under 2 seconds; commit-answered detection offers verification and does not auto-close; a missing folder returns `Project folder moved — Locate folder` and a live or younger-than-60-second `.git/index.lock` is not deleted.

## Known Limitations / Follow-Ups

- The screen is a deterministic view model and plain-text layout. The renderer package has no UI toolkit dependency, and `package.json` cannot gain one here.
- Confirmed view imports, manual commits, and lockfile includes are store records for Task 171. They do not edit the user repo or move `harness/integration`.
- Worktree recreation is recorded for Task 038 only when the developer confirms it. The scan never runs `git worktree`.
- CLI conformance is a recorded request for Task 151, not a suite run.
- Confirming a commit-answered task records the id for Task 173. This task does not re-run the failing checks.
- Human-step probes may flip the registry port's own status during the scan. That is not a user-repo write. `state.db` learns the id on Resume through `ReentryStateStore`.
- The only user-repo filesystem change on Resume is deletion of a `.git/index.lock` that is at least 60 seconds old and has no live git process. The scan itself does not delete it. A probe that cannot list processes refuses the delete.
- A wake under 10 minutes with an unchanged repo and network does not hold the gate, so the in-flight attempt can resume from its checkpoint. This module still dispatches nothing itself.
- `InMemoryReentryStore` is the stand-in for `state.db`. Wiring the same transitions into SQLite belongs with the db package.
