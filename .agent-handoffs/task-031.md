---
task_id: "Task-031"
branch: "task/031-named-pipe-ipc-transport"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ipc/src/transport/**"
  - "packages/ipc/tests/transport/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 031 handoff

Windows named-pipe transport for the window/daemon protocol. Commit stays on `task/031-named-pipe-ipc-transport`.

## Exports Provided

Import from `packages/ipc/src/transport/index.ts` until the package barrel below is wired:

- `NamedPipeServer` — current-user named pipe (or `0o600` Unix socket). Requires `session.hello` first, constant-time token check, protocol `1.0`/`1.1`, `session.ping`, multi-client sessions, per-client outbound cap, and `EADDRINUSE` as `PipeInUseError`.
- `NamedPipeClient` — reconnect with bounded exponential backoff, `session.ping` heartbeat, in-flight rejection on disconnect, and token re-read from disk. Events: `connected`, `reconnecting`, `disconnected`.
- `FrameCodec` — `uint32BE length` + channel byte + optional `uint32BE streamId` + payload. Channel `0` max `1_048_576`, channel `1` max `65_536`. Length is rejected before a payload buffer is allocated.
- `SessionTokenStore` — 256-bit token at `%LOCALAPPDATA%\EFHarness\session.token` (override with `directory`), atomic replace, current-user-only ACL, `timingSafeTokenEqual`, and `register("SESSION_TOKEN", token)` on the supplied or shared redactor.
- `MessagePortBridge` — `sendBinary` / `forwardFrame` transfer channel `1` `ArrayBuffer`s via `postMessage(message, [buffer])`.

Also exported for callers: `FrameTooLargeError`, `ProtocolVersionMismatchError`, `OutboundBufferLimitError`, `PipeInUseError`, `ConnectionClosedError`, `LocalSecretRedactor`, `createRedactingLogger`, `testPipePath`, `userPipePath`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/ipc/src/index.ts` is outside this task's owned subtree. After integration, re-export the transport from that barrel so `@ef-harness/ipc` exposes it:

```ts
export {
  FrameCodec,
  MessagePortBridge,
  NamedPipeClient,
  NamedPipeServer,
  SessionTokenStore,
} from "./transport/index.js";
```

Task 011 is not on `harness/integration`. `SessionTokenStore` accepts a `SecretRedactor` (`register` / `forget` / `redact`) and a `StructuredLogger` (`debug` / `info` / `warn` / `error`). On start it tries `getSharedSecretRedactor` from `@ef-harness/shared-contracts/telemetry` and, if that module is absent, registers the token on `LocalSecretRedactor`. Pass the process-wide Task 011 redactor and logger once that package is wired so daemon logs share one vault.

Task 008 JSON-RPC schemas are not on this branch. `session.hello` is validated to that shape: `jsonrpc: "2.0"`, `params.token`, `params.protocol` `1.0` or `1.1`, `params.client.{name,version}`. Channel numbers and size caps match Task 008 (`0` / `1`, `1_048_576` / `65_536`). Authenticated requests other than `session.ping` are dispatched to `onRequest` for Task 032.

## Dependency Intents (New Packages Requested)

None. `fast-check` is already a root devDependency and is imported by the transport tests. `package.json` is foundation-frozen, so it was not added to `@ef-harness/ipc`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-031-named-pipe-ipc-transport`:

- `pnpm --filter @ef-harness/ipc typecheck` — passed.
- `pnpm --filter @ef-harness/ipc lint` — passed.
- `pnpm --filter @ef-harness/ipc test -- transport` — passed, 4 files, 19 tests (frame codec fragmentation, coalesced frames, fast-check payloads, oversize rejection, Windows pipe ACL, session token file ACL, auth `-32001`, protocol mismatch, 5-second handshake timeout, `EADDRINUSE`, 3 isolated clients, token rotation re-auth, heartbeat, MessagePort transfer, outbound cap).
- `node scripts/verify-harmony.mjs --task 031` — passed (`harmony ok for Task-031`).

## Known Limitations / Follow-Ups

- libuv creates each named-pipe instance with a NULL security descriptor (Administrators full, Everyone read). After `listen`, and again when a client is accepted, the transport rewrites every writable instance DACL to SYSTEM + the current user SID only. There is a short gap inside libuv before that rewrite.
- A handle that cannot accept `WRITE_DAC` (typically the already-connected client end) is skipped so one denial does not drop the new listening instance.
- Unix `0o600` socket mode is implemented. This run executed the suite on Windows only.
- Replacing `session.token` retries `EPERM`/`EBUSY` when a reconnecting client still has the file open, then deletes and renames.
