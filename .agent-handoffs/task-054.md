---
task_id: "Task-054"
branch: "task/054-worker-loop-context-compaction"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/worker-loop/src/context/**"
  - "packages/worker-loop/tests/context/**"
  - ".agent-handoffs/task-054.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 054 handoff

6-zone pinned context builder, bounded `notes.update` working memory, and the 4-stage MUST-preserving compaction pipeline. Commit stays on `task/054-worker-loop-context-compaction`.

## Exports Provided

Import from `packages/worker-loop/src/context/index.ts` until the package barrel is wired:

- `WorkerContextBuilder` — `buildRequest(input)` assembles zones 1–6. Returns `status: "ok"`, `status: "task_too_large_for_model"` (`mustTokens`, `windowTokens`), or `status: "park_after_context_overflow"` after the single tightened retry.
- `WorkingMemoryStore` — `notes.update` section patches and JSON-patch ops for `planSteps`, `doneByMustId`, `openProblems`, `learnedFacts`. Cap is 1,500 estimator tokens. Successful updates append a `turn_log`-shaped row whose `result_artifact` is `working-memory@1\n` plus the full snapshot. `WorkingMemoryStore.restore(rows, options)` reloads that snapshot verbatim.
- `CompactionPipeline` — `run(input)` applies stages in order: `trim_should_and_superseded_reads`, `collapse_old_tool_results`, `summarize_old_turns`, `hard_refusal`. Stops when the estimated request is at or under the target.
- `TokenEstimator` — family-aware conservative counts for prose, code, and JSON, plus a safety headroom used by the request estimate.

Supporting exports used by tests and by Task 057: `resolveContextCaps`, `renderMustBand`, `renderZone1`, `renderWorkingMemoryZone`, `renderTailChecklist`, `toolPairViolations`, `emptyWorkingMemory`, `compactionTargetTokens`, `buildPromptEnvelope`, `validateTurnSummarizerV1`, `parseTaskPacketV1`, `parseModelProfile`.

`buildRequest` accepts an injected synchronous `turnSummarizer`. Invalid schema, over-budget notes, thrown errors, and `{ blocked: true }` fall back to one-line turn summaries plus Zone 4. If `workingMemoryCoversThroughStep` already covers every step outside the verbatim window, the summarizer is not called and no progress note is added.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/worker-loop/src/index.ts` on this branch. When integration wires the barrel, add:

```ts
export {
  CompactionPipeline,
  TokenEstimator,
  WorkerContextBuilder,
  WorkingMemoryStore,
} from "./context/index.js";
```

Task 057 should construct `WorkerContextBuilder`, pass the attempt `WorkingMemoryStore` snapshot into `workingMemory`, and pass `coversThroughStep()` as `workingMemoryCoversThroughStep`. Persist each `NotesUpdateResult.turnLogRow` in `state.db.turn_log`. On `context_overflow`, call `buildRequest` again with `contextOverflow: true` exactly once; `park_after_context_overflow` means park the attempt. `task_too_large_for_model` means return the task to the planner without sending a truncated MUST band.

Zones 1 and 2 are the cache prefix (`prefixText` / `prefixHash`). The current step number is only in Zone 6.

## Dependency Intents (New Packages Requested)

No package.json change. This branch does not add a dependency.

`packages/worker-loop/tests/context/property.test.ts` imports `fast-check`, which is already a root devDependency and resolves from the worktree root `node_modules`. If a later install stops walking up to that root, add `fast-check` to `@ef-harness/worker-loop` `devDependencies`. Do not add `zod` here; validation of the local ports is hand-written until Tasks 008 and 009 are merged.

## Contract Change Requests

None. Sibling branches are not merged into this base, so the context package carries local ports and must be swapped at integration:

| Local port | Replace with |
|---|---|
| `parseTaskPacketV1` / `TaskPacketV1` in `src/context/ports.ts` | Task 008 `TaskPacketV1Schema` |
| `buildPromptEnvelope`, `escapeProvenanceText`, `validateTurnSummarizerV1` | Task 009 `buildPromptEnvelope` and `TurnSummarizerV1Schema` |
| `parseModelProfile` / `ModelProfile` | Task 053 `ModelProfile` |

Zone 2 pins the Task 008 packet fields that are stable for the whole attempt: goal, write scope, contracts, MUST items, visible checks, hidden-check count (not the hidden checks), pinned skills, tools, limits, and integer budget. Hidden check bodies are never copied into the prompt.

Context caps above 32,768 tokens are local choices because the task only fixes the small-window numbers: K = 8 up to 65,536, K = 12 up to 131,072, K = 16 above that; read cap 400 lines; test-failure cap 25. At `contextWindow <= 32_768`, K = 4, read cap 200, test-failure cap 10, and over-long reads render as a symbol outline when one is present.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-054-worker-loop-context-compaction`:

- `pnpm --filter @ef-harness/worker-loop typecheck` — exit 0.
- `pnpm --filter @ef-harness/worker-loop lint` — exit 0.
- `pnpm --filter @ef-harness/worker-loop test -- context` — exit 0. 6 files, 16 tests passed, including the 200-run `fast-check` tool-pair property (`seed: 54`).
- `node scripts/verify-harmony.mjs --task 054` — exit 0, `harmony ok for Task-054`.

## Known Limitations / Follow-Ups

- `WorkingMemoryStore` keeps `turn_log` rows in memory. Task 057 writes them into SQLite. Restore trusts the latest `working-memory@1` snapshot for that attempt.
- `turnSummarizer` is synchronous. An async model client should be awaited by Task 057 and passed in as a sync closure. There are zero live model calls in this package.
- Compaction estimates the request it would send, including family headroom, and triggers above 70% of `contextWindow` (`estimated > floor(window * 0.7)`). A provider `context_overflow` tightens that target by 15% and runs the pipeline once. MUST text is never sliced.
- Large-window K and the 400-line / 25-failure caps are the local defaults described above. Small-window caps match the task exactly.
- The package barrel is intentionally unwired.
