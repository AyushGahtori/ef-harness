---
task_id: "Task-144"
branch: "task/144-codex-runtime-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/codex/**"
  - "packages/runtime-adapters/tests/codex/**"
  - ".agent-handoffs/task-144.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 144 handoff

Codex runtime adapter on `task/144-codex-runtime-adapter`. Commit stays on this branch.

## Exports Provided

From `packages/runtime-adapters/src/codex/index.ts`:

- `CodexRuntimeAdapter` — all 10 `AgentRuntimeAdapter` methods (`probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`) for both `codex app-server` and `codex-acp`.
- `CodexAppServerClient` — newline JSON-RPC over stdio: `initialize`, `thread/start`, `turn/start`, `turn/interrupt`, `thread/resume`, `account/rateLimits/read`, `item/delta`, `item/fileChange/requestApproval`, `item/commandExecution/requestApproval`.
- `CodexAcpFallbackTransport` — local driver of `codex-acp` (`initialize`, `session/new`, `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`, `session/load`). Same normalized events and the same supervision policy.
- `CodexRateLimitBridge` — parses `account/rateLimits/read` primary (5h) and secondary (7d) windows into ppm (`usedPercent * 10_000`, so 92% is `920_000`) plus reset timestamps, and feeds `BurnRateWindowTracker` and `ModelAllowanceWeightLearner`. At `>= 900_000` ppm it sets wind-down and the adapter refuses another turn without changing auth mode.

Also exported for tests and the integrator: `parseCodexRateLimits`, `percentToPpm`, `CodexRuntimeError`, `CodexAllowanceWindDownError`, `assertSafeCodexArgs`, `assertSafeCodexConfig`, `buildCodexEnv`, `prepareCodexHome`, `renderConfig`, `LABELED_WIP_HEADER`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's owned write scope (shared with Tasks 142–151). Please re-export the four adapter types from the package barrel:

```ts
export {
  CodexRuntimeAdapter,
  CodexAppServerClient,
  CodexAcpFallbackTransport,
  CodexRateLimitBridge,
} from "./codex/index.js";
```

Do not add dependencies. `@ef-harness/runtime-adapters` already depends on `@ef-harness/shared-contracts`. No root manifest, tsconfig, or vitest config edits.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None. Sibling contracts are not on this base (`6497730`). Local ports live under `packages/runtime-adapters/src/codex/` and must be swapped at integration. Do not import unpublished sibling packages as if they were already on `harness/integration`.

