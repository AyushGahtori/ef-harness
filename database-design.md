# Database design: complete schema and the ten fixes before M0

Two independent reviews found ten concrete holes in the database design: missing DDL, records with two homes, three SQL bugs, a cross-database transaction, noisy invalidation, group-commit races, a shared event table, unsafe blob cleanup, missing migration and recovery procedures, lossy export, and no secret purge. Every claim was checked against the documents; the reviewers' own corrections are folded in (for example, `nodes.kind` and `tasks.state` had no `CHECK` constraints, and no document proposed `ATTACH`). This document records the decisions. The schema itself is executable SQL, and a test suite runs it against real SQLite. Diagram: [database-design.svg](database-design.svg) · [editable Mermaid](database-design.mmd). Research: [SQLite database engineering](research/sqlite-database-engineering.md).

| File | Content |
|---|---|
| [schema/state.sql](schema/state.sql) | Project database: every table, index, trigger and view |
| [schema/global.sql](schema/global.sql) | Per-user global database |
| [schema/telemetry.sql](schema/telemetry.sql) | High-rate, lossy telemetry (separate file) |
| [schema/code-index.sql](schema/code-index.sql) | Rebuildable code index (separate file) |
| [schema/queries.sql](schema/queries.sql) | Canonical statements: claim, reserve, settle, validate, impact walk, as-of, prune, grants, GC |
| [schema/schema-test.js](schema/schema-test.js) | 67 scenario tests; `node schema/schema-test.js` (67/67 pass on SQLite 3.53 in Node 24) |

## The principles everything follows

1. **One home per fact.** Knowledge meaning (what a task, rule or check *is*) lives only in `nodes`, versioned. Runtime state (who holds a task, which checks passed, what was spent) lives only in runtime tables keyed by the node ID. Relations live only in `edges`. Convenience tables become views.
2. **The database enforces what it can.** Version steps, history, search indexes, name uniqueness, edge-set counters and read models are maintained by triggers inside the same transaction, so application code can't forget them.
3. **Integers for money and time.** Units with a declared scale; milliseconds since the epoch.
4. **No transaction spans two files.** SQLite documents that in WAL mode a crash during a multi-file commit can leave some files committed and others not. Files exchange idempotent messages instead.
5. **History is immutable and temporal,** so any revision can be read with an indexed query and long exports never need a long read transaction.

## 1 · One home per record

| Former name in the docs | Now |
|---|---|
| `decisions`, `spec_items`, `research_facts`, `edge_cases`, `arch_nodes`, `contracts`, `rules`, `plans` | Node kinds in `nodes` (`fields` JSON validated per kind, `feature` as a generated column) |
| `tasks` | Meaning: task node. Runtime: `task_runtime` (state, epoch, lease, holder) with a foreign key to the node. The brief version is the node's version, recorded per attempt. |
| `checks` | Meaning: check node. Results: `check_results` |
| `requirements`, `task_requirements`, `check_requirements`, `waivers` | **Views** over `nodes` and `edges` (`implements`/`obeys`/`handles_edge_case`, `verifies`, `waives`) |
| `names` | Table maintained by node triggers from `fields.names`; its primary key makes a duplicate name abort the publishing change set |
| `ccr` | Node kind (`ccr@1` is its JSON message form) |
| `feature_progress` | Trigger-maintained rollups (`rollup_feature_tasks`, `rollup_feature_requirements`) over source rows, with a drift check |
| `git_leases` | `ref_leases` |
| Question queue, effect ledger, process registry, turns and spans | `inbox_items` + `inbox_subscribers`, `effects`, `env_processes` (ports in `global.db`), `turns` + `evidence` (with locators) |

**Vocabularies are lookup tables** (`node_kinds`, `edge_types`, `task_states`, `currencies`) referenced by foreign keys. Adding a node kind or task state is an `INSERT`, never a table rebuild. `CHECK` lists remain only for domains that won't change (`dir IN ('in','out')`, `pass|fail|…`).

