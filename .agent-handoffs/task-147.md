---
task_id: "Task-147"
branch: "task/147-claude-code-headless-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/claude-code/**"
  - "packages/runtime-adapters/tests/claude-code/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 147 handoff

Claude Code headless runtime adapter. Console API key only. Commit stays on `task/147-claude-code-headless-adapter`.

## Exports Provided

Import from `packages/runtime-adapters/src/claude-code/index.ts` until the package barrel is wired:

- `ClaudeCodeRuntimeAdapter` — ten-method runtime (`probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`)
- `ClaudeStreamJsonTransport` — newline-delimited `stream-json` stdio, control-channel interrupt, permission responses
- `ClaudeStdioPermissionController` — `--permission-prompt-tool stdio` decisions `{ behavior: "allow", updatedInput? }` or `{ behavior: "deny", message }`
- `ClaudeConsoleKeyComplianceEnforcer` — console-key gate. Missing key message is `Anthropic Console API key required — Claude consumer subscriptions are not supported`

Also exported from the subtree for tests and injection, and **not** for the package barrel: port types and the local stand-ins listed under sibling wiring.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's owned write scope and was not edited. Integration should add only these re-exports:

```ts
export {
  ClaudeCodeRuntimeAdapter,
  ClaudeStreamJsonTransport,
  ClaudeStdioPermissionController,
  ClaudeConsoleKeyComplianceEnforcer,
} from "./claude-code/index.js";
```

Do not re-export the local port classes (`DeterministicSupervisionPolicyEngine`, `NormalizedRuntimeEventBus`, `LocalCliMinVersionGate`, `LocalBudgetLedger`, and the other `Local*` stand-ins) from the package barrel. Those names belong to sibling tasks. Construct `ClaudeCodeRuntimeAdapter` with the real ports via `ClaudeCodeRuntimeAdapterOptions` after the swap.

No root `package.json`, `tsconfig`, or workspace file changes.

## Dependency Intents (New Packages Requested)

None. No new package. The adapter spawns the `claude` binary (or a test double) with `node:child_process`.

## Contract Change Requests

None. Frozen foundation files were not edited.

Sibling contracts are not on base `649773097c387ae534b686ea5825f449f843aa7c`. This task uses local ports inside `packages/runtime-adapters/src/claude-code/` and records the swap here. Replace the local class with the sibling export; keep the method names the adapter already calls.

| Local port | Swap to | Adapter call |
|---|---|---|
| `DeterministicSupervisionPolicyEngine` | Task 142 `DeterministicSupervisionPolicyEngine` | `evaluate(request, context)` |
| `NormalizedRuntimeEventBus` | Task 142 `NormalizedRuntimeEventBus` | `publish`, `stream`, `historyOf` |
| `LocalCliMinVersionGate` | Task 135 `CliMinVersionGate` | `evaluate("claude", installedVersion)`. Default floor `2.1.0` matches the bundled Claude floor. `probe()` maps `below_minimum` to `version_too_old`. |
| `CompliancePolicyLocksPort` | Task 135 `CompliancePolicyLocks` | optional `inspectCredential`. The enforcer remains authoritative and refuses subscription material even if this port is absent. |
| `LocalWindowsDpapiSecretsVault` | Task 120 `WindowsDpapiSecretsVault` | `read(secretId)` |
| `LocalApiConnectionManager` | Task 136 `ApiConnectionManager` | `readConsoleKey(connectionId)` |
| `LocalPriceTable` | Task 136 `VersionedPriceTableEstimator` | `estimateMicroUsd(modelId, usage)` integer micro-USD, half-up per 1M tokens, including cache read and cache creation |
| `LocalBudgetLedger` | Task 023 `BudgetLedger` | `reserve({ attemptId, connectionId, ceilingMicroUsd })`, `recordSpend(receipt)` |
| `LocalAttemptCheckpoints` | Task 150 attempt checkpoints | `save`, `latest`. Budget stop handoff is `Task-059` and `Task-128`. |
| `LocalSandboxTierSelector` | Task 045 `SandboxTierSelector` (Task 142 notes the published class may be Task 043) | `selectTier`. `hold: true` blocks launch. |
| `PidTrackingJobSupervisor` | Task 041 `WindowsJobSupervisor` (Task 142 notes Task 040 `WindowsJobManager`) | `create`, `attach`, `kill` after the 500 ms interrupt grace |
| `LocalLoopbackAllowlistProxy` | Task 046 loopback allowlist proxy | `bind`. Proxy delivery omits `ANTHROPIC_API_KEY` from the child env. |
| `LocalLeasedMcpServer` | Task 049 `LeasedMcpServer` | `lease`. Written to an ephemeral `--mcp-config` with `--strict-mcp-config`. |
| `LocalPacketSecurityRedactor` | Task 011 `PacketSecurityRedactor` | `register`, `redact`, `redactValue` |

`resume(sessionId, checkpointRef)` returns `{ supported: false, reason: "unsupported_resume" }` when no native `session_id` is available, for Task 150's fresh-session fallback.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-147-claude-code-headless-adapter` on `task/147-claude-code-headless-adapter`.

- `pnpm --filter @ef-harness/runtime-adapters typecheck` — exit 0
- `pnpm --filter @ef-harness/runtime-adapters lint` — exit 0
- `pnpm --filter @ef-harness/runtime-adapters test -- claude-code` — exit 0, 3 files, 18 tests passed
- `pnpm --filter @ef-harness/runtime-adapters test` — exit 0, 4 files, 19 tests passed (claude-code plus package smoke)
- `node scripts/verify-harmony.mjs --task 147` — exit 0, `harmony ok for Task-147`

Covered by those tests: console-key required, subscription prefix and oauth env and setup-flow and personal credential path refused before spawn, isolated `CLAUDE_CONFIG_DIR`, scrubbed host secrets, proxy delivery hides the raw key, required argv (`-p`, stream-json input and output, `--permission-prompt-tool stdio`, `--max-budget-usd`, `--strict-mcp-config`) and no skip-permissions flag, wrapped and stripped permission allow/deny (in-scope edit, write scope, symlink junction, `~/.ssh`, `~/.claude`, `git push`, `pnpm add`, `curl | sh`, unproxied web), stripped `--disallowedTools`, token and cache accounting with micro-USD cross-check, `error_max_budget_usd` ledger plus WIP, `--resume`, cooperative interrupt under 500 ms, job kill after the grace, `version_too_old`, steering stdin, skill mount cap and `.git/info/exclude` without touching `CLAUDE.md` or the personal Claude directory.

## Known Limitations / Follow-Ups

- Local ports above are not the real Windows sandbox ACLs, DPAPI store, or price table. They implement the call shapes so this branch is testable. Integration must swap them. A denied tool is not additionally blocked by OS ACLs until Task 045/041 are injected.
- Tests drive `packages/runtime-adapters/tests/claude-code/fake-claude.mjs`, not an installed `claude` binary. Conformance against a real CLI belongs to Task 151.
- Stripped mode always passes `--disallowedTools Bash,WebFetch,WebSearch,Edit,Write`. If a native Edit prompt still arrives, the permission controller uses the same write-scope decision as wrapped mode.
- Cooperative cancel returns as soon as the child honors the stream-json interrupt. Job termination runs only after the 500 ms grace.
- Mounted skills stay under `.ef-harness-claude/` and are listed in `.git/info/exclude`. Deleting them before the candidate diff is left to the resume and commit tasks.
- The ephemeral `CLAUDE_CONFIG_DIR` is removed when the session is interrupted or closed. It is not the user's personal Claude directory.
