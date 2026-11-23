---
task_id: "Task-177"
branch: "task/177-github-connector-queue"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/github/**"
  - "packages/ship-deploy/tests/github/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 177 handoff

Remote GitHub connector: auth reuse + device OAuth into vault ports, branch-protection reader, serialized rate-aware queue, conditional ETag poller, pre-push guards, ephemeral credentials, and Task 176 reconciler hooks.

## Exports Provided

Import from `packages/ship-deploy/src/github/index.ts` until the package barrel is wired.

- `GitHubAuthConnector` — `probeCliReuse`, `acceptCliReuse`, `deviceAuthorize`, `parseRemote`, `scopesCoverWorkflow`
- `BranchProtectionPolicyReader` — `read`, `chooseShipStrategy`
- `GitHubRateAwareQueue` / `sharedGitHubQueue` — serialized mutations (`>= 1s`, `< 80/min`, `< 500/hr`), `Retry-After` / `x-ratelimit-reset` backoff
- `ConditionalEtagPoller` — `If-None-Match` polling with adaptive `10s → 20s → 45s` intervals
- `PrePushGuard` — public-repo badge, workflow scope detection, `ls-remote` preflight
- `EphemeralGitCredentialHelper` — ephemeral `GIT_ASKPASS` (no embedded URL tokens)
- `evaluatePushPolicy` — blocks `--force` on protected/default branches; gated `--force-with-lease`
- `registerGitHubEffectReconcilers` — `git_push`, `create_pr`, `update_pr` read-only reconcilers for Task 176
- `parseGitHubRemote`, `containsEmbeddedToken`, `createFetchGitHubTransport`, `GitHubDeviceOAuthFlow`

Structural ports (integrate with Tasks 035, 120, 176):

- `MinGitRepoInspectorPort` — `lsRemote`, `diffNameOnly`
- `VaultSecretWriter` — `putGitHubToken`, `readGitHubToken`
- `EffectReconcilerRegistrar` — `register(effectType, reconciler)`

## Shared Wiring Needs (Root / Index Barrels)

`packages/ship-deploy/src/index.ts` is outside this task's owned write scope. Integrator should re-export:

```ts
export * from "./github/index.js";
```

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-177-github-connector-queue`.

- `pnpm --filter @ef-harness/ship-deploy test -- github` — pass. Vitest v5.1.1: 9 files, 23 tests passed.
- `pnpm --filter @ef-harness/ship-deploy typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/ship-deploy lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 177` — pass (`harmony ok for Task-177`, exit 0).

## Known Limitations / Follow-Ups

- Live `gh` and GitHub.com calls are not used in unit tests; loopback `MockGitHubApi` covers rate limits, ETags, branch protection, reconcilers, and vault storage.
- `GitHubAuthConnector.deviceAuthorize` resolves login via GitHub REST in production; tests stub `fetch`.
- Task 176 `ExternalEffectLedger` types are mirrored via `EffectReconcilerRegistrar` until effects land on the integration branch.