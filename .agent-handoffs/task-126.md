---
task_id: "Task-126"
branch: "task/126-worker-inspector-panel"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/cockpit/inspector/**"
  - "apps/renderer/tests/cockpit-inspector/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 126 handoff

Worker Inspector for the right-hand shell: structured timeline, lazy 64 KB diff, checks and receipts, pinned brief, and an opt-in raw stream. Commit stays on `task/126-worker-inspector-panel`.

## Exports Provided

Import from `apps/renderer/src/cockpit/inspector/index.ts` until the renderer barrel is wired:

- `WorkerInspectorPanel` — `show(selection)`, `setTab`, `selectAttempt`, `view`, header actions (`pause`, `explain`, `fixedItMyself`), `loadDiff(filePath, hunkOffset?)`, `setDiffLayout`, `openScreenshot`, `closeLightbox`, `disputeTest`, `followRequirement`, `followHandoff`, `followFile`, `toggleRawStream`, `scrollRawStream`, `jumpToLive`, `noteLiveGrowth`, `copyVisibleLog`, `residentBytes`. Default tab is Timeline. Raw bytes stay closed until `toggleRawStream(true)`.
- `InspectorSelectionProps` — `{ taskId, host: "collapsible-shell" | "popout", attemptId? }`. `host: "popout"` is the Task 123 window; `collapsible-shell` is the Task 122 drawer.
- `INSPECTOR_SHELL_SLOT` — `{ shell: "CollapsibleInspectorShell", minPx: 340, maxPx: 480, collapsible: true, popoutCompatible: true }`.
- `StructuredAttemptTimeline` — grouped attempt headings (`Attempt 1 · Hint 1`, `Attempt 3 · PASS`) and human milestone chains. Command JSON is rewritten to `Structured result (hidden raw JSON)` after the redaction check.
- `LazyRangeDiffViewer` — file tree with `+added / -deleted`. Files with `byteSize > 100 KB` render `Large file (3.1 MB) — Load preview chunk (64 KB)` and do not fetch until `loadFile` / `loadDiff`. Each fetch calls `fetchDiffRange(attemptId, filePath, hunkOffset, 65536, signal)`.
- `ChecksAndReceiptsTab` — layers `STATIC_AUDIT`, `typecheck`, `lint`, `unit`, `playwright`, `reviewer@1`, `taste-reviewer@1`, `hidden`. Playwright rows expose `View screenshot`. Hidden rows expose `DisputeTest`. Sealed source is left out of the tree while `hideSealedSource` is set and the latest attempt is not `pass`.
- `PinnedBriefReadSetViewer` — historical `sliceSha256`, `nodeVersions`, MUST/SHOULD/COULD token counts, `X-01`–`X-14`, at most 2 skills, write scope, `kb.*` pulls, and `harness.read_result` handoff reads. A newer graph version is a badge (`R-5 updated later`); the text stays the pinned version.
- `OptInRawStreamTab` — toggle label `Show raw log stream`. At most 500 lines. Tail follow pauses on scroll-up and shows `Jump to live`. Growth while pinned coalesces to one extra tail fetch.
- `ResidentLedger` — refuses a retain that would pass 25 MB (`MAX_RENDERER_HEAP_BYTES`).

`explain()` returns two sentences from the last 50 structured milestone summaries and passes that list to the shell. It does not call a model.

## Shared Wiring Needs (Root / Index Barrels)

`apps/renderer/src/index.ts` is outside this task's owned subtree. After integration, re-export:

```ts
export {
  ChecksAndReceiptsTab,
  INSPECTOR_SHELL_SLOT,
  LazyRangeDiffViewer,
  OptInRawStreamTab,
  PinnedBriefReadSetViewer,
  StructuredAttemptTimeline,
  WorkerInspectorPanel,
} from "./cockpit/inspector/index.js";
export type { InspectorDependencies, InspectorSelectionProps } from "./cockpit/inspector/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, `eslint.config.mjs`, or `packages/*/src/index.ts` edit.

Mount `WorkerInspectorPanel` in Task 122 `CollapsibleInspectorShell` (340–480 px) and in a Task 123 pop-out when `selection.host` is `"popout"`. Task 124 card clicks, Task 163 worker sprites, and Task 153 canvas nodes should call `show({ taskId, host })`. Task 173 should call `fixedItMyself()`. `followFile` asks the shell to run `code -g <path>:<line>`. `followRequirement` and `followHandoff` ask the shell to open that canvas node.

## Dependency Intents (New Packages Requested)

None. The frozen renderer manifest has Vitest and no React. The inspector is a host-agnostic element tree (`view()`), and the tests query that tree. Do not add React or Testing Library for this task.

## Contract Change Requests

Sibling branches are not in this base. These local ports are the swap:

- `SeekableZstdLogReader.locateLineWindow(artifactId, startLine, maxLines, maxBytes, signal)` returns a window whose `byteLength` is at most `maxBytes` (the panel passes 65536 and 500 lines) plus `totalBytes`, `totalLines`, `archived`, and `framesDecompressed`. Bind it to Task 029 `SeekableLogReader.readRange` / `ArtifactManager.readLogRange`. The landed class name there is `SeekableLogReader`, not `SeekableZstdLogReader`.
- `BinaryStreamClient.fetchDiffRange(attemptId, filePath, hunkOffset, limit, signal)` matches the spec signature plus `AbortSignal`. Bind it to Task 033 `RangeDiffHandler.diffGet` hunk bodies, capped at 64 KB. `fetchLogChunk` and `fetchScreenshot` are the same credit path for `turn_log` bytes and CAS PNG thumbnails (`ArtifactStreamClient`, initial credit 8). The panel discards a chunk whose `attemptId` or `filePath` does not match the open worker.
- `KnowledgePacketSlicerManifestPort.pinnedManifest(sliceSha256)` must return that hash's `nodeVersions` and historical requirement text. Bind it to Task 088 `KnowledgePacketSlicer.reconstruct` / the brief manifest row. `previewManifest(taskId)` is the queued upcoming brief only. A hash mismatch throws `PinnedBriefMismatchError` and the mismatched text is not shown.
- `ArtifactHandoffStore.readsForAttempt` lists `harness.read_result` rows. `lineage(handoffId)` is Task 109 `HandoffAuditTrail.lineage`.
- `InspectorTaskCatalog.load(taskId)` is the board/office/canvas snapshot (identity, attempts, milestone summaries, diff file sizes, check receipts). It must not inline hunk bodies, log bytes, or screenshot bytes.
- `InspectorShellPort` is the Task 122/123 action sink: pause, explain, fixed-it-myself, canvas node, editor command, dispute, copy.
- Redaction stays on the daemon (Task 011 `PacketSecurityRedactor`). `assertPreRedacted` refuses diff text, command output, and raw lines that still contain a raw credential, and those bytes are not retained. Placeholders such as `[REDACTED:API_KEY]` are shown.

No schema or shared-contract edit.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-126-worker-inspector-panel`:

