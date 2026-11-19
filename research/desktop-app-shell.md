# Research: the desktop shell, background daemon and updates

Question: how should a Windows desktop harness keep builds alive when its window closes, what should ship in the installer, and how can it update without breaking parked work? Design: [desktop app](../desktop-app.md).

## Keeping work alive

- Electron quits when all windows close **unless** the app listens for `window-all-closed`; tray apps keep running this way. `app.requestSingleInstanceLock()` prevents a second instance and forwards its arguments to the first. [Electron app API](https://www.electronjs.org/docs/latest/api/app) · [Tray tutorial](https://github.com/electron/electron/blob/main/docs/tutorial/tray.md)
- `utilityProcess.fork` runs Node services as children of the main process, suitable for crash-prone work, but they live and die with the app's main process. [Process model](https://www.electronjs.org/docs/latest/tutorial/process-model) · [utilityProcess](https://github.com/electron/electron/blob/main/docs/api/utility-process.md)
- Electron's executable can run as plain Node with the `ELECTRON_RUN_AS_NODE` environment variable, so a detached daemon needs no second Node runtime. [Electron environment variables](https://www.electronjs.org/docs/latest/api/environment-variables)
- Power events: `powerMonitor` reports suspend and resume; `powerSaveBlocker` can prevent sleep while work runs. [powerMonitor](https://www.electronjs.org/docs/latest/api/power-monitor) · [powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker)

**Conclusion:** window, Electron main and daemon as three processes; the daemon detached and single-instance per user.

## Local IPC security

- Local HTTP servers on `localhost` can be reached by web pages through DNS rebinding and cross-site requests unless carefully defended; many developer tools have had such bugs.
- Windows named pipes accept a security descriptor, so access can be limited to the current user; they aren't reachable from browsers at all.

## SQLite inside Electron

- `node:sqlite` ships in Node, has been unflagged since Node 22.13/23.4, works inside Electron 42 (Node 24) with FTS5 and BM25, and avoids native-module ABI mismatches between Node and Electron that affect `better-sqlite3`. It lacks some helpers (transaction wrapper, `pragma()`), so a thin driver interface is needed. [DEV article on node:sqlite](https://dev.to/grimicorn/nodesqlite-the-database-that-already-ships-with-node-3p0j) · [ABI issue write-up](https://github.com/chandra447/pi-hermes-memory/issues/137) · [Electron 42 + node:sqlite PR](https://github.com/iOfficeAI/AionUi/pull/3271)
- SQLite's `PRAGMA user_version` stores an application schema version; `VACUUM INTO` writes a consistent copy of a live database (SQLite 3.27+), suitable for pre-migration backups. [PRAGMA](https://www.sqlite.org/pragma.html#pragma_user_version) · [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto)

## Sizes for the installer decision (approximate)

| Component | Size | Source |
|---|---|---|
| Whisper models (ggml) | tiny ~75 MB, base ~142 MB, small ~466 MB, medium ~1.5 GB | [whisper.cpp models](https://github.com/ggml-org/whisper.cpp/tree/master/models) |
| MinGit | Tens of MB | [MinGit](https://github.com/git-for-windows/git/wiki/MinGit) |
| Playwright browsers | Downloaded per browser on demand by `playwright install` | [Playwright browsers](https://playwright.dev/docs/browsers) |

## Updates

- electron-builder with electron-updater supports background downloads and differential (blockmap) updates on Windows NSIS installers. [electron-builder auto update](https://www.electron.build/docs/features/auto-update)
- Event-sourcing practice uses **upcasters** to read old event formats without rewriting stored data, which suits old checkpoint formats.

## Observability

Structured JSON logs and trace spans per operation (the OpenTelemetry model of traces and spans) make a model call attributable to its task and outcome. [OpenTelemetry concepts](https://opentelemetry.io/docs/concepts/signals/traces/)

## To measure

- Cold start time of the daemon and window on a mid laptop.
- Time to park a 6-worker build for an update.
- Database migration time on a 200 MB project database.
