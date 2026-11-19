---
task_id: "Task-006"
branch: "task/006-spike-foreign-runtimes"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - spikes/foreign-runtimes/**
  - spikes/tests/foreign-runtimes.test.ts
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 006 handoff

Wire-level probes for Codex app-server, Copilot ACP, Claude stream-json, Gemini ACP, and OpenCode ACP, plus a scratch harness MCP server. Commit stays on `task/006-spike-foreign-runtimes`.

## Exports Provided

Spike modules under `spikes/foreign-runtimes/` (not a package barrel):

- `mini-mcp.mjs` exposes `harness.get_brief`, `harness.ask_owner`, and `harness.submit_candidate` on stdio and on `127.0.0.1` loopback.
- `acp-probe.mjs` drives `initialize`, `session/new` (with MCP server registration), `session/prompt`, `session/cancel`, `session/update`, and `session/request_permission` through `@agentclientprotocol/sdk`.
- `codex-probe.mjs` speaks newline-delimited app-server JSON-RPC (`thread/start`, `thread/resume`, `account/rateLimits/read`, approval requests) and measures whether one process returns two thread ids.
- `claude-probe.mjs` speaks stream-json `can_use_tool` control messages and refuses to spawn unless an explicit console API key is supplied.
- `policy.ts` is the deterministic allow/deny function (write-scope globs and command allowlist). No model call.
- `opencode-permissions.ts` evaluates ordered OpenCode permission rules, last match wins.
- `events.ts` maps wire messages onto the normalized event union.
- `framing.mjs` reassembles split UTF-8 NDJSON and LSP `Content-Length` frames, and isolates banners and malformed lines.
- `spawn-runtime.mjs` spawns resolved `.exe` targets with `shell: false` and `windowsHide: true`, then kills the tree through a Windows Job Object.
- `fakes/` contains the five vendor simulators plus the generic ACP agent.
- `probe.mjs --once` runs one fake scenario. `probe.mjs --report --live` writes `report.json` and `REPORT.md`.

## Shared Wiring Needs (Root / Index Barrels)

`spikes/vitest.config.ts` is frozen by Task 001 and only includes `tests/**/*.test.ts`. The suite itself lives in `spikes/foreign-runtimes/tests/foreign-runtimes.test.ts`. `spikes/tests/foreign-runtimes.test.ts` is a one-line import so `pnpm --filter @ef-harness/spikes test -- foreign-runtimes` can see it. No `src/index.ts` change.

## Dependency Intents (New Packages Requested)

None. The probes import `@modelcontextprotocol/sdk`, `@agentclientprotocol/sdk`, and `zod` from the root install already committed by Task 001.

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/spikes test -- foreign-runtimes` — 17 passed (ACP, Codex, Copilot, Claude stream-json, Gemini ACP, OpenCode ACP, scratch MCP stdio/loopback, split UTF-8, banners, malformed lines, abrupt exit, interrupt, Job Object tree kill, Claude key guard).
- `node spikes/foreign-runtimes/probe.mjs --report --live` — report written. Fake Codex multiplexes two threads in one process (`light`). Live `codex app-server` 0.169.0 returned `rpc_error` before a second thread id, so the scheduling verdict is `session-process`. Unknown live notifications (`remoteControl/status/changed`, `account/updated`, `mcpServer/startupStatus/updated`) were logged and ignored. OpenCode `--version` printed 1.17.12. Copilot launcher file version is 0.1.2 (`--version` did not exit). Claude and Gemini binaries are not installed. No model turn was sent.
- `pnpm exec eslint spikes/foreign-runtimes/**/*.ts spikes/tests/foreign-runtimes.test.ts` — passed.
- `node scripts/verify-harmony.mjs --task 006` — run by the task commit script.

## Known Limitations / Follow-Ups

- Live Codex multiplexing is not confirmed. Tasks 048 and 142–151 should keep the `session-process` cap until a later probe records two live thread ids from one `codex app-server` process. The fake client path is ready to upgrade that verdict to `light`.
- `codex --version` and `copilot --version` did not exit under a piped stdio handle. Recorded versions come from the installed Codex package manifest (0.169.0) and the Copilot launcher file version (0.1.2).
- Claude and Gemini were not installed here, so their live rows are `not_installed`. The Claude probe still refuses a missing or non-console key, and the Gemini probe does not open credential directories.
- OpenCode's installed CLI did not print its permission schema. The ordered keys and last-match rule are the ones enforced by the fake and documented for Task 149: `bash`, `read`, `edit`, `webfetch`, `websearch`, `external_directory`, `glob`, `grep`, `list`. Shell and web are denied; unmatched actions ask.
- Permission decisions are pure TypeScript rules. `harness.ask_owner` records the question and returns a fixed acknowledgement. It does not call a model.
