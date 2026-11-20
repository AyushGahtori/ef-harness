---
task_id: "Task-066"
branch: "task/066-candidate-acceptance-tx"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/acceptance/**"
  - "packages/verifier/tests/acceptance/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 066 handoff

Candidate acceptance runs inside one `BEGIN IMMEDIATE` transaction on `state.db`. `finalizeCandidateAcceptance` rechecks the lease, blocking holds, current-version check coverage (including `X-01`–`X-14` and diff-detected rules), canonical node and edge read sets, and recorded searches before `finish_submission(next_state = 'ACCEPTED')`. `revalidatePriorEvidence` stamps new `check_results` for a compatible, clarifying, or base-sync change and leaves the accepted commit in place.

## Exports Provided

Import from `packages/verifier/src/acceptance/index.ts` until the package barrel is wired:

- `CandidateAcceptanceCoordinator` — `finalizeCandidateAcceptance`, `revalidatePriorEvidence`, `flushArchives`
- `AcceptanceDecision` — structured accept/refuse result (`reason`, `route`, stale nodes/edges/searches, unmet checks, queued rules, merge packet, evidence ids, downstream unlock flag)
- `MergeInstructionsBuilder` — builds a `merge-instructions@1` packet (`commit`, `diffstat`, `exports_changed`, `dependency_intents`, `migration_intents`, `wiring_needs`, `contracts_verified`, `receipt`)
- Port types the integrator swaps: `KnowledgeSearchPort`, `DiffTouchPort`, `RuleCheckQueuePort`, `CleanVerifierPort`, `TurnLogArchivePort`
- Local stand-ins: `LocalRecordedSearchVerifier`, `LocalDiffTouchReader`, `MemoryRuleCheckQueue`, `LocalTurnLogArchiver`
- `canonicalSearchResultHash` / `EMPTY_SEARCH_RESULT_HASH` — SHA-256 of `JSON.stringify(sorted [id, version] pairs)`; empty is the hash of `[]`
- `CROSS_CUTTING_RULE_IDS`, `BUILTIN_CROSS_CUTTING_SCOPES`, `BLOCKING_HOLD_REASONS`, `PAUSE_HOLD_REASON`, `TASK_ACCEPTED_CONSUMERS`

`TaskAccepted` outbox deliveries are registered with the canonical `register_delivery` statement for `scheduler`, `integrator`, `exporter`, and `ui_projection`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/verifier/src/index.ts` on this branch. When integration is allowed, re-export the acceptance surface from that barrel:

```ts
export {
  CandidateAcceptanceCoordinator,
  MergeInstructionsBuilder,
} from "./acceptance/index.js";
export type {
  AcceptanceDecision,
  MergeInstructionsV1,
  KnowledgeSearchPort,
  DiffTouchPort,
  RuleCheckQueuePort,
  CleanVerifierPort,
  TurnLogArchivePort,
} from "./acceptance/index.js";
```

No root `package.json`, workspace, tsconfig, or eslint change. No new dependency. Schema files stay frozen; the coordinator loads `stale_reads_for_acceptance`, `stale_edge_reads_for_acceptance`, `finish_submission`, `register_delivery`, `requirement_status_recompute`, `archive_turn_log`, and `purge_archived_turn_log` verbatim from `schema/queries.sql`.

## Dependency Intents (New Packages Requested)

No new package. Sibling branches are not on this base. The coordinator talks to them through local ports. Swap these when the sibling lands:

| Port | Sibling | Local stand-in on this branch |
| --- | --- | --- |
| `KnowledgeSearchPort.verifyRecordedSearchReads` | Task 018 `KnowledgeSearchService` | `LocalRecordedSearchVerifier` re-runs up to 50 `search_reads` against `nodes` (id/title/text plus optional `kind`/`feature` filters) and compares `canonicalSearchResultHash`. The sibling hash must use the same canonical form. |
| `DiffTouchPort.detectTouches` | Task 077 diff touch tags | `LocalDiffTouchReader` reads `detected_touches` on the candidate payload. Planned tags are `nodes.fields.touches` plus `inherited_touches`. |
| `RuleCheckQueuePort.queueRuleChecks` | Task 089 diff-touched rule checks | `MemoryRuleCheckQueue`. The decision also returns `queuedRules`. Called only when the route is `repair_checks`. |
| `CleanVerifierPort.rerunCurrentChecks` | Task 060 `CleanVerifierRunner` | No default. `revalidatePriorEvidence` throws if this port is missing so it cannot invent passes. |
| `TurnLogArchivePort.archiveClosedAttemptTurnLog` | Task 029 `ArtifactManager` | `LocalTurnLogArchiver` runs canonical `archive_turn_log` then `purge_archived_turn_log` on a microtask after the acceptance commit. |
| Holds, submission, candidates | Task 021 `TaskHoldAndSubmissionRepo` | Direct SQL on `task_runtime`, `task_holds`, `attempts`, `candidates`, and canonical `finish_submission`. |
| Rollups and requirement status | Task 027 `ReadModelRepo` | `syncRequirementStatusInTx` applies canonical `requirement_status_recompute`. `rollup_feature_tasks` and `rollup_feature_requirements` move only through the schema triggers. |
| Outbox | Task 026 `OutboxRepo` | `INSERT INTO outbox` plus canonical `register_delivery` in the same transaction. |

Search re-runs happen before `BEGIN IMMEDIATE`. Inside the write transaction the coordinator re-reads `meta.last_rev` and `max(change_sets.rev)` and re-runs searches only when that token changed, releasing the lock first. The kernel should keep `meta.last_rev` current; the max change-set revision is included so a committed change set still invalidates a search that straddled it.

## Contract Change Requests

None to frozen schema or root contracts.

Acceptance policy implemented here, for the dispatcher and integrator:

- Blocking holds (`requirement_change`, `budget`, `ccr`, `governor`, and any reason other than `user_pause`) refuse acceptance, leave `check_results` in place, and do not promote artifacts or emit `TaskAccepted`.
- `user_pause` alone, when every other gate passes, promotes receipt-cited `diagnostic` artifacts to `evidence`, keeps `task_runtime.state = 'CLEAN_VERIFY'` and `submission_pending = 1`, and does not emit `TaskAccepted`. Downstream `task_states.done` stays 0.
- Stale epoch or attempt mismatch marks the attempt `rejected` with outcome `superseded`, clears `submission_pending` only while this attempt still holds the task, and never sets `ACCEPTED`.
- Breaking node reads, edge-set reads (including `version = 0`), and changed `search_reads` mark the attempt `rejected` with outcome `reverify:<code>`, clear `submission_pending` the same way, keep the candidate row and receipts, and set `route = "reverify"`. Task state stays off `ACCEPTED` / `MERGED_TO_FEATURE`.
- Missing, skipped, failed, stale-version, or wrong-digest checks refuse with `unmet_checks`, `stale_check_version`, or `artifact_digest_mismatch` and leave the attempt `submitted`.
- A diff that newly satisfies a cross-cutting scope (X-07 is `all: [personal_data, logging]`) whose check is not a current pass refuses with `diff_detected_rule` and queues that check.
- Zero linked checks refuse. Waived requirements are omitted from the linked check set.
- `revalidatePriorEvidence` rejects `breaking` without calling the verifier. A failed compatible/clarifying/base-sync recheck updates `requirement_status` and sets `reworkSuggested` but does not flip the attempt or delete the commit. Opening the rework task stays with the scheduler.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-066-candidate-acceptance-tx`:

- `pnpm --filter @ef-harness/verifier test -- acceptance` — pass, 2 files, 17 tests.
- `pnpm --filter @ef-harness/verifier typecheck` — pass.
- `pnpm --filter @ef-harness/verifier lint` — pass.
- `node scripts/verify-harmony.mjs --task 066` — pass (`harmony ok for Task-066`).

Covered by those tests: clean acceptance updates `task_runtime`, `attempts`, `requirement_status`, `rollup_feature_tasks`, and `outbox` (`TaskAccepted` plus the four delivery rows) and emits `merge-instructions@1`; stale pushed node, stale pulled node, edge read `0 → 1`, and empty search `[] → [hit]` refuse and do not unlock dependents; cosmetic and clarifying reads plus an unrelated breaking edit do not refuse; skip (14 pass + 1 skip), missing check, stale check version, stale epoch, and diff-detected `X-07` each refuse with that reason; `user_pause` preserves evidence; a blocking hold does not; search revalidation stays outside the write lock and retries when `last_rev` advances; clarifying, base-sync, and failed compatible revalidation preserve the accepted commit.

## Known Limitations / Follow-Ups

- Package barrel re-export is listed above and is not applied on this branch.
- `LocalRecordedSearchVerifier` is a SQL stand-in, not Task 018's FTS `kb.search`. Swap it before production search parity matters. The hash function is the contract the swap must keep.
- `CleanVerifierPort` is required for revalidation and is supplied by tests. Task 060 must be injected at integration.
- Diff touch detection reads payload tags. Task 077 should replace `LocalDiffTouchReader` with the real diff scan. Entity-tag inheritance is whatever the planner already stored in `touches` / `inherited_touches`.
- Queued rule checks are returned on the decision and sent to `RuleCheckQueuePort`. There is no schema table for that queue (schema is frozen).
- `user_pause` does not publish `requirement_status` or `TaskAccepted`. A later `finalizeCandidateAcceptance` after the hold is released accepts if the other gates still pass.
- Revalidation that fails a current check leaves the task `ACCEPTED` and marks the requirement failing. The rework task is not created here.
- Turn-log archival is enqueued with `queueMicrotask` after commit. Callers that need the archive row before exit should `await flushArchives()`.
- A second `finalizeCandidateAcceptance` on an already accepted matching epoch returns `already_accepted` and does not insert another outbox event.
