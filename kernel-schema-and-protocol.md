# Kernel storage, artifact store and window protocol

Milestone M0 ([roadmap](roadmap.md)) builds the kernel skeleton. This document fixes what it needs: the database files and their roles, how large files are stored and cleaned up, and the protocol between the window and the daemon. The full schema and its decisions are in [database design](database-design.md). The rules these structures enforce are in [knowledge database](knowledge-database.md). Research: [kernel storage and IPC](research/kernel-storage-and-ipc.md).

## Decisions in plain words

1. **Current state and history are separate tables.** Hot queries read small current-state tables; immutable history sits beside them and is read only for audits and reconstruction.
2. **Every claim, transition and reservation is one conditional statement** checked by the number of rows changed, inside a `BEGIN IMMEDIATE` transaction on the single writer.
3. **Large content never lives in SQLite.** Logs, traces, screenshots, diffs and fetched pages are content-addressed files; the database stores their hashes and who references them.
4. **The window talks to the daemon with JSON-RPC over a named pipe,** with numbered events so a reconnecting window replays exactly what it missed, and a separate binary stream channel for big content.

## Files on disk

```
%LOCALAPPDATA%\EFHarness\
├── global.db                      connections, windows, grants, CAS pins, ports, machine profile, research cache, settings
├── projects\<project-id>\
│   ├── state.db                   knowledge, runtime, ledger, outbox for one project
│   ├── telemetry.db               high-rate progress and metrics (lossy, 14 days)
│   ├── code-index.db              Tree-sitter symbols and ranking (rebuildable)
│   ├── backups\                   VACUUM INTO copies: hourly (24), daily (7), pre-migration
│   └── envs\                      embedded database clusters and service data (test environments)
├── cas\sha256\ab\cd\<hash>.zst    content-addressed blobs (zstd or seekable zstd), shared by all projects
├── wt\<project-id>\<slot>\        reusable worktree slots
├── components\                    Whisper models, browsers, service binaries
└── logs\
```

## Databases

The complete schema is executable SQL under [`schema/`](schema/state.sql), with its decisions in [database design](database-design.md) and a scenario test suite (`node schema/schema-test.js`). The earlier DDL in this document is superseded by those files.

| File | Main groups |
|---|---|
| `state.db` | Knowledge (`nodes`, temporal `node_versions` and `edges`, per-type `edge_set_versions`, `change_sets`); views (`requirements`, `task_requirements`, `check_requirements`, `waivers`); search (`kb_words`, `kb_ident`); runtime (`task_runtime`, `task_holds`, `attempts`, `turn_log`, `read_sets`, `candidates`, `check_results`); ledger in integer units (`budgets`, `reservations`, `reservation_scopes`, `grant_receipts`); `outbox`; trigger-maintained rollups; names, inbox, effects, leases, evidence, artifacts, redactions |
| `global.db` | `projects`, `connections`, `connection_windows`, `grants`, `port_leases`, `cas_blobs`, `cas_pins`, `machine_profile`, `footprints`, `research_cache`, `vocabulary`, `settings` |
| `telemetry.db` | Progress, tokens, heartbeats, health metrics; never in a transaction with `state.db` |
| `code-index.db` | Symbols, references and file ranking keyed by file hash and commit |

