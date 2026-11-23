---
task_id: "Task-173"
branch: "task/173-human-fixed-it-myself"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/human-fix/**"
  - "packages/integrator/tests/human-fix/**"
  - ".agent-handoffs/task-173.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 173 handoff

“I Fixed It Myself” first-class human flow: card/chat/commit entry into `HUMAN_OWNED`, VS Code worktree picker, clean verify with real developer Git authorship (`EF-Author-Mode: human-fixed`), scope and contract reconciliation, `This test is wrong` / `Accept anyway`, hand-back to AI, and merge-queue unblocking. Commit stays on `task/173-human-fixed-it-myself`.

## Exports Provided

From `packages/integrator/src/human-fix/index.ts`:

- `HumanFixFlowEngine` — orchestrates takeover, workspace choice, clean verify, scope reconcile, override policy, hand-back, merge handoff, AI preserve prompt, and receipts.
- `HumanFixTakeoverController` — `fromCard`, `fromChat`, `fromCommitDetection`, and `enter` for all three entry points into `HUMAN_OWNED`.
- `HumanEditWorkspacePicker` — `present` / `choose` for task worktree VS Code vs main checkout.
- `HumanFixCleanVerifier` — `verifyAndContinue` runs Task 055-equivalent stages with developer authorship trailers.
- `HumanScopeAndContractReconciler` — out-of-scope file prompts, `DeterministicSchemaDiffClassifier` contract deltas, sibling overlap holds.
- `HumanVerificationOverridePolicy` — `Fix code`, `This test is wrong`, `Accept anyway (Human Override)` with honest `human_override_accepted` audit.
- `HumanFixStateDb`, `GitRepo`, local ports (`CleanVerifierHarnessPort`, `WorktreeSlotPoolPort`, `ActiveScopeOverlapDetectorPort`, `ProjectMergeQueuePort`, `VerificationHintLadderPort`), in-memory stand-ins, and typed errors.
- Constants: `HUMAN_OWNED`, entry kinds, workspace choices, override kinds, `VERIFICATION_HUMAN_OVERRIDE`, trailer keys.

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is frozen. Re-export the human-fix barrel:

```ts
export {
  HumanEditWorkspacePicker,
  HumanFixCleanVerifier,
  HumanFixFlowEngine,
  HumanFixTakeoverController,
  HumanScopeAndContractReconciler,
  HumanVerificationOverridePolicy,
} from "./human-fix/index.js";
export type {
  CleanVerifyResult,
  DeveloperIdentity,
  HandBackRequest,
  HandBackResult,
  HumanFixReceipt,
  MergeHandoff,
  OverrideChoice,
  ScopeReconcileResult,
  TakeoverResult,
  WorkspacePickerResult,
} from "./human-fix/index.js";
```

## Dependency Intents (New Packages Requested)

None. Git is spawned from `PATH`. Runtime task state uses `node:sqlite` `DatabaseSync` in a local file (same pattern as Task 129 undo ports).

## Contract Change Requests

None.

Sibling branches are not merged. Swap these local ports at integration:

| Sibling | Stand-in |
|---------|----------|
| Task 017 `KnowledgeGraphRepo` | `HumanFixStateDb` + `upsertContract` (`basis = explicit`) |
| Task 038 `WorktreeSlotPool` | `WorktreeSlotPoolPort` / `InMemoryWorktreeSlots` |
| Task 055 / 060 `CleanVerifierHarness` | `CleanVerifierHarnessPort` / `InMemoryCleanVerifier` |
| Task 059 / 087 `VerificationHintLadder` + `ReverseImpactWalker` | `VerificationHintLadderPort` / `InMemoryHintLadder` |
| Task 111 `ProjectMergeQueue` | `ProjectMergeQueuePort` / `InMemoryMergeQueue` |
| Task 171 `ActiveScopeOverlapDetector` | `ActiveScopeOverlapDetectorPort` |
| Task 021 `transitionTaskState` | `states.ts` + `HumanFixStateDb.enterHumanOwned` for `HUMAN_OWNED` edges |
| Task 096 / 111 landing | `finishToMerge`, `enqueueHumanFix` handoff after verify or override |

Task 124 / 126 card **“I’ll fix it myself”**, Task 130 commit detection, and Task 171 **Take Over** should call `HumanFixTakeoverController` entry methods only (no deep imports into sibling subtrees).

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-173-human-fixed-it-myself`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- human-fix` — pass. Vitest v5.1.1: 1 file, 7 tests passed (~43s). Covers all three entry points to `HUMAN_OWNED` with zero-unrelated-pause, VS Code worktree picker, true `git config` developer authorship and `EF-Author-Mode: human-fixed` trailers, out-of-scope + contract `cutoffGraceMinutes` reconciliation (`basis = explicit`), `This test is wrong` spec repair + re-verify green, honest `Accept anyway` override logging, hand-back to AI with human WIP + preserve prompt, and sibling scope collision hold.
- `node scripts/verify-harmony.mjs --task 173` — pass (exit 0, `harmony ok for Task-173`, ~139s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- `HumanFixStateDb` is not `state.db`; it mirrors Task 021 `HUMAN_OWNED` transitions and hold parking for tests until Task 013/021 barrels are wired.
- `DeterministicSchemaDiffClassifier` detects additive contract fields heuristically from diff text; swap for Task 083/112 schema diff at integration.
- `InMemoryCleanVerifier` runs stage labels only; replace with Task 060 clean-copy worktree verifier for production.
- Chat routing recognizes the two patterns from `editor-coexistence.md`; Task 113/114 should feed normalized `TakeoverRequest` payloads.
- No UI or VS Code extension launch in this package; `HumanEditWorkspacePicker` returns the `code <wt_path>` command string only.