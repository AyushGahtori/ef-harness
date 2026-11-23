---
task_id: "Task-145"
branch: "task/145-copilot-runtime-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/copilot/**"
  - "packages/runtime-adapters/tests/copilot/**"
  - ".agent-handoffs/task-145.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 145 handoff

GitHub Copilot SDK and ACP runtime adapter: wrapped default, stripped fallback, SDK `onPermissionRequest`, `session.usage.getMetrics`, `account.getQuota`, paid-overage pause, and BYOK. Commit stays on `task/145-copilot-runtime-adapter`.

## Exports Provided

Import from `packages/runtime-adapters/src/copilot/index.ts` (the package barrel `packages/runtime-adapters/src/index.ts` is intentionally untouched):

- `CopilotRuntimeAdapter` — facade over the SDK bridge and the ACP fallback. Chooses transport from `CopilotSessionSpec.transport` or Task 135 policy (`preferredTransport()`). Implements all 10 `AgentRuntimeAdapter` methods: `probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`.
- `CopilotSdkBridge` — official SDK shape behind `CopilotSdkClientPort`. Wrapped posture keeps editing tools and passes `excludedTools: []`. Stripped posture passes `excludedTools: ["shell", "web_fetch", "web_search"]` and the permission handler denies built-in shell and web. `gitHubToken` is passed only on the in-memory session config (DPAPI vault read). Leased MCP tools are `kb.*`, `harness.run`, and `harness.read_result`.
- `CopilotAcpFallbackAdapter` — drives Copilot CLI ACP through `GenericAcpAdapterPort` with argv `copilot --acp --stdio` (`COPILOT_ACP_ARGV`). Same 10 methods, same permission handler, same isolated worktree config. The token is not placed on argv.
- `CopilotMetricsAndQuotaTracker` — after each completed turn reads `session.usage.getMetrics()` (missing numbers become `0`; a `TypeError` sets `partial_interrupted: true` and does not throw). Polls `account.getQuota()` on session start, before each turn, and after each turn. Writes `connection_windows` with `source: "account.getQuota"` and calls `AllowancePacingControllerPort.observeCopilotQuota`. When `remaining === 0 && overageEnabled === true` and that reset date is not explicitly approved, it sets `cwnd = 0`, opens one `CheckpointStopCard`, and `sendTurn` throws `CopilotOveragePausedError` before the SDK/ACP send. `approvePaidOverage(connectionId, resetDateUtc)` is the explicit approval hook for Task 141.
- `onPermissionRequest` / `LocalDeterministicSupervisionPolicyEngine` — synchronous policy. Allows in-scope worktree edits and wrapped test/build commands (`pnpm test`, `pnpm build`, `vitest`, `tsc`, `eslint`, `node --test`). Denies `~/.ssh` and other credential paths, out-of-scope edits, symlink escapes, `git push`, `gh pr create`, `pnpm add` / `npm install`, and unproxied web (`curl`, `wget`, `Invoke-WebRequest`, web tools). A caller `allow` cannot override an engine deny. Decisions used by the tests are under 2 ms.
- Local stand-ins, swapped at integration: `LocalCliMinVersionGate`, `LocalCopilotRuntimePolicy`, `LocalSandboxTierSelector`, `LocalWindowsJobObject`, `LocalLoopbackAllowlistProxy`, `LocalLeasedMcpServer`, `LocalGitHubTokenVault`, `LocalByokVault`, `LocalMicroUsdPriceTable`, `LocalAnthropicComplianceLocks`, `LocalAllowancePacingController`, `ConnectionWindowStore`, `AttemptCheckpointStore`, `OverageApprovalStore`, `RecordingCardSink`, `RecordingPaidFallbackGuard`, `RecordingByokLedger`, `localCopilotDeps`.

BYOK (`billing.mode === "byok_api_key"`) resolves the vault key, rejects a non-console Anthropic key, configures the SDK `byok` provider in memory, tags receipts `billingMode: "byok_api_key"`, estimates integer `micro-USD` from the price-table port, sets `premiumRequests: 0` and `subscriptionQuotaApplies: false`, and does not write the Copilot premium `connection_windows` row. A `401` / `Bad credentials` failure parks the session, emits one `AccountCard` titled `Re-authenticate GitHub Copilot`, calls the no-silent-paid-fallback port, and does not read another connection's token.

Skills (at most 2) and `session.json` are written under `<worktree>/.ef-copilot/`, listed in `.git/info/exclude` between `# ef-harness-copilot-begin` and `# ef-harness-copilot-end`, and removed by `interrupt` / `cleanupCopilotAttempt`. Writes under the user profile `.copilot` or `.config/github-copilot` directories throw `home_config_pollution`. The on-disk config does not contain `gitHubToken` or the BYOK key.

