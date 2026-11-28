---
task_id: "Task-149"
branch: "task/149-opencode-acp-runtime-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/opencode/**"
  - "packages/runtime-adapters/tests/opencode/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 149 handoff

External OpenCode ACP runtime adapter. Ephemeral `opencode.json` denies built-in shell and web, keeps compaction explicit, overrides hostile repo and personal config, and attaches only the leased harness MCP server. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `packages/runtime-adapters/src/opencode/index.ts`:

- `OpenCodeRuntimeAdapter` — all 10 `AgentRuntimeAdapter` methods: `probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`. Default mode is `wrapped` (native edit/write stay `ask` and go through ACP `session/request_permission`). `stripped` sets `edit` and `write` to `deny`. `closeSession` cancels, kills the tracked process tree, and deletes the ephemeral config plus worktree skill mounts.
- `OpenCodeConfigGenerator` — writes `opencode.json` under an ephemeral directory and returns `OPENCODE` child env inputs. `resolveEffectiveOpenCodeConfig` returns that document alone. Repo and user documents are ignored, not merged.
- `OpenCodeCompactionController` — `compaction.auto` stays false in config. At `>= 0.75` of the context ceiling (ACP `usage_update` input + output + cacheRead + cacheWrite + reasoning) the next turn is prefixed with a pinned brief. Every MUST line and every `write_scope` path is copied verbatim. `preferFreshSession` returns a Task 150 handoff labeled `[PRIOR UNVERIFIED WIP DIFF — REVIEW & FINISH]`.

Permission dialect is `permission-object` (same as `stack-manifest.json`). A string rule matches every resource, which is how `bash`, `shell`, `webfetch`, `websearch`, `external_directory`, and `doom_loop` are unconditional `deny`. A pattern map is ordered and the last matching glob wins (`evaluatePermission`). Wrapped `edit` / `write` are `ask`. The JSON file does not contain the provider key. `baseURL` is loopback only. Ollama uses `http://127.0.0.1:11434` and records `costMicroUsd: 0` with `currency: "usd-zero"`.

`usage()` and the ledger receipt keep `input`, `output`, `cacheRead`, `cacheWrite`, and `reasoning` with `connectionId`. `resume` calls ACP `session/load`. A contradictory delta, `loadSession: false`, or `SESSION_NOT_FOUND` returns `fallback: "fresh_session_labeled_wip"`. Additive `steer` notes are queued until the next prompt. A note prefixed `CONTRADICTION:` does not resume.

`probe` runs `opencode --version` and `opencode acp --help`. The local gate's minimum is `1.0.0`. A pass is `trust: "conformance_verified"` and is only the version precondition for Task 151. `authStatus` does not read the developer home directory.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is frozen. Add this re-export when the integrator lands the branch:

```ts
export {
  AllowAllPacing,
  DenyPacing,
  InMemoryBudgetLedger,
  InMemoryCheckpointStore,
  InMemorySandboxSelector,
  InMemoryWindowsJobObject,
  LocalDeterministicSupervisionPolicyEngine,
  LocalGenericAcpClient,
  OpenCodeCompactionController,
  OpenCodeConfigGenerator,
  OpenCodeRuntimeAdapter,
  OpenCodeSkillMounter,
  PrefixSteeringClassifier,
  probeOpenCodeBinary,
  resolveEffectiveOpenCodeConfig,
} from "./opencode/index.js";
export type {
  CheckpointRef,
  CompactionAssessment,
  NormalizedRuntimeEvent,
  NormalizedUsageReceipt,
  OpenCodeConfigDocument,
  StartSessionSpec,
  TurnResult,
  VersionProbe,
} from "./opencode/index.js";
```

No root `package.json`, workspace, or tsconfig change.

## Dependency Intents (New Packages Requested)

None. The adapter uses the existing `@ef-harness/runtime-adapters` toolchain and Node built-ins. It does not import `@agentclientprotocol/sdk`.

## Contract Change Requests

