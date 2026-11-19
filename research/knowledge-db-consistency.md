# Research: keeping the knowledge database, its files and its writers consistent

Question: how do established systems synchronize generated documents with edits, coordinate writers on SQLite, and decide what a change invalidates? Design: [knowledge database](../knowledge-database.md).

## SQLite's concurrency model

- In WAL mode readers don't block the writer and the writer doesn't block readers, but **there can only be one writer at a time**. [SQLite WAL](https://www.sqlite.org/wal.html)
- `BEGIN IMMEDIATE` takes the write lock at the start of a transaction, avoiding the failure where a read transaction later tries to upgrade to a write and gets `SQLITE_BUSY`. [Transactions](https://www.sqlite.org/lang_transaction.html)
- `busy_timeout` makes a connection wait instead of failing immediately when the database is locked. [PRAGMA busy_timeout](https://www.sqlite.org/pragma.html#pragma_busy_timeout)
- `PRAGMA data_version` changes when *another* connection commits, which lets one process detect foreign writes. [PRAGMA data_version](https://www.sqlite.org/pragma.html#pragma_data_version)
- SQLite gives serializable isolation between connections, but application-level read-modify-write across separate transactions can still lose updates. [Isolation in SQLite](https://www.sqlite.org/isolation.html)

**Consequence:** one writer process, `BEGIN IMMEDIATE`, conditional updates and derived counters, rather than many writers retrying on busy errors.

## Exactly-once effects over unreliable calls

- **Idempotency keys:** the client generates a key per operation and the server stores the result under it, so retries after a timeout return the original result instead of repeating the action. [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- **Transactional outbox:** write the state change and the event to be delivered in the same database transaction, then deliver at least once with deduplication. [Transactional outbox](https://microservices.io/patterns/data/transactional-outbox.html)
- **Fencing tokens** (increasing epochs) stop a paused or expired worker from writing after its lease was given away (Kleppmann, *Designing Data-Intensive Applications*, ch. 8).

## Detecting file edits on Windows

- `ReadDirectoryChangesW` reports file changes but can overflow its buffer, in which case the application must rescan the directory. [ReadDirectoryChangesW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-readdirectorychangesw)
- Many editors save by writing a temporary file and renaming it over the original; file-watching libraries such as chokidar have an option to treat this as a single change. [chokidar](https://github.com/paulmillr/chokidar)

**Consequence:** a watcher for speed, plus hash scans against a manifest for correctness.

## Merging edits from two sides

A three-way merge compares both edited versions against their common base, so changes on different parts combine and only true overlaps conflict. [git merge-file](https://git-scm.com/docs/git-merge-file) The version number embedded in each exported section provides that base.

## Deciding what a change invalidates

- **Build systems à la carte** (Mokhov, Mitchell and Peyton Jones, ICFP 2018) describes **verifying traces**: record the hashes of every input a task read, and rebuild only if one of them changed. It also describes **early cutoff**: if a rebuilt result is identical to the old one, its dependents don't rebuild.
- The Rust compiler's incremental system uses the same idea (“red-green” marking): a changed query whose result is unchanged turns green and stops propagation. [rustc incremental compilation](https://rustc-dev-guide.rust-lang.org/queries/incremental-compilation.html)

Read sets are verifying traces for agents; regenerating briefs and checks with hash comparison gives early cutoff.

## To measure

- Write throughput and p99 latency of the coordinator with 50 simulated workers.
- Share of changes stopped by early cutoff on benchmark revisions.
- False conflicts in Markdown imports (edits flagged as conflicting that weren't).
