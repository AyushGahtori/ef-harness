# Agent runtime adapters: running a harness inside our harness

When the user pays through a plan that only works inside the provider's own agent (Copilot, Cursor, Claude Code), our harness cannot call the model directly. It has to hand a task to *their* agent and supervise it. This document explains how that works without an AI in our harness watching their AI. Sources: [agent control protocol research](research/agent-control-protocols.md).

## The worry, answered

> “How will our harness listen to their harness without an AI in our harness? How will our harness perform any functions without an AI?”

Our kernel never needs to *understand* what another agent is thinking. It reads gauges. Every major coding agent can run headless and emit a **structured event stream**: machine-readable JSON lines such as “about to run `npm test`”, “wants to edit `src/a.ts`”, “used 12,000 tokens”, “turn finished”, “hit a rate limit”. Our TypeScript kernel matches those events against plain rules: is the path inside this task's write scope, is the command allowed, is the budget left. It answers yes or no. A factory supervisor doesn't need to be a welder; they read meters and own the off switch.

Three facts make this safe:

1. **Rules, not judgment, govern permissions.** The brief already lists the write scope, allowed tools and budget. Checking an event against that list is ordinary code.
2. **The Git diff is the truth.** After a turn, the kernel reads the worktree's diff. Whatever the agent *says* it did, only the files it actually changed count, and files outside scope reject the candidate.
3. **Acceptance never trusts the agent.** “All tests pass” in the agent's message means nothing. The clean verifier runs the locked checks ([verification](verification-and-isolation.md)).

Where our harness *does* need intelligence (planning, routing a chat message, resolving answers), it uses the same connection in a **structured turn**: the planner prompt goes to Codex, Claude Code, Copilot or Cursor with tools disabled and a JSON schema for the reply. The kernel validates that JSON like any other model output.

**Why we don't “open a terminal and type”.** Typing into an interactive terminal and reading the screen back would be fragile: colors, spinners, prompts that change between versions, no clean signal for “done”. Every one of these agents ships a machine mode instead: a JSON-RPC protocol over stdin/stdout (ACP or the vendor's own). The harness starts the agent as a child process in that mode. A visible terminal is used only once, for the user's own login.

### One task on a Copilot plan, step by step

| Step | What happens | Who decides |
|---|---|---|
| 1 | Kernel creates worktree `wt/k3/T03-a1`, renders the T03 brief, starts `copilot --acp --stdio` with `cwd` set to that worktree and the harness MCP server registered. | Code |
| 2 | Kernel sends the brief as the first prompt. | Code |
| 3 | Copilot streams `plan.updated` (its todo list). Cockpit shows “3 steps planned”. Office view: the junior sits down and opens a notebook. | Display only |
| 4 | Copilot asks permission to write `src/kitchen/to-print-rows.ts`. The path is inside the write scope glob, so the kernel answers *allow*. | Code (glob match) |
| 5 | Copilot asks to run `curl … \| sh`. Not on the command allowlist: *deny*, recorded. | Code (allowlist) |
| 6 | Copilot calls `harness.ask_owner("Should zero-quantity rows be dropped?")`. The kernel routes it to the T03 author, who finds rule R31 in the record and answers. No user interrupt. | Planner model, then code |
| 7 | Copilot calls `harness.submit_candidate()`. Kernel reads `git diff`: only in-scope files changed. Snapshot commit. | Code |
| 8 | Clean verifier runs the locked checks, including one held-back case. Pass → accepted, dependents unlock. | Code |

Only step 6 used a model on our side, and it was a planner question, not supervision.

## Two ways to use a connection

| Mode | When | Who runs the tool loop | Control level |
|---|---|---|---|
| **Model mode** | API keys, OpenRouter, Sign in with ChatGPT tokens, local models | Our own native worker loop calling the model ([worker loop](worker-loop.md)) | Full: we see every tool call because we execute it. |
| **Agent mode** | Copilot plan, Cursor plan, installed Claude Code, installed Gemini CLI, optionally Codex | The provider's agent, inside a worktree we create | Supervised: we approve tool calls through its permission channel, observe events, and verify the diff. |

ChatGPT plans can use model mode because Sign in with ChatGPT returns a token for the Responses API. That keeps OpenAI work inside our own loop, which is the preferred path.

## The Agent Runtime Interface

Every adapter implements the same small interface so the kernel, cockpit and office view never care which vendor is underneath.