Sibling packages are not on this base. The adapter talks to them through local ports. Replace the adapters. Do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 142 `AgentRuntimeAdapter` | `OpenCodeRuntimeAdapter` method set | Keep the 10 method names and the normalized event `type` strings (`turn_started`, `assistant_delta`, `tool_call_requested`, `tool_call_started`, `tool_call_finished`, `file_edited`, `permission_requested`, `permission_decided`, `usage_reported`, `rate_limited`, `turn_completed`, `session_error`, `session_exited`). |
| Task 142 `DeterministicSupervisionPolicyEngine` | `LocalDeterministicSupervisionPolicyEngine.decide` | Returns `allow_once` or `reject_once`. Edit and write must sit inside `write_scope` after `realpath`. Bash, shell, webfetch, and websearch are denied. `harness.run`, `harness.read_result`, and `kb.*` are the leased tools. A third identical call is `doom_loop`. |
| Task 143 `GenericAcpAdapter` / `AcpJsonRpcTransport` | `LocalGenericAcpClient` | Newline JSON-RPC on stdin/stdout. Stderr is not framed. Frames over 8 MB are rejected. `session/request_permission` is answered with `{ outcome: { outcome: "selected", optionId } }`. |
| Task 045 `SandboxTierSelector` | `SandboxTierSelectorPort.select` | `hold: true` throws `sandbox_hold` before `opencode acp` is spawned. |
| Task 041 Windows Job Object | `WindowsJobObjectPort.attach` / `terminateTree` | The in-memory port kills pids the adapter attached, including `trackDescendant`. The real job object must also reap grandchildren that were never enumerated. |
| Task 046 loopback allowlist proxy | `assertLoopbackUrl` | Provider `baseURL` and the leased MCP URL must be `127.0.0.1`, `localhost`, or `::1`. |
| Task 049 `LeasedMcpServer` | `opencode.json` `mcp["ef-harness"]` plus `session/new` `mcpServers` | One remote server, `Authorization: Bearer <per-attempt token>`. No other MCP name is written. |
| Task 078 `SkillMounter` | `OpenCodeSkillMounter` | At most 2 skills, `vettingStatus === "vetted"`, SHA-256 must match. Copies land in `OPENCODE_CONFIG_DIR/skills` and `<worktree>/.opencode/skills`, with `.opencode/skills/` in `.git/info/exclude`. `closeSession` deletes both copies and the exclude line. |
| Task 135 `CliMinVersionGate` | `probeOpenCodeBinary` | Default floor `1.0.0`, plus a denylist. Below the floor the message is `Update opencode to >= <min>`. Replace the floor with the signed policy. |
| Task 023 / Task 136 `BudgetLedger` | `BudgetLedgerPort.record` | One receipt per ACP `usage_update`, attributed to `connectionId`. Ollama forces `costMicroUsd` to 0. |
| Task 140 pacing | `AllowancePacingPort.mayStartTurn` | A deny throws `pacing_blocked` before `session/prompt`. |
| Task 141 no silent paid fallback | `buildOpenCodeChildEnv` / `providerEnv` | The child env is an allowlist plus the one authorized provider variable. Host `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and the other blocked names are not copied. `HOME` and `USERPROFILE` are the ephemeral config directory, not the developer profile. |
| Task 115 additive vs contradictory | `SteeringClassifierPort` | Default classifier treats a `CONTRADICTION:` prefix as contradictory. Swap in the real delta classifier. |
| Task 150 `attempt_checkpoints` | `AttemptCheckpointStorePort` | Saves `attemptId`, `adapterId: "opencode"`, `nativeSessionId`, `pinnedBaseCommitSha`, MUST lines, and `write_scope`. Load failure and contradiction return the labeled WIP string. This branch does not write `state.db`. |
| Task 151 conformance | `probe().trust` | Version-gate pass is `conformance_verified` only as the registration precondition. Task 151 still runs the 10 probes and may downgrade the adapter. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-149-opencode-acp-runtime-adapter`.

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/runtime-adapters test -- opencode` — pass, 5 files, 22 tests. Covers unconditional bash/shell/webfetch/websearch/external_directory/doom_loop denial, last-match globs, hostile repo and personal config left byte-for-byte unchanged, stripped edit denial, loopback rejection, pinned compaction at 75% and 78%, fresh-session handoff, in-scope allow, path escape, Windows case folding, symlink escape when the link can be created, warm policy decisions under 2 ms (median, at least 35 of 40 calls), two-skill mount and cleanup, version gate, and a fake `opencode acp` process through probe, startSession, sendTurn, `session/request_permission`, usage, resume, steer, interrupt, and close. Commands are denied on built-in bash and allowed only as `harness.run`. Ollama cost is 0. A sandbox hold and an old CLI do not spawn `acp`. Pacing stops the turn before a prompt. A tracked helper pid is gone after close with `leakedPids` empty.
- `node scripts/verify-harmony.mjs --task 149` — pass (`harmony ok for Task-149`).

## Known Limitations / Follow-Ups

- The in-memory job object kills pids passed to `attach` and `trackDescendant`. Untracked grandchildren need Task 041's real Windows Job Object.
- `respondPermission` cannot loosen a deny that was already written to the ACP process. A later `allow` for that request id still returns the deny.
- Explicit compaction rewrites the next prompt. It does not call an OpenCode compact RPC. Task 150 owns the fresh-session checkpoint row in `state.db`.
- The local version floor is `1.0.0` until Task 135's signed policy replaces `CliVersionPolicy`.
- `OPENCODE_CONFIG_DIR` must sit outside the worktree and outside the developer personal opencode config directory. The generator throws otherwise.
- Warm policy decisions are under 2 ms. One Windows timer stall can exceed 2 ms, so the test checks the median and the count of in-budget samples rather than every sample.
- `packages/runtime-adapters/src/index.ts` is intentionally untouched. The barrel block above is the integrator's wiring step.
