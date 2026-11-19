# Sandbox and security: what a worker can touch, reach and leak

Any worker, whether our own loop or another company's agent, can be wrong, confused, or manipulated by text it reads (a README, a package, a web page, a test output). A Windows Job Object only stops processes; it doesn't stop a command from reading `C:\Users\<you>\.ssh` or sending it to the internet. This document defines the real boundaries. Research: [Windows sandboxing](research/windows-sandboxing.md).

## Decisions in plain words

1. **The boundary is the operating system, not tool names.** Every process an agent starts, by any tool, runs inside an OS sandbox. Foreign agents run *wrapped*: the whole vendor process tree inside the sandbox, keeping the native tools they were trained on. Where wrapping isn't possible, native shell tools are switched off and `harness.run` replaces them ([details](#foreign-agents-native-tools-or-ours)).
2. **The sandbox is enforced by Windows, not by asking nicely.** Writes are limited to the attempt's worktree. Reads of personal secrets (SSH keys, browser profiles, cloud credentials, other repos, the harness's own data) are denied. Network is blocked at the OS level.
3. **Coding workers have no direct internet.** They read documentation through a harness doc fetcher that returns cleaned, labeled text. Only the research stage browses, and it can't change anything.
4. **Dependencies are installed by the kernel, not by workers,** with install scripts blocked unless the developer approves a package.
5. **Secrets only enter processes that need them** (the verifier and dev server for a named task), never a worker's environment.
6. **Text can't grant power.** Anything an agent reads is data. Permissions come only from the kernel's policy and the task's brief.

## Threat model

| Asset | Example | Main threats |
|---|---|---|
| Developer's files outside the project | `.ssh`, browser cookies, `.aws`, other repos, documents | Read and exfiltrate; delete |
| Credentials | Vault entries, provider tokens, plan logins | Leak via prompt, log, Git, network |
| The developer's checkout and Git history | `main`, uncommitted work | Overwrite, force-push, reset |
| Harness state | `state.db`, briefs, held-back tests | Tamper to fake acceptance; read hidden expectations |
| Other attempts | Parallel worktrees, test databases | Read or corrupt another attempt's data |
| The developer's accounts | GitHub, hosting, payment provider | Unapproved pushes, deploys, charges |
| The developer's plan allowance and money | ChatGPT plan, API credit | Runaway loops |

