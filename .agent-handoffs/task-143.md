---
task_id: "Task-143"
branch: "task/143-generic-acp-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/acp/**"
  - "packages/runtime-adapters/tests/acp/**"
  - ".agent-handoffs/task-143.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 143 handoff

Generic ACP adapter. Commit stays on `task/143-generic-acp-adapter`. Do not merge.

`GenericAcpAdapter` speaks newline-delimited JSON-RPC 2.0 over stdio: `initialize`, `session/new`, `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`, and `session/load`. Stderr is diagnostic only. One non-JSON stdout line before the first object is treated as a startup banner (`Welcome to Agent v1.2!`). A later non-JSON line, an oversized frame (`> 8 MB`), an unknown-method flood (`8`), or an `initialize` silence past `15 s` kills the child Job and raises `AcpProtocolError`.

Host `fs/read_text_file` and `fs/write_text_file` go through the supervision port (`realpath`, `write_scope`, UTF-8 atomic write, line slicing, `4 MB` cap). Denial is JSON-RPC `-32003`. Host `terminal/create`, `terminal/output`, `terminal/wait_for_exit`, `terminal/kill`, and `terminal/release` take a Pool 2 slot, emit `waiting_run_slot` with status `Waiting for run slot` when the pool is full, and run only through `harness.run` inside a command Job. `interrupt()` settles a pending permission as `reject_once` / `outcome: "cancelled"` and sends `session/cancel`. `resume()` returns `{ supported: false, reason: "unsupported_resume" }` when the agent advertises `loadSession: false`.

`cleanupEphemeralMounts()` deletes `.ef-skills/` and `.ef-mcp/` inside the attempt worktree and revokes the MCP bearer. Those directories are listed in `.git/info/exclude`. The bearer is registered with the redactor before `session/new` is written, so the turn log does not keep the token.

## Exports Provided

Import from `packages/runtime-adapters/src/acp/index.ts` until the package barrel is wired:

- `GenericAcpAdapter` / `createGenericAcpAdapter` — the 10-method runtime (`probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`) plus `stop`, `cleanupEphemeralMounts`, and `inspect`
- `AcpJsonRpcTransport` / `AcpFrameParser` — stdio JSON-RPC framing, monotonic ids, timeouts, stderr separation, wire ring
- `AcpHostFsAndTerminalBridge` — host `fs/*` and `terminal/*`
- `AcpMcpAndSkillBinder` — leased MCP registration and worktree skill mount / cleanup
- `ACP_RUNTIME_PROFILES` — `generic`, `codex-acp`, `copilot-acp`, `cursor-acp`, `gemini-acp`, `opencode-acp` spawn hooks, capability quirks, and env allowlists
- Errors: `AcpProtocolError`, `AcpFramingCorruptionError`, `AcpRpcError`, `SkillMountDeniedError`