| Operation | Purpose |
|---|---|
| `probe()` | Is the binary or SDK installed, which version, which capabilities (see matrix). |
| `authStatus()` / `login()` | Signed in? Start the provider's own login flow. |
| `startSession(spec)` | `cwd` = attempt worktree, rendered brief, model, effort, permission profile, MCP servers, environment. Returns a session reference. |
| `sendTurn(input)` | Send the brief or a follow-up. |
| `steer(message)` | Mid-turn input where supported; otherwise queue for the next turn boundary. |
| `interrupt()` / `stop()` | Cancel the active turn / end the session and its process tree. |
| `resume(sessionRef)` | Continue a saved session after restart, if the runtime supports it. |
| `events()` | Stream of normalized events (below). |
| `respondPermission(id, decision)` | Allow or deny a pending tool request. |
| `usage()` | Tokens, cost and rate-limit state the runtime exposes. |

### Normalized events

| Event | Meaning | Used by |
|---|---|---|
| `session.started` / `session.ended` | Process and session lifecycle | Kernel, office view |
| `turn.started` / `turn.completed(stopReason)` | One request/response cycle | Kernel, cockpit |
| `plan.updated(steps)` | The agent's own todo list | Cockpit checklist |
| `tool.requested(kind, args)` | kind = read, search, edit, shell, web, mcp | Policy engine, office animation |
| `permission.requested(id, tool, args)` | Waiting for our decision | Policy engine |
| `tool.completed(result, exitCode)` | Summary of the result | Cockpit timeline, stall detection |
| `file.changed(paths)` | Files edited | Scope check, office animation |
| `input.requested(question)` | The agent asks a question | Routed to `AskOwner`, never shown raw to the user |
| `subagent.started/stopped` | The vendor's own subagents | Office view (helpers at the same desk), budget |
| `usage(tokens, cost?)` | Consumption | Ledger |
| `rate_limit(status, resetsAt?, usedPercent?)` | Throttle or window state | Pacing controller |
| `error(kind)` | auth, rate_limit, usage_limit, billing, overloaded, context_overflow, other | Recovery policy |
| `message.delta(text)` | Prose the agent writes | Display only; never drives a decision |

## How each runtime is driven

Prefer the **Agent Client Protocol (ACP)** as the common denominator: one JSON-RPC protocol that most coding agents now speak natively or through an adapter. Use a vendor's native protocol where it exposes more (Codex rate limits, Claude cost).

| Runtime | Transport | Permission channel | Notable extras |
|---|---|---|---|
| Codex | `codex app-server` (JSON-RPC over stdio), or `codex-acp` | Server sends approval requests for commands and patches; sandbox `workspace-write` | `account/rateLimits/read`, `thread/resume`, external ChatGPT tokens via `ACCESS_TOKEN` |
| Claude Code | `claude -p --output-format stream-json --input-format stream-json` | `--permission-prompt-tool stdio` emits `can_use_tool` requests; `PreToolUse` hooks | Result event has usage and cost; `--max-budget-usd` in API-key mode; session resume |
| GitHub Copilot | Copilot SDK (TypeScript), or `copilot --acp --stdio` | SDK permission handler | Per-user `gitHubToken`; `account.getQuota` (remaining % and reset date); BYOK |
| Cursor | `@cursor/sdk` local agent, or `cursor-agent acp` | Hooks `preToolUse` / `beforeShellExecution`; `local.sandboxOptions` | `run.usage`, `Agent.getUsage()`, custom tools for local agents |
| Gemini CLI | `gemini --acp` (native ACP) | `session/request_permission`; ACP file-system proxy | The CLI owns Google login; headless runs reuse its cached login |
| Any ACP agent | `session/new`, `session/prompt`, `session/update` notifications | `session/request_permission` | ACP lets the **client** serve `fs/read_text_file`, `fs/write_text_file` and terminals, so our kernel can own file I/O directly |

The harness never wraps a vendor binary in a way the vendor forbids. Claude Code runs unmodified with a Claude Console **API key** (`claude -p` stream-json, or the Agent SDK, which Anthropic reserves for API-key use); the harness doesn't drive Claude plan logins (see [provider connections](provider-connections.md)). Gemini CLI runs unmodified with its own login. Antigravity is not offered (see [provider connections](provider-connections.md)).

## Talking back: our tools inside their agent

Every mainstream agent supports MCP. The kernel starts a small **harness MCP server** per attempt, scoped by its lease, and registers it with the foreign session:

