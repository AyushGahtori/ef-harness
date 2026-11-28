---
task_id: "Task-112"
branch: "task/112-contract-change-request-pipeline"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/ccr/**"
  - "packages/integrator/tests/ccr/**"
  - ".agent-handoffs/task-112.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 112 handoff

Contract Change Request (`ccr@1`) pipeline: deterministic SQL / OpenAPI / JSON Schema / TypeScript diff classification, additive owner fast-path, breaking revision reopener, deadlock-safe waits, a 3-CCR spam cap, and an append-only audit ledger. Commit stays on `task/112-contract-change-request-pipeline`.

Worktree base is `649773097c387ae534b686ea5825f449f843aa7c`. Sibling task branches are not on this base. The pipeline talks to them through local ports. Replace the adapters; do not keep the local copies once the real barrels exist.

## Exports Provided

Import from `packages/integrator/src/ccr/index.ts` until the package barrel is wired:

- `ContractChangeRequestEngine` — `submit` / `submitMany` intake. Classifies before `ccr@1` is parsed. Identical fingerprints share one CCR and one owner task. `approve(id, "Approve breaking revision")` opens Task 087 and places Task 021 holds. `reject(id, "Keep original contract")` resolves `REJECTED` and wakes the requester with `Contract is locked; implement adapter within your scope`. `landQueued()` lands additive CCRs left in `waiting_on_ccr`.
- `DeterministicSchemaDiffClassifier` — structural diff across SQL DDL, OpenAPI, JSON Schema, and TypeScript. `BREAKING` wins over any claimed `"additive"` label (`overridden: true`). Drop, rename, type narrowing, new required field, status change, auth change, tenant change, and input-enum addition are breaking. Nullable or defaulted columns, optional fields, new endpoints, output-only enum values, and optional UI variants are additive.
- `AdditiveOwnerFastPath` — schedules one owner task. `mutatedBy` is the canonical owner (or `project-integrator@1` on a deadlock break), never the requesting consumer. `consumerMayEdit` is `false`. Names a `migrations/YYYYMMDDHHMMSS_<hash>_<slug>.sql` file, runs `compat:<contract>` before landing, then calls the merge-queue port and wakes every subscriber.
- `BreakingCcrRevisionReopener` — hard-blocks auto-execution. `open` builds one Contract Change Decision Card (requested change, rationale, blast radius, `Prefer additive expand-then-contract field instead`, `Approve breaking revision`, `Keep original contract`, plus semantic workarounds). `approve` calls the auto-start port with `breakingContract: true` and refuses to continue if `autoStart` is true. Holds go on active impacted tasks only.
- `CcrSemanticCompatibilityReviewer` — `ccr@1` behavioral check after the structural diff. A sort, timezone, or pagination default change with an identical JSON Schema is `BREAKING`, names consumers `M04` and `UI tests` for sort changes, and proposes an additive workaround.
- `CcrLedger` / `CCR_DDL` — `ccr_requests` plus append-only `ccr_audit_ledger` (`PROPOSED → CLASSIFIED → APPROVED|REJECTED → LANDED`) with schema-diff signatures, owner commit SHAs, and woken task ids.
- `LocalCcrV1Schema`, `parseCcrV1`, `buildCcrV1` — local port of `CcrV1Schema`.
- Local ports listed under Contract Change Requests.

`landMode` defaults to `"immediate"`. `"queued"` registers `waiting_on_ccr` only after `WaitGraphCycleDetector` accepts the edge, and leaves landing to `landQueued()` unless a cycle must be broken.

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is frozen. Re-export the CCR pipeline from the package barrel:

```ts
export {
  AdditiveOwnerFastPath,
  BreakingCcrRevisionReopener,
  ContractChangeRequestEngine,
  DeterministicSchemaDiffClassifier,
  LocalCcrV1Schema,
  parseCcrV1,
} from "./ccr/index.js";
export type {
  CcrIntakeResult,
  CcrV1,
  ContractChangeDecisionCard,
  ContractChangeProposal,
  ContractOwnerDirectory,
  SchemaDiffResult,
} from "./ccr/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

`CCR_DDL` creates `ccr_requests`, `ccr_audit_ledger`, `ccr_wait_edges`, `ccr_notices`, and `ccr_id_sequences`. Fold that DDL into `schema/state.sql` when schema edits are allowed. Statements are `CREATE TABLE IF NOT EXISTS`, so opening a Task 013 database that does not yet have these tables is safe. The spec name `state.db.ccr_requests` is the current-row projection. `ccr_audit_ledger` is the immutable lifecycle log and is never updated or deleted.

Task 111 should call `ContractChangeRequestEngine` when a merge candidate needs a shared contract change instead of editing the contract on the feature branch. Task 127 should render `ContractChangeDecisionCard` from `decision` on a `CLASSIFIED` breaking CCR. Task 134 should drive `submitMany`, `approve`, and `reject` against this barrel.

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`) and `node:crypto`. No package was added to `@ef-harness/integrator`. `zod` is not on this base, so `ccr@1` is validated by the local parser.

## Contract Change Requests

None filed against frozen foundation files. `schema/state.sql` was not edited.

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). These local ports should be swapped at integration:

- **Task 009 `CcrV1Schema`.** `LocalCcrV1Schema.parse` / `parseCcrV1` / `buildCcrV1`. The published Task 008 schema (the document Task 009 re-exports) only allows `change.add_column`. This pipeline also accepts exactly one of `add_field` (`optional: true`), `add_endpoint`, `add_enum_value`, `add_ui_variant`, `breaking`, or `semantic`, and still rejects unknown keys. Extend `CcrChangeSchema` with those keys, then replace `parseCcrV1` with `CcrV1Schema.parse`. Do not drop the extra keys or the strict object check.
- **Task 083 `SkeletonLockEnforcer`.** `LocalSkeletonLock.evaluate(contractNodeId, ops)`. A locked contract allows additive ops and refuses a breaking fast path with route `ccr`. Swap by mapping each `DiffOp` onto `SkeletonMutation` and calling `SkeletonLockEnforcer.evaluate(store, mutation)`. Nullable or defaulted `add_column` stays allowed after `skeleton_locked`.
- **Task 087 `ChangeClassifier`.** `LocalChangeClassifier` in `classifier.ts`. A requested `additive` / `cosmetic` / `clarifying` / `compatible` label cannot downgrade a breaking structural diff (`classification_floor`). Text that changed but produced no parsed op becomes `BREAKING` (`unclassified_structural_change`). Swap `classify` for `ChangeClassifier.classify(edit)` and keep the floor: if the real class is `breaking`, the CCR class stays `BREAKING`.
- **Task 087 `ReverseImpactWalker`.** `LocalReverseImpactWalker.walk(startIds)`. Edges are `dependent → dependency`. The walk fills `ImpactedBlast` (features, screens, active tasks, merged tasks, checks). Swap for `ReverseImpactWalker.walkCombined` and map `affectedScreens`, `affectedActiveTasks`, `affectedMergedTasks`, and `affectedChecks`.
- **Task 087 hybrid revision.** `LocalHybridRevision.open` records `revisionTask: "Task-087"`. Swap for the hybrid revision entry that consumes the decision card. This package does not apply the breaking schema itself.
- **Task 108 `RevisionAutoStartPolicy`.** `LocalRevisionAutoStartPolicy.evaluate(true)` returns `{ autoStart: false, trigger: "breaking_contract" }`. Swap by calling `RevisionAutoStartPolicy.evaluate` with `breakingContract: true`. Never auto-start that candidate.
- **Task 109 `DurableRoleMailbox`.** `LocalDurableRoleMailbox.submit` uses kinds `SharedTypeAdditionRequest` (additive) and `ContractClarificationRequest` (breaking). `wake(taskIds, resolution)` is the stand-in for `resolve`, which wakes every waiter in one transaction. Swap `wake` for `DurableRoleMailbox.resolve` and keep the waiter list equal to `subscriberTaskIds`.
- **Task 109 `WaitGraphCycleDetector`.** `LocalWaitGraphCycleDetector.commitWait` uses the same BFS as Task 109 `minimalCycle` and does not insert a `waits_on` edge when the new edge would cycle. A cycle escalates to `project-integrator@1`. When both CCRs are additive, one coordinator commit lands both and wakes both requesters. Swap the class for `WaitGraphCycleDetector`; keep `ccr_id` on the edge so the partner CCR can be found.
- **Task 081 contradiction engine.** `LocalContradictionCounter.count(contractNodeId)`. The fast path requires `0`. Swap for `FiveLayerContradictionEngine` over the contract node. A positive count sets `blocked_by_contradiction` and notifies `project-integrator@1`.
- **Task 110 timestamp+hash migrations.** `LocalMigrationNamer.name` returns `migrations/YYYYMMDDHHMMSS_<6 hex>_<slug>.sql`, matching `MigrationIntentAndConflictLinter.nameMigration` with tool `timestamp-hash`. Swap `name` for `nameMigration({ featureId, slug, sql, at, tool: "timestamp-hash" })`.
- **Task 111 merge queue.** The sibling export is `ProjectIntegratorEngine`, not a class named `ProjectMergeQueue`. `LocalProjectMergeQueue.land` records one landing and a 40-hex commit sha derived from the CCR ids, owner task, migration name, and compatibility checks. Swap `land` for the queue submit that advances the integration ref only after those checks pass. One deduped CCR produces one landing.
- **Task 021 surgical holds.** The published sibling name is `TaskHoldAndSubmissionRepo` (the task text says `TaskHoldsManager`). `LocalSurgicalHolds.place(taskIds, "ccr:<id>")` holds active impacted tasks only. Swap for a hold row with reason type `ccr` and `reason_ref_id` of the CCR id. Do not hold already-merged tasks.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-112-contract-change-request-pipeline`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- ccr` — pass. Vitest v5.1.1: 2 files, 47 tests passed. The classifier matrix has 33 SQL, OpenAPI, JSON Schema, and TypeScript cases (above the 25-case floor) plus the false `"additive"` override on `price_cents INTEGER` → `price TEXT`. The pipeline covers owner routing for `orders.dietary_note`, deduped `submitted_at` for `F-Orders` and `F-Reports`, mutual `W-A` / `W-B` cycle break into one coordinator commit, semantic `created_at DESC` → `created_at ASC` review with `M04` / `UI tests`, reject with the locked-adapter instruction, breaking approval into Task 087 without auto-start, `blocked_by_owner_hold` for `entity:MenuItem`, the 4th-CCR spam cap to `project-integrator@1` and `planner`, compatibility-check refusal before land, audit survival across a reopened SQLite file, and `ccr@1` rejection of unknown fields.
- `node scripts/verify-harmony.mjs --task 112` — pass (exit 0, `harmony ok for Task-112`, about 48s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- The diff parsers cover the task's additive and breaking matrix. They are not full SQL, OpenAPI, JSON Schema, or TypeScript compilers. A text change that yields no recognized op is classified `BREAKING` rather than trusted as additive.
- A default-value-only edit on an existing column, with the same type and nullability and no `CHECK` change, does not emit its own op. Put that behavioral change in `behaviorBefore` / `behaviorAfter` so `ccr@1` can flag it.
- `ccr@1.change` stores one representative key. The full ordered op list lives on `ccr_requests.schema_diff` and in the `CLASSIFIED` audit payload.
- Breaking approval stops at `APPROVED` / `revision_task_087`. Task 087 lands the revision. This package does not auto-start it and does not call the merge queue for it.
- `LocalDurableRoleMailbox`, `LocalProjectMergeQueue`, and `LocalSurgicalHolds` are process memory. CCR rows, the audit ledger, wait edges, and notices are in SQLite. Reopen restores those tables, not the in-memory ports.
- Additive fast-path regression is the check id `compat:<contractNodeId>`. Wire Task 111's combined regression gate in front of `LocalProjectMergeQueue.land` so existing consumer suites run as well.
- The package barrel re-export above is not applied. `packages/integrator/src/index.ts` stays frozen.
