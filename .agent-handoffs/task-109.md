---
task_id: "Task-109"
branch: "task/109-artifact-handoff-mailbox-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/handoffs/**"
  - "packages/integrator/tests/handoffs/**"
  - ".agent-handoffs/task-109.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 109 handoff

Artifact handoff engine for immutable CAS handoffs, `harness.read_result`, pinned `(baseCommitSha, sliceSha256)` attempts, a durable role mailbox, wait-graph cycle rejection, and owner-first routing. Commit stays on `task/109-artifact-handoff-mailbox-engine`.

Worktree base is `649773097c387ae534b686ea5825f449f843aa7c`. `node scripts/agent-worktree.mjs create` was given `--base 649773097c387ae534b686ea5825f449f843aa7c` because `harness/integration` had moved to `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` and `pnpm install --frozen-lockfile` failed there (`packages/shared-contracts/package.json` adds `zod@^3.25.0` without a matching lockfile specifier).

## Exports Provided

Import from `packages/integrator/src/handoffs/index.ts` until the package barrel is wired:

- `ArtifactHandoffStore` — write-once handoffs in `state.db` plus a content-addressed blob (`sha256` of the raw bytes). Fields are `handoffId`, `fromRole`, `toRole`, `fromTaskId`, `toTaskId`, `artifactType`, `pinnedBaseCommitSha`, `pinnedSliceSha256`, `schemaVersion`, `summary`, `blobSha256`, `blobBytes`, `priorHandoffId`, `supersedes`, `supersededBy`, `createdAt`. `supersede` stamps `superseded_by` on the previous row, leaves its blob unchanged, and wakes watchers with the fresh pins. `bindAttempt` refuses a pin pair that does not match the bound handoff.
- `ReadResultToolHandler` — `harness.read_result(handoff_id, range?)`. Missing ids, sealed `artifactType === "sealed_oracle"`, and callers with no dependency path return the same `{ ok: false, code: "NOT_FOUND" }`. The default read is a structured summary capped at 2048 bytes. A range requires `limit` from 1 through 16384.
- `HandoffMcpSurface` — tool list is only `harness.read_result`. Any other tool name, including peer chat, throws `FreeFormChatRejectedError` (`code: "NO_FREE_FORM_CHAT"`).
- `DurableRoleMailbox` — typed `ContractClarificationRequest`, `SharedTypeAdditionRequest`, `IntegrationConflictHandoff`, and `VerificationDispute` rows addressed to a canonical role. Identical open `(targetOwnerTaskId, contractId, questionHash)` requests share one row and a waiter list. `resolve` wakes every waiter in one transaction. `claim(role, workerId)` records the worker id and still returns the role's open rows. `sweep` escalates held owners, expired ages, and exhausted owner turns to `coordinator` and `user-inbox`.
- `WaitGraphCycleDetector` — `O(V + E)` BFS over `waits_on ∪ depends_on` before a wait or depends-on edge is inserted. A cycle throws `WaitGraphDeadlockError` after the break row and notices commit. The rejected edge is not stored. `minimalCycle` is the pure helper.
- `OwnerResolutionCoordinator` — `registerOwner` keeps a single `(contractId → ownerRole, ownerTaskId)` row. `request` submits the mailbox item to that owner role only. `assertOwnedWrite` rejects paths outside the caller patterns. `peerMessages` is always empty.
- `HandoffAuditTrail` — `lineage(handoffId)` walks `priorHandoffId` and returns the role chain. `forTask` lists artifacts that name the task.
- `HandoffRuntime.open({ stateDbPath, now, cas, graph, holds, slices, ttl, needsHumanDecision })` wires the pieces and applies `HANDOFF_DDL`.
- Local ports: `SqliteCasBlobStore`, `MemoryCasBlobStore`, `FormatSlicePinPort`, `CatalogSlicePinPort`, `LocalKnowledgeGraphPort`, `LocalTaskHoldsPort`.
- Errors: `SchemaValidationError`, `ImmutableHandoffError`, `InvalidPinError`, `UnverifiedSliceError`, `PinMismatchError`, `CasBlobMissingError`, `CasIntegrityError`, `RoleAddressError`, `FreeFormChatRejectedError`, `WaitGraphDeadlockError`, `OwnerConflictError`, `OwnerMissingError`, `OutOfScopeWriteError`, `MailboxStateError`, `HandoffNotFoundError`, `RangeLimitError`.