Tasks 144–149 should construct `GenericAcpAdapter` with their profile instead of copying framing, permission, fs, or terminal code.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` and `packages/runtime-adapters/package.json` are frozen. Integration should re-export this module from the package barrel. No new `package.json` `exports` key is required once the barrel re-exports it.

```ts
export {
  AcpHostFsAndTerminalBridge,
  AcpJsonRpcTransport,
  AcpMcpAndSkillBinder,
  GenericAcpAdapter,
  createGenericAcpAdapter,
} from "./acp/index.js";
export type { AcpRuntimeProfile, AcpSessionSpec } from "./acp/index.js";
```

No root `package.json`, workspace, or tsconfig change.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None for frozen schema or package barrels.

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 142 `AgentRuntimeAdapter` | `GenericAcpAdapter` method set | Keep the 10 methods. Drop this adapter's structural duplicate once Task 142's interface is on the barrel and make the class `implements` it. |
| Task 142 `NormalizedRuntimeEventBus` | `NormalizedRuntimeEventBus` in `src/acp/events.ts` | Replace the class. This bus also emits `session_started`, `plan_updated`, and `waiting_run_slot` because Task 142's published list has no plan or pool-wait event. Map those three or extend the union. |
| Task 142 `DeterministicSupervisionPolicyEngine` | `LocalSupervisionPolicy.decide(context, request)` | Same `allow` / `deny` / `redirect` via `harness.run` shape, with `elapsedMs`. |
| Task 047 `HarnessRunEngine.executeSandboxedCommand` | `LocalHarnessRunEngine` / `HarnessRunPort` | Task 143's text names this Task 048 `harness.run`. The published engine is Task 047. Pass `executeSandboxedCommand`. |
| Task 048 `AttemptMcpServer.listenLoopback` | `LocalLeasedMcpServer.lease` / `revoke` | Task 143's text names Task 049 `LeasedMcpServer`. The published per-attempt server is Task 048. Return `endpoint` plus the lease `bearerToken`. `session/new` sends `mcpServers[]` with `Authorization: Bearer`. `revoke` runs on session exit. |
| Task 078 `SkillMounter.mount({ worktreeRoot, skillIds, attemptId })` | `LocalSkillMounter.mount({ worktreeRoot, attemptId, skills })` | The local port carries vetted file payloads because the registry is not on this base. Wrap Task 078's mounter so it still lands in `<worktree>/.ef-skills/<attemptId>/` and `.git/info/exclude`. |
| Task 119 `WarmExecutionSlotPool.acquire` / `release` | `LocalWarmExecutionPool` | Default capacity is 2. Queueing emits `waiting_run_slot` and payload status `Waiting for run slot`. |
| Task 040 `WindowsJobManager` (Task 041 consumes it) | `LocalWindowsJob` | `create`, `attach`, `kill`, `close`. Command jobs are separate from the ACP child job so `terminal/kill` does not reap the agent. |
| Task 011 `PacketSecurityRedactor` | `LocalPacketSecurityRedactor` | Placeholder is `[REDACTED:<label>]`. |
| Task 029 `turn_log` | `LocalTurnLog.append` | Kinds are `acp_wire`, `acp_stderr`, and `security`. Text is redacted before append. |

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-143-generic-acp-adapter`:

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/runtime-adapters test -- acp` — pass, 1 file, 11 tests. Live fake ACP child covers `initialize → session/new → session/prompt → session/update → usage → exit`, stdout banner vs framing corruption, stderr isolation, env scrub (`OPENAI_API_KEY` absent), MCP bearer present on the wire and redacted in the turn log, `fs/*` allow/deny (`src/**`, ssh key, symlink junction, out-of-scope write), `terminal/*` `vitest run` allow and `git push --force origin main` deny before spawn, Pool 2 queue of 3 commands on 2 slots with `Waiting for run slot`, `session/cancel` unblocking `session/request_permission` as `reject_once` / `cancelled` in under 500 ms with the child reaped, `loadSession: false` resume, skill and `.ef-mcp` cleanup, and the file byte cap.
- `node scripts/verify-harmony.mjs --task 143` — pass (`harmony ok for Task-143`), including repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- The fake ACP server is `packages/runtime-adapters/tests/acp/fake-acp-server.mjs`. It is not a vendor CLI. Tasks 144–149 supply the real `codex-acp`, `copilot --acp`, `cursor-agent acp`, `gemini --acp`, and `opencode acp` commands through `ACP_RUNTIME_PROFILES`.
- `LocalHarnessRunEngine` can spawn a scrubbed `node` command. The conformance tests inject a recording `harness.run` so `vitest run` does not depend on a project install. Swap it for Task 047 before live builds.
- Pool 2 here is an in-process 2-slot queue, not Task 119's pressure, aging, or disk lane. The event name and `Waiting for run slot` status are the swap point.
- `terminal/kill` aborts that command's Job only. `interrupt()` / `stop()` close the agent Job after the cancel grace (`500 ms` by default).
- Skill mounting refuses user-home config directory segments (`.config`, `.claude`, `.codex`, `.gemini`, `.copilot`) and never creates them. The forbidden home-relative gemini string is not embedded; the check is a path segment.
- `respondPermission` can force a pending request to `reject_once` while the policy is still the default allow/deny path. A manual allow does not override a policy deny.
