---
task_id: "Task-090"
branch: "task/090-master-planner-wave-budgets"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/master-plan/**"
  - "packages/planner/tests/master-plan/**"
  - ".agent-handoffs/task-090.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 090 handoff

Master planner, Phase 0 recipes `P0.1`–`P0.8`, topological wave DAG, and the 20% paperwork envelope allocator. Commit stays on `task/090-master-planner-wave-budgets`.

## Exports Provided

Import from `packages/planner/src/master-plan/index.ts` until the planner barrel below is wired:

- `MasterPlanOrchestrator` — `master-planner@1`. Builds Phase 0, ordered feature waves, the Task 101 completion wave, and integer envelopes. Waves `2+` stay `projected` with task-count and cost ranges only. `commit` writes the checkpoint; `resume` reloads the latest committed plan for a project.
- `Phase0RecipeGenerator` — exact recipes. Web SaaS emits serial `P0.1` then parallel `P0.2`–`P0.8`. Headless CLI emits `P0.1`, `P0.2`, `P0.5`, `P0.6`, `P0.7` (no `P0.3`, `P0.4`, or `P0.8`). API keeps auth and drops `P0.4` and `P0.8`. Brownfield emits only parallel `P0.B1` and `P0.B2` and never lists `package.json`, the lockfile, TypeScript config, or ESLint config.
- `WaveDagBuilder` — every feature in wave `W` depends only on Phase 0 or on waves `< W`. Breadth is `min(hardwareSlots, providerSlots, developerMax?)`. Ready features are ordered by vertical slice (wave 1), then longest downstream chain, then furthest progress along an in-progress chain.
- `PaperworkBudgetEnvelopeAllocator` — integer `micro-USD` / `ppm` split: research `3%`, architecture `5%`, planning and sealed oracles `6%`, integration and reviews `4%`, final audits `2%`, build `80%`. Sum of the six envelopes equals the project total. Optional research fetches and advisory taste review compress at `100%` of their sub-envelope. Sealed oracles and determinism gates are not skipped; crossing them requires `userApprovedBuildRaid`. A warning metric is returned at `85%`.
- Also exported: `MasterPlanStore`, `validateMasterPlan`, `parseMasterPlannerV1`, `allocateEnvelopes`, `ledgerRows`, `MasterPlanError`, and the port types `LockedSystemArchitecture`, `KnowledgeGraphRepoPort`, `BudgetLedgerPort`, `MasterPlanRequest`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/planner/src/index.ts` is frozen. Integration should add:

```ts
export {
  MasterPlanError,
  MasterPlanOrchestrator,
  MasterPlanStore,
  PaperworkBudgetEnvelopeAllocator,
  Phase0RecipeGenerator,
  WaveDagBuilder,
  allocateEnvelopes,
  ledgerRows,
  parseMasterPlannerV1,
  validateMasterPlan,
} from "./master-plan/index.js";
export type {
  AdmitDecision,
  AdmitRequest,
  BudgetLedgerPort,
  KnowledgeGraphRepoPort,
  LockedSystemArchitecture,
  MasterPlan,
  MasterPlanRequest,
  Phase0Recipe,
  WarningMetric,
} from "./master-plan/index.js";
```

No root `package.json` change. No `packages/shared-contracts/src/index.ts` change. No `packages/db/src/index.ts` change.

## Dependency Intents (New Packages Requested)

None. Persistence uses `node:sqlite` (`DatabaseSync`) and `node:crypto`, which Node 24 already provides to `@ef-harness/planner`.

## Contract Change Requests

Sibling branches are not on this base. Local ports stand in for them. Swap at integration:

- Task 009 `MasterPlannerV1Schema` — `parseMasterPlannerV1` in `schema.ts` is the local port. The published success object is `{ phase0: [{ id, commands, files, versions, expected_outputs }], waves: [{ features, depends_on }], estimates: [{ id, low, high, unit }], paperwork_projection: { ppm, note } }` plus the honest `{ blocked: true, reason }` exit. This task also requires wave index, `planned` vs `projected`, a Task 101 completion wave, integer envelope units, and a hard reject of Wave `2+` leaf tasks. Keep `parseMasterPlannerV1` as the kernel check until `MasterPlannerV1Schema` grows those fields. Do not drop the leaf-task reject when the Zod schema is wired.
- Task 017 `KnowledgeGraphRepo` — `KnowledgeGraphRepoPort.listActiveFeatureIds` is the local port. The repo has no method by that name. Supply active `feature` nodes (`kind = "feature"`, status active) from `getSnapshotAsOf` or an equivalent read. Planner may import `@ef-harness/db` only through its barrel once that barrel exports `KnowledgeGraphRepo`.
- Task 023 `BudgetLedgerRepo.createBudgetScope` — `BudgetLedgerPort` matches the scope kinds `project | feature | task | wave_paperwork | grant` and the `budgets` columns. This port takes `bigint` units; `BudgetLedgerRepo` takes a safe integer. Convert with the same bound `MasterPlanStore` already enforces before calling the repo. Do not call `createWavePaperworkEnvelopes` as-is: Task 023 phases are `spec 3 / research 5 / architecture 6 / planning 4 / audit 2`. This task's envelopes are `research 3 / architecture 5 / planning 6 / integration_review 4 / final_audit 2 / build 80`, which is the breakdown required here. Map each paperwork envelope to its own `wave_paperwork` scope and the build share to a `project` child scope. Register `usd` and `allowance:<connection>` before insert when the real `currencies` foreign key is present.
- Task 083 `SystemArchitectureSynthesizer` — `LockedSystemArchitecture` is the local lock (`schema: "system-architect@1"`, `projectId`, `projectKind`, `featureIds`, optional `database` and `auth`). Swap `featureIds` to `SystemSkeleton.feature_map` (`id`, `title`, `depends_on`). Project kind and the database/auth flags are not on that skeleton; keep passing them on the request until the skeleton records them. A missing feature-map id is `unscheduled_feature` and must stay a hard reject.

`schema/state.sql` is frozen and has `budgets` but not `waves`, `phase0_tasks`, `feature_wave_assignments`, or `budget_envelopes`. `MasterPlanStore.open` creates those four tables with `CREATE TABLE IF NOT EXISTS` and writes `budgets` only when no ledger port is passed. Please add the four tables to `schema/state.sql` so a database that already applied the frozen schema does not depend on this startup migration. Suggested keys match the store: `waves (plan_id, wave_key)`, `phase0_tasks (plan_id, task_id)`, `feature_wave_assignments (plan_id, feature_id)`, `budget_envelopes (plan_id, scope_key, envelope)`. `leaf_tasks_json` stays `NULL` for every row.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-090-master-planner-wave-budgets`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- master-plan` — exit 0. Test Files 4 passed, Tests 25 passed (Web SaaS `P0.1` then `P0.2`–`P0.8`, CLI without `P0.4`/`P0.8`, brownfield without `P0.1`, topological waves, Wave `2+` leaf rejection, `$1`/`$2`/`$10`/`$100`/`1,000,000 ppm` splits, `85%` warning, `100%` optional compression, sealed-oracle raid only with approval, atomic restart).
- `pnpm --filter @ef-harness/planner test` — exit 0. Test Files 5 passed, Tests 26 passed (includes the package smoke test).
- `node scripts/verify-harmony.mjs --task 090` — exit 0. Printed `harmony ok for Task-090`.

## Known Limitations / Follow-Ups

- `packages/planner/src/index.ts` does not re-export this task. Wire the snippet above.
- Envelope names and percents follow this task (`3/5/6/4/2` plus `80` build), not Task 023's `spec/research/architecture/planning/audit` table and not the older economics labels in `build-pipeline.md`. Integration must keep this split.
- `planning-and-crew.md` still numbers Phase 0 differently (`P0.2` packages, `P0.3` data, `P0.7` design). Recipes here follow the Task 090 list: `P0.2` database, `P0.3` auth, `P0.4` design system, `P0.5` domain types, `P0.6` test harness, `P0.7` observability, `P0.8` JSX preview.
- Unused paperwork does not roll forward, and a later wave's envelope is not borrowed. Those rules live on Task 023 `rollForwardUnusedPaperwork` / `crossWaveBorrowApproved`. This allocator only compresses optional calls and raids the build share inside the same bucket after explicit approval.
- Wave 1 leaf tasks are not generated here. `feature-planner@1` (Task 091) owns them. Passing proposed leaves for wave `2+` throws `premature_wave_leaf_tasks` before any database write.
- Opening `MasterPlanStore` on a real `state.db` that already has `budgets` will reuse that table. Currency rows must already exist, and the four plan tables must be created by the migration above or by `CREATE TABLE IF NOT EXISTS`.
