# Our own worker loop

The first live agent in the [roadmap](roadmap.md) (milestone M1) is our own worker loop. It is also the preferred runtime for API keys, OpenRouter, Sign in with ChatGPT and local models. Foreign agents (Codex, Claude Code, Copilot, Cursor, Gemini CLI) are described in [agent runtime adapters](agent-runtime-adapters.md); this document designs the loop we own. Research: [worker loop and edits](research/worker-loop-and-edits.md).

## Decisions in plain words

1. **A lean native TypeScript loop inside the daemon, not embedded OpenCode.** OpenCode brings its own session database, permission system, compaction and subagents. Embedded, those would be a second source of truth competing with the kernel's checkpoints, sandbox and audit. OpenCode remains available as an optional external runtime over ACP, configured like any foreign agent.
2. **Every tool step is checkpointed.** The full conversation is rebuilt from our own turn log, never from provider-side state, so a crash, stall or rate limit resumes at the last completed step.
3. **The context has pinned zones that compaction can never touch:** kernel rules and the task's MUST band at the start, a checklist repeating them at the end.
4. **Tool output is shrunk before it enters the conversation.** A 4,000-line test log becomes a 20-line summary plus an artifact ID the worker can query.
5. **Edits use the format each model family was trained on,** applied by a tolerant but never-guessing applier, with a fixed recovery ladder after failed edits.
6. **No subagents in v1.** Parallelism comes from the scheduler, not from workers spawning helpers.

## Components

```
task packet ─▶ Context builder ─▶ Provider adapter ─▶ model
                    ▲                    │ streamed items
                    │                    ▼
              Turn log (SQLite) ◀── Step executor ──▶ Tools: read · grep · edit · harness.run · kb.* · notes · ask_owner · flag_blocked · submit
                    │                    │
                    └── checkpoint refs (Git) ◀─┘
```

| Component | Responsibility |
|---|---|
| Provider adapter | One per protocol family: OpenAI Responses (API key and Sign in with ChatGPT), Anthropic Messages, OpenAI-compatible Chat (OpenRouter, Ollama, LM Studio), Gemini API. Declares the model profile (below) |
| Context builder | Assembles the request from pinned zones, working memory and recent history within the model's budget |
| Step executor | Runs tool calls one at a time in order, through the sandbox, recording intent and result |
| Turn log | Append-only rows per step: request digest, returned items (including opaque reasoning items), tool call, result summary, artifact IDs, worktree checkpoint |
| Guards | Turn limits, repetition and no-progress detection, budget, stall timeouts |

### Model profile

Each roster entry declares: context window; output limit; edit format; whether it supports parallel tool calls, reasoning replay and streaming tool arguments; tool-call reliability tier (measured in the [meta-lab](meta-lab.md)); and route constraints. Sign in with ChatGPT, for example: Responses API only, `store: false`, no `previous_response_id`, no `max_output_tokens`, no `temperature`, function tools only.

## The context, zone by zone

```
┌ 1 Kernel rules + role ............ pinned, stable prefix (cache-friendly)
├ 2 MUST band of the task packet .... pinned, never compacted
├ 3 SHOULD band .................... trimmed first when space is short
├ 4 Working memory ................. structured notes kept by the worker (notes.update)
├ 5 History ........................ recent steps verbatim, older steps as one-line summaries
└ 6 Tail checklist ................. pinned: MUST rule IDs, checks, write scope, current step
```

**Working memory** is a small structured document the worker maintains with `notes.update`: plan steps, done items keyed to MUST IDs, open problems, facts learned (“`toPrintRows` returns rows sorted by label”). It survives compaction verbatim, so progress isn't lost when old turns are summarized.

### Shrinking tool output before it enters history

| Tool result | What the model sees | Full content |
|---|---|---|
| Test run | Pass/fail counts; each failing test with its first assertion message and stack trimmed to project frames; repeated lines counted | Artifact, queryable with `harness.read_log(id, query or range)` |
| Build or type errors | Deduplicated errors grouped by file, first 30 | Artifact |
| File read | Requested range, maximum ~400 lines; outline (symbols with line numbers) for larger files | The file itself |
| Grep | First 50 matches with file and line | Rerun with a narrower pattern |
| `kb.*` | Node text with ID and version | — |

### Compaction

Triggered when the request would exceed about 70% of the model's window, applied in order until it fits:

1. **Drop superseded reads.** A file read that was later re-read or edited becomes `[read of src/x.ts @ step 5, superseded]`.
2. **Collapse old tool results** to their one-line summaries (kept in the turn log).
3. **Summarize old turns** beyond the last K steps (K depends on the window) into a short progress note, written by `turn-summarizer@1` or taken from working memory if it is current.
4. If zones 1, 2 and 6 alone don't fit, the task is too big for this model: park and return it to the planner to split. MUST content is never cut.

