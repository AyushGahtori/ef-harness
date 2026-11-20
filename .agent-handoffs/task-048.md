---
task_id: "Task-048"
branch: "task/048-attempt-mcp-server"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/mcp-server/src/**"
  - "packages/mcp-server/tests/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 048 handoff

Per-attempt leased MCP server. One `AttemptMcpServer` is bound to `(projectId, taskId, attemptId, leaseEpoch, bearerToken)` and speaks stdio or loopback HTTP (streamable HTTP at `/mcp` and legacy SSE at `/sse` + `/messages`). Every tool call checks the injected epoch authority before it runs. Only names listed in `task-packet@1.tools` are registered (`kb.*` and `harness.*` expand). `kb.*` pulls are written to `read_sets` (`how = 'pulled'`), `edge_read_sets`, and `search_reads` before the response is returned, including zero-hit searches. Held-back nodes and `checks-sealed` artifacts are removed before snippet generation and serialize as `NotFound`, the same text as a missing id. `kb.get` and `kb.contract` return the brief's pinned version unless `latest: true`. `harness.submit_candidate` validates `candidate@1`, reads `git diff --name-only` plus untracked files, and rejects any path outside `write_scope`. Returned `kb.*`, `harness.read_result`, `harness.fetch_docs`, and `harness.read_log` bodies are wrapped in `<data source="..." trust="untrusted|kb">`.

## Exports Provided

- `AttemptMcpServer` — `connect`, `startStdio`, `listenLoopback`, `stop`, `callTool`, `registeredToolNames`
- `AttemptMcpDependencies` — injected ports, including `startService`, `askOwner`, `disputeTest`, and `codeLookup`
- `MCP_TOOL_NAMES` — the 12 `harness.*` tools and the 6 `kb.*` tools, in stable order

Also exported for callers and tests: `HARNESS_TOOL_NAMES`, `KB_TOOL_NAMES`, `resolveVisibleTools`, `LeaseFencedError`, `MCP_ERROR_LEASE_FENCED`, `PULL_QUOTA_MESSAGE`, `CandidateV1Schema` (local `candidate@1` stand-in), `SqliteReadSetStore`, `MemoryReadSetStore`, `openReadSetDatabase`, `readGitChangedPaths`, `snapshotWorktreeDiff`, and the dependency interfaces (`KnowledgeSearchService`, `TaskHoldAndSubmissionRepo`, `SecureDocFetcher`, `HarnessRunEngine`, `ArtifactManager`, `EpochAuthority`, and the four injected ports above).

## Shared Wiring Needs (Root / Index Barrels)

None. Downstream tasks import `@ef-harness/mcp-server`. No edit to `packages/shared-contracts/src/index.ts` is required for this task.

## Dependency Intents (New Packages Requested)

`packages/mcp-server/package.json` is foundation-frozen, so these are not added there. Both packages are already installed at the workspace root and resolve from this package today:

- `@modelcontextprotocol/sdk` `^1.32.2` — runtime dependency of `@ef-harness/mcp-server` (client and server transports, tool protocol)
- `zod` `^3.25.0` — runtime dependency of `@ef-harness/mcp-server` (tool argument and `candidate@1` validation)

Please add both to `packages/mcp-server/package.json` `dependencies` when the integrator is allowed to edit that manifest.

## Contract Change Requests

- When Task 008 exports `CandidateV1Schema` from `@ef-harness/shared-contracts`, replace the local schema in `packages/mcp-server/src/candidate.ts` with that export. The local schema matches `candidate@1` from the build pipeline, and `changed_paths` is accepted then ignored.
- When Tasks 018, 021, 029, 045, 047, 049, and 167 land, construct `AttemptMcpDependencies` with `KnowledgeSearchService`, `TaskHoldAndSubmissionRepo.submitAndAcceptCandidate`, `ArtifactManager`, `SecureDocFetcher`, `HarnessRunEngine`, `StartService`, and `CodeLookup`. No `state.sql` change: pulls write the existing `read_sets`, `search_reads`, and `edge_read_sets` tables.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-048-attempt-mcp-server`:

- `pnpm --filter @ef-harness/mcp-server typecheck` — passed
- `pnpm --filter @ef-harness/mcp-server lint` — passed
- `pnpm --filter @ef-harness/mcp-server test` — passed, 2 files, 17 tests. A real `@modelcontextprotocol/sdk` client drives all 12 `harness.*` tools and all 6 `kb.*` tools over in-memory transport, plus streamable HTTP, legacy SSE, and stdio. Covered held-back redaction (no snippet of sealed text, identical `NotFound`), sqlite rows for `read_sets` / `edge_read_sets` / `search_reads` including a zero-hit search, the 50-search cap and its pull-pattern log, token cap, fenced epoch (`MCP_ERROR_LEASE_FENCED`), cross-attempt bearer `401`, forged `changed_paths` ignored, out-of-scope `git diff` rejected, git snapshot commit, and display-only `harness.report_progress`.
- `node scripts/verify-harmony.mjs --task 048` — passed (`harmony ok for Task-048`), including workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- The SDK and Zod are phantom dependencies until the package manifest can list them. Typecheck and tests pass because Node resolves them from the workspace root `node_modules`.
- `openReadSetDatabase` creates the three read-set tables without the `attempts` foreign key so unit tests do not need a full `state.db`. Production should pass the project database, which already has those tables and the attempt row.
- Shutdown after accept, pause, or fencing waits about 30 ms so the in-flight JSON-RPC response can flush, then closes the transport and the loopback socket.
- `harness.report_progress` only calls the injected telemetry sink. It does not touch holds, budgets, or task state.
