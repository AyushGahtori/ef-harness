---
task_id: "Task-067"
branch: "task/067-m1-daemon-minimal-viewer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/daemon/src/bootstrap/**"
  - "apps/desktop/src/bootstrap/**"
  - "apps/renderer/src/m1-viewer/**"
  - "apps/daemon/tests/bootstrap/**"
  - ".agent-handoffs/task-067.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 067 handoff

Detached `harnessd`, the Electron M1 shell, the utility-process pipe bridge, and the minimal diff/receipt viewer are implemented on this branch only.

## Exports Provided

Import these from the owned modules until the package barrels below are wired. Do not deep-import them from other layers before that wiring.

Daemon launcher (`apps/daemon/src/bootstrap/index.ts`):

- `createHarnessDaemon`, `HarnessDaemon`, `HarnessdOptions`, `ShutdownReceipt`
- `startHarnessd`, `optionsFromEnv`, `harnessdEntryPath` (entry: `apps/daemon/src/bootstrap/harnessd-main.ts`)
- `buildDetachedHarnessdSpawn`, `spawnDetachedHarnessd`, `resolveDaemonRuntime`, `DetachedSpawn`
- `installShutdownSignals`
- `userPipePath`, `defaultPipePath`, `defaultProfileDir`, `profileFromLocalAppData`, `sanitizeUser`
- `generateSessionToken`, `writeSessionToken`, `readSessionToken`, `timingSafeTokenEqual`
- `FrameCodec`, `FrameTooLargeError`, `FrameChannelError`, `PipeInUseError`
- `TASK_PIPELINE`, `M1View`

Electron shell (`apps/desktop/src/bootstrap/index.ts`):

- `startDesktopMain`, `DesktopOptions`, `DesktopRuntime`, `ElectronHost`
- `ensureHarnessd`, `launchDetached`, `EnsureHarnessdDeps`, `DetachedLaunch`
- `probeDaemon`, `callDaemon`, `DaemonProbe`
- `ELECTRON_SECURITY_DEFAULTS`, `M1_CONTENT_SECURITY_POLICY`, `PRELOAD_EXPOSES`
- `M1_PRELOAD_CONTRACT`, `PRELOAD_CJS`, `M1PreloadContract`

Preload contract: main posts on channel `ef-port` with one transferred `MessagePort`. The sandboxed preload forwards only that port via `window.postMessage("ef-port", ...)`. The page never receives `ipcRenderer` or Node.

M1 viewer mount (`apps/renderer/src/m1-viewer/index.ts`):

- Mount id `M1_VIEWER_MOUNT_ID` (`m1-viewer`) in `M1_VIEWER_DOCUMENT` (`index.html`)
- `M1_CONTENT_SECURITY_POLICY`, `M1_TASK_PATH`
- `createClientStateSyncer`, `DomainEvent`, `SyncApply` (local port of Task 032 `ClientStateSyncer`)
- `escapeText`, `renderDiffText`

The static page is `apps/renderer/src/m1-viewer/index.html` plus `viewer.css` and `viewer-client.js`. Electron serves it on the privileged `ef-m1://viewer/` scheme. Task 122 should mount the full shell on `#m1-viewer`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit the frozen package barrels in this task. Integrator re-exports:

- `apps/daemon/src/index.ts` re-exports `apps/daemon/src/bootstrap/index.ts`
- `apps/desktop/src/index.ts` re-exports `apps/desktop/src/bootstrap/index.ts`
- `apps/renderer/src/index.ts` re-exports `apps/renderer/src/m1-viewer/index.ts`

Root `package.json` script, frozen here:

```json
"dev:m1": "node apps/daemon/src/bootstrap/dev-m1.mjs"
```

`apps/daemon/src/bootstrap/dev-m1.mjs` typechecks `@ef-harness/daemon` and `@ef-harness/desktop`, then launches Electron on `apps/desktop/dist/bootstrap/electron-entry.js`. That shell spawns detached `harnessd` at `apps/daemon/dist/bootstrap/harnessd-main.js` with `ELECTRON_RUN_AS_NODE=1`, `detached: true`, `stdio: 'ignore'`, and `unref()`.

No new root dependency. `electron` and `playwright` are already root devDependencies.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `task-067-m1-daemon-minimal-viewer`:

- `pnpm --filter @ef-harness/daemon typecheck` — pass
- `pnpm --filter @ef-harness/desktop typecheck` — pass
- `pnpm --filter @ef-harness/renderer typecheck` — pass
- `pnpm --filter @ef-harness/daemon lint` — pass
- `pnpm --filter @ef-harness/desktop lint` — pass
- `pnpm --filter @ef-harness/renderer lint` — pass
- `pnpm --filter @ef-harness/daemon test -- bootstrap` — pass, 2 files, 16 tests

Coverage in that run:

- Detached `harnessd` survives the parent exiting, rejects a wrong session token, parks on `daemon.parkAndExit` when versions differ, and checkpoints WAL with `TRUNCATE` before closing `global.db` and `state.db`.
- Playwright Electron launches the M1 viewer over a real named pipe and `MessagePort`, checks live states, the accepted diff, check receipts, the Stop button, single-instance exit, renderer-crash reopen, and daemon survival after the viewer is closed.
- Security: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP `default-src 'self'` with no `unsafe-eval`, and an untrusted diff note rendered as text.

- `node scripts/verify-harmony.mjs --task 067` — pass (`harmony ok for Task-067`)

## Known Limitations / Follow-Ups

Sibling branches are not on this base. These are local ports, not imports of unpublished packages:

- Task 031 `NamedPipeServer` / `NamedPipeClient` / `FrameCodec` / `MessagePortBridge` — local pipe server, `FrameCodec`, and the utility-process port bridge. Wire layout is `uint32BE payloadLength` + `uint8 channel` + optional `uint32BE streamId` + payload. Channel 0 is JSON-RPC. Channel 1 is binary.
- Task 032 `RpcRouter` / `EventSubscriptionServer` / `ClientStateSyncer` — local JSON-RPC methods (`session.hello`, `events.subscribe`, `snapshot.get`, `diff.get`, `build.stop`, `build.start`, `daemon.parkAndExit`, `daemon.shutdown`) and `createClientStateSyncer`.
- Task 033 `BinaryStreamManager` — local `diff.get` hunk streaming with credit windows. Payloads above 64 KB go to channel 1.
- Task 066 worker loop — `SimulatedTask` walks `LEASED → CODING → STATIC_AUDIT → CLEAN_VERIFY → ACCEPTED` and serves a fixed accepted diff on `harness/f/F12` with trailer `Harness-Task: T03`. Replace it with the real task runner when that branch is integrated. The sandbox badge is advisory tier C.

MessagePort frames are base64 structured clones (`bytes:<base64>` from the page, `{ type: "bytes", encoding: "base64", payload }` from the utility). Transferring an `ArrayBuffer` on Electron's utility-process port dropped the message. Swap back to a real transfer when Task 031's bridge is the one on the wire.

Closing the M1 window does not quit Electron main and does not stop `harnessd`. Task 131 still owns tray hide, quit-while-building, and the idle app quit. Daemon idle shutdown runs only when zero authenticated windows are connected and no simulated task is active.

`session.token` is overwritten atomically before `listen`. Pipe name is `\\.\pipe\efharness-<user>`. Profile root is `%LOCALAPPDATA%\EFHarness`, overridable with `EF_HARNESS_PROFILE` and `EF_HARNESS_PIPE`.
