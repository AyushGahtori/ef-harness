---
task_id: "Task-179"
branch: "task/179-deploy-adapter-vercel-docker"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/deploy-adapters/**"
  - "packages/ship-deploy/tests/deploy-adapters/**"
  - ".agent-handoffs/task-179.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 179 handoff

Deploy adapter interface with v1 `VercelDeployAdapter` and `DockerOverSshDeployAdapter`, plus `NameOnlySyncEnvController` for DPAPI vault name-only env sync. Commit stays on `task/179-deploy-adapter-vercel-docker`.

## Exports Provided

Public module: `packages/ship-deploy/src/deploy-adapters/index.ts`.

Required by Tasks 180–181:

- `DeployAdapter` — `probeAuth`, `planDeploy`, `planEnvSync`, `syncEnv`, `deploy`, `reconcile`, `rollback`
- `VercelDeployAdapter` + `VercelHttpClient` — preview/staging/production deploy, Vercel Env API sync (encrypted values never logged), instant rollback, effect-id reconcile
- `DockerOverSshDeployAdapter` — `StrictHostKeyChecking=yes` host-key pinning, shell-safe path validation, health-gated container swap, `0600` stdin env-file injection (zero `docker run -e` argv secrets), compose `--wait` path
- `NameOnlySyncEnvController` — salted HMAC name-only diff, approval lines (`+ NAME (added)`), blocks live Stripe keys on `preview`, blocks test Stripe keys on `production`
- `DeployApprovalPolicyEngine` + `assertDeployDispatchAllowed` — local port of Task 176 tiered approval for production/staging/preview deploy effects
- `InMemoryKnownHostsStore`, `assertPinnedHost`, typed deploy errors

## Shared Wiring Needs (Root / Index Barrels)

`packages/ship-deploy/src/index.ts` is outside this task's owned write scope. Re-export during integration:

```ts
export {
  DeployAdapter,
  VercelDeployAdapter,
  DockerOverSshDeployAdapter,
  NameOnlySyncEnvController,
  DeployApprovalPolicyEngine,
  VercelHttpClient,
} from "./deploy-adapters/index.js";
export type { DeployPlan, DeployOutcome, NameOnlyEnvDiff, VaultNameHashPort } from "./deploy-adapters/index.js";
```

Integration swaps (sibling tasks not on base `6497730`):

| Local port | Integration target |
|---|---|
| `VaultNameHashPort` | Task 120 `WindowsDpapiSecretsVault.listSecretNamesAndHashes` + deploy materialization |
| `DeployApprovalPolicyEngine` | Task 176 `EnvApprovalPolicyEngine` + Task 127 `ApprovalCard` |
| `VercelHttpClient` token | Task 120 DPAPI + Task 121 `vercel` CLI probe |
| `UnknownOutcomeReconciler.register` | Wire `VercelDeployAdapter.reconcile` / Docker label lookup per Task 176 handoff |

**Local test wiring (this worktree only):** mock Vercel HTTP binds `127.0.0.1:0` (ephemeral port). No fixed localhost services required for CI.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-179-deploy-adapter-vercel-docker`:

- `pnpm --filter @ef-harness/ship-deploy typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/ship-deploy lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/ship-deploy test -- deploy-adapters` — pass. Vitest v5.1.1, 1 file, 10 tests, exit 0. Covers name-only env diff, preview live-key refusal, production test-key refusal, production approval gate, Vercel auth/deploy/reconcile/rollback against mock REST on `127.0.0.1:0`, SSH host-key pinning, shell metacharacter rejection, `0600` stdin env sync without `-e` argv leaks, unhealthy swap abort, and Docker rollback.
- `node scripts/verify-harmony.mjs --task 179` — pass (`harmony ok for Task-179`, exit 0). Also ran root `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Real Vercel and SSH transports are HTTP/CLI wrappers; production wiring uses Task 120 vault and Task 121 human-step probes.
- Post-v1 managed hosts (Fly/Railway/Render) remain behind the `DeployAdapter` interface only.