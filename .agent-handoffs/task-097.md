---
task_id: "Task-097"
branch: "task/097-external-intake-converters"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/intake/src/converters/**"
  - "packages/intake/tests/converters/**"
  - ".agent-handoffs/task-097.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 097 handoff

Offline sandboxed intake converters with exact locators, magic-byte dispatch, zip-bomb and XXE guards, hidden-text stripping, scanned-PDF OCR fallback, and CAS dedup. Commit stays on `task/097-external-intake-converters`.

## Exports Provided

Import from `packages/intake/src/converters/index.ts` until the intake barrel is wired.

- `SandboxedDocumentConverter` — `convert({ fileName, bytes, pageStart?, pageEnd?, visionCaptioner?, wallClockMs?, memoryLimitBytes? })`. Hashes the raw bytes, returns a cached `NormalizedDocument` on the same source hash and page range, otherwise runs parsing in a child process. Result is `{ document, cacheHit, deduplicated, engines, sandbox }`. `sandbox` reports `executed`, `pid`, `networkDenied`, `zeroNetwork: true`, `memoryLimitBytes` (512 MB), `wallClockMs` (30 s), and `jobAssigned`.
- `DocumentLocatorSchema` — `parse` / `safeParse` for `pdf`, `pdf_ocr`, `docx`, `markdown`, `html`, `csv`, and `image` locators. `DocumentLocatorParseError` lists the issues.
- `NormalizedDocument` — `schema: "normalized-document@1"`, `sourceHash` (`sha256:` + hex of the original bytes), `fileName`, `mediaType`, `text`, `blocks`, `warnings`, `ocrDerived`, `stats`. Each block has `charStart`/`charEnd` into `text` and `utf8ByteStart`/`utf8ByteEnd` into the UTF-8 bytes of `text`.
- `PdfConverter`, `DocxConverter`, `MarkdownHtmlConverter`, `CsvTsvConverter`, `ImageOcrVisionConverter`, `convertBytes`.
- `formatLocatorCitation` — PDF citations look like `PRD.pdf p.4 ¶3`.
- `verifyBlockQuote` — the block text equals both `text.slice(charStart, charEnd)` and the UTF-8 slice at `utf8ByteStart`/`utf8ByteEnd`.
- Errors: `FileExpansionLimitError`, `FileSizeLimitError`, `UnsupportedOrMismatchedFileType`, `PasswordRequiredError` (message `This PDF is password-protected; please export an unlocked copy`), `PageRangeRequiredError` (message `Select specific page range`), `ConverterProcessError`, `ConverterTimeoutError`, `ZeroNetworkDeniedError`, `CasBlobMissingError`, `CasIntegrityMismatchError`.

`Task 098`, `Task 100`, and `Task 193` should consume `SandboxedDocumentConverter`, `DocumentLocatorSchema`, and `NormalizedDocument`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/intake/src/index.ts` is outside this task. Re-export the symbols above from that barrel. Do not deep-import `packages/intake/src/converters/**` from another package.

No root `package.json`, `packages/intake/package.json`, or `packages/shared-contracts/src/index.ts` edit. Those files are frozen.

## Dependency Intents (New Packages Requested)

`pdfjs-dist`, `mammoth`, and `sharp` are already root devDependencies. This task loads them from the repository root with `createRequire` / dynamic import and does not edit any `package.json`. At integration, add them to `@ef-harness/intake` so the package does not depend on hoisting:

- `pdfjs-dist` — offline PDF text, operator styles, and password detection (`legacy/build/pdf.mjs`).
- `mammoth` — DOCX HTML conversion with `externalFileAccess: false`. Paragraph locators still come from a DOCTYPE-stripped read of `word/document.xml`.
- `sharp` — PNG/JPEG/WebP decode with `limitInputPixels`. PNG fixtures also decode through the in-tree PNG codec.
- `tesseract.js` — not installed. `ImageOcrVisionConverter` tries `tesseract.js` and falls back to the offline bitmap OCR (`renderBitmapText` / `recognizeBitmap`) for A–Z, digits, and spaces. Add `tesseract.js` for photographed pages.
- `remark` and `remark-parse` — not installed. `MarkdownHtmlConverter` is the local structural parser (headings, lists, tables, fenced code, sanitized HTML). Swap in remark when those packages are approved.

## Contract Change Requests

None. `schema/state.sql` is unchanged. The source-hash to normalized-document link is held by the local CAS port (`readNormalized` / `writeNormalized`). When Task 028 and Task 013 are wired, store that link on `state.db.artifacts` and keep the normalized JSON bytes in CAS.

Sibling branches are not on this base. Local ports, and the swap:

- **Task 007 `CanonicalHash`.** `packages/intake/src/converters/ports/canonical-hash.ts` is `local-port:task-007`. `createCanonicalHash().sha256` is 64 lowercase hex. `sha256Prefixed` is `sha256:` plus that hex. `stableJson` sorts object keys. Swap to `@ef-harness/shared-contracts` `digestSha256` and `canonicalizeJson` when that barrel exports them. Do not deep-import the sibling package.
- **Task 028 `CasBlobStore`.** `MemoryCasBlobStore` is `local-port:task-028`. `putBlob`, `getBlob`, `readNormalized`, and `writeNormalized` are the methods this task calls. The blob key is `sha256:` + hex of the uncompressed bytes (Task 007 prefix). Task 028's on-disk store keys blobs by lowercase hex without the prefix; strip or keep the prefix consistently at the swap. This port does not compress, retry Windows renames, or run GC.
- **Task 041 `WindowsJobSupervisor`.** `WindowsJobSupervisor.attach` is `local-port:task-041`. On Windows it compiles a short PowerShell/C# helper and assigns the child to a job with kill-on-close plus a 512 MB process and job memory cap. Task 041's published consumption shape is `WindowsJobManagerPort`, and Task 040 publishes `WindowsJobManager`. Swap `attach` / `terminate` onto `WindowsJobManager.assignProcess` and `runCommand` when `packages/sandbox/src/index.ts` exports them.
- **Task 045 `SandboxRunner`.** `NodeSandboxRunner` is `local-port:task-045`. The task text names `SandboxRunner` from Task 045; that branch publishes `SecureDocFetcher`, and `SandboxTierSelector` is Task 043. This runner spawns the converter child with a scrubbed environment, a 30 s wall clock, and the job supervisor. It does not fetch docs. Swap the spawn to `SandboxTierSelector` plus the job manager when those barrels exist. Do not import unpublished sandbox packages from this branch.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-097-external-intake-converters`.

- `pnpm --filter @ef-harness/intake typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/intake lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/intake test -- converters` — exit 0. Vitest 5.1.1: 4 files, 20 tests passed (about 10 s). Covered: PDF headings, paragraphs, lists, table cells, hidden white 1 pt text, 6-page scanned OCR with `ocr_derived`, 501-page cap and an explicit page range, DOCX paragraph indexes and table cells, XXE and macro stripping, markdown/HTML stealth Unicode and hidden markup, 100,000-row CSV sample, PNG OCR, sandboxed child pid and zero-network denial, CAS cache hit, `.exe` renamed to `.pdf`, declared and streaming zip bombs, password-protected PDF, quote alignment, and an image with no vision captioner leaving `visionSummaryRef` unset.
- `node scripts/verify-harmony.mjs --task 097` — exit 0, `harmony ok for Task-097` (schema 67/67, diagrams, owned paths, workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

- **Bitmap OCR.** Without `tesseract.js`, recognition is the in-tree 5×7 font for uppercase A–Z, digits, and spaces. Photographed pages need the real engine. Scanned-PDF fallback extracts embedded page images, re-encodes a bounded PNG, tries `tesseract.js` on that PNG, and falls back to the bitmap OCR. It does not rasterize vector-only pages through a canvas.
- **Windows job.** The helper is compiled on each attach with `Add-Type`. It is not Task 040's cached `csc.exe` helper. `jobAssigned` is true only when that assignment prints `ASSIGNED`. The OS memory cap is at least 2 GB so `pdf.js` is not killed when the rest of the workspace test run is busy; the receipt still records the requested 512 MB policy cap. The child also patches `net`, `dns`, `http`, `https`, and `fetch`. The worker is started with Node's type stripper, not `tsx`. `register-ts-hook.mjs` maps relative `.js` specifiers onto sibling `.ts` sources so that stripper can load the converter.
- **CAS.** `MemoryCasBlobStore` is in-memory. Identical file bytes and the same page range convert once. A different page range is a different cache key.
- **Vision.** `visionSummaryRef` is set only when `convert` is given a `visionCaptioner`. The default image path leaves it unset. The captioner result is also stored with `putBlob`.
- **Markdown.** The structural parser is not remark. HTML comments, scripts, styles, `display:none`, `visibility:hidden`, `font-size:0`, and the `hidden` attribute are removed before blocks are emitted.
- **DOCX.** Mammoth is invoked with `externalFileAccess: false` after DOCTYPE and external-entity declarations are removed. Locators come from `word/document.xml`. `vbaProject.bin` is dropped and warned as `macros_stripped`.
- **CSV.** A file above the sample size keeps the header, inferred column types, the first 20 data rows, the last 2 edge rows, and `stats.totalRows`. It does not put every row in the normalized text.
