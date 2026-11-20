# Task 002 spike verdict

Decision for Task 012: **go**.

`node:sqlite` works inside Electron 45.3.4 (Node 24.22.3, SQLite 3.54.1) with WAL, FTS5, `VACUUM INTO`, and 67/67 schema scenarios on both `:memory:` and on-disk WAL databases. The same suite passed on system Node 24.16.0 (SQLite 3.53.0).

## Runtimes

| Runtime | Electron | Node | SQLite |
| --- | --- | --- | --- |
| system Node | none | 24.16.0 | 3.53.0 |
| Electron `ELECTRON_RUN_AS_NODE=1` | 45.3.4 | 24.22.3 | 3.54.1 |

## Pass/fail matrix

| Check | System Node | Electron |
| --- | --- | --- |
| `runtime-identity` | pass: runtime=node electron=none node=24.16.0 | pass: runtime=electron electron=45.3.4 node=24.22.3 |
| `sqlite-version` | pass: 3.53.0 meets minimum 3.43 and target 3.53 | pass: 3.54.1 meets minimum 3.43 and target 3.53 |
| `constructor-options` | pass: explicit undefined options throw ERR_INVALID_ARG_TYPE; omitting options opens the database | pass: explicit undefined options throw ERR_INVALID_ARG_TYPE; omitting options opens the database |
| `harness-pragmas` | pass: journal_mode=wal synchronous=2 foreign_keys=1 busy_timeout=5000 secure_delete=1 journal_size_limit=67108864 temp_store=2 | pass: journal_mode=wal synchronous=2 foreign_keys=1 busy_timeout=5000 secure_delete=1 journal_size_limit=67108864 temp_store=2 |
| `sql-features` | pass: STRICT WITHOUT ROWID VIRTUAL RETURNING AUTOINCREMENT json_each DEFERRABLE | pass: STRICT WITHOUT ROWID VIRTUAL RETURNING AUTOINCREMENT json_each DEFERRABLE |
| `named-parameter-prefixes` | pass: prefixes=: @ $ bareDefault=accepted bareOff=rejected unknown=rejected queries=45 | pass: prefixes=: @ $ bareDefault=accepted bareOff=rejected unknown=rejected queries=45 |
| `bigint` | pass: default read throws; readBigInts returns bigint | pass: default read throws; readBigInts returns bigint |
| `begin-immediate` | pass: deferredBegin=rejected busyErrcode=5 | pass: deferredBegin=rejected busyErrcode=5 |
| `schema-suite-memory` | pass: 67/67 SQLite 3.53.0 storage=memory skipped=0 | pass: 67/67 SQLite 3.54.1 storage=memory skipped=0 |
| `schema-suite-wal` | pass: 67/67 SQLite 3.53.0 walFiles=4 skipped=0 | pass: 67/67 SQLite 3.54.1 walFiles=4 skipped=0 |
| `fts-contentless-trap` | pass: contentlessLike=0 externalLike=C-014 | pass: contentlessLike=0 externalLike=C-014 |
| `fts-unicode` | pass: cafe naive camel snake stored=emoji+eszett strasseHits=0 emojiHits=0 | pass: cafe naive camel snake stored=emoji+eszett strasseHits=0 emojiHits=0 |
| `fts-vacuum` | pass: VACUUM and VACUUM INTO kept external FTS and contentless LIKE stayed empty | pass: VACUUM and VACUUM INTO kept external FTS and contentless LIKE stayed empty |
| `iterator-checkpoint` | pass: openIterator=SQLITE_LOCKED 6; return() released PASSIVE RESTART TRUNCATE | pass: openIterator=SQLITE_LOCKED 6; return() released PASSIVE RESTART TRUNCATE |
| `data-version` | pass: same=2->2 other=3 | pass: same=2->2 other=3 |
| `vacuum-into-concurrent` | pass: bytes=59006976 vacuumIntoMs=775 quickCheckMs=78 integrityCheckMs=64 rows=12802 | pass: bytes=59006976 vacuumIntoMs=876 quickCheckMs=69 integrityCheckMs=57 rows=12802 |
| `vacuum-into-destination` | pass: existing destination preserved; partial file removed; fresh copy passed quick_check | pass: existing destination preserved; partial file removed; fresh copy passed quick_check |
| `worker-terminate` | pass: terminateMs=3 PASSIVE=2ms RESTART=0ms TRUNCATE=0ms handlesReleased=yes | pass: terminateMs=3 PASSIVE=7ms RESTART=0ms TRUNCATE=8ms handlesReleased=yes |
| `worker-inflight-call` | pass: inFlightTerminateMs=281 (sqlite3_interrupt is not exposed; terminate waits for the current call) | pass: inFlightTerminateMs=327 (sqlite3_interrupt is not exposed; terminate waits for the current call) |
| `driver-parity` | pass: equal=yes nodeMs=15 fallbackMs=20 sample={"count":1000,"name":"row-0","length":5,"mode":"wal"} | pass: equal=yes nodeMs=12 fallbackMs=24 sample={"count":1000,"name":"row-0","length":5,"mode":"wal"} |
| `native-addons` | pass: nativeAddons=0 better-sqlite3=unresolved | pass: nativeAddons=0 better-sqlite3=unresolved |

