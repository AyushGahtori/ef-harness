---
task_id: "Task-148"
branch: "task/148-gemini-cli-optional-adapter"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/runtime-adapters/src/gemini-cli/**"
  - "packages/runtime-adapters/tests/gemini-cli/**"
  - ".agent-handoffs/task-148.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 148 handoff

Optional Gemini CLI runtime adapter. Off until the exact compliance notice is accepted. Unmodified `gemini --acp` over a local ACP port, with wrapped Tier A execution and a stripped harness.run fallback. Interactive login is a visible console session. The personal Gemini credential directory is never read or written.

## Exports Provided

From `packages/runtime-adapters/src/gemini-cli/index.ts`:

- `GeminiCliRuntimeAdapter` — 10-method runtime (`probe`, `authStatus`, `startSession`, `sendTurn`, `steer`, `interrupt`, `resume`, `events`, `respondPermission`, `usage`) plus `disable`, `applySignedPolicy`, `autoDiscover`, and `cleanupEphemeralMounts`.
- `GeminiOptInComplianceGate` — default `enabled: false`. `acceptNotice` persists `{ optedInAt, noticeVersion, enabled, revoked, revocationNotice }` under settings key `gemini_cli.opt_in`. `startSession` throws `GeminiOptInRequiredError` before any spawn when the user has not opted in.
- `GeminiVisibleConPtyLoginHelper` — Settings → Connections visible login (`windowsHide: false`, pane `settings-connections`). Cancel kills the process tree. Auth status is an `gemini --acp` `initialize` probe and does not open credential files.
- `complianceNotice`, `NOTICE_VERSION` (`2026-11-17.gemini-cli-acp.1`), `GEMINI_ROUTE_ID` (`gemini_cli_acp`), `GEMINI_MIN_VERSION` (`0.20.0`), `SETTINGS_KEY`.
- Errors: `GeminiOptInRequiredError`, `GeminiRouteRevokedError`, `GeminiHomeAccessError`, `GeminiVersionGateError`.

`RESOURCE_EXHAUSTED` / daily quota sets `cwnd` to 0, opens a `checkpoint_stop` card, and refuses silent paid fallback. A bare `429` / RPM signal halves `cwnd` and leaves the session in the pool. `route_revoked` for `gemini_cli_acp` disables the adapter and parks active sessions with the signed notice.

## Shared Wiring Needs (Root / Index Barrels)

`packages/runtime-adapters/src/index.ts` is outside this task's owned subtree. Integrator should add:

```ts
export {
  GeminiCliRuntimeAdapter,
  GeminiOptInComplianceGate,
  GeminiVisibleConPtyLoginHelper,
  complianceNotice,
  GEMINI_ROUTE_ID,
  GEMINI_MIN_VERSION,
  NOTICE_VERSION,
  SETTINGS_KEY,
} from "./gemini-cli/index.js";
```

Sibling contracts are not on this base (`6497730`). Local ports live under `packages/runtime-adapters/src/gemini-cli/` and should be swapped for the real exports:

| Local port | Swap to |
| --- | --- |
| `MemoryGlobalSettingsStore` | Task 014 `global.db` `settings` row `gemini_cli.opt_in` (existing JSON `settings` table; no schema edit) |
| `LocalCliMinVersionGate` | Task 135 `CliMinVersionGate` for runtime `gemini`, floor `0.20.0`, plus this adapter's `--acp` help check |
| `LocalSupervisionPolicyEngine` | Task 142 `DeterministicSupervisionPolicyEngine` |
| `AgentRuntimeAdapter` (local interface) | Task 142 `AgentRuntimeAdapter` |
| `LocalGenericAcpAdapter` | Task 143 `GenericAcpAdapter` |
| `LocalTierAMxcSandbox` | Task 042 `TierAMxcSandbox` |
| `LocalJobObject` | Task 041 Windows Job Object supervisor |
| `LocalLoopbackAllowlistProxy` | Loopback allowlist proxy. Task 148 names Task 046. On this foundation the loopback worktree is `task/044-loopback-allowlist-proxy`. Swap to whichever export lands on the integration branch. |
| `LocalPacingClassifier` | Task 140 `RateLimitVsUsageLimitClassifier` (`RESOURCE_EXHAUSTED` → usage-limit park, `cwnd = 0`; transient 429 → RPM backoff) |
| `LocalSilentPaidFallbackGuard` | Task 141 no-silent-paid-fallback guard |
| `LocalHarnessRunRecorder` | Task 048 / Task 049 leased `harness.run` MCP (this port records the command and does not execute it) |
| Skill mount under `.ef-gemini-skills/` plus `.git/info/exclude` | Task 078 skill mounter. Lines also exclude `.ef-gemini-home/`. |

Persist opt-in only through `GlobalSettingsStore`. API-key mode injects `GEMINI_API_KEY` into an isolated `GEMINI_CLI_HOME` under the attempt worktree. CLI-login mode lets unmodified `gemini` use that same isolated home. Wrapped mode attaches the Tier A port, the job, and the loopback proxy. Stripped mode writes `tools.exclude` for shell and web tools inside the isolated home and routes shell through `harness.run`.

## Dependency Intents (New Packages Requested)

None. No package.json changes. The visible login helper uses `node:child_process` with `windowsHide: false` because a native console library cannot be added while package manifests stay frozen.

## Contract Change Requests

None. Opt-in state fits the existing `global.db` `settings` table (`key` text, `value` JSON). Suggested value:

```json
{
  "optedInAt": "2026-11-23T12:00:00.000Z",
  "noticeVersion": "2026-11-17.gemini-cli-acp.1",
  "enabled": true,
  "revoked": false,
  "revocationNotice": null
}
```

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-148-gemini-cli-optional-adapter` on `task/148-gemini-cli-optional-adapter`.

- `pnpm --filter @ef-harness/runtime-adapters test -- gemini-cli` — pass, 3 files, 14 tests (repeated once; both runs passed). Covers default-off `startSession` refusal before spawn, notice persistence, personal-directory path spy across probe / authStatus / startSession / visible login, wrapped and stripped fake `gemini --acp`, secret-path and `git push` deny, stripped `harness.run` routing, `usage_update` totals, `RESOURCE_EXHAUSTED` park with `cwnd = 0` and refused silent paid fallback, transient 429 backoff, settings disable, `route_revoked`, version floor, missing `--acp`, and visible-login cancel.
- `pnpm --filter @ef-harness/runtime-adapters lint` — pass (eslint, exit 0).
- `pnpm --filter @ef-harness/runtime-adapters typecheck` — pass (`tsc -b`, exit 0).
- `node scripts/verify-harmony.mjs --task 148` — pass (`harmony ok for Task-148`, exit 0). The command also re-ran workspace typecheck, lint, and test.

## Known Limitations / Follow-Ups

- Barrel re-export and the sibling swaps above are not wired on this branch. Sibling task branches are not ancestors of `6497730`.
- Visible login is a real shown child console plus a streamed output API for the Settings pane, not a native ConPTY pseudoconsole. Cancel still terminates the process tree.
- `LocalHarnessRunRecorder` does not execute commands. The integrator must connect it to leased `harness.run`.
- `MemoryGlobalSettingsStore` is the default store. Production must pass a `global.db` settings adapter.
- Fake `gemini --acp` lives at `packages/runtime-adapters/tests/gemini-cli/fixtures/fake-gemini-acp.mjs` and is the conformance stand-in until a host `gemini` binary is probed.
