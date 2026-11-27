# Pass 04 — Chunk 006 Audit Report (`packages/runtime-adapters` Part 1: Core Supervision, Generic ACP, Codex, Copilot & Cursor — `Tasks 142–146`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-04`
- **Chunk:** `chunk-006`
- **Units Audited (5):**
  - `Task 142` (`task/142-runtime-adapter-core-supervision` @ `e50d00a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-142-runtime-adapter-core-supervision`, unmerged, clean)
  - `Task 143` (`task/143-generic-acp-adapter` @ `4ff2425`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-143-generic-acp-adapter`, unmerged, clean)
  - `Task 144` (`task/144-codex-runtime-adapter` @ `2a84057`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-144-codex-runtime-adapter`, unmerged, clean)
  - `Task 145` (`task/145-copilot-runtime-adapter` @ `5f2d8c7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-145-copilot-runtime-adapter`, unmerged, clean)
  - `Task 146` (`task/146-cursor-runtime-adapter` @ `b6c107e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-146-cursor-runtime-adapter`, unmerged, clean)
- **Governing Architecture Documents:** `agent-runtime-adapters.md`, `sandbox-and-security.md`, `provider-connections.md`, `task-and-skill-architecture.md`, `onboarding-providers-and-runtimes.mmd`, `research/agent-control-protocols.md`, `research/windows-sandboxing.md`.

## 2. Files Directly Inspected
- `packages/runtime-adapters/{package.json,src/index.ts}` (`task-142`)
- `packages/runtime-adapters/src/core/{interface.ts,windows-job.ts}` (`Task 142`)
- `packages/runtime-adapters/src/acp/{adapter.ts,job.ts}` (`Task 143`)
- `packages/runtime-adapters/src/codex/{adapter.ts,process.ts}` (`Task 144`)
- `packages/runtime-adapters/src/copilot/runtime-adapter.ts` (`Task 145`)
- `packages/runtime-adapters/src/cursor/{adapter.ts,local-ports.ts}` (`Task 146`)

## 3. Verified Local Strengths
- `DeterministicSupervisionPolicyEngine` (`142`) enforces canonical `realpath` + case-folded `write_scope[]` checks, blocks `.git/`, lockfiles, sealed test paths, `~/.ssh`/`~/.claude`/`~/.gemini`/`~/.codex`, `git push`, `pnpm add`, and unproxied web tools in `< 2 ms`, and scrubs host environment secrets before child spawn.
- `GenericAcpAdapter` (`143`) implements newline-delimited JSON-RPC 2.0 stdio transport (`initialize`, `session/new`, `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`), host-served `fs/*` & `terminal/*` bridges, and `.git/info/exclude` ephemeral skill mounting + cleanup.
- `CodexRuntimeAdapter` (`144`) implements `codex app-server` JSON-RPC (`thread/start`, `turn/start`, `turn/interrupt`, `thread/resume`, `account/rateLimits/read`), isolated ephemeral `CODEX_HOME`, `danger-full-access`/`--yolo` rejection, and `exp - 180 s` token-refresh restart + `thread/resume`.
- `CopilotRuntimeAdapter` (`145`) and `CursorRuntimeAdapter` (`146`) enforce `wrapped`/`stripped` mode switching, `onPermissionRequest` / `preToolUse` + `beforeShellExecution` deterministic hooks, paid-overage consent stops (`remaining === 0 && overageEnabled` / `onDemandEnabled`), BYOK billing separation, and 90-day Cursor key expiry parking.

## 4. Local Implementation Defects Discovered
1. **`core/windows-job.ts` Missing `KILL_ON_JOB_CLOSE` + Main-Thread `Atomics.wait` Freeze (`Task 142` `packages/runtime-adapters/src/core/windows-job.ts:11-56,141,154` — `F-060`):**
   - Spawns `powershell.exe -ExecutionPolicy Bypass` with `Add-Type` C# P/Invoke calling `CreateJobObject` + `AssignProcessToJobObject` **without calling `SetInformationJobObject(..., JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)`**, so daemon crashes leave orphaned foreign CLI trees alive.
   - Blocks the main Node.js event loop via `Atomics.wait(view, ..., 20_000)` for up to 20 seconds during cold `csc.exe` C# compilation and on every `ASSIGN`/`KILL` call.
