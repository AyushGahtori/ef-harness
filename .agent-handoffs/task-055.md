---
task_id: "Task-055"
branch: "task/055-worker-loop-tool-shrinker"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/worker-loop/src/read-tools/**"
  - "packages/worker-loop/tests/read-tools/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 055 handoff

Windowed file reads, symbol outlines, structured test/build/grep/kb shrinkers, and `harness.read_log` live under `packages/worker-loop/src/read-tools/`. The package barrel is frozen, so nothing is re-exported from `packages/worker-loop/src/index.ts` yet. Sibling tasks 011, 029, 047, and 054 are not on this branch. Their contracts are consumed through local ports.

## Exports Provided

Import from `packages/worker-loop/src/read-tools/index.ts` until the barrel wiring below lands.

- `WindowedFileReader` — `readFile(path, range?)`, `listFiles(glob)`, `grepFiles(pattern, glob?)`, `readLocalPackageSource(packageRoot, relativePath)`, `lastObservedFileHash(path)`.
- `FileHashReadCache` — last whole-file SHA-256 observed by a successful `readFile`. Task 056 compares a fresh hash with `lastObservedFileHash` and rejects the edit when they differ.
- `FileOutlineExtractor` — `extract(fileName, source)` for `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts` (TypeScript compiler API, regex fallback) and `.py/.go/.rs` (regex). Kinds: `class`, `function`, `interface`, `component`, `type`, `export`.
- `ToolOutputShrinker` — `shrinkTestOutput`, `shrinkBuildOutput`, `shrinkKbOutput`, `oneLineSummary`, and `shrinkForHistory`. Every history-bound tool result goes through `shrinkForHistory`.
- `ReadLogTool` — `readLog(artifactId, { query?, startLine?, endLine?, maxLines? })`. Hard cap 200 lines and 16 KB per call.
- `oneLineSummary` — deterministic `turn_log.result_summary` line. Examples: `read src/kitchen/print.tsx L1-120`, `grep "toPrintRows": 4 hits in 2 files`, `test: 14 passed, 1 failed (AC-31) [ART-42]`.
- `shrinkTestOutput`, `shrinkBuildOutput`, `shrinkKbOutput` — same functions the class methods call.
- Errors: `PathEscapeDeniedError`, `SecretFileDeniedError`, `FileNotFoundError`, `NotAFileError`, `InvalidLineRangeError`, `InvalidRegexError`, `UnsafeRegexError`, `ArtifactNotFoundError`, `PackageRootDeniedError`.

`ReadModelProfile` is `{ contextWindow: number }`. `contextWindow <= 32768` selects the small-model caps: 200-line reads and 10 test failures. Larger windows use 400-line reads and 25 test failures. Build errors cap at 30 deduplicated diagnostics. Grep and list cap at 50. Lines longer than 500 characters are replaced with `Line N is <count> chars (minified/generated); truncated`.

`fileHash` is SHA-256 of the raw file bytes. `rangeHash` is SHA-256 of the selected logical line texts joined by `\n` (not the numbered display, and not the raw CRLF slice). Task 056 `replace_lines` must hash the same logical lines with `\n` when it checks `range_hash`. A capped read's hash covers only the lines actually returned (`returnedStart`..`returnedEnd`).

Oversized files with no range return a symbol outline, the first window, `<omitted> lines omitted`, and the exact instruction `File has <N> lines; call read_file(path, { start, end }) for specific ranges`. Grep truncation uses `Showing first 50 of <total> matches; refine pattern or glob`.

File contents, grep matches, list results, log slices, and test/build summaries are wrapped in escaped `<data source="..." trust="untrusted">` tags after redaction. Knowledge nodes use `trust="kb"`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/worker-loop/src/index.ts` in this task. When integrating, re-export the read-tools surface from that barrel:

```ts
export {
  WindowedFileReader,
  FileHashReadCache,
  FileOutlineExtractor,
  ToolOutputShrinker,
  ReadLogTool,
  oneLineSummary,
  shrinkTestOutput,
  shrinkBuildOutput,
  shrinkKbOutput,
  capsForProfile,
  PathEscapeDeniedError,
  SecretFileDeniedError,
  InvalidLineRangeError,
  InvalidRegexError,
  UnsafeRegexError,
  ArtifactNotFoundError,
} from "./read-tools/index.js";
export type {
  ReadModelProfile,
  FileReadResult,
  GrepFilesResult,
  ListFilesResult,
  ReadLogResult,
  SymbolOutlineEntry,
  SecretRedactorPort,
  ArtifactLogPort,
  HistoryToolInput,
  PreparedHistory,
  OneLineEvent,
} from "./read-tools/index.js";
```

No root `package.json` script or workspace change is required.

## Dependency Intents (New Packages Requested)

None. `FileOutlineExtractor` optionally `require`s the `typescript` package already declared as a devDependency of `@ef-harness/worker-loop`. If that load fails, outline extraction uses the regex fallback. No new runtime dependency should be added for this task.

## Contract Change Requests

None. Sibling packages are not imported.

Local ports, and the swap once those tasks are integrated:

- `SecretRedactorPort.redact(text: string): string` stands in for Task 011 `SecretRedactor`. `LocalSecretRedactor` masks registered vault values (length >= 8, including base64, base64url, URL-encoded, and JSON-escaped forms) and the built-in token shapes, replacing matches with `[REDACTED:<LABEL>]`. Replace construction sites with the shared redactor when `packages/shared-contracts` exports it. Streaming chunk-overlap redaction stays in Task 011; this port only sees complete strings.
- `ArtifactLogPort.readLogRange(artifactId, startLine, endLine)` and `queryLogStream(artifactId, pattern, maxMatches, range?)` stand in for Task 029 `ArtifactManager`. `MemoryArtifactLogStore` is the in-memory test double. The optional fourth `range` argument (`{ startLine?, endLine? }`) is local. A Task 029 adapter can call the 3-argument `queryLogStream` and filter by line number, or pass the window through if the manager grows that parameter. `ReadLogTool` still enforces the 200-line / 16 KB cap after the port returns.
- `ReadModelProfile.contextWindow` is the only field this task needs from Task 053/054 `ModelProfile`. Pass the real profile object; extra fields are ignored.

`WindowedFileReader` does not call `HarnessRunEngine` or `OutputSummarizer` (Task 047). Those callers should pass the command `artifactId` into `shrinkTestOutput` / `shrinkBuildOutput` and serve the full log through `ReadLogTool`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-055-worker-loop-tool-shrinker`.

- `pnpm --filter @ef-harness/worker-loop test -- read-tools` — pass. Vitest v5.1.1: 3 files, 33 tests passed (windowed 400/200 reads, 1,000-line symbol outline, minified-line protection, binary NUL detection, symlink and path escape, secret-file denial, gitignore, 50-match grep cap, non-ReDoS rejection, 4,000-line Vitest and Playwright shrink to <= 25 lines with project frames and `harness.read_log` lookup, 100 tsc errors shown as the first 30 grouped by file, build parsers, one-line summaries).
- `pnpm --filter @ef-harness/worker-loop typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/worker-loop lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 055` — pass (`harmony ok for Task-055`).

## Known Limitations / Follow-Ups

- `LocalSecretRedactor` is not the Task 011 redactor. It does not do streaming overlap windows, HMAC fingerprints, or log sinks. Swap the port before production wiring.
- `MemoryArtifactLogStore` is not seekable zstd. It is the stand-in until `ArtifactManager.readLogRange` / `queryLogStream` exist. Do not point `ReadLogTool` at a full log buffer in the model context.
- `.gitignore` matching covers comments, negations, directory-only rules, `*`, `**`, and nested gitignore files. Exotic git pattern forms are not fully reproduced.
- Regex search rejects nested quantifiers, quantified alternation, backreferences, and lookaround (`UnsafeRegexError`) instead of running them. Invalid syntax throws `InvalidRegexError`.
- Direct `readFile` stays inside the attempt worktree. Reads outside it go only through `readLocalPackageSource` and an explicit `localPackageRoots` allowlist. `.env*`, `*.pem`, `*.key`, and anything under `.git/` are refused. `list` / `grep` skip `.git/`, secret files, and `node_modules/` unless `includeLocalPackageSource: true`.
- Modules under `read-tools/` only read files. They do not write, rename, or delete worktree paths.
- Outline entries are capped at 80. A PascalCase function is classified as a React `component`.
- Task 054 should call `oneLineSummary` (or `ToolOutputShrinker.oneLineSummary`) for Zone 5 collapse. Task 056 should use `fileHash`, `rangeHash`, `returnedStart`, `returnedEnd`, and `FileHashReadCache`. Task 057 should send every tool result through `shrinkForHistory` before it is appended to history.
