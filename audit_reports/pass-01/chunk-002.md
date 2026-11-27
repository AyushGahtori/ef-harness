# Pass 01 — Chunk 002: SQLite Kernel, Repositories, Lifecycles, CAS, and Secret Purge (`Tasks 012–030`)

## 1. Chunk identification and scope
- **Pass number:** Pass 01
- **Chunk ID:** `pass-01/chunk-002`
- **Unit IDs:** `Tasks 012–030` (`packages/db`)
- **Branches and commits:**
  - `task/012-sqlite-driver-wrapper` (`51c90de`), `task/013-state-db-bootstrap-safemode` (`7baa1b6`), `task/014-global-telemetry-codeindex-dbs` (`e4c80c0`), `task/015-db-migration-engine` (`0ddc371`), `task/016-backups-corruption-recovery` (`b674e4a`), `task/017-knowledge-graph-repo` (`a6ef07d`), `task/018-fts5-knowledge-search` (`baee148`), `task/019-name-registry-hygiene` (`cea291d`), `task/020-task-claiming-leases-sleep-guard` (`336e7e5`), `task/021-holds-submissions-fencing` (`4f5c3f6`), `task/022-feature-project-lifecycles` (`a3c8977`, dirty worktree diff), `task/023-budget-reservation-ledger` (`96649df`), `task/024-cross-db-grant-protocol` (`e16d754`), `task/025-idempotency-group-commit` (`b0a731a`), `task/026-transactional-outbox` (`ce1ab76`), `task/027-read-models-rollups-drift` (`a95c149`), `task/028-cas-artifact-store-gc` (`49ff155`), `task/029-seekable-logs-retention-archive` (`e289bb9`), `task/030-secret-purge-engine` (`71bacaa`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/db` and `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles`
- **Governing architecture documents:** `schema/{state,global,telemetry,code-index,queries}.sql`, `schema/schema-test.js`, `database-design.md`, `kernel-schema-and-protocol.md`, `architecture-deep-review.md`, `IMPLEMENTATION_TASKS.md` (`Tasks 012–030`).

## 2. Units inspected
- All 19 units `Task 012` through `Task 030`, plus the uncommitted worktree diff in `task-022-feature-project-lifecycles`.

## 3. Files inspected
- `schema/{state,global,telemetry,code-index,queries}.sql` & `schema/schema-test.js`
- `packages/db/package.json`, `packages/db/src/index.ts`
- `packages/db/src/driver/{backend.ts,connection.ts,query-catalog.ts,reader-pool.ts}`
- `packages/db/src/state-db/{bootstrap.ts,state-db.ts}`, `packages/db/src/auxiliary-dbs/{global-broker-db.ts,telemetry-db.ts,code-index-db.ts,broker-lock.ts}`
- `packages/db/src/migrations/migration-runner.ts`, `packages/db/src/recovery/{backup-scheduler.ts,corruption-recovery.ts}`
- `packages/db/src/knowledge/knowledge-graph-repo.ts`, `packages/db/src/search/fts5-search-repo.ts`, `packages/db/src/registry/name-registry-repo.ts`
- `packages/db/src/leases/task-lease-manager.ts`, `packages/db/src/holds/holds-submissions-repo.ts`
- `packages/db/src/lifecycles/{feature-lifecycle.ts,project-lifecycle.ts}` (+ `task-022` uncommitted diff)
- `packages/db/src/ledger/budget-ledger-repo.ts`, `packages/db/src/grants/broker-grant-issuer.ts`, `packages/db/src/write-queue/coordinator-write-queue.ts`, `packages/db/src/outbox/outbox-repo.ts`, `packages/db/src/read-models/{board.ts,rollups.ts,drift.ts}`
- `packages/db/src/cas/cas-blob-store.ts`, `packages/db/src/artifacts/{artifact-logger.ts,retention.ts}`, `packages/db/src/secret-purge/secret-purge-engine.ts`

## 4. Architecture documents consulted
- `database-design.md` (single writer per SQLite file, WAL + reader pool, `user_version` migrations, contentless `kb_words` FTS5, CAS layout, secret purge)
- `kernel-schema-and-protocol.md` (7-condition feature DONE gate, project lifecycle gates, transactional outbox, `op_id` group commit)
- `schema/state.sql` & `schema/queries.sql` (authoritative DDL, triggers, invariants, named SQL queries)

## 5. Contracts and signatures discovered
- `SqliteConnection` (`driver/connection.ts`), `ReaderPool`, `QueryCatalog`
- `ProjectStateDb.open(options)` (currently wraps a private `StateConnection`), `GlobalBrokerDb`, `TelemetryDb`, `CodeIndexDb`
- `MigrationRunner.migrate(db, migrations)` (`015`)
- `KnowledgeGraphRepo`, `Fts5SearchRepo`, `NameRegistryRepo`, `TaskLeaseManager.claimTask(...)`, `HoldsSubmissionsRepo`
- `verifyFeatureDoneConditions` & `ProjectLifecycleManager` (`022`)
- `BudgetLedgerRepo`, `BrokerGrantIssuer`, `CoordinatorWriteQueue`, `OutboxRepo`, `BoardReadModelRepo` (`getFeatureProgress(featureId: string)`)
- `CasBlobStore` (`028`: async `put(bytes, opts)` returning bare 64-hex hash, `zstd|raw`), `ArtifactLogWriter` (`029`: expects sync `CasBlobStore` with `zstd-seekable`), `SecretPurgeEngine` (`030`: defines `RawFileCasBlobStore`)

## 6. Confirmed findings
- **F-007** — `CasBlobStore` (`028`) and `artifacts.hash` store bare `<64-hex>` while `shared-contracts` `Sha256HexSchema` and receipts require `"sha256:<64-hex>"`.
- **F-008** — `harness/integration` lacks `task-022`'s uncommitted fixes: inverted `coversScope` prefix check (`audited.startsWith(scopePrefix)` instead of `taskPath.startsWith(auditedScope)`), missing `contractsCurrent` brief-version pin, `BLOCKED` resume state loss, and `meta`-persisted exit approvals.
- **F-009** — `ProjectStateDb` (`013`) and `GlobalBrokerDb` (`014`) hardcode `PRAGMA user_version === 1` and reject migrated databases instead of invoking `MigrationRunner` (`015`).
- **F-010** — Four divergent `ef_search_text` SQLite UDF implementations (`013`, `015`, `030`, `067`) omit `([A-Z]+)([A-Z][a-z])` acronym splitting from `shared-contracts` `splitSearchText` (`007`/`018`), corrupting contentless `kb_words` FTS5 deletes and rebuilds.
- **F-011** — Three incompatible `CasBlobStore` contracts across `028` (async `zstd|raw`), `029` (sync pre-framed `zstd-seekable`), and `030` (`RawFileCasBlobStore`).
- **F-012** — `ProjectStateDb` hides a private `StateConnection` and 9 `packages/db` submodules define incompatible `Connection` interfaces + duplicate `queries.sql` loaders, preventing composition into one single-writer `ProjectDbBundle`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `packages/db` (`012–030`) is the authoritative persistence producer for `packages/ipc` (`032–033`), `packages/sim` (`034`), `mcp-server` (`048`), `verifier` (`066`), `daemon` (`067`), `discovery`/`spec-expansion`/`planner`/`integrator`/`ship-deploy`/`portability`.

## 9. Defects and missing integrations
- No unified `ProjectDbBundle` factory exists yet in `packages/db` to bind all repositories onto the single `SqliteConnection` writer + `ReaderPool` + shared `QueryCatalog`.

## 10. Tests and verification performed
- Executed `node schema/schema-test.js` → **PASS (`67/67 passed · SQLite 3.53.0`)**.
- Verified `task-022` uncommitted diff against `kernel-schema-and-protocol.md` feature/project state machine rules.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- Cross-check `CodeIndexDb` (`014`) against `packages/brownfield` (`166–170`) in `pass-05`, and `GlobalBrokerDb` / `BrokerGrantIssuer` (`014, 024`) against `packages/portability` (`188`) and `packages/providers` (`140`) in `pass-04`/`pass-06`.