| Local port | Swap to | Wiring |
| --- | --- | --- |
| `AgentRuntimeAdapter` method set and `NormalizedRuntimeEvent` / `LocalEventBus` | Task 142 `AgentRuntimeAdapter`, `NormalizedRuntimeEventBus` | Keep the 10 method names and the event `type` union (`turn_started`, `assistant_delta`, `permission_requested`, `permission_decided`, `usage_reported`, `rate_limited`, `turn_completed`, `session_error`, `session_exited`). Point `CodexRuntimeAdapter` at the core bus. |
| `LocalDeterministicSupervisionPolicyEngine` | Task 142 `DeterministicSupervisionPolicyEngine` | Pass it as `policy`. File approvals and shell approvals already call `decide({ worktreeRoot, writeScope, request })` and keep a deny if `respondPermission` later asks to allow. |
| `CodexAcpFallbackTransport` | Task 143 `GenericAcpAdapter` | Pass it as `genericAcp`. `startSession` must return `{ sessionId, nativeSessionId, pid }` and spawn `codex-acp` with the scrubbed env and ephemeral `CODEX_HOME` this adapter builds. Same permission callback. |
| `LocalCliMinVersionGate` (default floor `0.42.0`, the Task 135 example) | Task 135 `CliMinVersionGate.evaluate("codex", version)` | Pass as `versionGate`. `probe()` maps `below_minimum` / `missing` to `status: "version_too_old"` or `"missing"` and `startSession` does not spawn. |
| `SiwcTokenRefresherPort.refresh({ connectionId })` | Task 137 `SiwcTokenRefresher` | Pass as `tokenRefresher`. Refresh runs only at a turn boundary when `exp - now < 180_000` ms, then the adapter restarts `codex app-server` and calls `thread/resume(threadId)`. A refresh failure stays on the ChatGPT connection. |
| `LocalBurnRateWindowTracker` and `LocalModelAllowanceWeightLearner` inside `CodexRateLimitBridge` | Task 140 `BurnRateWindowTracker`, `ModelAllowanceWeightLearner`, `AllowancePacingController` | Construct `CodexRateLimitBridge` with those two ports (`pacing`). Observations use `primaryPpm`, `secondaryPpm`, reset timestamps, `deltaPrimaryPpm`, and `k[model]` ppm per 1k tokens. |
| `LocalTierAMxcSandbox` | Task 042 `TierAMxcSandbox` | `align({ worktreeRoot, loopbackProxy })` must keep `sandboxMode: "workspace-write"`, `windowsMechanism: "mxc"`, writable roots inside the worktree, and `network: "disabled-except-loopback-proxy"`. Anything else throws `unrestricted_sandbox` before spawn. |
| `LocalWindowsJob` | Task 041 `WindowsJobSupervisor` | Pass as `jobs`. The local port records pids and `process.kill`s them (Windows `taskkill /T /F` only if `process.kill` fails). It is not a kernel Job Object with `KILL_ON_JOB_CLOSE`. |
| `MemoryCheckpointStore` | Task 053 / Task 150 `attempt_checkpoints` | Rows use the schema columns `attempt`, `step`, `wip_ref`, `session_ref` (Codex `threadId`), `contract_versions`, `pending_effects`, `handoff_artifact`, `updated_at`. |
| `LocalWipSnapshot` | Task 037 `DirtySnapshotEngine` | `capture(worktreeRoot)` on unexpected child exit. |
| `LocalResumeHandoff` and `LocalLabeledWipRebuilder` | Task 150 `ForeignRuntimeResumeCoordinator` / `LabeledWipFreshSessionRebuilder` | Exit code `1` reaps the job, stores `wipTreeSha`, and calls the handoff. Contradiction or `thread/resume` failure uses label `[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]`. |
| `LocalSteeringDisposition` (default: every note is additive) | Task 115 `AdditiveVsContradictoryResumer` | Pass as `steering`. Additive notes call `thread/resume` then a follow-up turn. |
| Loopback proxy env (`HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`) | Task 046 allowlist proxy | Default proxy is `http://127.0.0.1:9`. Non-loopback proxies are rejected. |
| `mcpEndpoint` + `EF_HARNESS_MCP_BEARER` | Task 049 leased MCP | Only the harness MCP server is written into the ephemeral `config.toml`. |
| ChatGPT vs API-key currency split | Task 136 price table and Task 141 `NoSilentPaidFallbackGuard` | Sign in with ChatGPT tags `currency: "ppm"` and sets `ACCESS_TOKEN` only. API key tags `currency: "micro-USD"` and sets `OPENAI_API_KEY` only. `costMicroUsd` for API-key turns is a local stand-in (`inputTokens + outputTokens`) until Task 136's price table is injected. Host `OPENAI_API_KEY` is scrubbed and is never applied to a ChatGPT session when the window hits wind-down. |

Spawn contract for the integrator: `codex` args are exactly `["app-server"]` unless a test or policy overrides the binary. `codex-acp` gets no extra flags. Both refuse `danger-full-access`, `--yolo`, and `approval-policy never`. `CODEX_HOME`, `HOME`, and `USERPROFILE` point at the ephemeral per-attempt directory. The user's `.codex` directory is never read or written. `config.toml` sets `approval_policy = "on-request"`, `sandbox_mode = "workspace-write"`, `[windows] sandbox = "mxc"`, `network_access = false`, and the loopback proxy.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-144-codex-runtime-adapter` on `task/144-codex-runtime-adapter`:

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — exit 0.
- `pnpm --filter @ef-harness/runtime-adapters lint` — exit 0.
- `pnpm --filter @ef-harness/runtime-adapters test` — exit 0, 3 files, 15 tests passed (package smoke plus Codex).
- `pnpm --filter @ef-harness/runtime-adapters test -- codex` — exit 0, 2 files, 14 tests passed. Fake stdio `codex app-server` covers turn streaming, in-scope allow / `git push` deny under 2 ms, `turn/interrupt` under 500 ms, `account/rateLimits/read` → `920_000` ppm wind-down with no API-key switch, isolated `CODEX_HOME`, token-expiry restart + `thread/resume`, exit code 1 reap + labeled WIP handoff, `version_too_old` for `0.1.0` vs `0.42.0`, and `codex-acp` fallback (protocol failure and policy override) with the same permission decisions.
- `node scripts/verify-harmony.mjs --task 144` — exit 0, `harmony ok for Task-144`.

## Known Limitations / Follow-Ups

- Sibling branches are not on this base. The swap table above is required before Tasks 150–152 can call the real core, ACP, pacing, sandbox, and token-refresh owners.
- The package barrel re-export is intentionally not in this commit.
- `LocalWindowsJob` does not create a Windows Job Object. Swap Task 041 before relying on `KILL_ON_JOB_CLOSE` for grandchildren whose pids were never recorded.
- `account/rateLimits/read` runs on the app-server transport at session start and after each completed turn. The `codex-acp` fallback does not invent quota percentages when that method is unavailable.
- Default steering treats every note as additive until Task 115 is injected. Tests cover the contradictory path through the port.
- API-key `costMicroUsd` is not the Task 136 price table.
- Verification uses a fake stdio `codex app-server` and `codex-acp`. It does not launch an installed Codex binary.