**Held is no longer a task state.** A task is held when it has at least one row in `task_holds`; each reason has its own row, so releasing one reason can't clear another (the existing “user pause vs requirement hold” rule, now structural).

**`nodes` has `nid INTEGER PRIMARY KEY`.** Without an explicit integer key, `VACUUM` may renumber rowids, which would silently corrupt the search indexes keyed by rowid.

## 2 · The three SQL bugs

**Search.** Two indexes replace the broken `nodes_fts`:

| Index | Type | Finds |
|---|---|---|
| `kb_words` | FTS5 contentless-delete, `unicode61` | Words, including camelCase, snake_case and kebab-case parts. Triggers feed it through the registered function `ef_search_text`, which turns `toPrintRows` into `toPrintRows to Print Rows` |
| `kb_ident` | FTS5 external content on `nodes(id, title)`, `trigram` | Substrings and IDs (`LIKE '%C-01%'`). It must be external-content: a contentless trigram table can't verify `LIKE` matches |

`nodes` now has a real `title` column. Tested: “print rows” finds `toPrintRows`, `%C-01%` finds `C-014`, updates re-index.

**Money.** All amounts are `INTEGER` units: micro-USD for `usd`, parts-per-million of the window share for allowances, slot counts for local capacity. Reservations name their scopes in `reservation_scopes` (normalized, with foreign keys), so one `UPDATE … WHERE (scope) IN (…)` reserves on every scope at once and succeeds only if every row changed.

**Settlement always succeeds.** Money already spent is recorded even when it exceeds a limit: `spent` may pass `limit`, `CHECK`s keep values non-negative, and `overrun_units` is stored on the reservation. Because the reserve guard is `reserved + spent + amount ≤ limit`, an overrun automatically blocks further spending under that scope until a person raises the limit. Routes that can't cap output (Sign in with ChatGPT) reserve the 95th percentile of observed output for that task class and stop reading the stream beyond the reservation, so an overrun is bounded by one stream chunk. Tested: 0.10 reserved, 0.34 settled, overrun 0.24 recorded, the next reservation refused.

**Claim.** The claim statement now requires a claimable state, the current brief version, **no holds** and **every `depends_on` dependency done**, sets the holder and returns the new epoch. The attempt row is inserted in the same transaction; `holder_attempt` is a deferred foreign key, so a claim pointing at a missing attempt fails at commit. Lease expiry is its own statement that never expires a lease whose submission arrived in time, and submissions are inserted only while the attempt still holds the task at the same epoch. All tested.

## 3 · Global and project databases never share a transaction

```
broker (global.db)                         project coordinator (state.db)
 issue grant G (state=issued) ──message──▶ deposit: grant_receipts + budgets('grant',G)   [idempotent by G]
 mark deposited ◀────────────── ack ──────
                                            reservations draw on budgets('grant',G) locally
 ◀──── closure report (used, unknown) ───── close: freeze budget, record used + unknown   [idempotent by G]
 record consumption, free the rest
```

| Failure | Recovery |
|---|---|
| Project crashes before depositing | Broker sees `issued` without ack; on project restart the coordinator lists its deposited grants; missing ones are marked expired and returned |
| Project crashes after closing, before reporting | On restart it re-sends closure reports (same grant ID, idempotent) |
| Project never comes back (deleted, drive gone) | After `expires_at` plus grace, the broker expires the grant **as fully used**, which is conservative: the plan window is never over-promised |
| Paid call with unknown outcome at closure | Reported as `unknown_units`; counted as used until reconciled |

Ownership: `global.db` has a single writer, the broker inside the daemon, protected by an owner row and an OS file lock like `state.db`. Ports are machine-wide, so `port_leases` lives in `global.db`; process records stay in each project's `env_processes`.

## 4 · Edge noise, read-set validation and history