Allowed artifact types: `planner_to_worker`, `worker_to_verifier`, `leaf_to_feature_integrator`, `feature_to_merge_queue`, `worker_to_contract_owner`, `verification_receipt`, `integration_conflict`, `sealed_oracle`.

Default mailbox TTL is 15 minutes or 3 owner turns (`DEFAULT_MAILBOX_TTL`). Tests pass a shorter policy. Deadlock notices go to `coordinator` and `contract-owner` with `pipeline: "Task 112"`. `needsHumanDecision` also notifies `user-inbox` and sets `escalatedTo` to `developer`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is frozen. Re-export the handoff engine from the package barrel:

```ts
export {
  ArtifactHandoffStore,
  DurableRoleMailbox,
  HandoffAuditTrail,
  HandoffMcpSurface,
  HandoffRuntime,
  OwnerResolutionCoordinator,
  ReadResultToolHandler,
  WaitGraphCycleDetector,
  assertOwnedWrite,
} from "./handoffs/index.js";
export type {
  CasBlobStorePort,
  HandoffArtifact,
  HandoffRuntimeOptions,
  KnowledgeGraphPort,
  MailboxMessage,
  MailboxSubmitInput,
  OwnerRoute,
  ReadResult,
  ReadResultCaller,
  SlicePinPort,
  TaskHoldsPort,
  WaitGraphDeadlockBreak,
} from "./handoffs/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

`HandoffMcpSurface.dispatch` is the function Task 049's leased MCP server (the published `harness.read_result` implementation on the Task 048 attempt-MCP branch) should call. Map that tool's `artifactId` argument to `handoff_id` when both exist. This package does not edit `packages/mcp-server`.

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`) and `node:crypto` `sha256`. No package was added to `@ef-harness/integrator`.

## Contract Change Requests

None filed as a Task 112 CCR, and `schema/state.sql` was not edited.

Sibling branches are not on this base. These local ports should be swapped at integration:

- **Task 017.** `LocalKnowledgeGraphPort` stands in for `KnowledgeGraphRepo`. `dependsOnEdges()` should be loaded from `getEdgesAsOf` for `depends_on`. Do not deep-import `packages/db/src/knowledge/**`.
- **Task 021.** The task text names `TaskHoldsManager`. The published sibling export is `TaskHoldAndSubmissionRepo`. `LocalTaskHoldsPort.isHeld` should call the hold list for that task. A held owner escalates the open mailbox instead of waiting on a dead worker.
- **Task 028.** `SqliteCasBlobStore` / `MemoryCasBlobStore` stand in for `CasBlobStore.putBlob` / `getBlob`. The sibling method is async, takes a `CasPutPin` (`holderKind: "project"`, `retention: "evidence"`), and stores the sha256 of the uncompressed bytes. This port is synchronous because `node:sqlite` is synchronous. `ArtifactHandoffStore` already checks that the returned hash matches the payload. Swap the port and keep the `state.db` artifact row.
- **Task 049 / Task 048.** The task text names `LeasedMcpServer`. The published `harness.read_result` tool lives on the attempt MCP server and takes `{ artifactId, slice }`, returning plain `NotFound` for concealed checks. `ReadResultToolHandler` takes `{ handoff_id, range?: { offset, limit } }` and returns `{ ok: false, code: "NOT_FOUND" }` for sealed oracles and unauthorized callers. Keep that indistinguishable body when the tool wrapper is attached.
- **Task 083.** `contract_owners` is the local single-owner registry. `sharedOwners` / skeleton `owner` fields should seed `OwnerResolutionCoordinator.registerOwner`. A second different owner throws `OwnerConflictError`.
- **Task 088.** `FormatSlicePinPort` checks 64 hex characters. `CatalogSlicePinPort` also requires the digest to be one this process has seen. Swap `verify` for `KnowledgePacketSlicer` manifest `sliceSha256` (canonical hash of the included node versions). Do not deep-import `packages/planner/src/slicer/**`.
- **Task 112.** Deadlock notices carry `pipeline: "Task 112"` and the minimal cycle. The CCR pipeline should consume those notices. This package does not classify schema diffs.
- **Task 116.** Escalation notices for TTL, blocked owners, and exhausted turns are addressed to role `user-inbox` (and `coordinator`). Swap that role for the question-arbiter inbox.
- **Task 126 / Task 133.** `HandoffAuditTrail.lineage` is the inspector and diagnostics query. It returns artifacts from the root `priorHandoffId` through the requested id, plus the role chain (`fromRole` of the root, then each `toRole`).