| Attacker or failure | Path |
|---|---|
| Confused model | Hallucinated `Remove-Item -Recurse`, wrong path, edits outside scope |
| Prompt injection | Instructions hidden in repo files, issues, package READMEs, web pages, test output, dependency error messages |
| Malicious dependency | Install script, compromised package version, typosquatting |
| Malicious skill or catalog pack | Community skill with hidden instructions or scripts ([meta-lab](meta-lab.md#community-and-custom-skills)) |
| Test gaming | Editing tests, special-casing inputs ([completeness gate](completeness-gate.md)) |

## One execution path

Every process started on behalf of an attempt, whether by our worker loop, a vendor's native tool, a vendor's subagent, hook or MCP server, runs inside the attempt's sandbox. A vendor's `Read` tool, its subagents and its web tools are only safe if the OS enforces the limits, because their own rules are advisory: Claude Code, for example, documents that its sandbox doesn't run on native Windows, and that its file and web tools follow permission rules rather than the sandbox.

### `harness.run`

| Property | Behavior |
|---|---|
| Process lifetime | Each call gets its own nested Job Object. When the command's main process exits, the job closes and every leftover child (a hung dev server, a watcher) is killed. Long-running servers are started with `harness.start_service`, which ties them to the attempt's environment ([test environments](test-environments.md)). |
| Output | Progress streamed while running; the result returns the first 100 and last 200 lines, a structured summary for known tools (test runners, compilers) and an artifact ID. Truncation is always stated (“3,412 lines omitted; use `harness.read_log`”), never silent. |
| Limits | Wall time per command, memory and process count per job |

## Foreign agents: native tools or ours

Frontier agents are trained on their own tool names and output formats; replacing their shell with an MCP tool can lower quality. So the default is to keep their native tools and move the boundary outside them.

| Mode | What runs where | Native tools | Used when |
|---|---|---|---|
| **W · Wrapped** (default) | The entire vendor process tree runs in the sandbox (Tier A, B or D). Network: only the vendor's provider domains (through the allowlisting proxy) and loopback to the harness MCP server. | Kept: shell, read, grep, edit, subagents. All of them inherit OS file and network limits because they are the same process tree. Web tools are denied by the vendor's permission rules so turns aren't wasted. | A strong tier is available and the vendor's login can be supplied (below) |
| **S · Stripped** | Vendor process outside the sandbox; only its commands inside | Shell disabled; `harness.run` over MCP. Built-in file reads restricted by the vendor's permission rules (deny the user profile, the harness data folder); built-in and custom subagents disabled; vendor hooks and extra MCP servers disabled; web tools denied | Only Tier C is available, or the vendor can't run wrapped |

**Logins in wrapped mode.** The harness never copies or reads a vendor's credential files ([provider connections](provider-connections.md)). It uses, per vendor:

1. **A token supplied by the client** where the vendor allows it: an access token for the Codex app-server, a GitHub token for the Copilot SDK, an API key for the Cursor SDK, a Claude Console **API key** for Claude Code. The kernel injects it from the vault into the wrapped process's environment. The network allowlist means it can only be sent to that provider. Claude **subscription** tokens (including `claude setup-token` tokens) are never stored or injected: Anthropic's terms forbid third-party developers to collect, store or intermediate them.
2. **The vendor's own login folder, read in place,** for vendors that only support file-based login (e.g. Gemini CLI). Tier A runs as the developer's own identity, so exactly that folder is added to the read allowlist. Tier B (separate sandbox user) can't read it without changing permissions on the developer's files, so it uses option 1 or mode S.

**Per vendor (default, confirmed by the conformance suite per version and tier)**

| Runtime | Default |
|---|---|
| Our worker loop | Our tools only, commands through `harness.run` |
| Codex | Codex's own Windows sandbox (MXC or elevated, OS-enforced) configured by the harness policy; equivalent to wrapped for commands |
| Claude Code | Wrapped with a Claude Console API key in Tier A, B or D; stripped otherwise |
| Copilot SDK, Cursor SDK | Wrapped with a supplied token |
| Gemini CLI | Wrapped in Tier A (login folder read in place); otherwise stripped, with ACP terminal and file requests served by the kernel |
| OpenCode (external) | Wrapped |

**Read sets aren't bypassed by native reads.** Repository files are pinned by the attempt's base commit. Knowledge reaches a worker only through its packet and `kb.*` tools. The generated `.harness/views` files live in the developer's project folder, not in attempt worktrees, so a native `Read` can't pick up stale exported knowledge.

**Capacity.** A wrapped agent keeps its process tree, and its sandbox, alive for the whole session, even while it only waits on the model. Wrapped agents therefore have their own small cap, below the width of our own loop, and commands from everyone else share a warm pool of execution sandboxes ([execution capacity](execution-capacity.md)).

**Quality check.** The meta-lab compares each vendor in both modes on the same tasks; a vendor whose stripped mode loses quality is restricted to machines where wrapping works.

The [adapter conformance suite](agent-runtime-adapters.md#adapter-conformance-suite) includes, per mode: reading `~/.ssh` through every native tool and subagent must fail; a web request to a non-provider domain must fail; a background process left by a command must be gone when the command (stripped mode) or attempt (wrapped mode) ends.

## The Windows sandbox, in tiers

The harness probes the machine at setup and picks the strongest available tier. Settings shows which tier is active and what it does and doesn't protect.

| Tier | Mechanism | Needs admin? | File writes | Secret reads | Network |
|---|---|---|---|---|---|
| **A · MXC** | Microsoft Execution Containers (Windows 11 24H2/25H2 builds that include it), the same mechanism Codex prefers | No | Enforced | Enforced | Enforced; loopback allowed |
| **B · Sandbox users** | One-time setup creates two low-privilege local users (offline, online), ACLs on the worktree root, firewall rules blocking the offline user except a loopback proxy port, restricted tokens | Yes, once | Enforced | Enforced | Enforced |
| **C · Restricted token** | Write-restricted token with a synthetic SID; ACLs grant that SID write only to the worktree | No | Enforced | **Not enforced** for paths the user can read | **Advisory only** (proxy environment variables) |
| **D · Container / WSL2** (optional) | Dev container or WSL2 distro per project | Docker/WSL2 installed | Enforced | Enforced | Enforced; also gives Linux parity with CI |

Policy by tier:

- Tier C is allowed only for tasks that don't need network and don't run third-party code beyond the locked dependencies; the cockpit shows a yellow “weaker sandbox” badge. Dependency installs and dev servers with untrusted packages require Tier A, B or D.
- **Foreign agents on a Tier C-only machine** run only in stripped mode (their own process talks to its provider; their commands run under Tier C with the restrictions above), and only for tasks that meet the Tier C rule. Their native file tools are limited by the vendor's permission rules alone, so the brief's write scope and the static audit are the backstop. Tasks that don't qualify go to our own loop or wait; the roster shows which agents are restricted on this machine.
- If no acceptable tier exists for a task, the task is held with an explanation, never run unsandboxed silently. The developer can explicitly allow “run unsandboxed for this project” in Settings with a red warning.
- Codex's Windows sandbox is open source; reusing its implementation is evaluated before writing our own (license and maintenance check in the [roadmap](roadmap.md) spike).

**Common rules in every tier**

| Rule | Detail |
|---|---|
| Writable | The attempt worktree, its temp folder and its build output folder |
| Read-only | Toolchains, shared package store, the worktree's Git objects |
| Denied (read) | User profile secrets (`.ssh`, `.aws`, `.azure`, `.gnupg`, `.npmrc` tokens, browser profiles, `%APPDATA%` credential stores), the harness data folder, other worktrees, the developer's checkout |
| Denied (write) | `.git` internals: only the kernel commits |
| Environment | Scrubbed: no tokens, no `GH_TOKEN`, no provider keys; `HOME` and temp point inside the attempt |
| Processes | Job Object per attempt: CPU, memory and process-count limits; whole tree killed on stop |
| Time | Wall-clock limit per command and per attempt |
| Desktop | Separate window station/desktop where supported, so a sandboxed process can't send input to the developer's windows |

## Network policy

| Who | Direct internet | Through the harness |
|---|---|---|
| Coding workers and their commands | None | `harness.fetch_docs` (documentation only), `harness.read_package_source` (from the local store) |
| Tests, verifier, dev servers | None, loopback only | Declared external test endpoints for a named task (e.g. a payment provider's test API) via an allowlisting proxy |
| Dependency installer (kernel) | Registry only, via proxy | — |
| Researcher agents | None directly | Doc fetcher with search and a broader allowlist; read-only, no side effects |
| Vendor agent process (not its commands) | Its provider's API only | — |

**The doc fetcher.** Fetches a URL or `package@version` docs from allowlisted documentation domains (official docs, package registries, GitHub READMEs at a pinned commit). It strips scripts, hidden text and invisible Unicode, converts to plain Markdown, caps the size, caches by URL and content hash, and returns it wrapped as untrusted quoted material with its source and date. The best source for an installed library is its local type definitions and source in the package store, so workers are pointed there first.

**Why coding workers get no browsing:** a single injected instruction in a forum answer can steer a worker that has write access. Research is done earlier by agents with no write access, and its results enter the knowledge base only as validated, cited facts ([build pipeline](build-pipeline.md#stage-a--research)).

## Dependencies and supply chain

1. Workers never run installs. They request a dependency through an intent; the integrator approves it ([parallel integration](parallel-feature-integration.md)).
2. The kernel installs with pnpm, whose version 10 and later blocks dependency install scripts by default. Packages that genuinely need a build step (e.g. a native module) are approved once by the developer and pinned by version.
3. New packages are checked before install: age of the version (very new versions wait a configurable period), known-vulnerability lookup, typosquat similarity to popular names, license.
4. The lockfile is integrity-checked; installs use the lockfile only.
5. For npm or Yarn projects, installs run with scripts disabled and approved scripts are run explicitly afterwards.

## Prompt-injection defenses

| Layer | Defense |
|---|---|
| Capabilities | Tools, paths, network and budgets come from the brief and kernel policy. No text can add them. |
| Provenance labels | Every item in a model's context is labeled: *instruction* (kernel and brief), *user* (the developer's words), *untrusted data* (files, web, tool output, other agents' notes). Prompts state that only instructions direct actions. |
| Separation of reading and acting | Researchers read the web but can't act; workers act but don't browse. Planners consume validated facts, not raw pages (the “plan-then-execute” and “dual LLM” patterns). |
| Structured outputs | Every model output is a schema-checked action; unknown or extra actions are rejected. |
| Output checks | Diffs are scope-checked; commands are allowlisted; risky actions need approval. |
| Escape hatch | Workers have `harness.flag_blocked(reason)` to stop and report a suspicious instruction or a contradictory task instead of complying. |
| Canaries | The meta-lab red-team suite plants injected instructions and fake secrets in fixtures and checks that nothing follows or leaks them ([meta-lab](meta-lab.md#red-team-suite)). |

## Data at rest

- The harness data folder inherits the user profile's permissions; the installer checks it isn't readable by other users.
- Secrets live only in Windows Credential Manager (DPAPI). Sandbox users can't read the developer's DPAPI store.
- Transcripts and audio: transcripts are stored locally; raw audio is not kept unless the developer turns it on. A per-project “forget transcripts older than N days” setting removes raw turns while keeping the extracted decisions and their quotes.
- The redactor runs on logs, traces, diagnostics, exports and outgoing prompts.
- Full-disk encryption (BitLocker) is recommended in the setup checklist; the harness doesn't add its own database encryption in v1.
- `secure_delete` is on for project databases, and a **secret purge** redacts an accidentally stored secret across history, search indexes, the WAL, blobs and backups, then asks for key rotation ([database design §10](database-design.md#10--code-index-secret-purge-and-query-bounds)).

## Edge cases

| Situation | Behavior |
|---|---|
| A test legitimately needs the internet (e.g. an OAuth sandbox) | The task's brief declares the domain; the proxy allows exactly that host for that attempt; logged. |
| The project lives in a folder the sandbox can't ACL (network drive) | Tier A or D only; otherwise ask to move the project. |
| A worker needs a tool not on PATH inside the sandbox | Becomes a human step or an approved toolchain install. |
| Dev server needs to bind a port | Loopback only, port allocated per attempt. |
| The developer explicitly disables the sandbox | Red banner on every task card; recorded in every receipt. |

[Diagram](sandbox-and-security.svg) · [Editable Mermaid](sandbox-and-security.mmd) · [Desktop app](desktop-app.md) · [Agent runtime adapters](agent-runtime-adapters.md) · [Build cockpit](build-cockpit.md#secrets) · [Completeness gate](completeness-gate.md) · [Research](research/windows-sandboxing.md)
