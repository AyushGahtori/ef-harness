# Research: kernel storage layout and the window protocol

Question: which SQLite features support a fast, auditable schema, how should large artifacts be stored, and what protocol lets a window resume a live event stream without gaps? Design: [kernel storage and protocol](../kernel-schema-and-protocol.md).

## SQLite features used

| Feature | Use | Source |
|---|---|---|
| STRICT tables | Type enforcement on every column | [STRICT tables](https://www.sqlite.org/stricttables.html) |
| WITHOUT ROWID | Compact composite-key tables (history, edges, read sets) | [WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html) |
| Partial indexes | Index only active rows or ready tasks | [Partial indexes](https://www.sqlite.org/partialindex.html) |
| `RETURNING` | Read the new epoch from the same claim statement | [RETURNING](https://www.sqlite.org/lang_returning.html) |
| FTS5 with BM25 | Knowledge search | [FTS5](https://www.sqlite.org/fts5.html) |
| WAL, `BEGIN IMMEDIATE`, `data_version` | Concurrency model | [Knowledge DB research](knowledge-db-consistency.md) |

The schema's DDL, claim and reservation statements were executed against SQLite in Node 24 (`node:sqlite`): the second claim on a task returns no rows, and a reservation exceeding the limit changes no rows.

## Content-addressed storage

Git stores objects by the hash of their content, so identical content is stored once and integrity is checkable. [Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects) Zstandard gives fast compression suitable for logs and traces. [zstd](https://facebook.github.io/zstd/)

## Protocol

- JSON-RPC 2.0 defines requests, responses and notifications without prescribing transport. [JSON-RPC 2.0](https://www.jsonrpc.org/specification)
- The Language Server Protocol frames JSON-RPC messages with a length header over a byte stream, the same approach used here. [LSP base protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#baseProtocol)
- Electron `MessagePort`s let a renderer talk to a utility process directly, transferring data without routing through the main process. [Electron message ports](https://www.electronjs.org/docs/latest/tutorial/message-ports)
- Resuming a stream by sequence number with a snapshot fallback is the standard pattern for event-sourced read models (snapshot plus events after its position).

## To measure

- p99 write latency at 50 simulated workers (target under 50 ms).
- Event replay time after a 24-hour disconnect.
- CAS growth per project per week with default retention.
