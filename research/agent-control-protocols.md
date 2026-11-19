# Research: controlling another company's coding agent

Question: if the developer's plan only works inside the provider's own agent (Copilot, Cursor, Claude Code, Gemini CLI, Codex), how can our harness drive and supervise that agent without an AI of its own watching it? Checked November 2026.

Design that uses this: [agent runtime adapters](../agent-runtime-adapters.md).

## Finding 1: every major agent has a machine mode

None of them needs to be driven by typing into a terminal. Each offers a structured protocol over stdin/stdout:

| Agent | Machine mode | Source |
|---|---|---|
| Codex | `codex app-server` (JSON-RPC: threads, turns, approvals, `account/rateLimits/read`), or the `codex-acp` adapter | [Codex app-server](https://developers.openai.com/codex/app-server) |
| Claude Code | `claude -p --output-format stream-json --input-format stream-json`; permission prompts through `--permission-prompt-tool`; hooks such as `PreToolUse` | Claude Code headless and hooks docs |
| GitHub Copilot | Copilot SDK (TypeScript) or `copilot --acp --stdio` | [Copilot SDK](https://github.com/github/copilot-sdk) · [acpx agent list](https://acpx.sh/agents.html) |
| Cursor | `@cursor/sdk` local agents, or `cursor-agent acp` | [Cursor SDK](https://cursor.com/docs/sdk/typescript) · acpx list |
| Gemini CLI | `gemini --acp` (native) | [ACP mode](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md) |

## Finding 2: ACP is the common denominator

The **Agent Client Protocol** is a JSON-RPC 2.0 protocol over stdio, created for editors to host coding agents. The client (our harness) sends `initialize`, `session/new`, `session/prompt`, `session/cancel`; the agent streams `session/update` notifications (plan, tool calls, messages) and asks `session/request_permission`. Crucially, ACP lets the **client serve file reads/writes and terminals**, so the host controls what the agent can touch. Gemini CLI's docs call this a security feature: the agent “only has access to the files that the client … has explicitly allowed.”

- The ACP registry lists Codex, Claude (via adapter), Cursor, GitHub Copilot, Gemini CLI, OpenCode and dozens more, all verified to support user authentication. [ACP registry](https://agentclientprotocol.com/get-started/registry)
- Zed and JetBrains IDEs host agents this way; Zed notes that with external agents “billing, legal terms, retention and data handling are between you and the agent provider”. [Zed external agents](https://zed.dev/docs/ai/external-agents)

**Caveat for Claude:** the registry's Claude adapter is built on the Agent SDK. Anthropic reserves the Agent SDK for API-key use in third-party products, so a Claude *plan* must be used through the unmodified `claude` binary directly.

## Finding 3: MCP is how the agent talks back

All of these agents can call MCP tools. A per-attempt MCP server owned by our kernel gives the foreign agent a narrow, typed way to reach us: get the brief, ask the task owner, dispute a test, request a dependency, submit the candidate. ACP's `initialize` also lets the client register MCP servers.

## Finding 4: supervision is rule checking, not understanding

The events are typed (tool kind, path, command, usage, rate limit). A permission request for `write src/kitchen/print.ts` is checked against a glob; a shell request against an allowlist. After the turn, `git diff` in the worktree is the ground truth of what changed, and a clean verifier decides acceptance. No model is needed for any of these.

**Prior art showing passive observation works:** Pixel Agents animates Claude Code sessions by reading the JSONL transcript files Claude Code writes and mapping tool calls to animations every 500 ms, without connecting to Claude Code's API. [Codearia guide](https://academy.codearia.com/en/guides/pixel-agents) · [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents)

## Usage visibility by runtime

| Runtime | Tokens | Cost | Plan window |
|---|---|---|---|
| Codex app-server | Yes | — | `account/rateLimits/read` (windows, used %, reset) |
| Claude Code headless | Result event usage | Result event cost | Only near thresholds |
| Copilot SDK | Per call | Premium-request multiplier | `account.getQuota` (remaining %, reset date) |
| Cursor SDK | `run.usage` | `Agent.getUsage()` | Dashboard only |
| Gemini CLI | Check per version | — | Errors only |

## Risks

- **Version drift:** CLIs update weekly. Pin minimum versions and run a conformance suite on each version change.
- **Policy drift:** keep routes switchable in the provider policy file.
- **Permission gaps:** some runtimes enforce permissions only through hooks; combine with OS boundaries (worktree outside the checkout, Windows Job Objects, scrubbed environment) and the diff check.
