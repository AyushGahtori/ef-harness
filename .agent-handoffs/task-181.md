---
task_id: "Task-181"
branch: "task/181-post-deploy-verify-rollback"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/post-deploy/**"
  - "packages/ship-deploy/tests/post-deploy/**"
  - ".agent-handoffs/task-181.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 181 handoff

Post-deploy health/build-id verification, read-only deployed smoke, the 10-minute error watch, environment-aware rollback, and external registration receipts. Commit stays on `task/181-post-deploy-verify-rollback`.

## Exports Provided

Import from `packages/ship-deploy/src/post-deploy/index.ts` (not re-exported by the package barrel; see wiring):

- `PostDeployVerifier` — `verifyHealthAndBuildId` (TLS, HTTP 200, exact build id, production `/__styleguide` 404, no `data-ef-source`, no stack traces) and `runDeployedSmoke` (375px and 1440px, GET/HEAD only, no Stripe or email side effects).
- `TenMinuteErrorWatchMonitor` — 10-minute window, 30-second polls, breaches on 3 consecutive health failures, container restart count >= 3, or 5xx rate above threshold. Local offline pauses with `Local internet offline — watch paused, live app unaffected` and does not roll back.
- `EnvironmentRollbackPolicyController` — preview and staging call `DeployAdapter.rollback` through the effect ledger. Production raises a P0 interrupt card (`Approve Rollback to <previousSha> Now` / `Investigate / Keep Live`) and does not roll back until `approveRollback`. Default policy never auto-rolls production.
- `ExternalRegistrationReceiptManager` — DNS CNAME/A/TXT, SPF, DKIM, Stripe webhook, and OAuth redirect probes. Receipts are `verified` only after a probe passes; `attest` records `attested` and never upgrades a failed probe.
- `PostDeployReleaseGate` — sequences health, smoke, the watch, rollback, and the shipped receipt `{ shipRunId, env, commitSha, liveUrl, deploymentId, healthPassedAt, smokeReceiptSha, tenMinWatchVerdict, registrations, rollbackTargetId }`. Early dismiss sets logical `state` to `SHIPPED`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ship-deploy/src/index.ts` is outside this task's write scope. Re-export the symbols above from that barrel when integration is allowed.

Sibling implementations are not on this base. `packages/ship-deploy/src/post-deploy/types.ts` holds the local ports. Replace them with the real contracts:

- `UiPlaywrightContractVerifier` (Task 057). Default stand-in: `createHttpLoopbackPlaywrightProbe` (HTTP read-only page, inline-script console errors, asset 404s). Pass the real verifier into `PostDeployVerifier`.
- `HumanStepProbeRegistry` (Task 121). Default stand-in: `createReadOnlyProbeRegistry` (DNS, TLS, HTTPS, optional same-origin webhook test ping). Pass it into `ExternalRegistrationReceiptManager`.
- `ExternalEffectLedger` and `EnvApprovalPolicyEngine` (Task 176). Rollback calls `plan` then `markDispatched` before `DeployAdapter.rollback`. Default policy: `defaultEnvApprovalPolicy` (preview/staging automatic, production explicit). `developerEnabledProductionAutoRollbackPolicy` is the explicit opt-in from ship-and-deploy.md.
- `DeployAdapter.rollback(env, previousDeploymentId, effectId)` (Task 179). The third argument is the ledger effect id. Task 181's prose shows two arguments; this port follows Task 179 so the write-ahead effect id is on the call.
- `PacketSecurityRedactor` (Task 011). Default stand-in: `FallbackPacketSecurityRedactor`. Every runtime log line is redacted before the in-memory CAS stand-in (`InMemoryCasBlobStore`, Task 028).
- `ProductionAlertCardSink` (Task 127). Default stand-in: `InMemoryProductionAlertCardSink`.
- `PostDeployStateStore` (Task 013 `state.db`). Default stand-in: `InMemoryPostDeployStore`.
- `HostObservabilitySource` for Vercel metrics or `docker logs --since` (Task 179). This module builds the poll command and does not open SSH.
- `LocalConnectivityProbe` so a laptop offline event is not treated as a remote crash.

Loopback tests use `127.0.0.1` with an ephemeral port from `listen(0)`. No fixed port is reserved.

## Dependency Intents (New Packages Requested)

None. No package.json changes. Playwright is not imported; the read-only smoke port can be backed by Task 057 later.

## Contract Change Requests

`schema/state.sql` `ship_runs.status` CHECK is `pending|running|passed|failed|cancelled|rolled_back` and has no `SHIPPED` value. This task stores the logical state `SHIPPED` on the receipt and maps it through `schemaStatusFor` to schema status `passed`. `WATCH_PAUSED` maps to `running`, `AWAITING_PROD_ROLLBACK_APPROVAL` and `KEPT_LIVE` map to `failed`, and `ROLLED_BACK` maps to `rolled_back`. A later schema change can add `shipped` or a `post_deploy_receipts` table. Do not edit `schema/` from this branch.

`DeployAdapter.rollback` should keep the Task 179 third `effectId` argument so Task 176 can mark the effect dispatched before the network call.

## Exact Verification Commands & Results

```
pnpm --filter @ef-harness/ship-deploy typecheck
```

Exit 0.

```
pnpm --filter @ef-harness/ship-deploy exec eslint .
```

Exit 0.

```
pnpm --filter @ef-harness/ship-deploy test -- post-deploy
```

Vitest v5.1.1: Test Files 5 passed (5), Tests 27 passed (27). Covered health and exact build-id match, stale `StaleDeploymentBuildIdMismatch`, header and meta build ids, `/__styleguide` 404, zero `data-ef-source`, stack-trace rejection, read-only smoke at 375 and 1440 with no Stripe requests, `ReferenceError: window is not defined` on `/orders`, protected-route 401 vs unlocked 200, fake-timer 30s polls and the 10-minute window, minute-4 5xx spike, 3 health failures, crash loop, local-offline pause with no rollback, early dismiss to `SHIPPED`, preview/staging auto-rollback with ledger dispatch before rollback, production P0 card with no silent rollback, keep-live, redacted logs, and DNS/webhook `verified` vs `attested` receipts.

```
node scripts/verify-harmony.mjs --task 181
```

`harmony ok for Task-181` (exit 0). This also re-runs repo typecheck, lint, and tests.

## Known Limitations / Follow-Ups

- The loopback smoke probe does not launch a browser. It GETs public routes, executes inline classic scripts to surface `window is not defined`, and skips Stripe and email hosts instead of requesting them. Task 057 should supply real Playwright screenshots and console capture.
- `FallbackPacketSecurityRedactor` masks known key prefixes, bearer tokens, URL userinfo, PEM blocks, and registered secret values. Task 011 still owns encoded variants and streaming overlap.
- Rollback of production is automatic only when `EnvApprovalPolicyEngine.rollbackDisposition` returns `automatic`. The default engine never returns that for production.
- The 10-minute watch does not open a Vercel or SSH connection. The host adapter implements `HostObservabilitySource.poll`.
