---
task_id: "Task-095"
branch: "task/095-sequential-task-dispatcher"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/sequential-runner/**"
  - "packages/planner/tests/sequential-runner/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 095 handoff

Sequential task dispatcher for M2: `explicit`-first ready queue, pinned brief materializer, one-leaf lifecycle through CAS merge, post-merge smoke with rollback, hold/stop/budget suspension, `LEAVES_MERGED`, and wave advancement. Commit stays on `task/095-sequential-task-dispatcher`.

## Exports Provided

Import from `packages/planner/src/sequential-runner/index.ts` until the planner barrel is wired:

- `SequentialBuildRunner` — claims one compiled leaf at a time and drives `READY → CLAIMED → WORKING → VERIFYING → ACCEPTED/MERGED`, or `RETRY_HINT_1` / `RETRY_HINT_2` / `ESCALATED`, `PARKED`, `SUSPENDED`, `WRITE_SCOPE_REJECTED`.
- `ExplicitFirstReadyQueue` — ready rows from `state.db` (`depends_on` done, zero `task_holds`, `feature_runtime.state = IN_WAVE`, `compiled_plan_snapshot.snapshotId` present, `meta.gate0 = PASSED` for wave work). At equal dependency depth, `explicit` precedes `derived`, `observed`, `proposed`, `delegated`, then `defaulted`. Critical-path blockers precede non-blocking leaves inside that basis.
- `AttemptBriefMaterializer` and `LocalKnowledgePacketSlicer` — pinned brief plus `sliceSha256` written to `attempt_checkpoints.contract_versions` and the brief text written to `attempt_checkpoints.handoff_artifact`.
- `PostMergeSmokeChecker`, `BarrelTypecheck`, `FastUnitSmoke`, `SMOKE_TIMEOUT_MS` (30_000). The checker refuses a longer budget.
- `KernelEventBus` — promise waiters only. Idle, hold-before-merge, and stop do not poll.
- `GitWorkspace` — temp-repo worktree slots, `git update-ref` compare-and-swap, and rollback.
- `StateDb` — canonical `state.sql` on `node:sqlite`, plus the runner receipt table.
- Ports the runner calls: `NativeWorkerLoopPort`, `CleanVerifierHarnessPort`, `StaticAuditPort`, `DiffAutoTagDetectorPort`, `FeatureIntegratorPort`, `FeatureDoneGatePort`, `WaveAdvancementPort`, `CompletionWavePort`, `PlannerRepairPort`, `KnowledgePacketSlicerPort`.

`run()` launches the worker with `sandbox.network = "deny"`, `sandbox.owner = "task-045"`, and tools `kb.get_fact`, `kb.contract`, `kb.code`, `harness.run`. Receipts persist `claimedAt`, `briefTokens`, `workerTurns`, `costMicroUsd`, `verifierVerdict`, `mergedCommitSha`, and `smokeMs`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` in this task. When integration is allowed to touch the barrel, re-export:

```ts
export {
  AttemptBriefMaterializer,
  ExplicitFirstReadyQueue,
  KernelEventBus,
  PostMergeSmokeChecker,
  SequentialBuildRunner,
  SMOKE_TIMEOUT_MS,
} from "./sequential-runner/index.js";
export type {
  AttemptReceipt,
  FeatureIntegratorPort,
  NativeWorkerLoopPort,
  ReadyTask,
  RunReport,
  WaveAdvancementPort,
} from "./sequential-runner/index.js";
```

No root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits. No `packages/*/src/index.ts` edit. No `packages/*/package.json` edit.

## Dependency Intents (New Packages Requested)

None. SQLite is built-in `node:sqlite` (`DatabaseSync`). Git is the system `git` binary. Brief hashes use `node:crypto`. Do not add `better-sqlite3`.

## Contract Change Requests

None of `schema/`, `.opencode/`, or `.githooks/` were edited.

- `attempt_checkpoints` has no `slice_sha256` column. The pin lives in `contract_versions` JSON (`sliceSha256`, manifest, tools, hint) and the rendered brief lives in `handoff_artifact`. Integration can add a real column later; readers should keep accepting this JSON.
- Receipts live in runner-owned `sequential_attempt_receipts` (`CREATE TABLE IF NOT EXISTS` on the open connection). It is not in `schema/state.sql`. A later migration should adopt that table for Board Cockpit (`Task 124`) and Meta-Lab (`Task 105`).
- `gate0` is `meta.key = 'gate0'` with value `PASSED` or `PENDING`. Phase 0 tasks (`fields.phase = 'phase0'` or `feature_runtime.wave = 0`) may dispatch before that value is `PASSED`. Wave tasks may not.
- Schema state `WAITING_INPUT` is the idle-on-user state this runner calls `WAITING_ON_USER` in status `idle_waiting_on_user`. A `user_replied` bus event moves that row back to `READY`.
- `compiled_plan_snapshot` is `nodes.fields.compiled_plan_snapshot.snapshotId`. There is no snapshot column on `task_runtime`. Missing or empty snapshot IDs are not claimable (`CompiledPlanMissingError`).

## Local ports swapped for sibling branches

Sibling task branches are not in this base. The runner depends on ports and ships local adapters. Replace them with the real exports when those branches integrate:

| Need | Local stand-in | Swap to |
| --- | --- | --- |
| Atomic claim, lease, budget pre-reservation | `StateDb.claim` runs canonical `claim_task`, `create_attempt`, `reserve` | `TaskClaimManager` (`Task 020`) and budget ledger (`Task 023`) |
| Holds and `submission_pending` | `task_holds` plus `KernelEventBus` | `TaskHoldsManager` (`Task 021`) |
| Clean worktree slot at `harness/f/<feature>` | `GitWorkspace.checkout` / `removeSlot` | `WorktreeSlotPool` (`Task 038`) |
| Worker loop | `NativeWorkerLoopPort` (tests use a fake writer) | `NativeWorkerLoop` (`Task 053`) |
| Sandbox, `kb.*`, `harness.run` | `SANDBOX_PROFILE` and `WORKER_TOOLS` on the worker context | `Task 045`, `Task 089`, `Task 048` |
| `STATIC_AUDIT` | `LocalStaticAudit` | `Task 054` |
| Tag / write-scope gate | `LocalDiffAutoTagDetector` | `DiffAutoTagDetector` (`Task 077`) |
| Clean verification | `LocalCleanVerifier` on a fresh detached worktree | `CleanVerifierHarness` (`Task 055`–`058`) |
| Hint ladder | canonical `record_hidden_failure` | hint ladder (`Task 059` / verifier ladder) |
| Acceptance + CAS | `submit_candidate`, `finish_submission`, `git update-ref <new> <expected>` | `CandidateAcceptanceTx` (`Task 060`) and ref CAS (`Task 039`) |
| Pinned brief | `LocalKnowledgePacketSlicer` | `KnowledgePacketSlicer` (`Task 088`) |
| Post-merge typecheck and unit smoke | `BarrelTypecheck` (relative re-exports) and `FastUnitSmoke` (`smoke/cases.json`) | incremental `tsc` plus the app's fast unit smoke, still capped at 30s |
| `LEAVES_MERGED` handoff | `LocalFeatureIntegrator` (`git merge --no-ff` onto `harness/integration`, then CAS) | `FeatureIntegratorEngine` (`Task 096`) |
| Seven-condition `DONE` | `LocalFeatureDoneGate` | `Task 022` |
| Next-wave JIT | `WaveAdvancementPort` | `feature-architect@1` (`Task 084`), `feature-planner@1`, `oracle-author@1` (`Task 091`), `DeterministicGraphCompiler` (`Task 092`) |
| Architecture mismatch | `PlannerRepairPort` | bounded planner repair |
| Final wave | `CompletionWavePort` launches `Task-101` | `Task 101` |

Infrastructure failures never call `record_hidden_failure`. Two consecutive failures with the same fingerprint pause the runner. A `503` card message is `Provider temporarily unavailable`. Code failures use the canonical ladder (same fingerprint twice jumps to step 3 and escalates). `DisputeTest` and budget hits escalate without climbing that ladder. Three identical static-audit failures escalate without incrementing `ladder_step`. SQL migrations outside declared `sql` / `migration` / `data` tags escalate before static audit and the verifier run.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-095-sequential-task-dispatcher`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- sequential-runner` — 17 passed (4 files). Covers explicit-before-delegated-before-defaulted ordering at equal depth, blockers before leaves, gate0 versus phase 0, missing `compiled_plan_snapshot`, holds blocking claim, a 6-task Phase 0 → Wave 1 → `LEAVES_MERGED` → Wave 2 → completion-wave loop on real SQLite and a temp Git repo, pinned `sliceSha256`, 30s smoke cap, barrel rollback via CAS with Hint 1 `TS2307`, `submission_pending` merge refusal, STOP parking with a WIP ref and a clean feature branch, zero-poll idle until `task_hold_released`, UI-only SQL write-scope rejection before verification, two `503`s pausing without ladder burn, `DisputeTest` escalation, 3× static findings, repeated verifier fingerprint jump to step 3, budget wind-down at the next checkpoint, and Wave 2 architecture-mismatch halt with bounded planner repair.
- `node scripts/verify-harmony.mjs --task 095` — exit 0, `harmony ok for Task-095`. The command also ran repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`. The commit gate runs it again with `--require-ready`.

## Known Limitations / Follow-Ups

- `LocalKnowledgePacketSlicer` is a deterministic pin (canonical JSON over task id, level, node id/version/content hash, and hint text). It does not apply Task 088 band budgets. Pass a `KnowledgePacketSlicerPort` that wraps `KnowledgePacketSlicer.compile` when that package is on the branch.
- `BarrelTypecheck` resolves relative `export … from` specifiers. It is not `tsc`. `FastUnitSmoke` reads only `smoke/cases.json`.
- `LocalFeatureIntegrator` merges the feature ref into `harness/integration` with `git merge --no-ff` and CAS. Task 096 still owns wiring tasks, conflict hunks, and journey execution. The local done-gate treats zero journey nodes as journey-passed and zero `page_route` names as accessibility-clean, and it marks implemented requirements `passing` when the leaf merges.
- Wave JIT runs only when the next wave has no `feature_runtime` rows yet. A wave that was seeded ahead of time is not compiled again.
- The primary temp-repo checkout is detached after init so CAS on `harness/integration` does not dirty that worktree. Slot directories live outside the repo.
- `SequentialBuildRunner` keeps its infrastructure streak and hint text in memory. Ladder step and receipts survive in SQLite; a restarted process must be given the same hint strings if a retry brief is rebuilt only from memory.
