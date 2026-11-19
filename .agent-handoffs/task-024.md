---
task_id: "Task-024"
branch: "task/024-cross-db-grant-protocol"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/db/src/grants/**"
  - "packages/db/tests/grants/**"
  - ".agent-handoffs/task-024.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 024 handoff

Cross-database broker-to-project grant protocol. `global.db` and `state.db` never share a SQLite transaction. Capacity moves only through idempotent grant messages.

## Exports Provided

From `packages/db/src/grants/index.ts`:

- `BrokerGrantIssuer` — `issueGrant`, `acknowledgeDeposit`, `acknowledgeDepositedGrants`, `recordClosure`, `reconcileUnknownSpend`, `expireUnreportedGrants`, `releaseUndepositedGrants`, `holdNewGrants`, `releaseNewGrants`
- `ProjectGrantReceiver` — `depositGrant`, `closeGrant`, `markClosureReported`, `recordUnknownReconciliation`, `listDepositedGrantIds`, `grantsNeedingClosure`, `unreportedClosures`
- `GrantReconciler` — `recoverUndepositedGrants` (crash before deposit), `resendUnreportedClosures` (crash after close, before broker ack), `expireVanishedProjectGrants` (project never returns), `reconcileUnknownPaidCall` (unknown paid call), `recoverProjectRestart`, `continueRecovery`
- Message schemas: `GrantIssuedMessage`, `GrantDepositedAck`, `GrantClosureReport`, `GrantUnknownReconciledMessage`, `GrantProtocolMessage`, `GrantMessageSink`
- `GrantSqlSession`, `openGrantDatabasePair`, `installCrossDatabaseAttachGuard`, `loadQueryCatalog`
- `CANONICAL_GRANT_QUERIES`: `deposit_grant`, `deposit_grant_budget`, `close_grant`, `close_grant_receipt`, `global_expire_grants` loaded from `schema/queries.sql`

`issueGrant` checks connection-window headroom inside `BEGIN IMMEDIATE`, inserts `grants.state = 'issued'`, charges `connection_windows.estimated_units` by the full grant, then dispatches `GrantIssued` after commit. `depositGrant` inserts the currency if needed, then runs `deposit_grant` and `deposit_grant_budget`, then sends `GrantDepositedAck`. `closeGrant` runs `close_grant` immediately and waits to run `close_grant_receipt` / `GrantClosureReport` until no `'held'` reservation remains. `unknown` reservations are reported as `unknown_units`. `closure_reported_at` is set only by `markClosureReported` after `recordClosure`. `expireUnreportedGrants` runs `global_expire_grants` (`used_units = units`). `recordClosure` accepts `issued`, `deposited`, or `expired`, counts `used_units + unknown_units` against the same windows charged at issue, and returns `max(0, units - used_units - unknown_units)`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/db/src/index.ts` is outside this task's owned subtree, so it was not edited. The integrator should re-export the grant barrel:

```ts
export {
  BrokerGrantIssuer,
  ProjectGrantReceiver,
  GrantReconciler,
  GrantSqlSession,
  openGrantDatabasePair,
  installCrossDatabaseAttachGuard,
  loadQueryCatalog,
} from "./grants/index.js";
```

## Dependency Intents (New Packages Requested)

None yet.

## Contract Change Requests

None. Tasks 012, 013, 014, and 023 are not on `harness/integration` yet. This task talks to real separate `global.db` and `state.db` files through `GrantSqlSession` (node:sqlite, `BEGIN IMMEDIATE`, ATTACH authorizer plus `limits.attach = 0`, canonical query catalog). When those tasks land, adapt `GlobalBrokerDb` and `ProjectStateDb` onto this session surface rather than changing the grant message schema. Local reserve/settle in the tests runs `reserve`, `settle`, and `settle_mark` from `schema/queries.sql` because `BudgetLedgerRepo` is not in this worktree.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-024-cross-db-grant-protocol`:

- `pnpm --filter @ef-harness/db test -- grants` — pass, 15 tests, 1 file.
- `pnpm --filter @ef-harness/db typecheck` — pass, exit 0.
- `pnpm --filter @ef-harness/db lint` — pass, exit 0.
- `node scripts/verify-harmony.mjs --task 024` — pass, `harmony ok for Task-024`.

## Known Limitations / Follow-Ups

- Package barrel wiring is listed above and is left to integration.
- `grant_protocol_hold` in `global.db.meta` blocks `issueGrant` while crash recovery still has a grant waiting on a `'held'` reservation. `continueRecovery` releases it after the closure is recorded.
- Issuing a grant charges every connection window that covers `issued_at`. Closure and expiry adjust those same windows. Conservative expiry does not charge them a second time; the original full charge stays until a restart proves the grant was never deposited or a closure reports a lower actual spend.
- An overrun records the full `used_units + unknown_units` on `estimated_units`. Headroom is `max(0, limit_units - estimated_units)`, so it is zero once actual spend meets or passes the window limit.