`HANDOFF_DDL` creates `cas_blobs`, `handoff_artifacts`, `active_attempts`, `graph_edges`, `contract_owners`, `role_mailbox`, `mailbox_waiters`, `mailbox_wakes`, `handoff_watches`, `handoff_wakes`, `wait_graph_deadlock_breaks`, `escalation_notices`, `role_claims`, and `id_sequences` in the opened database. Fold that DDL into `schema/state.sql` when schema edits are allowed. Until then, opening a Task 013 `state.db` that does not yet contain these tables is safe because the statements are `CREATE TABLE IF NOT EXISTS`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-109-artifact-handoff-mailbox-engine`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- handoffs` — pass. Vitest v5.1.1: 5 files, 15 tests passed. Covers immutable CAS bytes, pin mismatch refusal, catalog slice refusal, free-form artifact rejection, `superseded_by` with unchanged historical bytes and a watcher wake, state.db reopen, indistinguishable `NOT_FOUND` for a missing id, `HO-ORACLE-99`, and an unauthorized caller, dependency-path reads, a 2 MB trace served as a summary under 2048 bytes, 16 KB pagination, `RANGE_LIMIT_EXCEEDED` above 16 KB, peer-chat rejection, 2-node and 4-node cycle rejection before commit, `depends_on` cycle rejection, developer escalation, mailbox dedup of three waiters with one atomic resolve, role claim after reopen by `W-Owner-2`, pid and untyped payload rejection, hold / turn / TTL escalation to `coordinator` and `user-inbox`, owner-only routing for `MenuItem`, single-owner conflict, out-of-scope writes, and the planner → worker → verifier → integrator → merge-queue lineage.
- `node scripts/verify-harmony.mjs --task 109` — pass (exit 0, `harmony ok for Task-109`, about 39s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- `SqliteCasBlobStore` keeps blobs in the same SQLite file as the handoff rows. It does not write the Task 028 directory layout, zstd frames, or `global.db` pins. A crash between an injected external `putBlob` and the artifact insert can leave an unreferenced blob; the default sqlite store writes both inside one transaction.
- `superseded_by` is the only column updated after insert. Payload, summary, pins, and the CAS hash stay put.
- `harness.read_result` authorizes the addressed role or task, the producing role or task, or a `depends_on` path from the caller to the producer. Sealed oracles stay `NOT_FOUND` even for the addressed role. The byte ceiling is 16384 per call. Token estimate is not a second cap.
- Mailbox dedup hashes the payload with `requestingTaskId` removed, plus `kind` and `contractId`. Different question text stays a separate row.
- Escalation marks the original row `escalated` and writes notices plus waiter wakes. It does not insert a new `waits_on` edge, so the escalation cannot close another cycle.
- `claim` appends a `role_claims` row. The mailbox address remains the role. A numeric role or `workerPid` field is rejected.
- `LocalTaskHoldsPort` is process memory. Reopen does not restore holds; the mailbox rows themselves do survive in `state.db`.
- Cycle checks are synchronous on the calling connection. Two processes would need the SQLite write lock; this package uses `BEGIN IMMEDIATE` for its own transaction.
- There is no model adapter and no free-form chat tool. Typed mailbox payloads reject unknown keys.
