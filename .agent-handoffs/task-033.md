---
task_id: "Task-033"
branch: "task/033-binary-artifact-streaming"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ipc/src/streams/**"
  - "packages/ipc/tests/streams/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 033 handoff

Credit-based Channel 1 artifact streaming, range log/diff fetch, and Channel 0 priority. Commit stays on `task/033-binary-artifact-streaming`.

## Exports Provided

Import from `packages/ipc/src/streams/index.ts` until the ipc barrel is wired:

- `BinaryStreamManager` — `artifact.open` handshake `{ streamId, totalBytes, mime, chunkBytes: 65536, initialCredits }`, `stream.credit`, `stream.close`, `stream.end { streamId, bytesSent, sha256 }`, and `stream.error { streamId, code, message }`. Connection-scoped `uint32` stream ids. Pauses at 0 credits. Grants must be integers `1..256` with at most `512` outstanding. Evidence and asset blobs are SHA-256 checked before the first chunk. A zero-byte artifact emits EOF immediately.
- `ArtifactStreamClient` — named-pipe client. Grants chunk credits, ignores Channel 1 frames for a `streamId` it already closed, and checks `stream.end` against the bytes it received.
- `RangeDiffHandler` — `diff.get { task, file, hunks? }`. Headers first; hunk bodies only for the requested indexes. Results over 1 MB throw `PayloadExceedsJsonCapError`.
- `RangeLogHandler` — `log.range { artifactId, startLine, endLine }` and `log.search { artifactId, query, maxMatches }`. Delegates to `ArtifactManager.readLogRange` / `queryLogStream` and does not widen the requested span.

Also exported for callers and tests: `ArtifactPipeServer`, `allocatePipePath`, `PriorityWriter`, `StreamFrameCodec`, `encodeBinaryFrame`, `encodeJsonFrame`, `adaptFrameCodec`, `FileArtifactCatalog`, `FileByteSource`, `FileBlobSource` is in `blob-source.ts` (pull-style CAS reader; not on the barrel), `assertJsonRpcWithinCap`, `spillToArtifactOpen`, `PayloadExceedsJsonCapError`, `ArtifactNotFoundError`, `InvalidCreditError`, `CasBlobMissingError`, `CasIntegrityMismatchError`, `StreamIdleTimeoutError`, `StreamRemoteError`.

Wire frame for Channel 1 is `[4B len][1B = 1][4B streamId][<=64KB data]`. Channel 0 is `[4B len][1B = 0][JSON]`, capped at 1 MB. A clean finish also sends a 0-byte Channel 1 frame so EOF is distinct from a truncated pipe. Default initial credit is 8 chunks (512 KB). Prefetch never holds more than that window, even after a larger grant. Idle streams that stop receiving credits are released after 60 s (override with `idleTimeoutMs`). Disconnect, `stream.close`, and idle timeout drop file descriptors, decompressors, and the `streamId` slot. Cross-project ids return `ArtifactNotFoundError`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ipc/src/index.ts` is outside this task's owned subtree. After integration, re-export the stream barrel:

```ts
export {
  ArtifactStreamClient,
  BinaryStreamManager,
  RangeDiffHandler,
  RangeLogHandler,
  PayloadExceedsJsonCapError,
  ArtifactNotFoundError,
  spillToArtifactOpen,
} from "./streams/index.js";
```

No root manifest, schema, or `packages/shared-contracts` edit.

Task 031's `NamedPipeServer` should delegate `artifact.open`, `stream.credit`, `stream.close`, `log.range`, `log.search`, and `diff.get` to `BinaryStreamManager` / `RangeLogHandler` / `RangeDiffHandler`, and write through `PriorityWriter` so Channel 0 (`build.stop`, `chat.send`, `session.ping`) flushes ahead of queued Channel 1 chunks. `adaptFrameCodec` accepts the Task 031 `FrameCodec` shape (`encode`, `push`, `reset`).

## Dependency Intents (New Packages Requested)

None. Hashing uses `node:crypto`, pipes use `node:net`, and zstd evidence uses `node:zlib`. No Electron import.

## Contract Change Requests

None. This branch does not modify Task 028, Task 029, or Task 031.

Local ports match the handoffs already on those branches:

- `CasIntegrityPort.verifyBlobIntegrity(hash)` and errors `CasBlobMissingError` / `CasIntegrityMismatchError` (same names as Task 028). Evidence and asset reads call the catalog `verifyIntegrity` hook or this port before streaming.
- `ArtifactLogReader.readLogRange(artifactId, startLine, endLine)` and `queryLogStream(artifactId, pattern, maxMatches)` match Task 029 `ArtifactManager`. Seekable logs are rejected on `artifact.open`; the cockpit uses `log.range`.
- `ExternalFrameCodec` matches Task 031 `FrameCodec`. `ArtifactPipeServer` is the standalone endpoint used by tests until `NamedPipeServer` is on the same tree.

When those packages land, prefer their error classes if they are the same types, and pass `ArtifactManager` plus `CasBlobStore` into the handlers instead of the file catalog.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-033-binary-artifact-streaming`:

- `pnpm --filter @ef-harness/ipc test -- streams` — pass, 4 files, 19 tests. Covers a 25 MB Windows named-pipe round trip with a 4-chunk (256 KB) credit window and exact SHA-256; server payload buffer stayed within that window; `session.ping` / `build.stop` / `chat.send` stayed under 10 ms while 3 concurrent 25 MB streams ran; `build.stop` flushed before queued Channel 1 chunks; round-robin of two streams; disconnect, `stream.close`, zero-byte EOF, missing blob, corrupt mid-stream blob, and credit counts `-1`, `999999`, and `2^31` left 0 stream slots and 0 handles; `log.range` and `diff.get` returned only the requested viewport; a Channel 0 body over 1 MB was rejected and the pipe still answered `session.ping`; a 50 MB synthetic stream stayed inside a 4-chunk window.
- `pnpm --filter @ef-harness/ipc typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/ipc lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 033` — pass, exit 0, `harmony ok for Task-033` (includes workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

- `NamedPipeServer` and `FrameCodec` from Task 031 are not on this branch. Tests use `ArtifactPipeServer` and `StreamFrameCodec` with the same length/channel/streamId layout. `adaptFrameCodec` is the adapter for the transport codec.
- `ArtifactManager` and `CasBlobStore` are not on this branch. `FileArtifactCatalog` hashes evidence and asset files (raw or zstd) for tests. A non-empty evidence or asset blob with no `verifyIntegrity` hook and no `CasIntegrityPort` is refused with `CasBlobMissingError`. A zero-byte blob whose SHA-256 is the empty-string hash is accepted without opening a descriptor.
- Resident chunk memory is capped at `min(initialCredits, 8) * 64 KB` per stream (at most 512 KB), which is below both the 1 MB per-stream ceiling and `outstandingCredits * 64 KB`. Credits above that window are remembered but not prefetched.
- The first prefetch is delayed a few event-loop turns so two `artifact.open` calls issued back to back share one round-robin pass. Later `stream.credit` grants schedule immediately.
- Idle timeout defaults to 60 s. The fault test uses a shorter override. Disconnect releases handles on the socket `close` path; the suite asserts that happens within 100 ms.
- This run executed the named-pipe suite on Windows. On other platforms `allocatePipePath` returns a temp socket path; that branch was not executed here.
