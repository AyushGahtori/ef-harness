# Pass 05 — Chunk 002 Audit Report (Worker Inspector, Calm Inbox, Budget Wind-Down & Stop Card, Desktop Lifecycle, Component Downloader/Updater & Diagnostics — `Tasks 126–128, 131–133`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-002`
- **Units Audited (6):**
  - `Task 126` (`task/126-worker-inspector-panel` @ `3dce5cd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-126-worker-inspector-panel`, unmerged, clean)
  - `Task 127` (`task/127-calm-notification-inbox-ui` @ `5b91291`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-127-calm-notification-inbox-ui`, unmerged, clean)
  - `Task 128` (`task/128-budget-winddown-stop-card-wip` @ `a8ca2fd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-128-budget-winddown-stop-card-wip`, unmerged, clean)
  - `Task 131` (`task/131-electron-desktop-lifecycle` @ `304c4e7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-131-electron-desktop-lifecycle`, unmerged, clean)
  - `Task 132` (`task/132-component-downloader-park-updater` @ `f89dbc1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-132-component-downloader-park-updater`, unmerged, clean)
  - `Task 133` (`task/133-diagnostics-health-bundle-exporter` @ `ab4387b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-133-diagnostics-health-bundle-exporter`, unmerged, clean)
- **Governing Architecture Documents:** `build-cockpit.md`, `stops-undo-and-reentry.md`, `desktop-app.md`, `app-shell-and-governor.md`, `database-design.md`, `kernel-schema-and-protocol.md`, `schema/state.sql`, `schema/telemetry.sql`, `desktop-app.mmd`, `stops-undo-and-reentry.mmd`.

## 2. Files Directly Inspected
- `apps/renderer/src/cockpit/inspector/{ports.ts,credit-stream.ts}` (`Task 126`)
- `apps/renderer/src/cockpit/inbox/{ports.ts,cards.ts}` (`Task 127`)
- `packages/steering/src/budget-stops/{controller.ts,ledger.ts,stop-events.ts,exporter.ts}` (`Task 128`)
- `apps/daemon/src/lifecycle/sqlite-wal.ts` + `apps/desktop/src/lifecycle/electron-binding.ts` (`Task 131`)
- `apps/daemon/src/components/signed-component-downloader.ts` + `apps/desktop/src/updater/park-first-auto-updater.ts` (`Task 132`)
- `apps/daemon/src/diagnostics/{telemetry-db.ts,bundle-exporter.ts}` (`Task 133`)

## 3. Verified Local Strengths
- `WorkerInspectorPanel` (`126`) implements 5 tabs (`Timeline`, lazy 64 KB `Diff`, `Checks` without leaking active sealed-check source, historical `sliceSha256` `Brief`, and opt-in `Raw Stream` with auto-scroll pause on scroll-up) plus `AbortController` cancellation on rapid worker switching.
- `CalmInboxPanel` (`127`) implements the 3-tier cadence (`Interrupt-Now`, `10-min` batch with critical-path/`>= 2` subscriber early flush, `FYI Digest` excluded from actionable badge count), Focus Mode suppression, and all 6 canonical card types (`Decision`, `Secret` with zero chat/SQLite leak, `Tool`, `Account`, `Approval`, grouped `Review`).
- `BudgetWindDownController` & `WipBranchHandoffExporter` (`128`) enforce `50% / 80% / 90% / 100%` wind-down across `micro-USD` and `ppm`, atomic pre-reservation ceiling guards, all 6 Stop Card recovery actions, and non-destructive `wip/<slug>-<date>` Git worktree + `HANDOFF.md` export without moving `main` or `harness/integration`.
- `DesktopLifecycleCoordinator` & `DaemonShutdownCoordinator` (`131`) implement the 3-choice Quit-While-Building dialog, dialog-free idle quit, `powerMonitor` suspend/resume/shutdown hooks, opt-in `powerSaveBlocker` auto-release, single-instance lock, and renderer crash survival.
- `SignedComponentDownloader` & `ParkFirstAutoUpdater` (`132`) verify pinned Ed25519 manifest signatures before HTTP `Range` download, check `freeBytes - 2 * size >= 5 GB`, verify SHA-256 before atomic staging swap, detect AV quarantine deletions, and enforce park-first checkpoint + WAL flush + backup before `quitAndInstall`.
- `RedactedDiagnosticsBundleExporter` (`133`) enforces a strict 6-file allowlist (excluding source code, prompts, diffs, and secrets), scrubs tokens + `C:\Users\<Name>` paths, guarantees byte-for-byte Preview-equals-Zip parity, and enforces `<= 10` / `<= 50 MB` local-only crash-dump retention.

## 4. Local Implementation Defects Discovered
1. **`CreditLimitedStream` Throws Instead of Queuing at Credit Limit (`Task 126` `apps/renderer/src/cockpit/inspector/credit-stream.ts:44-48` — `F-065`):** When `this.outstanding >= INITIAL_STREAM_CREDITS`, `run()` immediately throws `RangeLimitError("stream credits exhausted")` instead of queuing pending range fetches until an in-flight chunk completes and replenishes a credit.
2. **`rebuildTelemetryDatabase` Unlinks Open SQLite WAL Files Without Closing Daemon Handle (`Task 133` `apps/daemon/src/diagnostics/telemetry-db.ts:47-56` — `F-066`):** Calls `rmSync` directly on `telemetry.db`, `-wal`, and `-shm` without coordinating with `Task 014` `TelemetryDb`'s active writer handle, causing Windows `EBUSY`/`EPERM` file-lock errors or WAL handle corruption.

## 5. Cross-Unit Contract & Seam Mismatches
1. **`Task 128` (`budget-stops`) Disconnected from `023` `BudgetLedgerRepo`, `036`/`039` `git-engine`, `140` `AllowancePacingController`, and `schema/state.sql` (`F-065`):**
   - `StopEventStore` (`stop-events.ts:29-36`) opens a standalone `DatabaseSync` and creates an out-of-schema `stop_events` table instead of using `@ef-harness/db` `CoordinatorWriteQueue` + `MigrationRunner` v2 migration.
   - `AtomicBudgetReservationLedger` (`ledger.ts:27-39`) is a volatile in-memory map disconnected from `Task 023` `BudgetLedgerRepo` (`state.db.budget_ledger`) and `Task 140` `GlobalConnectionWindowRepo` (`global.db.connection_windows`).
   - `WipBranchHandoffExporter` (`exporter.ts:4,37-61`) spawns host `git` directly via `git-repo.ts` instead of `Task 036` pinned `MinGit` + `Task 039` `GitRefCasUpdater`.
2. **`126` (`Inspector`) & `127` (`Inbox`) Method/IPC Mismatches Against `029`, `033`, `088`, `109`, `116`, `120`, `121` (`F-065`):**
   - `126` expects RPC methods `locateLineWindow` (`029` `SeekableZstdLogReader` has no `locateLineWindow`), `pinnedManifest`/`previewManifest` (`088` `ContextSlicerEngine` has `sliceForTask`), and `readsForAttempt` (`109` `ArtifactHandoffStore` has `readResult`), none of which are registered on `apps/daemon` IPC (`031`/`033`/`066`).
   - `127` calls `StaleReplyReconciler.receive(card, reply)` (`116` exposes `reconcile(...)` on daemon side), `HumanStepProbePort.checkAgain(stepId)` (`121` exposes `verify`/`runProbe`), and `PreloadSecretIpc.put({ projectId, envScope, name, value })` (`120` uses `secretName`/`plaintext`).
3. **`131`, `132`, `133` Unwired from `apps/daemon` (`066`) & `apps/desktop` (`067`) + Missing `electron-updater` & `reconcileAfterWake` (`F-066`):**
   - Neither `apps/daemon/src/index.ts` nor `apps/desktop/src/main.ts` wires `131` (`lifecycle`), `132` (`components`/`updater`), or `133` (`diagnostics`).
   - `131` uses an HTTP-like `/lifecycle/shutdown` router instead of `NamedPipeServer` (`031`) RPCs and calls nonexistent `reconcileAfterWake()` on `Task 130` `ColdOpenReconciler` (`reconcile()`).
   - `132` omits `electron-updater` from `apps/desktop/package.json` and leaves `CheckpointSchemaUpcasterRegistry` unwired from `015` `MigrationRunner` and `053`/`150` checkpoint loaders.

## 6. Shared-File & Ownership Conflicts
- `packages/steering/src/index.ts` must export `budget-stops` (`128`) alongside `113`–`116` and `130`.
- `apps/daemon/src/index.ts` (`066`), `apps/desktop/src/main.ts` (`067`), and `apps/renderer/src/index.ts` (`122`) must mount `126`, `127`, `128`, `131`, `132`, and `133`.

## 7. Runtime Wiring Gaps
- Register daemon IPC handlers for Inspector range queries (`126` → `029`/`033`/`088`/`109`), Inbox actions (`127` → `116`/`120`/`121`/`176`), Stop Card recovery actions (`128` → `023`/`039`/`114`/`140`), Desktop lifecycle/sleep/shutdown (`131` → `020`/`066`/`067`/`118`/`125`/`130`), Component downloads & Park-First updates (`132` → `015`/`016`/`118`/`131`), and Diagnostics self-checks & `.zip` bundle export (`133` → `011`/`014`/`028`/`117`).

## 8. Architecture & Security Violations
- `F-065`: `StopEventStore` (`128`) opens a rogue `DatabaseSync` writer on `state.db`, and `WipBranchHandoffExporter` (`128`) spawns host `PATH` `git` instead of pinned `MinGit` (`036`).
- `F-066`: `telemetry-db.ts` (`133`) unlinks live SQLite WAL files outside `@ef-harness/db` `TelemetryDb` (`014`).

## 9. Test Coverage & Verification Gaps
- Unit tests in `126`–`128` and `131`–`133` use in-memory/mock ports (`MemoryPorts`, `RecordingSqlite`, mock `ElectronUpdaterPort`); there are no integration tests wiring `131`+`132` into `067` `apps/desktop` or `126`+`127`+`128` into `122` `SingleAppShell`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-065` (`HIGH`):** `WorkerInspectorPanel` (`126`), `CalmInboxPanel` (`127`) & `BudgetWindDownController` (`128`) Credit-Exhaustion Throw Bug, Rogue `stop_events` SQLite Writer, Volatile `AtomicBudgetReservationLedger`, Host `git` Spawn & Upstream RPC/Method Mismatches.
- **`F-066` (`HIGH`):** Desktop Lifecycle (`131`), Component Downloader & Auto-Updater (`132`) & Diagnostics (`133`) Unwired from `apps/daemon`/`apps/desktop`, Missing `electron-updater`, Nonexistent `reconcileAfterWake`, and Live `telemetry.db` WAL Unlink Race.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`126, 127, 128, 131, 132, 133`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] Cross-checked against `011, 014–016, 020, 023, 028, 029, 031, 033, 036, 039, 066, 067, 088, 109, 114, 116–122, 130, 140`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-065`–`F-066`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-003`: `Tasks 153–156, 159` (`apps/renderer` Canvas React Flow + ELK.js `153`, popovers/multi-select `154`, Single Composer `155`, Canvas box-chat & structural edits `156`, Spec Browser & Plan Tree `159`).
