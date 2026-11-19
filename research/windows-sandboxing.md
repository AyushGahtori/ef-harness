# Research: sandboxing agent commands on Windows

Question: what actually prevents a command run by an AI agent on Windows from reading personal secrets, writing outside its project or reaching the internet? Design: [sandbox and security](../sandbox-and-security.md).

## What Windows primitives do and don't do

| Primitive | Limits | Doesn't limit |
|---|---|---|
| Job Objects | CPU, memory, process count; kill a whole tree | File access, network |
| Restricted (write-restricted) tokens + ACLs | Where a process can write | Reads the user can already do; network |
| Separate local user + ACLs + firewall rules | Reads, writes and network per user identity | Needs admin to set up |
| AppContainer | Capability-based file, registry and network access | Many developer tools aren't designed to run inside it |
| Windows Sandbox (`wsb` CLI, Windows 11 24H2+) | Full disposable VM | `wsb exec` returns only an exit code, no output, so it can't host interactive build and test commands. [Windows Sandbox CLI](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli) |

## How Codex solved it (the closest prior art)

OpenAI documented building a native Windows sandbox for Codex. [Codex Windows sandbox blog](https://openai.com/index/building-codex-windows-sandbox/) · [Windows sandbox docs](https://learn.chatgpt.com/docs/windows/windows-sandbox)

- **Unelevated:** a write-restricted token with a synthetic SID; ACLs give that SID write access only to the workspace (and deny `.git` and config folders). Network blocking was only advisory (proxy environment variables, stub `ssh`), because “a process could ignore the environment… or just open sockets directly”.
- **Elevated:** one-time admin setup creates `CodexSandboxOffline` and `CodexSandboxOnline` local users; firewall rules block outbound traffic for the offline user except a loopback proxy port, making network policy enforceable. Sandbox users can't read the developer's DPAPI-protected secrets. [Network proxy PR](https://github.com/openai/codex/pull/12220)
- **MXC (Microsoft Execution Containers):** now recommended; native process isolation without admin setup, extra accounts or firewall rules, on Windows 11 24H2 (build 26100.9278) and 25H2 (build 26200.9278) and later. Limits: loopback traffic allowed, deny-read globs evaluated at process start, child processes stop when the foreground command exits (affects detached dev servers).

Codex is open source, so its implementation can be evaluated for reuse (license and maintenance check required).

## Foreign agents' own controls

- Claude Code's sandbox covers shell commands only, and “on native Windows, Claude Code runs commands unsandboxed”. Its file and web tools (Read, Edit, WebFetch, WebSearch) follow permission rules, not the sandbox; hooks and MCP servers it starts run with full access. [Claude Code sandboxing](https://code.claude.com/docs/en/sandboxing)
- Built-in Claude Code subagents inherit the parent's permission rules; custom subagents have independent permissions; all built-in agents can be removed in the Agent SDK with an environment variable, or the `Agent` tool denied. [Claude Code subagents](https://code.claude.com/docs/en/sub-agents) · [Permissions](https://code.claude.com/docs/en/permissions/)

**Consequence:** a vendor's own rules can't be the boundary on Windows. Either the whole vendor process tree runs inside our OS sandbox (wrapped mode) or its native tools are restricted and replaced (stripped mode).

## Supply chain

- pnpm 10 stopped running dependency lifecycle scripts by default; packages must be allowlisted (`onlyBuiltDependencies`, now `allowBuilds`), and `strictDepBuilds` can fail installs with unreviewed scripts. The pnpm maintainers cite postinstall-based attacks as the motivation. [pnpm 10 release](https://github.com/pnpm/pnpm/releases/tag/v10.0.0) · [pnpm settings](https://pnpm.io/10.x/settings) · [Supply-chain guide](https://pnpm.io/10.x/supply-chain-security)
- npm supports `--ignore-scripts`, after which approved scripts can be run explicitly.

## Prompt injection

- Design patterns for agents that resist prompt injection separate the component that reads untrusted content from the component that chooses privileged actions (e.g. plan-then-execute, dual-LLM, action selectors). (Beurer-Kellner et al., 2025, “Design Patterns for Securing LLM Agents against Prompt Injections”, arXiv:2506.08837)
- CaMeL enforces capabilities on data flowing from untrusted sources so that injected text can't trigger privileged tools (Debenedetti et al., 2025, arXiv:2503.18813).
- OWASP lists prompt injection as the top risk for LLM applications and recommends separating instructions from data, least privilege and human approval for high-risk actions. [OWASP LLM Top 10](https://genai.owasp.org/llm-top-10/)

## Credentials in skills and tool output

An empirical study of agent skills found debug logging was the main credential-leak path, because agent frameworks feed stdout back into the model's context. Scrubbing the environment and redacting tool output matter as much as file permissions. (arXiv:2604.03070)

## To measure

- MXC availability across a sample of developer laptops.
- Red-team suite results per tier (file read attempts, socket exfiltration, install-script attacks).
- Overhead per sandboxed command.
