---
task_id: "Task-010"
branch: "task/010-closed-vocabularies"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/shared-contracts/src/vocabularies/**
  - packages/shared-contracts/tests/vocabularies/**
  - .agent-handoffs/task-010.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 010 handoff

Closed vocabularies, lookup constants, basis and status enums, the 28-tag touches registry, the `{ any, all }` scope evaluator, and integer currency converters are on `task/010-closed-vocabularies`. Commit stays on this branch.

## Exports Provided

`packages/shared-contracts/src/vocabularies/index.ts`:

- SQLite lookup tuples, Zod enums, and guards: `NODE_KINDS` (17, `isRequirement`), `EDGE_TYPES` (14, `invalidates`), `TASK_STATES` (15, `claimable` / `done` / `terminal`), `FEATURE_STATES` (13, `terminal`), `PROJECT_STATES` (10), `CHANGE_CLASSES` (6), `HOLD_REASONS`, `INBOX_KINDS`, `EFFECT_STATES`, `RETENTION_CLASSES`, `PRIORITY_CLASSES`
- `SETTLED_BASES`, `CRITERION_STATUSES`, `isSettledBasis`, `isCriterionStatus`, `SettledBasisSchema`, `CriterionStatusSchema`
- `TOUCHES_TAG_GROUPS`, `TOUCHES_TAGS` (28), `TouchesTagSchema`, `isTouchesTag`
- `ScopePredicateSchema`, `matchesScopePredicate`, `evaluateTouchesScope`
- `CurrencyCode`, `CurrencyCodeSchema`, `isCurrencyCode`, `usdToMicroUnits`, `microUnitsToUsdDisplay`, `percentToPpm`, `ppmToPercentDisplay` (`USD_MICRO_SCALE` and `WINDOW_SHARE_PPM_SCALE` are `1_000_000`; 100 percent is `1_000_000` ppm)
- `NAME_KINDS` (17)
- `PROJECT_STAGES`, `MODEL_LEVELS`, `SANDBOX_TIERS`, `RUNTIME_MODES`, `RUNTIME_COST_CLASSES`
- `assertNever`

## Shared Wiring Needs (Root / Index Barrels)

wiring_needs:

- `packages/shared-contracts/src/index.ts` is frozen by Task 001. Add this barrel export so later tasks import the module from `@ef-harness/shared-contracts`:

```ts
export * from "./vocabularies/index.js";
```

The layer rule treats `@ef-harness/shared-contracts/vocabularies` as a deep import past `src/index.ts`, so the public path is that root barrel. `packages/shared-contracts/package.json` stays unchanged.

## Dependency Intents (New Packages Requested)

None. `zod` (`^3.25.0`) and `fast-check` (`^4.1.0`) are already workspace-root devDependencies and resolve from this package. `packages/shared-contracts/package.json` is frozen, so they were not added there.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-010-closed-vocabularies`:

- `pnpm --filter @ef-harness/shared-contracts test -- vocabularies` — pass. Vitest 5.1.1: 5 files, 22 tests passed (SQL parity, basis/status, X-01–X-14 scopes, fast-check currency round-trips).
- `pnpm --filter @ef-harness/shared-contracts typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/shared-contracts lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 010` — pass (`harmony ok for Task-010`).

## Known Limitations / Follow-Ups

The root barrel export in wiring_needs is required before other tasks can import these symbols. `HOLD_REASONS` and `INBOX_KINDS` follow the SQL column comments in `schema/state.sql` because those lists are not CHECK constraints. `PRIORITY_CLASSES` follows the `priority_class` CHECK in `schema/global.sql`.
