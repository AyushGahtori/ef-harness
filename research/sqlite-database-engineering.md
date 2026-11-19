# Research: SQLite engineering for the harness databases

Question: which SQLite behaviors decide the schema's correctness (atomicity across files, rowid stability, full-text search options, checkpoints, migrations, recovery), and what supporting techniques handle blobs, logs and export? Design: [database design](../database-design.md). All schema statements were executed in Node 24's built-in `node:sqlite` (SQLite 3.53) by [schema/schema-test.js](../schema/schema-test.js): 67 scenarios pass.

## Atomicity across files

“Transactions involving multiple attached databases are atomic, assuming that the main database is not ':memory:' and the journal_mode is not WAL. If … the journal_mode is WAL, then transactions continue to be atomic within each individual database file. But if the host computer crashes in the middle of a COMMIT where two or more database files are updated, some of those files might get the changes where others might not.” [ATTACH](https://www.sqlite.org/lang_attach.html)

**Consequence:** `global.db` and `state.db` exchange idempotent messages (grant issue, deposit, closure) instead of sharing a transaction.

## Keys and history

| Fact | Source | Use |
|---|---|---|
| `VACUUM` may change rowids of tables without an explicit `INTEGER PRIMARY KEY` | [VACUUM](https://www.sqlite.org/lang_vacuum.html) | `nodes.nid INTEGER PRIMARY KEY` keeps FTS rowids valid |
| `AUTOINCREMENT` prevents reuse of rowids from deleted rows | [AUTOINCREMENT](https://www.sqlite.org/autoinc.html) | Outbox `seq` stays monotonic after pruning |
| Deferred foreign keys are checked at commit | [Foreign keys](https://www.sqlite.org/foreignkeys.html#fk_deferred) | Claim sets the holder before the attempt row exists in the same transaction |
| Generated columns can be indexed | [Generated columns](https://www.sqlite.org/gencol.html) | `nodes.feature` from `fields` without duplicate storage |
| Row values and `UPDATE` with subqueries | [Row values](https://www.sqlite.org/rowvalue.html) | Reserve and settle all scopes in one statement |
| `json_each` table-valued function | [JSON functions](https://www.sqlite.org/json1.html#jeach) | Read-set validation in one query; name registry from `fields.names` in a trigger |

Temporal (valid-time) tables, where each row carries the interval in which it was true, are the standard way to answer “as of” queries without snapshots (Snodgrass, *Developing Time-Oriented Database Applications in SQL*, 1999; SQL:2011 period tables).

## Full-text search

- Contentless-delete FTS5 tables (SQLite 3.43+) support `DELETE` and full-row updates while storing only the index. [FTS5](https://sqlite.org/fts5.html)
- The `trigram` tokenizer supports indexed `LIKE` and `GLOB` substring queries, but only when column values can be read, so a contentless trigram table returns no `LIKE` matches; an external-content table is needed. [FTS5](https://sqlite.org/fts5.html) · [Forum: contentless trigram and LIKE](https://sqlite.org/forum/forumpost/985badf249)
- The `unicode61` tokenizer splits on non-alphanumeric characters only, so camelCase identifiers need application-side splitting before indexing (done by the registered `ef_search_text` function).

## WAL and checkpoints

- A checkpoint can't complete past a page an active reader still needs; long-running readers let the WAL grow (“checkpoint starvation”). [WAL](https://www.sqlite.org/wal.html)
- `wal_checkpoint` modes `PASSIVE`, `FULL`, `RESTART`, `TRUNCATE`; `journal_size_limit` truncates the WAL after checkpoints. [PRAGMA](https://www.sqlite.org/pragma.html#pragma_wal_checkpoint)
- `secure_delete` overwrites deleted content with zeros. [PRAGMA secure_delete](https://www.sqlite.org/pragma.html#pragma_secure_delete)

## Migrations and recovery

- Changes `ALTER TABLE` can't make (constraints, column types) use the documented 12-step rebuild: disable foreign keys, create the new table, copy, drop, rename, recreate indexes, triggers and views, check foreign keys. [ALTER TABLE](https://www.sqlite.org/lang_altertable.html#otheralter)
- `quick_check` and `integrity_check` detect corruption. [PRAGMA integrity_check](https://www.sqlite.org/pragma.html#pragma_integrity_check)
- The recovery extension (and the CLI's `.recover`) copies salvageable content from a corrupt database into a new one. [Recovery](https://www.sqlite.org/recovery.html)
- `VACUUM INTO` writes a consistent copy of a live database. [VACUUM INTO](https://www.sqlite.org/lang_vacuum.html#vacuuminto)

## Blobs and logs

- On Windows, renaming a file can fail briefly with `EPERM` or `EACCES` because antivirus or indexing software holds it; Node's graceful-fs retries renames for this reason. [graceful-fs](https://github.com/isaacs/node-graceful-fs)
- The zstd seekable format splits data into independently compressed frames with a seek table, so a byte range can be read by decompressing only the frames that cover it. [Seekable format](https://github.com/facebook/zstd/blob/dev/contrib/seekable_format/zstd_seekable_compression_format.md)

## Export

`git fast-import` writes many blobs, trees and a commit in one streaming process, and can modify files relative to a parent commit, which makes incremental export of only changed entities cheap. [git fast-import](https://git-scm.com/docs/git-fast-import)

## To measure (M0 benchmark)

- p99 write latency with 50 simulated workers (target under 50 ms).
- Board and readiness queries at 500 tasks and 5,000 requirements (target under 10 ms).
- Export time for 300 changed entities; rehydration time from history segments.
- Recovery drill: corrupt `state.db` mid-build and measure what is restored automatically.
