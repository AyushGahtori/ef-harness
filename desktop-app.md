# The desktop app: shell, background daemon, bundled tools and updates

The harness is a Windows desktop app first (macOS and Linux later). This document describes the application itself: which processes run, what happens when the window closes, what ships in the installer, how it updates without breaking a build that is parked for two days, and how its own problems are diagnosed. Research: [desktop app shell](research/desktop-app-shell.md).

## Decisions in plain words

1. **The build engine is a separate background process.** A small daemon (`harnessd`) owns the coordinator, the database, workers and Git. The window is only a viewer. Closing or crashing the window never kills a build.
2. **Closing the window while building keeps building.** The app moves to the system tray with a notification. Closing while idle quits completely. Quitting during a build asks first.
3. **Small installer, tools on demand.** The installer carries what every project needs (about 200 MB). Speech models, test browsers and language toolchains download when first needed, with their size shown and checksums verified.
4. **Updates never interrupt a build.** Updates download quietly and install only when the developer chooses, after every task is parked at a checkpoint. Database upgrades back up first and are forward-only.
5. **Everything the harness does is logged locally and can be exported, redacted, as a diagnostics bundle.**

## Processes

```
┌───────────────── Windows user session ─────────────────────────────────────────┐
│  EF Harness window (Electron renderer, React)      Tray icon (Electron main)   │
│        │  named pipe \\.\pipe\efharness-<user> (current user only + token)      │
│        ▼                                                                        │
│  harnessd (Node via Electron runtime, detached, single instance per user)      │
│   ├─ coordinator per open project ── state.db (SQLite, WAL)                     │
│   ├─ resource broker ─────────────── global.db (connections, ledgers, slots)    │
│   ├─ adapters: own worker loop · codex app-server · copilot · cursor · claude · gemini │
│   ├─ harness MCP server per attempt                                             │
│   ├─ sandbox launcher (MXC / sandbox users / restricted token)                  │
│   └─ Git (bundled MinGit) · verifier runner · doc fetcher · Whisper (on demand) │
└─────────────────────────────────────────────────────────────────────────────────┘
```

| Process | Responsibility | If it crashes |
|---|---|---|
| Window (renderer) | Chat, canvas, cockpit, office | Reopens and reconnects; nothing lost |
| Electron main | Window lifecycle, tray, notifications, auto-update | Daemon keeps running; relaunching the app reconnects |
| `harnessd` | All state and work | Workers' process trees stop with their Job Objects; on restart the normal recovery runs ([coordinator and recovery](coordinator-and-recovery.md#effects-and-restart)) |
| Workers, verifiers, dev servers | One attempt each, sandboxed | Attempt fails over to its checkpoint |

**Why a separate daemon and not an Electron utility process:** utility processes are children of the Electron main process, so a crash of the app shell would take the build with it. The daemon is started detached, using the Electron executable in plain-Node mode so no second runtime is shipped.

**Why a named pipe and not a localhost port:** a pipe can be restricted to the current Windows user, and no web page can reach it, which removes a whole class of browser-based attacks on local servers. Each connection also presents a per-session token stored in the user profile.

**Why not a Windows Service:** services run outside the user's session and identity, but the harness needs the developer's Git config, credential vault (which is per-user) and plan logins. A per-user background process is the right identity.

## Window, tray and quitting

| Situation | Behavior |
|---|---|
| Close the window, nothing running | App quits (daemon stops after a short idle grace period) |
| Close the window while building | Hides to tray; toast “Still building · 4 workers · click to reopen” (first time only, then quiet) |
| Tray menu | Open · Pause all · Status line · Quit |
| Quit while building | Dialog: **Pause and quit** (checkpoints everything, about 10 s) · **Keep building in background** · Cancel |
| Windows sleep | Daemon pauses dispatch at sleep and runs reconciliation on wake; in-flight model calls are treated as unknown outcomes |
| Windows shutdown or sign-out | Daemon checkpoints within the shutdown window; anything not checkpointed resumes from the previous turn boundary |
| Optional: keep awake while building | Setting “Prevent sleep while a build runs” (off by default) |
| Optional: start at sign-in | Setting to start the daemon at login, so scheduled resumes (e.g. after a plan window resets) happen without opening the window |
| Second app launch | Single-instance lock focuses the existing window |

## Installer contents and on-demand downloads

| Component | When | Approximate size |
|---|---|---|
| Electron app, daemon, UI | Installer | 120–150 MB |
| MinGit (bundled Git) | Installer | 50–60 MB |
| gitleaks, tree-sitter grammars (WASM), office art | Installer | 20–30 MB |
| Whisper speech model (base by default, small optional) | First microphone use | 140 MB / 470 MB |
| Playwright browsers (Chromium, WebKit) | First project with browser tests | 150–250 MB each |
| Project toolchains (Node LTS, pnpm, Python) | First project that needs them, if not already installed | Varies |
| Local models (Ollama, LM Studio) | Never bundled; linked | — |
| Docker / WSL2 | Never bundled; optional for the strongest sandbox tier | — |

Every download comes from a URL listed in a signed manifest with a pinned SHA-256; a mismatch refuses the file. Downloads resume after interruption and show progress in Settings → Components, where any component can be removed.

## Updates

