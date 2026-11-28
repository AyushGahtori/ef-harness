---
task_id: "Task-142"
branch: "task/142-runtime-adapter-core-supervision"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/core/**"
  - "packages/runtime-adapters/tests/core/**"
  - ".agent-handoffs/task-142.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 142 handoff

Runtime adapter core: the 10-method `AgentRuntimeAdapter` contract, normalized event bus, deterministic supervision policy, wrapped/stripped selection, sandbox wrapping, trust registry, env scrub, and redaction. Commit stays on `task/142-runtime-adapter-core-supervision`.

## Exports Provided

Import these from the package barrel once wiring below lands. Until then they live in `packages/runtime-adapters/src/core/index.ts`.

- `AgentRuntimeAdapter`, `assertAgentRuntimeAdapter`, `AGENT_RUNTIME_ADAPTER_METHODS`
- `SupervisedAgentRuntime` (reference implementation of the 10 methods)
- `NormalizedRuntimeEvent`, `NormalizedRuntimeEventBus`, `LocalWorkerEventSchema`, `CanonicalWorkerEvent`
- `DeterministicSupervisionPolicyEngine`, `SupervisionContext`, `policyToPermission`, `DIRECT_INSTALL_DENY_REASON`, `USER_STOPPED_REASON`
- `WrappedVsStrippedModeSelector`
- `AdapterRegistry`, `EgressBreachMonitor`
- `MandatorySandboxSupervisor`
- `scrubChildEnvironment`, `normalizeUsage`, `spawnForeignProcess`
- `LocalPacketSecurityRedactor`, `MemoryTurnLog`
- Local ports: `CliMinVersionGatePort`, `SignedProviderPolicyEnginePort`, `WindowsJobSupervisorPort`, `SandboxTierSelectorPort`, `LoopbackAllowlistProxyPort`, `LeasedMcpServerPort`, `SessionProcessCapGuardPort`, `PacketSecurityRedactor`
- Local stand-ins: `LocalCliMinVersionGate`, `LocalSignedProviderPolicy`, `PidTrackingJobSupervisor`, `LocalSandboxTierSelector`, `LocalLoopbackAllowlistProxy`, `LocalLeasedMcpServer`, `LocalSessionProcessCap`

`events(sessionId)` yields only the 13 canonical types: `turn_started`, `assistant_delta`, `tool_call_requested`, `tool_call_started`, `tool_call_finished`, `file_edited`, `permission_requested`, `permission_decided`, `usage_reported`, `rate_limited`, `turn_completed`, `session_error`, `session_exited`.

`usage()` and `usage_reported` always use `{ inputTokens, cachedInputTokens, outputTokens, reasoningTokens, costMicroUsd?, quotaUnits? }`. Claude cache read and cache creation stay available as `cacheReadInputTokens` and `cacheCreationInputTokens` and are summed into `cachedInputTokens`.

`resume()` returns `{ supported: false, reason: "unsupported_resume" }` when the session cannot resume, for Task 150 fresh-session fallback.

Abnormal exits `137` and `0xC0000005` emit `session_exited` with `disposition: "abnormal"` and `handoff: "Task 150"`. `interrupt()` denies every pending permission with reason `user_stopped` and terminates the session job.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/runtime-adapters/src/index.ts` on this branch. After integration, append:

```typescript
export type * from "./core/index.js";
export * from "./core/index.js";
```

No root `package.json` or `packages/shared-contracts/src/index.ts` change.

Tasks 143–151 should import `AgentRuntimeAdapter`, `NormalizedRuntimeEventBus`, `DeterministicSupervisionPolicyEngine`, `WrappedVsStrippedModeSelector`, and `AdapterRegistry` through `@ef-harness/runtime-adapters` after that barrel wiring. `NormalizedRuntimeEventBus.toWorkerEvent()` emits `schema: "event@1"` records whose `consumers` include `board-cockpit` (Task 124) and `worker-inspector` (Task 126).

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

Sibling branches are not on this base. The core calls the local ports below. Swap the class, keep the method names.

| This branch | Replace with | When |
| --- | --- | --- |
| `LocalWorkerEventSchema` (`schema: "event@1"`, non-empty `consumers`) | Task 008 `WorkerEventSchema` / `event@1` | packets land |
| `LocalPacketSecurityRedactor` (`register`, `forget`, `redact`, `redactValue`) | Task 011 `SecretRedactor` (this task's name is `PacketSecurityRedactor`) | telemetry lands |
| `MemoryTurnLog` | Task 029 `turn_log` append of already-redacted text | log store lands |
| `PidTrackingJobSupervisor` plus `assignWindowsJob` / `terminateWindowsJob` | Task 041 `WindowsJobSupervisor`. Published primitive on the sibling branch is Task 040 `WindowsJobManager` | job objects land |
| `LocalSandboxTierSelector.selectTier` | Task 045 `SandboxTierSelector`. Published method on the sibling branch is Task 043 `SandboxTierSelector.resolve` | sandbox tier lands |
| `LocalLoopbackAllowlistProxy.bind` | Task 046 loopback allowlist proxy | proxy lands |
| `LocalLeasedMcpServer.lease` | Task 049 `LeasedMcpServer` | leased MCP lands |
| `LocalSessionProcessCap` | Task 119 `SessionProcessCapGuard` | capacity scheduler lands |
| `LocalCliMinVersionGate.evaluate` and `LocalSignedProviderPolicy.complianceForRuntime` | Task 135 `CliMinVersionGate` and `SignedProviderPolicyEngine` | provider policy lands |

`DeterministicSupervisionPolicyEngine` allows leased MCP tools `kb.*`, `harness.run`, and `harness.read_result` only. Direct `pnpm add` / `npm install` is denied with `Direct package installs are disabled; emit a DependencyIntent via harness MCP instead`.

Wrapped mode keeps native file and shell tools inside the sandbox and denies unproxied web tools. Stripped mode denies native file, shell, and web tools. Both postures still start the process inside the selected sandbox tier, Windows job, and loopback proxy.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-142-runtime-adapter-core-supervision`:

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — exit 0
- `pnpm --filter @ef-harness/runtime-adapters lint` — exit 0
- `pnpm --filter @ef-harness/runtime-adapters test -- core` — 3 files, 22 tests passed (policy allow/deny including symlink, traversal, `.git`, lockfile, credential reads, `git push`, `pnpm add`, unproxied web, under 2 ms p95; env scrub; redaction; registry block; interrupt; abnormal exit; event mapping)
- `node scripts/verify-harmony.mjs --task 142` — exit 0, `harmony ok for Task-142`

## Known Limitations / Follow-Ups

- Local ports above are intentional until the named sibling branches are integrated. Do not vendor their implementations into this tree.
- `LocalPacketSecurityRedactor` masks registered secret values and their URL-encoded form. The full Task 011 pattern catalog stays in that task.
- On Windows, `spawnForeignProcess` holds the real CLI behind a one-byte gate until `PidTrackingJobSupervisor.attach` puts the gate in a job, so grandchildren inherit the job. `terminateWindowsJob` is an in-process helper for that job until Task 040/041 replaces it.
- Write-scope matching is case-insensitive so Windows path casing cannot false-deny an in-scope edit.
- Stripped mode still sandboxes the vendor process. Permission replies are not the only boundary.