| Tool | Effect |
|---|---|
| `harness.get_brief()` | Current brief version and pinned contracts |
| `harness.read_result(artifactId, slice?)` | A dependency's accepted artifact |
| `harness.ask_owner(question, criterionId?)` | `AskOwner` to the task author; the agent waits or continues other steps |
| `harness.dispute_test(checkId, counterexample)` | `DisputeTest` to the author |
| `harness.report_progress(step, note)` | Optional progress note; display-only |
| `harness.request_dependency(pkg, range, reason)` | Dependency intent for the integrator |
| `harness.submit_candidate()` | Signals “done”; the kernel snapshots the diff and starts verification |
| `harness.run(command, cwd?)` | Runs a shell command in the attempt's OS sandbox with its own Job Object; used by our loop and by vendors in stripped mode, while wrapped vendors keep their native shell inside the same sandbox ([sandbox and security](sandbox-and-security.md#foreign-agents-native-tools-or-ours)) |
| `harness.start_service(name)` | Starts a manifest service (dev server, watcher) in the attempt's environment and returns its URL; it lives until the attempt ends ([test environments](test-environments.md#starting-servers-from-a-task)) |
| `harness.fetch_docs(url \| package@version)` | Cleaned, labeled documentation through the doc fetcher; workers have no direct internet |
| `harness.flag_blocked(reason)` | Stops and reports a contradictory task or suspicious instruction instead of guessing |
| `kb.search`, `kb.get`, `kb.neighbors`, `kb.contract`, `kb.why`, `kb.code` | Read-only knowledge queries, each recorded in the attempt's read set ([knowledge slicing](knowledge-slicing.md#pull-tools)) |

So: **ACP or the native protocol is how we control them; MCP is how they talk to us.**

## Rules the kernel enforces without an AI

| Guard | Rule |
|---|---|
| Write scope | Allow edits only to path globs in the brief. Deny everything else and record the attempt. |
| Commands | Allow a per-project list (test, build, lint, package-manager install through dependency intents). Deny `git push`, branch switches, `reset --hard`, network installers and deletes outside the worktree. |
| Secrets | Deny reads of vault-mapped paths and home-directory credential files. Environment contains only test settings. |
| Budget | Stop the turn when the attempt's reservation is used. |
| Time | Wall-clock cap per turn and per attempt. |
| Loops | The same tool call with the same arguments N times, or the same failing command fingerprint three times, ends the turn and goes to the owner. |
| Stall | No events for X minutes → interrupt, checkpoint, mark “possibly stuck”. |

Defense in depth, from inside out: the vendor's own sandbox setting; our permission answers; the OS sandbox around every command (file, secret-read and network boundaries enforced by Windows, see [sandbox and security](sandbox-and-security.md)); Job Objects and a scrubbed environment; finally the static audit, diff check and clean verifier.

## Giving their agent our brief

1. Create the attempt worktree ([workspace and git](workspace-and-git.md)).
2. Render the brief as the first turn: task, contracts, write scope, acceptance examples that are not held back, and how to finish (`harness.submit_candidate`).
3. Mount pinned skills into the runtime's local skills folder inside the worktree. Exclude harness files from Git with `.git/info/exclude` so they never land in a commit.
4. Register the harness MCP server and the permission profile.
5. Start the session; store its session reference in the checkpoint.

## Sessions, checkpoints and resume

The checkpoint stores the session reference (Codex thread ID, Claude session ID, Cursor agent ID), the WIP commit made by the kernel in the worktree and the brief version. On resume, try the runtime's own resume. If it fails or the brief changed by contradiction, start a fresh session with the brief plus the labeled WIP diff, exactly as for our own workers.

## Capability matrix (verify per pinned version)

| Capability | Own loop | Codex | Claude Code | Copilot | Cursor | Gemini CLI | Generic ACP |
|---|---|---|---|---|---|---|---|
| Structured events | Native | Yes | Yes | Yes | Yes | Yes | Yes |
| Per-call permission answer | Native | Yes | Yes | Yes | Hooks | Yes | Yes |
| Mid-turn steering | Yes | Yes | Partial | Check | Check | Check | Varies |
| Resume | Yes | Yes | Yes | Yes | Yes | `loadSession` | Varies |
| Token usage | Yes | Yes | Yes | Yes | Yes | Check | Varies |
| Plan window visibility | n/a | Yes | Near threshold only | Yes (`getQuota`) | No | No | No |
| Model and effort choice | Yes | Yes | Yes | Yes | Yes | Yes | Varies |
| MCP tools | Yes | Yes | Yes | Yes | Yes | Yes | Yes |

## Adapter conformance suite

Vendors update CLIs often. On startup and after any version change, each adapter runs a short local suite: start a session in a scratch worktree, request a denied write, request an allowed edit, run an allowed command, interrupt, resume, read usage. A failing step downgrades the runtime: “observe only” (no new tasks) or “disabled”, with the failing step shown in Settings. Unknown event types are logged and ignored rather than crashing the adapter. Minimum versions are pinned in the provider policy file.

## Windows notes

Spawn runtimes directly with `child_process` (no shell string), attach the process tree to the attempt's Job Object, and keep worktree paths short. Use a visible ConPTY terminal only for the user's interactive login.

[Diagram](onboarding-providers-and-runtimes.svg) · [Editable Mermaid](onboarding-providers-and-runtimes.mmd) · [Provider connections](provider-connections.md) · [Agent handoffs](agent-handoffs.md) · [Office view](office-view.md) · [Research](research/agent-control-protocols.md)