- `pnpm --filter @ef-harness/renderer typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/renderer lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/renderer test -- cockpit-inspector` — pass, 2 files, 15 tests. Covers all 5 tabs, attempt switcher (`Attempt 1 (Failed — Hint 1)` through `Attempt 3 (PASS)`), queued brief plus `Waiting on T-2, T-3` and `Estimated Mid · $0.11`, Phase 0 `Waiting on Phase 0 Gate 0` with zero alert nodes, historical `sha-historical` / `cutoff 10:45 Europe/Berlin` / `R-5 updated later` / `kb.get_fact` / `harness.read_result`, skill cap 2, `code -g src/kitchen/print.tsx:14`, sealed source absent plus `DisputeTest` and a PNG lightbox, diff redaction refusal, `Large file (3.1 MB) — Load preview chunk (64 KB)` with one 65536-byte fetch, 50 MB `totalBytes` log paging under 25 MB retained and at most 500 lines, 1,000-line growth coalesced to at most 2 fetches, scroll-up pause with `Jump to live`, 10-card switch (9 aborted signals, only worker W9 left on screen), and a stale diff marker dropped on worker switch.
- `node scripts/verify-harmony.mjs --task 126` — pass, exit 0, `harmony ok for Task-126` (includes workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

- Task 029, Task 033, Task 088, Task 109, Task 122, and Task 124 are not merged into this base. The ports above are the integration swap.
- The 25 MB ceiling is the retained-chunk ledger (`ResidentLedger`), not a sample of `process.memoryUsage()`. The 50 MB case reports `totalBytes` and returns one 64 KB window; the inspector never asks for the rest.
- `explain` does not call a model. The shell receives the last 50 calm milestone lines.
- `code -g` is a command string. This package does not spawn VS Code.
- Screenshot zoom keeps the first 64 KB thumbnail and says so when the artifact is larger.
- Raw opt-in resets when the attempt's log artifact id changes.
- Vitest here is `environment: "node"` (`vitest.config.ts` is frozen). Tests walk the element tree instead of React Testing Library.
