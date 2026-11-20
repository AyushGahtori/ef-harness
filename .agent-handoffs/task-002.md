---
task_id: "Task-002"
branch: "task/002-spike-node-sqlite-electron"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "spikes/node-sqlite-electron/**"
  - "spikes/tests/node-sqlite-electron.test.ts"
  - ".agent-handoffs/task-002.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 002 handoff

Spike verdict for Task 012: **go**. `node:sqlite` works in Electron 45.3.4 (Node 24.22.3, SQLite 3.54.1) and on system Node 24.16.0 (SQLite 3.53.0). Both are above the 3.43 minimum and the 3.53 target. WAL, FTS5, `VACUUM INTO`, and the 67 schema scenarios passed on `:memory:` and on-disk WAL files. Details are in `spikes/node-sqlite-electron/report.json` and `spikes/node-sqlite-electron/REPORT.md`.

Commit stays on `task/002-spike-node-sqlite-electron`.

## Exports Provided

No package barrel is wired. Task 012 should copy the contract from `spikes/node-sqlite-electron/driver.ts` into `packages/db`:

- `SqliteDriver` with `beginImmediate()`, `savepoint()`, `prepare()`, `pragma()`, `registerFunction()`, and `close()`
- `openNodeSqliteDriver()` for the default `node:sqlite` path
- `openBetterSqlite3Driver()` plus `BetterSqliteVendor` for a future fallback that does not leak `DatabaseSync`
- `HARNESS_PRAGMAS` matching the connection settings at the top of `schema/state.sql`

## Shared Wiring Needs (Root / Index Barrels)

No root manifest, lockfile, or `packages/shared-contracts/src/index.ts` edit.

`spikes/vitest.config.ts` is frozen and only includes `tests/**/*.test.ts`. The mandated command passes `node-sqlite-electron` as a Vitest filename filter, so the suite is invisible unless a file under `spikes/tests/` contains that name. `spikes/tests/node-sqlite-electron.test.ts` is a one-line side-effect import of the spike test. The assertions themselves stay in `spikes/node-sqlite-electron/`.

## Dependency Intents (New Packages Requested)

None. Do not add `better-sqlite3`. The default path loaded zero native `.node` addons on Node and on Electron, and `better-sqlite3` did not resolve. The fallback adapter was parity-tested against an in-process vendor with the same method results.

## Contract Change Requests

None for this integration. Task 012 owns the driver implementation under `packages/db`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-002-spike-node-sqlite-electron`:

- `node --disable-warning=ExperimentalWarning spikes/node-sqlite-electron/run-spike.ts` — exit 0, `all checks passed`. Decision `go` on system Node 24.16.0 / SQLite 3.53.0 and Electron 45.3.4 / Node 24.22.3 / SQLite 3.54.1. Schema suite 67/67 on `:memory:` and on-disk WAL in both runtimes. Concurrent `VACUUM INTO` of the ~59 MB synthetic database passed `quick_check` and `integrity_check`. Chunked worker termination unblocked `wal_checkpoint(TRUNCATE)` in well under 500 ms and `fs.rmSync` removed the temp directory. Exact samples are in `REPORT.md`.
- `pnpm --filter @ef-harness/spikes test -- node-sqlite-electron` — exit 0. Vitest 5.1.1: `Test Files 1 passed (1)`, `Tests 1 passed (1)`, duration 32.27s. A later harmony run repeats this test.
- `pnpm exec eslint spikes/node-sqlite-electron/**/*.{ts,mjs} spikes/tests/node-sqlite-electron.test.ts` — exit 0.
- `node scripts/verify-harmony.mjs --task 002` — exit 0, `harmony ok for Task-002`. That run repeated typecheck, lint, the workspace tests (including the spike filter via `pnpm test`), schema 67/67, and the owned-path check.

## Known Limitations / Follow-Ups

Task 012 quirks, measured in this spike:

- `allowBareNamedParameters` defaults to true. Bare keys bind `:name`, and so do `:name`, `@name`, and `$name`. All 45 `-- name:` queries in `schema/queries.sql` accept both bare and prefixed `:name` bindings. Setting the option false rejects bare keys. Unknown names throw.
- Integers above `Number.MAX_SAFE_INTEGER` throw on read unless the statement is prepared with `readBigInts: true`, which returns `bigint`. Leave the default off so ordinary integers stay numbers.
- `new DatabaseSync(path, undefined)` throws `ERR_INVALID_ARG_TYPE`. Omit the options argument when there is nothing to set.
- `PRAGMA synchronous = FULL`, `PRAGMA foreign_keys = ON`, and `PRAGMA temp_store = MEMORY` return no rows from `prepare().all()`. `PRAGMA journal_mode = WAL` does. The driver reads the name back after an empty assignment.
- `PRAGMA data_version` does not change for a write on the same connection. Another connection's commit changes it.
- Contentless trigram `LIKE '%C-01%'` returns 0 rows. `kb_ident` must stay external content (`content='nodes'`, `content_rowid='nid'`, trigram). `unicode61 remove_diacritics 2` matches `cafe` to `Café` and `naive` to `naïve`. `straße` and emoji are stored, and they are not FTS word hits (`strasseHits=0`, `emojiHits=0`).
- An unexhausted iterator makes `wal_checkpoint` throw errcode 6 (`SQLITE_LOCKED`). `iterator.return()` releases `PASSIVE`, `RESTART`, and `TRUNCATE`.
- `beginImmediate()` while another writer holds the lock fails with errcode 5 (`SQLITE_BUSY`). The driver rejects a statement whose first keyword is `BEGIN` unless it is `BEGIN IMMEDIATE`. Trigger `BEGIN` bodies in `schema/state.sql` are not transactions.
- `node:sqlite` sets function arity from `function.length`. The driver passes `varargs: true` because its wrapper uses a rest parameter.
- `worker.terminate()` does not expose `sqlite3_interrupt`. One in-flight recursive query delayed terminate by several hundred milliseconds (about 0.3–1.2 s in the runs above). A tight synchronous loop can also delay cancellation on Windows. The reader yields between calls; terminate then returned within a few milliseconds and `wal_checkpoint(TRUNCATE)` finished well under 500 ms, and `fs.rmSync` removed the temp directory.
- `VACUUM INTO` throws `output file already exists` and must not replace a prior backup. The helper writes a unique partial file, renames it only after success, and deletes the partial file on failure.
- `ß` is not folded to `ss` by `remove_diacritics 2`. Emoji is stored and is not a `unicode61` word token.