- **Per-type edge-set versions.** `edge_set_versions(node, dir, type)` replaces the two counters on `nodes`. `edge_types.invalidates` marks which types make dependents stale. A comment or `documents` edge bumps only its own counter. Tested: adding a comment to `C-014` leaves its consumer version unchanged.
- **Validation in one SQL statement.** A change set's reads are passed as JSON and compared with current node and edge-set versions using `json_each`, in one query inside `BEGIN IMMEDIATE`. Stale entries are returned by name. The reads are also stored in `change_set_reads` for audit.
- **Temporal history.** `node_versions` and `edges` carry `valid_from_rev` and `valid_to_rev`, with indexes on both. “The database as of revision 214” is two indexed range queries; no checkpoints needed. Triggers close the previous interval and open the next, so history can't drift from current state. Tested.

## 5 · Group commit, idempotency and WAL

| Rule | Why |
|---|---|
| **Knowledge change sets run alone** (a barrier), never batched | A publish changes what other requests validate against |
| Task transitions, receipts and results may share a batch, each in its own savepoint, applied in queue order | Each request validates against the state left by earlier ones in the batch, which is ordinary serial order |
| Acceptance checks the attempt's read set against breaking changes in its savepoint | If a breaking change to R17 committed first, T07's acceptance is rejected as stale |
| **Propagation runs after commit** from the `read_sets_by_node` index | If T07 was accepted first, the later R17 change finds T07 through its read set and schedules re-verification. Either order ends correct |

**Operations** store `request_hash`; reusing an `op_id` with a different request returns `op_id_reused` instead of an old receipt. Rows are pruned after 30 days; the durable record of anything important is its receipt, not the operation row.

**WAL growth.** Readers never hold long transactions: UI queries run in short transactions, and exports read immutable history revision by revision in small batches (possible because of temporal tables). Checkpoints: `PASSIVE` after one second of writer idleness, `RESTART` when the WAL passes 64 MB, `TRUNCATE` at daily idle and on close, with `journal_size_limit` set. Readers live in worker threads; one exceeding its time budget is cancelled by terminating its worker, so a slow view can't starve checkpoints.

## 6 · Outbox, telemetry and fast read models

| Stream | Where | Guarantee |
|---|---|---|
| **Domain events** (`TaskAccepted`, `FeatureCompleted`, `RevisionPublished`) | `outbox` in `state.db`, same transaction as the state change | Never pruned while any consumer hasn't acknowledged; `seq` uses `AUTOINCREMENT` so numbers are never reused after pruning (tested); the window's gap-free stream is this table |
| **Telemetry** (progress, tokens, heartbeats, health) | `telemetry.db`, a separate file | Lossy is fine; sent live to the window as ephemeral messages without sequence guarantees |

The earlier idea of moving “the event log” to its own file is withdrawn: the outbox must stay in `state.db`; only telemetry moves.

**Read models.** Board and readiness numbers come from trigger-maintained rollups (`rollup_feature_tasks`, `rollup_feature_requirements`) updated in the same transaction as the rows they count. Requirement status is written by the kernel in the same transaction as check results. A periodic drift query recounts from source rows; any difference rebuilds the rollup and is logged as a bug. Board queries read a few rows per feature regardless of project size; the performance target (under 10 ms at 500 tasks and 5,000 requirements) is part of the M0 benchmark.

## 7 · Shared blob store

