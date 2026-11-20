---
task_id: "Task-056"
branch: "task/056-worker-loop-edit-applier"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/worker-loop/src/edits/**"
  - "packages/worker-loop/tests/edits/**"
  - ".agent-handoffs/task-056.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 056 handoff

Model-family edit dispatcher, 4-tier non-guessing matcher, CRLF and indent preservation, and the 4-step per-file recovery ladder. Commit stays on `task/056-worker-loop-edit-applier`.

Import path after wiring: `@ef-harness/worker-loop` barrel, plus a package export subpath `@ef-harness/worker-loop/edits`. Until that wiring lands, Task 057 and Task 184 can import `packages/worker-loop/src/edits/index.ts` from this branch only. Do not treat that deep path as a published package export.

## Exports Provided

Runtime values:

- `EditToolDispatcher` — `applyPatch`, `strReplace`, `searchReplace`, `writeNewFile`, `replaceLines`, `availableTools`
- `offeredEditTools(editFormat)` — the trained tool plus `write_new_file`. Never includes a whole-file rewrite tool.
- `FourTierMatcher` — `match` and `matchAnchored`
- `applyMatchedReplacement` — splice used by the dispatcher. Tier 4 reindents. Replacement newlines follow the file's dominant EOL. Untouched bytes stay as they were.
- `snapMatchToWholeLines` — patch hunks expand to whole lines so a deleted line takes its linebreak with it
- `findHeaderAnchorEnds` — `@@` context for `apply_patch`
- `parseOpenAiApplyPatch` — OpenAI `*** Begin Patch` / `*** Update File` / `*** Add File` / `*** Delete File` envelope, including optional `*** Move to:`
- `parseSearchReplaceBlocks` — text form of search/replace blocks, or pass `SearchReplaceBlock[]` straight to `searchReplace`
- `EditRecoveryTracker` — consecutive failures per `(attemptId, filePath)`. `replace_lines` stays enabled for that pair once the third failure lands. A later success clears the consecutive count and does not revoke the unlock.
- `findClosestRegion`
- `atomicWriteFile` / `atomicRemoveFile` — temp file plus rename, with `EPERM` / `EBUSY` retry. The target is never truncated in place.
- `hashFileContent` / `hashLineRange` — lowercase hex SHA-256 of the exact UTF-8 bytes (no `sha256:` prefix)
- `dominantEndOfLine`, `convertEndOfLine`, `numberedView`, `detectElision`, `pathMatchesWriteScope`, `resolveEditPath`
- `MemoryReadObservationCache` — local stand-in a caller fills from file reads

Errors: `AmbiguousEditMatchError` (`matchLineNumbers`), `NearestCandidateError`, `FreshRegionViewError`, `ReplaceLinesUnlockedError`, `EditStuckEscalation`, `FileAlreadyExistsError` (message `Use <editFormat> for existing files`), `ReplaceLinesNotEnabledError`, `StaleRangeHashError` (`currentLines`, `currentRangeHash`), `FileChangedExternallyError` (`numberedView`), `ElisionPlaceholderError`, `WriteScopeDeniedError`, `ProtectedPathError`, `PathEscapeDeniedError`, `EditToolNotOfferedError`, `OverlappingHunkError`, `PatchParseError`, `SearchReplaceParseError`, `EmptySearchTextError`, `BinaryFileEditError`, `FileNotFoundForEditError`, `ReplaceLinesBoundsError`.

`availableTools()` is `[editFormat, "write_new_file"]`. Pass a relative path after that file's third failure and the list also contains `replace_lines` for that file only.

Failure 1 message shape: `Your search text wasn't found. Closest match at lines 40–52: ...` (en dash). Failure 2 returns a `L0040:` numbered view and the hint `Use a smaller hunk.` Failure 3 unlocks `replace_lines` and returns the current `range_hash`. Failure 4 throws `EditStuckEscalation` so the loop can checkpoint and feed the fingerprint ladder.

`range_hash` is the SHA-256 of the raw file slice covering lines `start..end` inclusive, including those lines' original linebreak bytes. `replace_lines` rejects any other hash with `StaleRangeHashError` and the current numbered lines.

Not-found and ambiguous matches increment the ladder. Scope denial, elision, external modification, a stale range hash, and `replace_lines` called before it is enabled do not.

Multi-file and multi-hunk patches are planned against the original file bytes and written only after every path, elision check, hash check, and hunk match succeeds. One bad path leaves zero files changed. Hunks that overlap are rejected the same way.

## Shared Wiring Needs (Root / Index Barrels)

`packages/worker-loop/src/index.ts` is frozen by Task 001. Add:

```ts
export {
  AmbiguousEditMatchError,
  BinaryFileEditError,
  EditApplyError,
  EditRecoveryTracker,
  EditStuckEscalation,
  EditToolDispatcher,
  EditToolNotOfferedError,
  ElisionPlaceholderError,
  EmptySearchTextError,
  FileAlreadyExistsError,
  FileChangedExternallyError,
  FileNotFoundForEditError,
  FourTierMatcher,
  FreshRegionViewError,
  MemoryReadObservationCache,
  NearestCandidateError,
  OverlappingHunkError,
  PatchParseError,
  PathEscapeDeniedError,
  ProtectedPathError,
  ReplaceLinesBoundsError,
  ReplaceLinesNotEnabledError,
  ReplaceLinesUnlockedError,
  SearchReplaceParseError,
  SearchTextNotFoundError,
  SMALLER_HUNK_HINT,
  StaleRangeHashError,
  WriteScopeDeniedError,
  applyMatchedReplacement,
  atomicRemoveFile,
  atomicWriteFile,
  convertEndOfLine,
  detectElision,
  dominantEndOfLine,
  findClosestRegion,
  findHeaderAnchorEnds,
  hashFileContent,
  hashLineRange,
  numberedView,
  offeredEditTools,
  parseOpenAiApplyPatch,
  parseSearchReplaceBlocks,
  pathMatchesWriteScope,
  resolveEditPath,
  snapMatchToWholeLines,
} from "./edits/index.js";
export type {
  AtomicFs,
  AtomicWriteOptions,
  ClosestFailureView,
  ClosestRegion,
  EditApplySuccess,
  EditFormat,
  EditToolDispatcherOptions,
  EditToolName,
  EndOfLine,
  LineSpan,
  MatchTier,
  ModelProfileEditView,
  ParsedAddFile,
  ParsedDeleteFile,
  ParsedPatch,
  ParsedPatchOperation,
  ParsedUpdateFile,
  ParsedUpdateHunk,
  RecoveryFailure,
  ResolvedEditPath,
  SearchReplaceBlock,
  UniqueMatch,
  WindowedFileReaderPort,
} from "./edits/index.js";
```

`packages/worker-loop/package.json` is frozen. Add an export subpath so `@ef-harness/worker-loop/edits` resolves:

```json
"./edits": {
  "types": "./dist/edits/index.d.ts",
  "import": "./dist/edits/index.js"
}
```

The current `ef/layer-boundary` rule treats `@ef-harness/worker-loop/edits` as a deep import. Allow that package export subpath when it is wired, or have callers import the barrel until the rule is updated.

Task 057 should call `EditToolDispatcher` for edits and should run the project formatter only at `submit_candidate`, never after these methods. This package does not call a formatter.

## Dependency Intents (New Packages Requested)

None. Runtime code uses `node:crypto` and `node:fs`. Property tests import `fast-check`, already installed at the repository root by Task 001. No lockfile change. Do not add `fast-check` to `@ef-harness/worker-loop` until a root manifest edit is allowed; Node resolves it by walking up to the workspace root during `vitest`.

## Contract Change Requests

None inside `schema/` or the frozen package barrels.

Hash contract to reconcile at integration: Task 007's `digestSha256` prefixes `sha256:`. This task's file hash and `range_hash` are 64 lowercase hex characters with no prefix, which is what `replace_lines` compares. Wrap or strip the prefix at the boundary. Do not change either side inside this branch.

Local ports, because Tasks 053 and 055 are not on this base:

- `ModelProfileEditView.editFormat` stands in for Task 053 `ModelProfile.editFormat` (`apply_patch | str_replace | search_replace`). Extra profile fields are ignored. Swap the constructor option to the real `ModelProfile` when that module is wired. Do not import the unpublished sibling.
- `WindowedFileReaderPort.observedContentHash(attemptId, relativePosixPath)` stands in for the SHA-256 Task 055 returns from `read_file`. `observedContent` is optional and, when present, limits `FileChangedExternallyError.numberedView` to the changed line span. `MemoryReadObservationCache.note(attemptId, path, content)` is the adapter Task 057 can call with each `WindowedFileReader` result until the two classes share a type. If no hash was observed, the edit is not treated as externally changed.

`write_scope` globs use `*`, `?`, and `**` against the worktree-relative posix path. `.git` and `node_modules` are rejected even when a glob would match them. Realpath must stay inside the worktree.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-056-worker-loop-edit-applier`:

- `pnpm --filter @ef-harness/worker-loop test -- edits` — passed, 4 files, 25 tests. Covers `apply_patch`, `str_replace`, `search_replace`, `write_new_file` existing-file rejection, all 4 match tiers, ambiguous line numbers, atomic multi-file abort, the 4-step ladder, stale `range_hash`, elision, external modification, and `fast-check` properties at 200 runs (CRLF preservation, indent shift, exact round-trip, no guessed duplicate).
- `pnpm --filter @ef-harness/worker-loop typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/worker-loop lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 056` — passed (`harmony ok for Task-056`). That command also re-ran repository `typecheck`, `lint`, and `test`.

## Known Limitations / Follow-Ups

- Whole-file rewrite is not offered. A unique targeted hunk may still cover an entire existing file; that is a replace, not a second tool.
- `write_new_file` and `*** Add File` fail with `FileAlreadyExistsError` when the path exists. New file bytes use LF and a trailing newline when the add body has lines. Existing files keep their dominant EOL (`CRLF` when `\r\n` outnumbers bare `\n`).
- Empty patch lines are ignored. A blank context line inside a hunk is a single leading space, which is the OpenAI envelope rule. A pure insertion (`+` lines and no `-` or context lines) needs exactly one `@@` anchor.
- `parseSearchReplaceBlocks` splits on a line that is seven `=` characters and on the end marker. A search or replace body that contains that divider line must use the structured `{ path, search, replace }` array instead.
- Elision checks cover `str_replace` / `search_replace` / `write_new_file` / `replace_lines` replacement text and `apply_patch` `+` lines only. Context lines copied from the file are not treated as a new elision. Patterns: `// ... existing code ...`, `/* ... rest of file unchanged ... */`, `# ... existing code ...`, `// ... rest of file ...`, `/* unchanged */`, and the phrase `rest of file unchanged`.
- Files that contain a NUL byte are rejected as binary.
- `atomicWriteFile` moves the existing target aside, then renames the temp into place. A crash in that window can leave a sibling whose name ends in `.ef-bak`. It does not leave a half-written 0-byte source file.
- Tier 1 is an exact substring, so overlapping hits of the same needle are ambiguous rather than guessed. Tiers 3 and 4 compare whole-line windows. Tier 4 ignores the common leading indent and still requires the same relative nesting.
- `@@` headers narrow matches to those that start after the header line. They do not override an ambiguous match that is still ambiguous after that filter.
- Success resets the consecutive failure count. `replace_lines` remains available for that attempt and file. A fourth consecutive miss still throws `EditStuckEscalation` even though the tool is unlocked.
- This dispatcher is synchronous. Task 057 owns checkpoints, the formatter-at-submit step, and feeding `EditStuckEscalation` into the kernel loop fingerprint ladder.