`resume` stores the vendor session id in `attempt_checkpoints.session_ref`. Native resume is used when the vendor supports it. Contradiction or `resumeSupported === false` / a null vendor resume returns `fallback: "fresh_session"` for Task 150. `probe` / `authStatus` split models on `enabledForOrg` so organization-disabled models are excluded from roster selection. `interrupt` races a hung SDK cancel (50 ms) and then terminates the job-object port; the vitest-watch test asserts `lingeringProcesses === 0`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/runtime-adapters/src/index.ts` on this branch. Integration should add:

```ts
export {
  CopilotRuntimeAdapter,
  CopilotSdkBridge,
  CopilotAcpFallbackAdapter,
  CopilotMetricsAndQuotaTracker,
} from "./copilot/index.js";
```

No root or package `package.json` dependency was added (`package.json` is frozen). `@github/copilot-sdk` stays behind `CopilotSdkClientPort`:

- `createSession` / `resumeSession` → SDK session create, with `onPermissionRequest`, `excludedTools`, MCP servers, working directory, and BYOK provider
- `session.usage.getMetrics` → `CopilotSdkSessionPort.usage.getMetrics`
- `account.getQuota` → `CopilotSdkClientPort.accountGetQuota`
- `gitHubToken` is an in-memory field on `CopilotSdkSessionConfig`, filled from `GitHubTokenVaultPort.readGitHubToken`

Sibling task branches are not on this foundation base. Swap these local ports for the published classes:

| Local port | Swap to |
|---|---|
| `LocalDeterministicSupervisionPolicyEngine.decide` | Task 142 `DeterministicSupervisionPolicyEngine` |
| `GenericAcpAdapterPort` (`startSession` / `loadSession`, argv `copilot --acp --stdio`) | Task 143 `GenericAcpAdapter` |
| `LocalCliMinVersionGate.evaluate("copilot", version)` | Task 135 `CliMinVersionGate` |
| `LocalCopilotRuntimePolicy.preferredTransport` / `postureOverride` | Task 135 signed policy (SDK vs `copilot --acp`, wrapped vs stripped) |
| `LocalSandboxTierSelector.select` | Task 045 / published Task 043 `SandboxTierSelector` (wrapped tier A, stripped tier C, `network: "loopback-allowlist"`) |
| `LocalWindowsJobObject` | Task 041 Windows Job Object (sibling primitive Task 040 `WindowsJobManager`) |
| `LocalLoopbackAllowlistProxy.bind` | Task 046 loopback allowlist proxy |
| `LocalLeasedMcpServer.lease` | Task 049 leased MCP server |
| `LocalGitHubTokenVault.readGitHubToken` | Task 139 `GitHubCopilotDeviceAuthFlow` plus Task 120 DPAPI `gitHubToken` |
| `accountGetQuota` payload | Task 139 `CopilotQuotaReader` / `CopilotAccountClient.accountGetQuota` |
| `LocalAllowancePacingController.observeCopilotQuota` / `setCwnd` | Task 140 `AllowancePacingController.observeCopilotQuota` |
| `ConnectionWindowStore` | Task 014 `global.db.connection_windows` via Task 140 |
| `AttemptCheckpointStore` | Task 053 `attempt_checkpoints` (`session_ref` = vendor session id) |
| `LocalByokVault` | Task 136 DPAPI API-key vault |
| `LocalMicroUsdPriceTable.estimateMicroUsd` | Task 136 `VersionedPriceTableEstimator` |
| `LocalAnthropicComplianceLocks.assertByokKey` | Task 135 `CompliancePolicyLocks` (Anthropic console key required for Anthropic BYOK) |
| `RecordingPaidFallbackGuard.refuse` | Task 141 no-silent-paid-fallback guard |
| `RecordingCardSink` | Task 128 checkpoint stop card and Task 127 `AccountCard` |
| `OverageApprovalStore.approve` | Task 141 explicit paid-overage confirmation (`confirmPaidOverage` on Task 139) |

`normalizeAccountQuota` accepts both a flat snapshot (`remaining`, `resetDateUtc`, `overageEnabled`) and the nested `quota_snapshots.premium_interactions` shape (`entitlement`, `used`, `remainingPercentage`, `resetDate`, `overagePermitted`). The nested key in code is `quotaSnapshots.premiumInteractions`.

## Dependency Intents (New Packages Requested)

None. No package.json changes. The official Copilot SDK and the `copilot` CLI are integration adapters behind the ports above, not new workspace packages from this task.

## Contract Change Requests

`schema/global.sql` `connection_windows` has no columns for `remaining`, `resetDateUtc`, `overageEnabled`, or pacing `cwnd`. This task does not edit `schema/`. `ConnectionWindowStore` keeps the frozen columns (`connection`, `window_kind: "monthly"`, `window_start`, `window_end`, `limit_units`, `observed_units`, `estimated_units`, `source: "account.getQuota"`, `observed_at`) plus those four fields on the in-memory row. Task 014 / Task 140 should persist `remaining`, `resetDateUtc`, and `overageEnabled` without storing secrets. `observed_units` is `entitlement - remaining` from `account.getQuota`, not a locally invented premium decrement. BYOK turns do not write this Copilot window.

`schema/state.sql` `attempt_checkpoints` stores the vendor session id in `session_ref`. Transport, posture, `resumeSupported`, and `contradiction` are JSON inside `contract_versions` (`AttemptCheckpointStore.sqlRow`). Task 053 can promote those fields to columns. `pending_effects` stays `[]`. No secret bytes are written into either row.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-145-copilot-runtime-adapter`:

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/runtime-adapters lint` — passed (`eslint .`).
- `pnpm --filter @ef-harness/runtime-adapters test -- copilot` — passed, 4 files, 17 tests. Covers wrapped and stripped SDK mode and ACP fallback (`copilot --acp --stdio`) for all 10 methods; `onPermissionRequest` allow of in-scope edits / `pnpm test` / `vitest` / `harness.run` / `kb.search` and deny of out-of-scope paths, `~/.ssh`, symlink escape, `git push`, `gh pr create`, `pnpm add`, `curl`, and `Invoke-WebRequest` in under 2 ms; stripped `excludedTools`; `session.usage.getMetrics` partial payload and `TypeError`; `account.getQuota` nested payload; premium drop to `remaining === 0` with `overageEnabled === true` opening one checkpoint card, `cwnd = 0`, and blocking turn 5 until `approvePaidOverage`; BYOK `micro-USD` on the Anthropic connection with zero premium-window writes and no on-disk key; Anthropic non-console key rejection; one `Re-authenticate GitHub Copilot` card on `401` with no other connection read; org-disabled model exclusion; version `0.9.0` → `version_too_old`; native resume vs contradiction / unsupported resume; worktree `.git/info/exclude` mount and cleanup; job-object kill of a hung `vitest --watch` child with `lingeringProcesses === 0` and interrupt under 500 ms.
- `node scripts/verify-harmony.mjs --task 145` — passed (`harmony ok for Task-145`) after the package typecheck, lint, and Copilot tests above. The harmony script also runs repository `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Sibling branches 041, 043/045, 046, 049, 053, 120, 135, 136, 139, 140, 141, 142, and 143 are not in this foundation base. The `Local*` classes and `*Port` interfaces are the swap list above. Tests use in-memory fakes. No live Copilot SDK, GitHub, or DPAPI calls run here.
- `LocalWindowsJobObject.terminate` is the stand-in for a real Windows Job Object. The vitest-watch test spawns a local `node` interval child and `interrupt` stops that pid with `process.kill` (`SIGKILL`), falling back to `taskkill /T /F` only if the in-process kill fails. It does not attach a kernel Job Object handle. `lingeringProcesses` is the port's remaining pid list after that kill (`0`).
- `CopilotSdkClientPort` is the seam for `@github/copilot-sdk`. Method names match `onPermissionRequest`, `session.usage.getMetrics`, and `account.getQuota`. The official client package is not imported.
- Quota pacing uses `observeCopilotQuota` with Task 140's snapshot shape (`remaining`, `entitled`, `remainingPercentage`, `resetDateUtcMs`). `cwnd` starts at the port default `2` and is forced to `0` only when remaining hits `0`.
- Included-quota exhaustion (`remaining === 0 && overageEnabled === false`) pauses with `premium_exhausted` and does not open the paid-overage card. The paid card is only for `overageEnabled === true`.
- Fake credentials are the literals `fixture-copilot-user-token-alpha` and `fixture-copilot-user-token-bravo`. BYOK test keys are built at runtime so source files do not contain a live credential prefix. No machine tokens were copied.
- Personal profile Copilot directories are refused by `assertNotPersonalCopilotHome`. The isolation test compares directory mtimes and does not create those directories.
- `interrupt` waits at most 50 ms for the vendor cancel, then kills the job port, so a hung SDK `interrupt()` still returns in under 500 ms.