**Small local models (16–32k):** planners size Junior tasks to fit ([knowledge slicing](knowledge-slicing.md#the-packet)); the loop uses tighter caps (200-line reads, 10 test failures, K = 4) and windowed file views instead of whole files.

## Checkpoints and recovery

Each step writes, in one coordinator transaction: the step's turn-log row and, if files changed, a checkpoint commit `refs/harness/checkpoints/<attempt>/<step>` (made with a temporary Git index, so the worktree is untouched).

| Crash point | Recovery |
|---|---|
| During a model call | Nothing executed; rebuild the same request from the turn log and call again |
| After the response, before tool execution | Execute the recorded tool call |
| During a tool call | Reset the worktree to the last checkpoint; rerun the call (all tool effects are confined to the worktree and attempt resources) |
| After the tool, before the log write | Same as above; the step is redone |

**Stateless providers.** With `store: false` (and always with Sign in with ChatGPT), every request carries the full conversation. The turn log keeps returned reasoning items exactly as received (requested with `include: ["reasoning.encrypted_content"]` where the route supports it) and replays them in order, so reasoning continuity survives restarts. Whether the ChatGPT plan route returns encrypted reasoning is verified by a probe; if not, the loop works without it.

**Output limits without `max_output_tokens`.** The loop streams and stops reading once a response exceeds its budget, then asks for a shorter continuation. The allowance ledger charges what was actually produced.

## Tools

| Tool | Notes |
|---|---|
| `read_file(path, range?)`, `list(glob)`, `grep(pattern, glob?)` | Read-only; whole repository readable, secrets excluded by the sandbox |
| Edit tool (per model family, below) | Write scope enforced at apply time |
| `write_new_file(path, content)` | Only for files that don't exist |
| `replace_lines(path, start, end, text, range_hash)` | Recovery edit (below) |
| `harness.run(command)`, `harness.read_log(id, …)` | Sandboxed commands ([sandbox](sandbox-and-security.md#one-execution-path)) |
| `harness.start_service(name)` | Long-running servers for the attempt ([test environments](test-environments.md#starting-servers-from-a-task)) |
| `kb.*` | Knowledge queries, recorded in the read set |
| `notes.update(patch)` | Working memory |
| `harness.ask_owner`, `harness.flag_blocked`, `harness.dispute_test`, `harness.submit_candidate` | Kernel interactions |

## Edits

| Model family | Edit tool | Why |
|---|---|---|
| OpenAI GPT-5 and Codex models | `apply_patch` in OpenAI's patch envelope | The models were trained on this exact format |
| Anthropic Claude | Exact string replace (`str_replace` style: path, old text, new text) | Matches the trained text-editor tool |
| Others and local models | Search/replace blocks | Efficient, widely supported |
| Any model, new file | `write_new_file` | — |
| Whole-file rewrite of an existing file | **Not offered** | Main source of silent truncation and stale overwrites |

**The applier** matches in tiers and never guesses:

1. Exact match.
2. Line endings normalized.
3. Trailing whitespace ignored.
4. Indentation ignored (the replacement is re-indented to the matched block).
5. Stop. If more than one location matches at any tier, the edit is rejected as ambiguous.

The formatter runs at submit time, not after each edit, so later search text still matches what the model saw.

**Recovery ladder for failed edits (per file):**

| Failure | Response |
|---|---|
| 1st | Precise error plus the nearest candidate region with line numbers: “Your search text wasn't found. Closest match at lines 40–52: …” |
| 2nd | A fresh view of that region is returned automatically, with a hint to use a smaller hunk |
| 3rd | `replace_lines` is enabled for that file: replace lines *a–b* given the hash of their current text (the hash prevents editing a region that changed) |
| 4th | Counted as stuck: checkpoint, then the kernel's loop fingerprint escalates (hint, stronger level or author) |

## Guards against spirals

| Guard | Default (Junior / Senior) |
|---|---|
| Maximum steps per attempt | 40 / 80 |
| Same tool, same arguments, same result | 3 times → stuck |
| No progress | No change in worktree hash and the same failing checks for 8 steps → stuck |
| Stream stall | No tokens for 60 s → abort and retry the same request once; then park |
| Rate limit | Wait per provider policy; the attempt isn't failed, and pacing is informed ([provider connections](provider-connections.md#budgeting-with-allowance-instead-of-dollars)) |
| Malformed tool call | One repair message with the validator error; then stuck |
| Budget | Reservation per attempt; exceeding it parks the attempt |

## OpenCode as an external runtime

For developers who prefer it, OpenCode runs as a foreign agent: launched over ACP, configured with ordered permission rules that deny its shell and web tools, its compaction set explicitly, and the harness MCP server attached. It is then subject to the same rules as other foreign agents ([sandbox and security](sandbox-and-security.md#foreign-agents-native-tools-or-ours)).

## Edge cases

| Situation | Behavior |
|---|---|
| The model calls a tool that doesn't exist | Error listing available tools; counts toward malformed calls. |
| The model writes code in its reply instead of calling the edit tool | Reminder once; repeated → stuck. |
| The model says it's done without calling submit | Asked to submit or state what's missing. |
| The provider changes the tool-call format | Adapter conformance tests fail; the roster entry is disabled until fixed. |
| A worktree file changed outside the loop (developer edit) | Detected by hash before applying an edit; the region is re-read. |

[Agent runtime adapters](agent-runtime-adapters.md) · [Knowledge slicing](knowledge-slicing.md) · [Completeness gate](completeness-gate.md) · [Research](research/worker-loop-and-edits.md)