- **Pins in `global.db`.** A blob is deleted only when `cas_pins` holds no pin for it, past a 7-day grace period. Holders: projects, backups, the research cache, exports. A project pins a blob **before** recording it, so a live blob is never unpinned; unpins are lazy, and a periodic full sync per project replaces its pin set. Pins outlive unplugged drives and offline projects, because they don't live in the project. Backups register their own pin set when created. Tested: a backup-pinned blob is never a GC candidate.
- **Writes on Windows.** Write to `cas\tmp\`, hash while writing, flush, then rename into place with retries on `EPERM`/`EBUSY`/`EACCES` (antivirus and indexers briefly hold files), backing off 50 ms → 1 s, 10 tries. If the target already exists, verify its hash and discard the temp file. Promoted files are marked read-only.
- **Integrity.** The key is SHA-256 of the uncompressed content. `evidence` and `asset` blobs are verified on every read; a weekly scrub samples the rest. A mismatch quarantines the blob, marks dependent receipts, and regenerates the artifact if possible.
- **Big logs.** Text artifacts over 1 MB use the seekable zstd format (independent frames of about 1 MB plus a seek table) and get a sidecar line index (line number → frame and offset every 1,000 lines). `harness.read_log(range)` decompresses only the frames it needs; queries stream frame by frame with a match cap.

## 8 · Migrations and corruption

**Migrations**

| Kind | Procedure |
|---|---|
| Additive (new table, column, index, lookup row) | One transaction |
| Rebuild (changing a constraint or column type) | SQLite's documented 12-step procedure: foreign keys off, transaction, create new table, copy, drop, rename, recreate indexes, triggers and views, `foreign_key_check`, commit, foreign keys on; FTS indexes rebuilt (`rebuild` for `kb_ident`, repopulated from `nodes` for `kb_words`) |
| Every migration | Work parked, readers closed, exclusive lock, `VACUUM INTO` backup first, `quick_check` after, recorded in `schema_migrations` |

**Several databases.** Each file has its own version. `global.db` migrates first and never assumes project schema versions. Projects migrate lazily when opened, each with its own backup. A project whose migration fails is restored from its backup and marked `needs_repair` in `global.db`; other projects keep working, and that project offers Retry, Export or Report.

**Corruption recovery**

| Step | Action |
|---|---|
| Detect | `quick_check` on open and at daily idle; `integrity_check` weekly; any `SQLITE_CORRUPT` puts the project in safe mode |
| Backups | `VACUUM INTO` every hour while work is happening (last 24 kept) plus daily (last 7) plus before migrations; each registers its CAS pins |
| 1 · Salvage | SQLite's recovery tool copies readable content into a new file; accepted only if the schema test invariants pass |
| 2 · Restore | Otherwise, the newest good backup |
| 3 · Replay | Knowledge since the backup from the `harness-state` history segments; accepted work from Git (commits carry `Harness-Task` and `Harness-Checks` trailers, re-verified); in-flight work parked at its newest `refs/harness/checkpoints/*` |
| 4 · Report | What was recovered, what was re-verified, and anything lost (for example, spend between backup and crash is estimated and flagged) |

`telemetry.db` and `code-index.db` are simply rebuilt or recreated.

## 9 · Export to `harness-state` at scale, and what travels

**Incremental.** The dirty set since the last export is computed from `node_changes` and edge intervals after `export_state.last_rev` (no extra queue table). The exporter renders only those entities and writes one commit with `git fast-import` on top of the previous export commit: changed files are modified, retired ones deleted, everything else carried over unchanged. It runs in the background after 10 seconds of quiet.

**What travels and what doesn't**

| Travels | How |
|---|---|
| Current entities | One YAML file per entity (as before) |
| History: node versions, edge intervals, change sets, node changes | **Append-only history segments** `history/000215-000260.jsonl`, never rewritten |
| Verification evidence of accepted work | Receipts with check results and the accepted attempt's read set |
| Evidence quotes; transcripts | Quotes always; full transcripts opt-in |

| Stays local | Why |
|---|---|
| `operations` | Idempotency for this machine's clients only |
| Read sets of unaccepted attempts, leases, attempts, telemetry | Machine runtime |
| Event sequence | Each machine has its own stream; a `stream_epoch` in `meta` changes on rehydration, and windows resync when it changes |
| Blobs | Hashes travel; content can be included in a project export archive |

Rehydration replays the history segments into a fresh `state.db`, then checks that the replayed current state hashes equal the exported entity files. Revision numbers continue from the highest exported revision.

## 10 · Code index, secret purge and query bounds

**Code index** in its own `code-index.db`: symbols, references and file ranking keyed by file content hash and commit. Rebuildable, excluded from backups and exports. Brownfield module cards (which cost tokens) stay in `state.db` as artifacts keyed by file hash.

**Secret purge.** Prevention comes first: input is scanned before a turn is stored, so most secrets never land. When one did:

1. Locate it in all text columns with one query (`secret_occurrences`), plus a streaming scan of the project's text blobs.
2. Replace every occurrence with `[REDACTED:<name>]`. This is the one sanctioned rewrite of history, recorded in `redactions` with an HMAC fingerprint (never the value) and a map from old to new content hashes so receipts stay explainable.
3. Re-index affected rows in both search indexes, then `optimize`.
4. `secure_delete` is always on for `state.db`, so freed pages are zeroed. Then `wal_checkpoint(TRUNCATE)` and `VACUUM`.
5. Rewrite affected blobs under new hashes, update references, delete the old blobs immediately, bypassing the grace period.
6. Replace backups that contain it (redact a copy, then delete the old file).
7. If the `harness-state` branch was pushed, its history must be rewritten; that needs the developer's approval and a force push.
8. **Always rotate the key.** Storage on SSDs can't be guaranteed erased, and the key may have reached a provider; the UI links to the provider's rotation page.

**Query bounds**

| Bound | Value |
|---|---|
| List queries | Keyset pagination, at most 500 rows per page |
| Impact walk | Depth ≤ 6, ≤ 5,000 nodes, 50 ms budget; beyond that the result is marked partial and the owner gets an “impact unclear” item |
| `snapshot.get` | At most 2 MB per view section, paginated |
| Read query time | 200 ms for UI queries, 2 s for exports per batch; over budget, the worker thread is terminated |
| JSON request size | 1 MB (unchanged) |

## Five more traps

| Trap | Decision |
|---|---|
| **Leases skewed by sleep** | Lease expiry compares stored wall-clock times, so a laptop that slept for an hour would expire every lease on wake. In-process timers use a monotonic clock. On resume (power event), or when wall time and monotonic time disagree by more than 30 seconds (clock change), the expiry sweeper is suspended until reconciliation has re-checked each attempt's process, and live attempts get their leases extended. Only attempts whose process is really gone are expired. |
| **ID allocation** | Human-readable IDs (`T07`, `R17`, `A0014`) come from `id_counters`, allocated with one atomic upsert inside the writing transaction, and are never reused, including after retirement. Counters are written to the export manifest, so a rehydrated project continues the sequence. |
| **Hashes that differ between machines** | `content_hash` is SHA-256 over the RFC 8785 (JSON Canonicalization Scheme) form of `{kind, title, text, fields}`. Text is normalized to Unicode NFC when it enters the kernel. The same content therefore hashes identically regardless of key order, whitespace or serializer, which history replay and the export round-trip check depend on. |
| **Negative reads** | A worker can rely on something *not* existing: no consumer of a contract, a search with no results, an unused name. Absence of edges is covered by edge-set versions (an empty set has version 0, and adding the first edge bumps it); each attempt records the edge sets it relied on in `edge_read_sets`, checked at acceptance. Searches are recorded in `search_reads` with a hash of their sorted results, an empty set included; at acceptance, recorded searches are re-run (at most 50 per attempt) and a changed result is treated like a changed pulled item. Name absence is enforced at publish by the registry's unique key. |
| **`turn_log` growth** | Every step of every attempt adds a row. When an attempt is closed, its full steps are written as one JSONL blob, `turn_log_archives` keeps the step count and token totals, and the rows are deleted. Running, submitted and parked attempts are never archived, because recovery needs their steps. Tested. |

The test suite covers ID allocation and archival; the sleep and hashing rules belong to kernel code and are covered by the M0 simulation tests (fake clock with suspend and clock jumps; hash round-trips across serializers).

## Basis and status vocabulary

One vocabulary everywhere (discovery, spec expansion, prompts, UI), enforced by a `CHECK` on the generated `nodes.basis` column (tested):

| Basis of a settled value | Meaning | Used by |
|---|---|---|
| `explicit` | A current user statement (or imported document span) establishes it | Discovery, intake |
| `derived` | An allowlisted rule from settled premises | Discovery, spec expansion |
| `delegated` | Chosen within an explicit delegation, including Autopilot | Discovery, planners |
| `defaulted` | Filled by an elaboration of the chosen catalog option or a universal policy | Spec expansion |
| `proposed` | Proposed by `spec-expander@1` for a cell nothing else covers | Spec expansion |
| `observed` | Current behavior read from an existing repository (baseline, not a requirement) | Brownfield discovery |

**Statuses** describe an unsettled criterion or cell and are never bases: `open`, `partial`, `missing`, `conflict`, `asked`, `deferred`, `not_applicable`, and `settled` once a basis exists. Older wording maps as follows: “chosen under delegation” → `delegated`; infer-or-ask's `delegated` status → basis `delegated`; spec-expansion's `asked` → status `asked`.

## Discovery records

| Table | Holds |
|---|---|
| Decision nodes (`kind = decision`) | One per catalog criterion instantiated for the project, with `fields.criterion`, `status`, `value`, `basis` |
| `work_items` | The project itself plus one row per brownfield change request, each with its own readiness |
| `discovery_scopes` | Scope revisions per work item; a new revision freezes a new applicable set and explains why |
| `scope_criteria` | Which decisions count in a revision, which are needed before building, which are critical |
| `discovery_batches` | The open batch, its ordered questions and the cursor, so a resumed chat recovers its place |

The readiness line (“Needed before building 18 of 18 ✓ · Everything we know 18 of 20”) is the `readiness` statement in [queries.sql](schema/queries.sql), tested. Discovery sets are small, so no rollup is needed.

## Additions from the 18 November architecture review

| Problem | Fix (all in `schema/`, tested) |
|---|---|
| Outbox events with no delivery rows could be pruned | Delivery rows are registered for every intended consumer in the same transaction as the event (`register_delivery`); pruning requires delivery rows and all of them acknowledged; `outbox_without_deliveries` reports bugs |
| Feature and project lifecycles had no storage | `feature_states` + `feature_runtime`, `project_states` + `project_runtime`; transitions as statements (e.g. `advance_feature_leaves_merged`) |
| Sweep leases weren't enforceable | `task_scopes` (write-scope path prefixes), `path_leases` + `path_lease_prefixes`; the claim refuses overlapping tasks; `grant_sweep_lease` waits for overlapping work to stop |
| Acceptance ignored edge-set reads | `edge_read_sets` and `stale_edge_reads_for_acceptance`; searches use `search_reads` (re-run at acceptance) |
| `submission_pending` was never set | `accept_submission` (with the candidate) and `finish_submission` (with the verification outcome) |
| Planner dependencies could live in task JSON instead of edges | Kernel converts them to `depends_on` edges at publish; `relations_in_fields` flags any relation left inside `fields` |
| Hint ladder had no state | `verification_state` with `record_hidden_failure` |
| Resume data missing | `attempt_checkpoints` (WIP ref, session reference, contract versions, pending effects, handoff note) |
| PR, CI and deploy state missing | `ship_runs` linked to `effects` |
| Requirement status had no recompute or drift check | `requirement_status_recompute` (latest result per check at its current version); the periodic drift job compares it with `requirement_status` |

## Corrections to other documents

- [Kernel schema and protocol](kernel-schema-and-protocol.md) now points here for the schema; its earlier DDL is superseded.
- [Knowledge database](knowledge-database.md): feature progress is “derived from source rows, cached in trigger-maintained rollups with a drift check”, not computed by application code.
- [Build pipeline](build-pipeline.md): the table list refers to node kinds and views; held is a property (holds), not a state.
- [Projects, portability and sync](projects-portability-and-sync.md): the export includes history segments; “rehydrate the full project” now means knowledge with full history and accepted evidence.
- [Desktop app](desktop-app.md): hourly backups, migration kinds and corruption recovery.

[Kernel schema and protocol](kernel-schema-and-protocol.md) · [Knowledge database](knowledge-database.md) · [Projects, portability and sync](projects-portability-and-sync.md) · [Research](research/sqlite-database-engineering.md)
