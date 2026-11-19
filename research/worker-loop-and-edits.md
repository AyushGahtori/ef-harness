# Research: building our own worker loop and its edit mechanics

Question: should the harness embed OpenCode or write its own loop, how do coding agents edit files reliably, and how does a stateless loop keep reasoning across tool turns? Design: [worker loop](../worker-loop.md).

## OpenCode as a candidate

- OpenCode can be hosted in-process through its SDK (no HTTP listener). [OpenCode SDK](https://opencode.ai/docs/build/sdk)
- Its permissions are ordered allow/deny/ask rules per action (shell, read, subagent…), last match wins; unmatched actions default to *ask*. [OpenCode permissions](https://opencode.ai/docs/permissions/)
- It compacts automatically near the context limit (configurable, lossy by its own description). [OpenCode compaction](https://opencode.ai/docs/compaction)
- SDK users have reported the permission types lagging behind the config format. [Issue #8524](https://github.com/anomalyco/opencode/issues/8524)

**Assessment:** usable as an external runtime, but its session store, permissions and compaction would duplicate the kernel's checkpoints, sandbox policy and pinned-context rules. A native loop keeps one source of truth.

## Edit formats

- Aider found GPT-4 Turbo produced “lazy” elided code with search/replace blocks; a simplified unified diff reduced that roughly 3× on its laziness benchmark. Aider selects the best edit format per model family. [Unified diffs](https://aider.chat/docs/unified-diffs.html) · [Edit formats](https://aider.chat/docs/more/edit-formats.html)
- OpenAI recommends its exact `apply_patch` implementation for GPT-5 Codex models, “as the model has been trained to excel at this diff format”. [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
- Anthropic provides a text-editor tool with exact string replacement that Claude models are trained to use. [Text editor tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/text-editor-tool)
- SWE-agent showed that the agent-computer interface itself (windowed file viewer, concise search results, edit feedback) strongly affects success (Yang et al., 2024, arXiv:2405.15793).

**Consequence:** a per-family edit tool, no whole-file rewrites of existing files, windowed reads, and an applier that reports the nearest match instead of failing silently.

## Stateless multi-turn reasoning

With `store: false`, the Responses API returns reasoning as encrypted items when `include: ["reasoning.encrypted_content"]` is requested. The client replays the full prior output (reasoning items unchanged and in order) with each tool result. [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state?api-mode=responses) · [Responses create](https://developers.openai.com/api/reference/resources/responses/methods/create)

## Long contexts degrade

Performance falls as input grows and facts in the middle are used least ([context slicing research](context-slicing.md)), which motivates pinning rules at the start and end and shrinking tool output before it enters history.

## To measure

- Edit failure rate per model family and format.
- Steps per accepted task with and without tool-output summarization.
- Recovery correctness: crash injection at every step type.
