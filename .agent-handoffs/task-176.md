---
task_id: "Task-176"
branch: "task/176-external-effect-ledger"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/effects/**"
  - "packages/ship-deploy/tests/effects/**"
  - ".agent-handoffs/task-176.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 176 handoff

External effect ledger, environment approval policy engine, lease-epoch fencing guard, and crash-safe `unknown_outcome` reconciler for every outbound push, PR, deploy, migration, env sync, DNS, and webhook effect. Commit stays on `task/176-external-effect-ledger`.

## Exports Provided

Public module: `packages/ship-deploy/src/effects/index.ts`.

Required by Tasks 177–181 and Task 187:

- `ExternalEffectLedger` — `planEffect`, `recordPlanned`, `approveEffect`, `denyEffect`, write-ahead `dispatchEffect`, idempotent `replaySucceededReceipt`, `auditHistory`
- `EnvApprovalPolicyEngine` — tiered approval rules (`git_remote`, `preview`, `staging`, `production`), payload-bound approval validation, hard production auto-approve rejection
- `LeaseEpochFencingGuard` — stale `writer_epoch` and `STOPPED` runtime fencing before socket open
- `UnknownOutcomeReconciler` — register per-effect read-only reconcilers, forbid blind `unknown_outcome` retries, apply `succeeded` / `safe_to_retry` / `escalate`
- `SqliteEffectStore` — frozen `effects` table adapter with `project_runtime` fence port for tests
- `canonicalPayloadHash` / `canonicalizeJson` — RFC 8785-style canonical hashing (Task 007 port)
- `redactEffectPayload` / `assertNoRawSecretsInPayload` — zero-secret-in-ledger guard
- Error types: `PayloadHashMismatchError`, `ProductionAlwaysRequiresExplicitApprovalError`, `ApprovalStalePayloadChangedError`, `LeaseEpochFenceError`, `BlindUnknownOutcomeRetryForbiddenError`, etc.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ship-deploy/src/index.ts` is outside this task's owned write scope. Re-export the effects surface from that barrel during integration:

```ts
export {
  ExternalEffectLedger,
  EnvApprovalPolicyEngine,
  LeaseEpochFencingGuard,
  UnknownOutcomeReconciler,
  SqliteEffectStore,
  canonicalPayloadHash,
  redactEffectPayload,
  PayloadHashMismatchError,
  ProductionAlwaysRequiresExplicitApprovalError,
} from "./effects/index.js";
export type { EffectRecord, EffectIntent, TargetEnv, EffectReconciler } from "./effects/index.js";
```

No root manifest, workspace, eslint, or `schema/state.sql` edits.

Integration swaps:

- `SqliteEffectStore` → Task 013 `StateDb.effects` on the live `state.db` (same frozen columns; approval sidecar JSON stays in `effects.approval`).
- `StoreFencePort.readRuntimeFence` → Task 187 `CrossDeviceLeaseManager` active `writer_epoch` plus Task 114 `project_runtime.state`.
- `EnvApprovalPolicyEngine` approval UX → Task 127 `ApprovalCard` (`Approve` / `Edit` / `Decline`) bound strictly to `canonicalPayloadHash`.
- `UnknownOutcomeReconciler.register(...)` hooks → Tasks 177–181 deploy/GitHub adapters (`git ls-remote`, PR search by head + `EF-Effect-Id`, Vercel deployment lookup).

## Dependency Intents (New Packages Requested)

None. Uses `node:sqlite`, `node:crypto`, and `node:fs` patterns consistent with other Layer 4 packages.

## Contract Change Requests

None. `schema/state.sql` is frozen. Logical fields (`approvalStatus`, `execStatus`, `dispatchedAt`, redacted `payloadJson`) live in the `effects.approval` sidecar JSON and map to frozen states (`intended` / `approved` / `sent` / `confirmed` / `failed` / `unknown`).

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-176-external-effect-ledger`:

- `pnpm --filter @ef-harness/ship-deploy typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/ship-deploy lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/ship-deploy test -- effects` — pass. Vitest v5.1.1, 1 file, 9 tests, exit 0, about 0.8 s. Covers write-ahead `planned → dispatched`, idempotent receipt replay, `PayloadHashMismatchError`, `planEffect` dry-run, production `autoApprove` rejection, stale payload invalidation, stale `writer_epoch` / `STOPPED` fencing, `unknown_outcome` reconciler without blind retry, and raw-secret rejection before insert.
- `node scripts/verify-harmony.mjs --task 176` — pass (`harmony ok for Task-176`, exit 0). The script also ran root `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Consumers cannot import the ledger from `@ef-harness/ship-deploy` until the barrel lines above are applied.
- Task 127 `ApprovalCard` UI binding, Task 187 lease epoch source, and Tasks 177–181 reconciler probes are local ports in this branch; wire them at integration.
- `recordPlanned` with preview project opt-in uses constructor `previewAutoDeployOptIn`; production paths never honor `autoApprove`.
- Full ship audit UI (Task 123 / Task 133) should call `ExternalEffectLedger.auditHistory()` once those surfaces land.