2. **Non-Job-Object Process Tracking & Dummy Default Proxy (`Tasks 143–146` — `F-060`):**
   - `143` (`acp/job.ts:20-78`) and `144` (`codex/process.ts:145-160`) track PIDs in a JS `Set` and call `taskkill /PID <pid> /T /F` (missing detached breakaway grandchildren), `144` (`codex/adapter.ts:132,188`) defaults `loopbackProxy` to dead port `http://127.0.0.1:9`, and `145`/`146` (`cursor/local-ports.ts:70-101,115-129,184-200`) default to pure in-memory mocks (`InMemoryJobSupervisor`, `LocalLoopbackProxy` `http://127.0.0.1/proxy/...`, `InMemoryCursorSdk`) with zero `@github/copilot-sdk` or `@cursor/sdk` runtime dependencies in `packages/runtime-adapters/package.json`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Five Incompatible `AgentRuntimeAdapter` Contracts Across `142`–`146` (`F-059`):**
   - `packages/runtime-adapters/src/index.ts` is an empty `packageIdentity()` stub on all 5 branches.
   - None of `143` (`GenericAcpAdapter`), `144` (`CodexRuntimeAdapter`), `145` (`CopilotRuntimeAdapter`), or `146` (`CursorRuntimeAdapter`) imports `../core/index.js` (`142`), and **none defines `readonly runtime: ForeignRuntimeId`**, causing `142`'s `assertAgentRuntimeAdapter` (`core/interface.ts:139`) to throw `SupervisionError("adapter_contract", "Adapter must name its runtime")` on all four!
   - Method signatures diverge on 5 of the 10 methods:
     - `probe()`: `142`/`144` return `status: "ready" | ...`, `143` returns `"ok" | "missing"`.
     - `authStatus()`: `142`/`143` take `0` args returning `Promise<AuthStatus>`, `144` returns sync `CodexAuthStatus`, `145` requires `(connectionId: string): Promise<CopilotAuthStatus>`.
     - `startSession(spec)`: `142` passes `SessionStartSpec`, whereas `143` requires `AcpSessionSpec` (`attemptId`, `taskId`), `144` requires `CodexSessionSpec` (`connection`, `modelId`, `attemptId`), `145` requires `CopilotSessionSpec`, and `146` requires `CursorSessionSpec`.
     - `resume(sessionId, checkpointRef)`: `142`/`143`/`144` pass `checkpointRef: string`; `145` passes `CopilotCheckpointRef` (`{ attemptId }`); `146` passes `CursorCheckpointRef`.
     - `respondPermission` & `usage`: synchronous in `142` (`PermissionReply`, `NormalizedUsage`), async `Promise<...>` in `145` and `146`.
   - `144`, `145`, and `146` each invent their own `GenericAcpAdapterPort` / mini ACP fallback instead of delegating to `143`'s `GenericAcpAdapter`, and each duplicates `LocalSupervisionPolicy`, `LocalEventBus`, and `LocalRedactor` instead of sharing `142` (`core`) and `011` (`shared-observability`).

## 6. Shared-File & Ownership Conflicts
- `packages/runtime-adapters/src/index.ts` and `packages/runtime-adapters/package.json` must be unified across `142`–`151` to add workspace dependencies (`@ef-harness/{sandbox,mcp-server,corpus,providers,governor,shared-observability}`) and export all adapter modules.

## 7. Runtime Wiring Gaps
- Wire all adapters (`143`–`146`) through `142` `AdapterRegistry` + `DeterministicSupervisionPolicyEngine` + `NormalizedRuntimeEventBus`, backed by real `@ef-harness/sandbox` (`WindowsJobObjectManager` `040`, `SandboxTierSelector` `045`, `AllowlistProxyServer` `046`, `HarnessRunEngine` `047`), `@ef-harness/mcp-server` (`AttemptMcpServer` `048`), `@ef-harness/corpus` (`SkillVettingPipeline` `078`), `@ef-harness/governor` (`WarmExecutionPool` `119`, `WindowsDpapiSecretsVault` `120`), and `@ef-harness/providers` (`135, 136, 137, 139, 140, 141`).

## 8. Architecture & Security Violations
- `F-060`: Missing `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` in `core/windows-job.ts` and PID-set `taskkill` / `InMemoryJobSupervisor` in `143`–`146` violate the mandatory Windows Job Object zero-orphan defense-in-depth invariant (`sandbox-and-security.md`, `agent-runtime-adapters.md`).

## 9. Test Coverage & Verification Gaps
- Each adapter (`142`–`146`) only tests against its own local `AgentRuntimeAdapter` type and `Local*` mocks; there is zero shared contract test passing `GenericAcpAdapter`, `CodexRuntimeAdapter`, `CopilotRuntimeAdapter`, and `CursorRuntimeAdapter` into `142` `assertAgentRuntimeAdapter` / `AdapterRegistry`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-059` (`CRITICAL`):** `packages/runtime-adapters` (`142`–`146`) Empty Barrel, Missing `runtime` Property Failing `assertAgentRuntimeAdapter`, Five Divergent 10-Method `AgentRuntimeAdapter` Signatures, and Disconnected `core`/`acp` Silos.
- **`F-060` (`CRITICAL`):** `packages/runtime-adapters` (`142`–`146`) Broken PowerShell Job Object Helper (Missing `KILL_ON_JOB_CLOSE` + 20s Main-Thread `Atomics.wait` Freeze), Non-Job `taskkill`/`InMemoryJobSupervisor` Fallbacks, Dead `127.0.0.1:9` Proxy Default, and Unwired Sandbox/SDK Dependencies.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`142, 143, 144, 145, 146`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `agent-runtime-adapters.md`.
- [x] Intra-package (`142` ↔ `143` ↔ `144`–`146`) and upstream (`011, 040–049, 078, 119, 120, 135–141`) contracts cross-checked.
- [x] Findings recorded immediately in `audit_findings.md` (`F-059`–`F-060`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-04/chunk-007`: `Tasks 147–152` (`packages/runtime-adapters` Claude Code `147`, Gemini CLI `148`, OpenCode `149`, checkpoint/resume `150`, conformance harness `151`, and `Task 152` M4 Exit Gate — check if `147`–`151` have the same `AgentRuntimeAdapter` mismatch and whether `152` uses `.ts` imports / local mocks like `105` & `134`).