**The app.** Signed builds, differential downloads in the background. The update applies only when the developer clicks **Restart to update**, and the daemon first parks every running task at a checkpoint (the same mechanism as Pause all). A build in progress shows “Update ready · applies after this build or when you choose”.

**The database.** Each SQLite file stores its schema version (`PRAGMA user_version`). On first start after an update:

1. Park work, close readers, take an exclusive lock, and back up with `VACUUM INTO` to a timestamped file.
2. Run forward-only migrations, each in its own transaction. Additive changes run directly; changes SQLite can't make in place (constraints, column types) use its documented 12-step table rebuild, followed by search-index rebuilds.
3. Run `quick_check` and the schema invariants; on failure, restore the backup.

`global.db` migrates first. Each project migrates when it is opened, with its own backup. A project whose migration fails is restored and marked *needs repair* (Retry, Export, Report) while other projects keep working. A newer database cannot be opened by an older app; the app offers the pre-migration backup instead.

**Backups and corruption.** Besides pre-migration copies, `state.db` is copied hourly while work is happening (last 24) and daily (last 7). `quick_check` runs at open and at daily idle. If a project database is corrupt, the harness salvages readable content with SQLite's recovery tool, or restores the newest good backup, then replays knowledge from the `harness-state` history and accepted work from Git trailers, parks in-flight work at its checkpoint refs, and shows a recovery report ([database design §8](database-design.md#8--migrations-and-corruption)).

**Parked work across versions.** Checkpoints, briefs, prompts and skills are stored with their own format version and content digest. A parked task resumes with the **prompt and skill versions it started with**. New versions apply to the next attempt. Old checkpoint formats are converted by small “upcaster” functions when read, never rewritten in place.

**Provider policy file.** A separately signed JSON file (provider routes, minimum CLI versions, model roster defaults) is checked daily. Changes apply to new dispatches. Only a *route revoked* entry (e.g. a provider banned a login route) affects running work, and it parks affected tasks at their next boundary with an explanation.

**Foreign agent CLIs** (Codex, Claude Code, Gemini CLI, Copilot CLI) are updated by their own installers. When the daemon sees a new version, it runs the [adapter conformance suite](agent-runtime-adapters.md#adapter-conformance-suite) before giving that runtime new tasks.

## Technology stack

| Layer | Choice | Reason |
|---|---|---|
| Shell | Electron (current stable) | Embedded Chromium for the App preview and canvas; mature Windows tooling |
| UI | React, TypeScript, React Flow + ELK, PixiJS | Matches the canvas and office designs |
| Daemon | TypeScript on the Electron-bundled Node runtime | One language across kernel and UI |
| Database | SQLite through `node:sqlite` (built into Node, no native rebuilds), behind a small driver interface with `better-sqlite3` as fallback | Avoids native-module ABI problems between Node and Electron |
| Search | SQLite FTS5 | Built in; enough for the knowledge base |
| Git | Bundled MinGit command line (not a library) | Exact Git behavior, including worktrees and `merge-tree` |
| Agent protocols | ACP TypeScript SDK, MCP TypeScript SDK, vendor SDKs | Official clients |
| Browser tests | Playwright | Locators and ARIA snapshots ([verification for real apps](verification-for-real-apps.md)) |
| Packaging | electron-builder (NSIS), signed | Differential updates |

Exact versions live in a stack manifest checked by CI; Electron and Node versions move together.

## Observability and diagnostics

| Signal | Where | Content |
|---|---|---|
| Structured logs | `%LOCALAPPDATA%\EFHarness\logs\*.jsonl`, rotated, 14 days | Every process; secret values redacted before writing |
| Traces | Local trace store, span per transaction, attempt, model call, tool call, Git operation, verification | Trace IDs tie a model call to its task, attempt, cost and outcome |
| Metrics | Health page: queue lengths, rate-limit events, model latency, verifier time, sandbox denials, database write latency | Live and last 24 h |
| Crash dumps | Local only | — |
| Diagnostics bundle | Help → Export diagnostics | Logs, traces, versions, settings and sandbox log for a chosen time range, run through the redactor, previewed before saving |

Nothing is sent anywhere unless the developer exports and shares it. Optional opt-in crash reporting can be added later.

## Edge cases

| Situation | Behavior |
|---|---|
| Two Windows users on one PC | Each has their own daemon, pipe, data folder and sandbox identities. |
| Daemon is running an older version after an update | The new app detects the version mismatch, asks the daemon to park and exit, then starts the new daemon. |
| Disk nearly full | Warning at 15 GB free, no new dispatch at 5 GB, Pause all at 2 GB ([hardware governor](app-shell-and-governor.md#hardware-governor)); the cockpit shows what can be cleaned. |
| Antivirus quarantines a bundled binary | Component check fails with the file name; Settings offers repair (re-download and verify). |
| The developer moves the data folder | Settings → Storage; the daemon parks work, moves files, repairs worktree paths. |

[Diagram](desktop-app.svg) · [Editable Mermaid](desktop-app.mmd) · [Sandbox and security](sandbox-and-security.md) · [Projects, portability and sync](projects-portability-and-sync.md) · [Coordinator and recovery](coordinator-and-recovery.md) · [Research](research/desktop-app-shell.md)