## VACUUM INTO

Synthetic database seed `20261119`, 12800 rows, 4096-byte payloads.
System Node copy took 775 ms and was 59006976 bytes. quick_check 78 ms, integrity_check 64 ms.
Electron copy took 876 ms and was 59006976 bytes. quick_check 69 ms, integrity_check 57 ms.

## Driver benchmark

The `SqliteDriver` surface (`beginImmediate`, `savepoint`, `prepare`, `pragma`, `registerFunction`, `close`) produced identical results on `node:sqlite` (15 ms) and the `better-sqlite3`-shaped fallback (20 ms).
Electron parity was identical (`node:sqlite` 12 ms, fallback 24 ms).
Native `.node` addons loaded by the default path: system Node 0, Electron 0. `better-sqlite3` was not resolved.

## Quirks for Task 012

- `allowBareNamedParameters` defaults to accepting bare keys for `:name` parameters (default-accepts-bare-and-prefixed on Node, default-accepts-bare-and-prefixed on Electron). `schema/queries.sql` binds that way. Setting the option false rejects bare keys and still accepts `:name`, `@name`, and `$name`. Unknown names throw.
- `node:sqlite` sets a function's arity from `function.length`. A rest wrapper has length 0, so the driver registers functions with `varargs: true`.
- Integers above `Number.MAX_SAFE_INTEGER` throws-unless-readBigInts on read. Opt in with `readBigInts: true` per statement. Do not enable it for every query: every integer would come back as `bigint`.
- `new DatabaseSync(path, undefined)` throws `ERR_INVALID_ARG_TYPE`. Omit the options argument when there is nothing to set.
- `PRAGMA synchronous = FULL`, `PRAGMA foreign_keys = ON`, and `PRAGMA temp_store = MEMORY` return no rows from `prepare().all()`. `PRAGMA journal_mode = WAL` does. The driver reads the pragma name back after an empty assignment.
- `PRAGMA data_version` is unchanged for a write on the same connection. A second connection's commit changes it. That is the signal for a foreign writer.
- Contentless trigram `LIKE` returned 0 rows on Node and 0 on Electron. `kb_ident` has to stay external content (`content='nodes'`).
- An unexhausted statement iterator fails `wal_checkpoint` with errcode 6 (`SQLITE_LOCKED` is 6). Calling the iterator's `return()` releases `PASSIVE`, `RESTART`, and `TRUNCATE`.
- A second `beginImmediate()` while the writer holds the lock fails with errcode 5 (`SQLITE_BUSY` is 5). The driver rejects `BEGIN` and `BEGIN DEFERRED` so a deferred read cannot upgrade into that error on the first write.
- Chunked read-only work yields between SQLite calls, then `worker.terminate()` 200ms after the reader starts returned in 3 ms on Node and 3 ms on Electron. `wal_checkpoint(TRUNCATE)` then finished in 0 ms and 8 ms. The temp directory was removed with `fs.rmSync`. A tight synchronous loop is not a reliable cancellation point on Windows: `terminate()` can wait until the thread leaves the current native call.
- One in-flight recursive query delayed `worker.terminate()` by 281 ms on Node and 327 ms on Electron. `node:sqlite` does not expose `sqlite3_interrupt`, so cancellation has to happen between SQLite calls.
- `VACUUM INTO` fails with `output file already exists` and must not replace a previous backup. Write a unique partial file, rename it only after success, and delete the partial file if the copy throws.

## Recommendation

Go. Implement the kernel driver from `spikes/node-sqlite-electron/driver.ts`. Keep `node:sqlite` as the default. Do not load `better-sqlite3` unless a future platform has no `node:sqlite`. Register `ef_search_text` before opening `state.sql`. Apply the harness pragmas from `schema/state.sql`. Use `BEGIN IMMEDIATE` for every write transaction. Keep `kb_ident` external-content with the trigram tokenizer.
