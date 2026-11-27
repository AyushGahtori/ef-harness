# Audit Report — `pass-04/chunk-001` (`Tasks 109–112, 129`: `packages/integrator` Handoffs, Feature Branches, Merge Queue, CCR & Feature Undo)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-001`
- **Scope:** M3 `packages/integrator` submodules: `handoffs` (`109`), `feature-branches` (`110`), `merge-queue` (`111`), `ccr` (`112`), and `undo` (`129`), cross-checked against M2 `integrator` (`096, 101`), `packages/db` (`014–023, 028`), `packages/git-engine` (`038, 039`), `packages/mcp-server` (`048`), and `packages/planner` (`083, 087, 088, 108`).
- **Isolation state:** All 5 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 109` | `task/109-artifact-handoff-mailbox-engine` | `989041d` | `C:/Users/Ayush/Desktop/ef-wt/task-109-artifact-handoff-mailbox-engine` | 0 |
| `Task 110` | `task/110-parallel-feature-branches-migrations` | `08a8f36` | `C:/Users/Ayush/Desktop/ef-wt/task-110-parallel-feature-branches-migrations` | 0 |
| `Task 111` | `task/111-project-merge-queue-integrator` | `72b37e6` | `C:/Users/Ayush/Desktop/ef-wt/task-111-project-merge-queue-integrator` | 0 |
| `Task 112` | `task/112-contract-change-request-pipeline` | `5ed8f81` | `C:/Users/Ayush/Desktop/ef-wt/task-112-contract-change-request-pipeline` | 0 |
| `Task 129` | `task/129-planned-feature-undo-engine` | `94ca48c` | `C:/Users/Ayush/Desktop/ef-wt/task-129-planned-feature-undo-engine` | 0 |

## 3. Files inspected
- `Task 109`: `packages/integrator/src/handoffs/{ddl.ts,mcp-surface.ts,index.ts}`
- `Task 110`: `packages/integrator/src/feature-branches/{ddl.ts,branch-manager.ts,state-db.ts,index.ts}`
- `Task 111`: `packages/integrator/src/merge-queue/{engine.ts,queue.ts,gate.ts,state-db.ts,index.ts}`
- `Task 112`: `packages/integrator/src/ccr/{engine.ts,ledger.ts,index.ts}`
- `Task 129`: `packages/integrator/src/undo/{engine.ts,state-db.ts,gate.ts,index.ts}`

## 4. Architecture documents consulted
- `agent-handoffs.md`, `agent-graph-routing.md`, `parallel-feature-integration.md`, `linked-architecture-revisions.md`, `stops-undo-and-reentry.md`, `workspace-and-git.md`
- `prompt-contracts.md` (`project-integrator@1`, `ccr@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 6691–6936`, `7967–8033`)

## 5. Contracts and signatures discovered
- `Task 109`: `ArtifactHandoffStore`, `ReadResultToolHandler`, `HandoffMcpSurface.dispatch(tool, caller, args)` (rejects any tool !== `harness.read_result`), `DurableRoleMailbox`, `WaitGraphCycleDetector`, `OwnerResolutionCoordinator`, `HANDOFF_DDL` (14 private SQLite tables).
- `Task 110`: `ParallelFeatureBranchManager`, `DependencyIntentAggregator`, `MigrationIntentAndConflictLinter`, `SmartBranchFreshnessSync`, `openFeatureBranchStateDb` (6 private SQLite tables including `ref_leases`, `feature_branch_runtime`).
- `Task 111`: `ProjectMergeQueue.{enqueue,drain,recover}`, `ProjectIntegratorEngine.resolve` (sync `ProjectIntegratorModel`), `CombinedRegressionGate.run`, `MergeBatchBisector`, `openMergeQueueStateDb` (5 private SQLite tables including `ref_leases`, `feature_queue_runtime`).
- `Task 112`: `ContractChangeRequestEngine.{submit,submitMany,approve,reject,landQueued}`, `DeterministicSchemaDiffClassifier`, `AdditiveOwnerFastPath`, `BreakingCcrRevisionReopener`, `CcrLedger` (5 private SQLite tables + 12 `Local*` default stand-in ports).
- `Task 129`: `FeatureUndoEngine.{execute,revive}`, `FeatureUndoInventoryAnalyzer`, `CrossFeatureUsageGraphChecker`, `SharedOwnershipTransferPlanner`, `UndoDataRetentionDialog`, `FeatureUndoExecutor`, `KnowledgeGraphPort.open` (6 private `undo_*`/`ref_leases` SQLite tables).

## 6. Confirmed findings
- **`F-049` (`CRITICAL` / `SCHEMA_MISMATCH`):** Five isolated private SQLite schemas (`36` custom tables!) across `packages/integrator` (`109` `HANDOFF_DDL`, `110` `feature_branch_runtime`/`ref_leases`, `111` `merge_queue_items`/`feature_queue_runtime`/`ref_leases`, `112` `CCR_DDL`, `129` `undo_nodes`/`ref_leases`) bypass `@ef-harness/db` single-writer `SqliteConnection`, duplicate `feature_runtime`, `leases`, `edges`, `read_sets`, and `CasBlobStore` (`028`), leave `112` wired to 12 `Local*` mocks instead of `109`/`110`/`111`/`083`/`087`/`108`, leave `109`'s `harness.read_result` unwired in `AttemptMcpServer` (`048`), and store `'undone'` in shadow `undo_nodes` instead of canonical `state.db`.
- **`F-050` (`CRITICAL` / `RUNTIME_WIRING` & `SECURITY`):** `CombinedRegressionGate` (`111`, `merge-queue/gate.ts:90-218`) and `FeatureUndoEngine` (`129`, `undo/gate.ts:13-57`) execute unsandboxed `child_process` commands against hardcoded toy conventions (`node --check *.js` skipping all `.ts`/`.tsx` files, `node build.mjs`, `template/app.sqlite`, `features/*/manifest.json`, `features/**/*.test.js`), while `ProjectIntegratorEngine` (`111`, `merge-queue/engine.ts:82-177`) uses a synchronous `defaultModel` rewriting `features/<id>/manifest.json` instead of async `ModelProtocolAdapter` (`053`) + `CleanVerifierRunner` (`055`) + `HarnessRunEngine` (`047`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 109` (`handoffs`) → `Task 048` (`AttemptMcpServer` `harness.read_result`), `Task 112` (`CCR`), `Task 116` (`QuestionArbiter`), `Task 126` (`WorkerInspector`).
- `Task 096` (`FeatureIntegratorEngine`) + `Task 110` (`feature-branches`) → `Task 111` (`ProjectMergeQueue`) → `Task 129` (`FeatureUndoEngine`) + `Task 160` (`LiveAppPreview`).
- `Task 083` (`SkeletonLockEnforcer`) + `Task 087` (`HybridRevisionEngine`) + `Task 108` (`RevisionAutoStartPolicy`) + `Task 109`–`111` → `Task 112` (`CCR`).

## 9. Defects and missing integrations
- Even within `packages/integrator`, `096`, `101`, `109`, `110`, `111`, `112`, and `129` do not import one another or share a common database schema (`F-047`, `F-049`, `F-050`).
- `packages/integrator/src/index.ts` exports none of these modules (`F-047`, `F-049`).

## 10. Tests and verification performed
- Reviewed unit tests across `packages/integrator/tests/{handoffs,feature-branches,merge-queue,ccr,undo}/**`: tests rely on temp repos structured around `build.mjs` and `features/<id>/manifest.json` + local SQLite files.

## 11. Unresolved questions
- Interaction with the remaining 4 `packages/integrator` M5 modules (`171–174`: coexistence-watcher, landing, human-fix, ui-checks) — inspected next in `pass-04/chunk-002`.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-002`: `Tasks 171–174` (`packages/integrator/src/{coexistence,landing,human-fix,ui-checks}/**`).