Each file has exactly one writer. `state.db` and `global.db` never share a transaction; they exchange idempotent grant messages ([database design §3](database-design.md#3--global-and-project-databases-never-share-a-transaction)).

## Write-path performance

The target from [knowledge database](knowledge-database.md#is-one-writer-fast-enough-with-20-workers) is p99 under 50 ms with 50 simulated workers. The design gets there by:

- Keeping write transactions to a handful of indexed statements (claims, receipts, reservations).
- Group commit for task transitions and receipts; knowledge change sets run alone.
- Doing traversal, exports and verification outside the write lock, on reader threads with time budgets.
- Writing high-volume streams to `telemetry.db`, never to `state.db`.

The outbox stays in `state.db`, because it must commit atomically with the state it describes.

## Content-addressed store and cleanup

- Blobs are stored once by SHA-256 of their uncompressed content, compressed with zstd; text artifacts over 1 MB use the seekable zstd format with a sidecar line index so ranges are read without decompressing everything.
- **A blob is deleted only when `cas_pins` in `global.db` holds no pin for it**, past a 7-day grace period. Projects pin before recording an artifact; backups and the research cache register their own pins. Pins survive offline projects and unplugged drives.
- **Retention classes:**

| Class | Examples | Kept |
|---|---|---|
| `evidence` | Logs and traces cited by an accepted receipt; final screenshots | Project lifetime |
| `diagnostic` | Traces of failed or superseded attempts | 14 days after the attempt ends |
| `ephemeral` | Intermediate command output | 3 days |
| `asset` | Brand files, imported documents | Until removed by the developer |
| research | Fetched documentation | Until the cache entry expires or the package version changes |

- Expired retention removes a project's pin; the blob goes only when no other holder pins it. A storage cap (default 10 GB) evicts the oldest `diagnostic` pins first.
- Writes go through a temp file and a rename with retries for antivirus locks; `evidence` and `asset` blobs are hash-verified on read ([database design §7](database-design.md#7--shared-blob-store)).

## Window ↔ daemon protocol

```
Renderer (React) ⇄ MessagePort ⇄ pipe client (Electron utility process) ⇄ \\.\pipe\efharness-<user> ⇄ harnessd
```

The renderer never blocks on the pipe: a utility process owns the connection and hands the renderer a `MessagePort`, transferring binary data without copying.

### Framing

Each frame: 4-byte length, 1-byte channel (`0` = JSON-RPC, `1` = binary stream), 4-byte stream ID (channel 1), payload. JSON-RPC 2.0 for requests, responses and notifications.

### Session

| Message | Purpose |
|---|---|
| `session.hello {token, protocol: "1.x", client}` | First message; per-session token from the user profile; the daemon supports the current and previous minor protocol versions |
| `session.ping` | Liveness |

### Requests (examples by area)

| Area | Methods |
|---|---|
| Project | `project.list`, `project.open`, `project.close` |
| Discovery | `chat.send {target, text, clauses}`, `question.answer`, `batch.accept` |
| Knowledge | `node.get`, `node.search`, `graph.view {view, filter}`, `impact.preview {change}` |
| Plan and build | `plan.preview`, `build.start`, `build.pauseAll`, `build.stop`, `task.retry`, `task.takeOver` |
| Inbox | `inbox.list`, `inbox.resolve` |
| Artifacts | `artifact.open {id, range?}` → stream ID, `diff.get {task, file, hunks?}` |
| Environment | `preview.start`, `preview.url` |
| Settings and diagnostics | `settings.get/set`, `diag.export` |

Every mutating request carries an `op_id`; the daemon returns the stored result for a repeated `op_id`.

### Live events without gaps or duplicates

1. `events.subscribe {project, topics, since_seq}` → the daemon replays domain events after `since_seq` from the outbox, then streams new ones as `events.batch {from_seq, to_seq, events}` notifications.
2. The window applies an event only if its `seq` equals `last_applied + 1`. A lower `seq` is a duplicate and ignored; a higher one means a gap, so the window resubscribes from `last_applied`.
3. If the requested `since_seq` is older than the retained outbox (default: 7 days, and never an event some consumer hasn't acknowledged), or the project's `stream_epoch` changed (for example after rehydration on another machine), the daemon answers `resync_required`; the window calls `snapshot.get {project, views}`, which returns the current view state with its `as_of_seq` (at most 2 MB per view section, paginated), then subscribes from there.
4. Telemetry (progress lines, token counts) arrives as `telemetry` notifications without sequence numbers. Missing one only loses detail, never state.

UI state is therefore always “snapshot + events after it”, the same model the Board and Office use.

### Large content

- `artifact.open` returns a stream ID; content flows on channel 1 in 64 KB chunks with credit-based flow control (the client grants chunk credits), so a 200 MB trace never floods the pipe.
- Diffs and logs are fetched by range: the diff viewer requests only visible hunks; the log viewer tails or seeks.
- Requests have size limits (1 MB JSON); anything larger must be an artifact.

## Edge cases

| Situation | Behavior |
|---|---|
| The window reconnects after the daemon restarted | `seq` continues from the database; replay or resync as above. |
| Two windows open the same project | Both subscribe; mutating requests are serialized by the coordinator like any others. |
| A schema migration adds a column used by the window | Protocol minor version bump; old windows ignore unknown fields. |
| The CAS folder is deleted by the user | Referenced evidence is reported missing in affected receipts; nothing else breaks; verification can be rerun. |

[Knowledge database](knowledge-database.md) · [Desktop app](desktop-app.md) · [Coordinator and recovery](coordinator-and-recovery.md) · [Research](research/kernel-storage-and-ipc.md)
