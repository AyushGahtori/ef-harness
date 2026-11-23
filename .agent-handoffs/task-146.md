---
task_id: "Task-146"
branch: "task/146-cursor-runtime-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/runtime-adapters/src/cursor/**
  - packages/runtime-adapters/tests/cursor/**
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 146 handoff

Cursor SDK and ACP runtime adapter. Commit stays on `task/146-cursor-runtime-adapter`.

## Exports Provided

From `packages/runtime-adapters/src/cursor/index.ts`:

- `CursorRuntimeAdapter` — facade. Selects `@cursor/sdk` local mode or `cursor-agent acp` from signed policy, SDK availability, or `spec.transport`. Implements all 10 `AgentRuntimeAdapter` methods.
- `CursorLocalSdkBridge` — `@cursor/sdk` local agent bridge. Same 10 methods. Launches with DPAPI key material, Windows job supervision, OS sandbox tier, loopback proxy, leased MCP, and both hooks.
- `CursorAcpFallbackAdapter` — `cursor-agent acp` over the `GenericAcpAdapter` port. Same 10 methods, same hook controller, same sandbox options, same normalized events.
- `CursorUsageAndHookController` — synchronous `preToolUse` and `beforeShellExecution`, `run.usage` parsing, `Agent.getUsage()` parsing, and the on-demand pause decision.
- `CURSOR_KEY_EXPIRED_ACCOUNT_CARD` — `Your 90-day Cursor key expired — Re-sign in`
- `CURSOR_LOGIN_ACTION` — `Cursor.auth.login`
- `AgentRuntimeAdapter`, `CursorLocalSandboxOptions`, `CursorLaunchRecord`, `NormalizedUsage`, `NormalizedRuntimeEvent`, `CursorSessionSpec`

For Task 150, Task 151, and Task 141: construct `CursorRuntimeAdapter` with `CursorRuntimeDeps`. Session handles are `CursorCheckpointRecord` (`agentId`, `conversationHandle`, `wipDiff`, `briefVersion`, `steeringNotes`). `resume()` returns `fallback: "native"` or `fallback: "fresh_session"` with `labeledWip` and `rebuiltBrief`. Expired keys and HTTP 401 emit one `AccountCard` and `silentPaidFallback: false`. Included usage at or above 90% with on-demand billing emits one `CheckpointStopCard` before the next provider send.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's owned write scope and was not edited. The integrator should add:

```ts
export {
  CursorRuntimeAdapter,
  CursorLocalSdkBridge,
  CursorAcpFallbackAdapter,
  CursorUsageAndHookController,
  CURSOR_KEY_EXPIRED_ACCOUNT_CARD,
  CURSOR_LOGIN_ACTION,
} from "./cursor/index.js";
export type {
  AgentRuntimeAdapter,
  CursorLaunchRecord,
  CursorLocalSandboxOptions,
  CursorRuntimeDeps,
  CursorSessionSpec,
  NormalizedRuntimeEvent,
  NormalizedUsage,
} from "./cursor/index.js";
```

No root `package.json` or workspace barrel was edited.

### Sibling ports to swap

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). Local ports live in `packages/runtime-adapters/src/cursor/ports.ts`, `policy.ts`, and `local-ports.ts`. Replace the port implementations; keep the adapter call shape.

| Local port | Swap to |
| --- | --- |
| `AgentRuntimeAdapter` and `NormalizedRuntimeEvent` in `cursor/types.ts` | Task 142 `AgentRuntimeAdapter` and `NormalizedRuntimeEventBus` (`turn_started`, `assistant_delta`, `tool_call_*`, `file_edited`, `permission_*`, `usage_reported`, `rate_limited`, `turn_completed`, `session_error`, `session_exited`) |
| `decidePreToolUse` / `decideBeforeShell` used by `CursorUsageAndHookController` | Task 142 `DeterministicSupervisionPolicyEngine` |
| `GenericAcpAdapterPort.start` / `probe` | Task 143 `GenericAcpAdapter` spawning `cursor-agent` with args `["acp"]` |
| `CliMinVersionGatePort.evaluate` | Task 135 `CliMinVersionGate.evaluate` for `cursor-agent` and `@cursor/sdk` |
| `SignedCursorTransportPolicyPort.transportOverride` | Task 135 `SignedProviderPolicyEngine` cursor transport override (`sdk`, `acp`, or `auto`) |
| `SandboxTierSelectorPort.selectTier` | Task 045 / Task 043 `SandboxTierSelector.selectTier` |
| `WindowsJobSupervisorPort` | Task 041 `WindowsJobSupervisor` (process-tree primitive published as Task 040 `WindowsJobManager`) |
| `LoopbackAllowlistProxyPort.bind` | Task 046 loopback allowlist proxy |
| `LeasedMcpServerPort.lease` | Task 049 `LeasedMcpServer` (`kb.*`, `harness.run`, `harness.read_result`) |
| `CursorKeyMaterialPort` and `CursorKeyExpiryPort` | Task 139 `CursorBrowserAuthFlow` + `CursorKeyExpiryReminderScheduler`, reading the 90-day key only from the Task 120 DPAPI vault |
| `CursorSdkPort.createLocalAgent` | Official `@cursor/sdk` local `Agent.create` |
| `CursorAgentUsageClient.getUsage` | Official `Agent.getUsage()` |
| `AllowancePacingPort.observeAuthoritativeUsage` | Task 140 `AllowancePacingController.observeAuthoritativeUsage` (`windowKind: "cursor_included"`, `source: "Agent.getUsage"`, `usedPpm = max(included, fast) * 10_000`) |
| `AllowancePacingPort.reportRunUsage` | Task 140 turn-completion feed from `run.usage` |
| `NoSilentPaidFallbackPort.refuseSilentPaidFallback` | Task 141 no-silent-paid-fallback guard (`cursor_subscription` to `paid_api_key`) |
| `CursorNoticeSink` | Task 127 / Task 141 `AccountCard` and checkpoint stop card |
| `AttemptCheckpointStorePort` | Task 053 / Task 150 `attempt_checkpoints` |
| `CursorConformanceGatePort.verified` | Task 151 conformance suite for `preToolUse`, `beforeShellExecution`, and `local.sandboxOptions` |
| `SecretRedactor` | Task 011 `PacketSecurityRedactor` |

`InMemoryCursorSdk`, `InMemoryCursorAcp`, and the other `InMemory*` / `Local*` classes are offline doubles for tests. They are not the production SDK.

## Dependency Intents (New Packages Requested)

Add `@cursor/sdk` to `@ef-harness/runtime-adapters` when the integrator wires `CursorSdkPort` to `Agent.create`, `run.usage`, `Agent.getUsage()`, and `Cursor.auth.login()`. This task did not edit `packages/runtime-adapters/package.json` because that file is outside the owned write scope. The adapter never imports the package by name, so typecheck stays green before the dependency lands.

## Contract Change Requests

None. No frozen foundation file was edited. Normalized events already use the Task 142 taxonomy so the bus can subscribe without a schema change.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-146-cursor-runtime-adapter`.

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/runtime-adapters test -- cursor` — pass (3 files, 13 tests). Covers both transports' 10 methods, normalized-event parity, `preToolUse` / `beforeShellExecution` allow and deny (in-scope edit, symlink junction escape, `../` escape, `~/.ssh`, `~/.cursor`, `~/.aws`, `state.db`, `git push`, `pnpm add`, `curl`, `wget`, `Invoke-WebRequest` in under 2 ms), stripped `harness.run` redirect, `local.sandboxOptions` worktree pin and loopback proxy, `run.usage` and `Agent.getUsage()` pacing feed, on-demand pause before send, expired-key and HTTP 401 park with one account card and preserved WIP, argv/log redaction, personal Cursor home untouched, job interrupt under 500 ms with zero lingering pids, and conformance hold for an unverified newer CLI.
- `node scripts/verify-harmony.mjs --task 146` — pass (`harmony ok for Task-146`, exit 0). The script also ran repository `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Production `@cursor/sdk` and `cursor-agent` processes are behind ports. Tests use in-memory doubles, not a live Cursor account.
- ACP JSON-RPC framing, host `fs/*`, and host terminals stay in Task 143. This adapter supplies the `cursor-agent acp` spawn, shared hooks, sandbox options, and normalized events.
- The 90-day key is passed into the SDK create request and into the ACP child env `CURSOR_API_KEY`. It is rejected if it appears in argv, registered with the redactor before logging, and omitted from checkpoints and normalized events. The real DPAPI read replaces `CursorKeyMaterialPort.readUserApiKey`.
- `resume()` after interrupt keeps the vendor handle and opens a fresh job when the previous job has no pids. Task 150 still owns fresh-session reconstruction when `supported` is false.
- A newer `cursor-agent` version stays `observe_only` until `CursorConformanceGatePort.verified(version)` is true. Task 151 owns the live conformance suite.
- Barrel re-exports above are not applied on this branch.
