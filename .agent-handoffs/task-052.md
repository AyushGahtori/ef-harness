---
task_id: "Task-052"
branch: "task/052-template-db-synthetic-data"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/test-env/src/synthetic-data/**
  - packages/test-env/tests/synthetic-data/**
  - .agent-handoffs/task-052.md
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 052 handoff

Pre-seeded template databases and a deterministic, code-only synthetic data generator. Commit stays on `task/052-template-db-synthetic-data`.

## Exports Provided

Import from `packages/test-env/src/synthetic-data/index.ts` until the package barrel is wired.

- `SyntheticDataGenerator`
  - `generateDataset(schema, seedRecipe) -> GeneratedDataset`
  - `generateMigrationPredecessorFixture(schema, seedRecipe?, commit?) -> PredecessorFixture`
- `TemplateDatabaseManager`
  - `ensureTemplate(request) -> Promise<TemplateHandle>`
  - `prewarmTemplate(request) -> void` (background build; errors via `takePrewarmErrors`)
  - `cloneFromTemplate(template, envId) -> Promise<CloneHandle>` (`env_<id>`, SQLite file copy or `CREATE DATABASE ... TEMPLATE`)
  - `pruneOldTemplates({ keep? }) -> Promise<PruneResult>` (default keep 5 newest; skip templates with active clones)
  - `listTemplates()`, `stats()`, `whenIdle()`
- `computeTableChecksums(dataset | { tables }) -> TableChecksum[]` (row count plus per-column SHA-256, rows ordered by primary key)
- `SeedRecipeSchema.parse` / `SeedRecipeSchema.safeParse`
- `computeTemplateKey(migrationsHash, seedRecipeHash, profile)` = `sha256(migrationsHash + ':' + seedRecipeHash + ':' + profile)`
- `hashMigrations`, `hashSeedRecipe`
- `planInsertion` (topological order, nullable cycle edges, `SchemaCycleDiagnostic` when a cycle has no nullable edge)
- `loadDatasetSqlite` (bulk multi-row inserts and pass-2 updates with `PRAGMA foreign_keys = ON`)
- `measureText` / `fitString` (`code_points`, `utf8_bytes`, `utf16_code_units`)
- Errors: `SchemaCycleDiagnostic`, `UniqueDomainExhaustedError`, `ConstraintViolationError`, `ProductionDataLeakError`, `ForeignKeyViolationError`, `RecipeValidationError`, `SchemaMetadataError`

`TemplateHandle.name` is `tpl_<shortHash>` (12 hex chars, extended on collision). Templates are published only after the builder connection is closed. SQLite templates are chmod `0o444`. Postgres templates run `pg_terminate_backend` and `ALTER DATABASE ... WITH ALLOW_CONNECTIONS false` before the ready promise resolves.

## Shared Wiring Needs (Root / Index Barrels)

`packages/test-env/src/index.ts` is frozen. Add:

```ts
export {
  SyntheticDataGenerator,
  TemplateDatabaseManager,
  SeedRecipeSchema,
  computeTableChecksums,
  computeTemplateKey,
  hashMigrations,
  hashSeedRecipe,
  planInsertion,
  loadDatasetSqlite,
  LocalSqliteFilePort,
  SimulatedEmbeddedPostgres,
  SchemaCycleDiagnostic,
  UniqueDomainExhaustedError,
  ProductionDataLeakError,
  ForeignKeyViolationError,
} from "./synthetic-data/index.js";
export type {
  CloneHandle,
  EmbeddedPostgresProviderPort,
  GeneratedDataset,
  PredecessorFixture,
  SchemaMetadata,
  SeedRecipe,
  SqliteEnvProviderPort,
  TableChecksum,
  TemplateBuildRequest,
  TemplateHandle,
} from "./synthetic-data/index.js";
```

No root `package.json` script changes. Consumers (`Task 060`, `Task 063`, `Task 093`, `Task 160`) should import the symbols above from `@ef-harness/test-env` after that barrel edit.

## Dependency Intents (New Packages Requested)

Add `@faker-js/faker` (`>=9`, resolved here as `10.6.0`) to `packages/test-env/package.json` `dependencies`. It is already a root devDependency, which is how this worktree resolves the import. This task does not edit `package.json` or `pnpm-lock.yaml`.

No other new packages. SQLite uses Node's built-in `node:sqlite`. Postgres execution goes through `EmbeddedPostgresProviderPort` (no `pg` driver added).

## Contract Change Requests

None. Schema metadata and seed recipes are local TypeScript contracts in `packages/test-env/src/synthetic-data/types.ts`.

Local ports, because sibling branches are not on this base:

- `SqliteEnvProviderPort` / `LocalSqliteFilePort` stand in for `Task 050` `SqliteEnvProvider` (copy a locked template file to `env_<id>.sqlite` and delete it). The manager still applies migrations, bulk-loads, and sets the template read-only itself.
- `EmbeddedPostgresProviderPort` / `SimulatedEmbeddedPostgres` stand in for `Task 050` `EmbeddedPostgresProvider`. The manager issues the real catalog SQL (`CREATE DATABASE`, `CREATE DATABASE ... TEMPLATE`, `COPY ... FROM STDIN`, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, `ALTER DATABASE ... WITH ALLOW_CONNECTIONS false`, `DROP DATABASE IF EXISTS`). Swap the constructor's `postgres` option for the real provider without changing that SQL.
- `Task 007` canonical hashing is not imported. Recipe keys and checksums use a local SHA-256 over sorted-key JSON with NFC strings. If a later integrator needs bit-identical RFC 8785 digests, hash the recipe through `canonicalizeJson` before calling `computeTemplateKey`.

`generateMigrationPredecessorFixture` does not check out Git. `Task 063` passes the previous schema plus an optional commit id.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-052-template-db-synthetic-data`:

- `pnpm --filter @ef-harness/test-env typecheck` — pass
- `pnpm --filter @ef-harness/test-env lint` — pass
- `pnpm --filter @ef-harness/test-env test -- synthetic-data` — pass, 3 files, 23 tests
  - FK topological sort, nullable cycle break, non-nullable cycle diagnostic
  - self-reference and mutual-cycle pass-2 updates
  - max-length, Unicode/emoji, RTL, DST, cutoff ± 1s, 0/1/many, soft-delete, nulls, duplicates
  - unique-vocabulary disambiguation and exhausted unique domain
  - checksum stability across runs, primary-key reorder, and timezones UTC / Pacific/Kiritimati / America/New_York
  - `@example.test` / `@env.test` only; gmail brownfield rejected
  - 10,000-row performance seed generated and loaded into SQLite in under 3 seconds with foreign keys on and no duplicate emails
  - template dedupe, read-only lock, clone isolation, prune (keep 5, skip active clones), disk-lane serialization
  - Postgres catalog simulator: one `CREATE DATABASE` under concurrency, terminate then `datallowconn = false` before use, `CREATE DATABASE env_91 TEMPLATE tpl_*`, clone refused while the builder connection is open
- `node scripts/verify-harmony.mjs --task 052` — pass (`harmony ok for Task-052`), including workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test`

## Known Limitations / Follow-Ups

- No `psql` binary and no `EF_HARNESS_POSTGRES_URL` on this machine, so the Postgres path was verified against `SimulatedEmbeddedPostgres` rather than a native server. The same manager SQL is what a real `EmbeddedPostgresProvider` must execute.
- Functional seeds contain at least 16 boundary rows per table unless `maxRows` or `singletonTables` constrains the table. `functionalRowCount` is a minimum.
- Performance seeds put `performanceRowCount` rows (default 10,000) on fact tables and at most 1,000 rows on referenced parent tables so Zipf fan-out stays meaningful.
- CHECK parsing covers `BETWEEN`, comparisons, `length` / `char_length` / `octet_length`, and `IN (...)`. Other check expressions are not inferred; pass explicit `min`, `max`, or `maxLength` on the column.
- Cutoff timestamps are normalized with `Date.toISOString` (UTC). The generator does not read the host timezone.
- Faker is used for seeded locale-sensitive names and dish text. Constrained values (emails, slugs, keys, timestamps, unique columns, Zipf/Pareto draws) are produced by deterministic code so bulk loads cannot collide and timestamps do not depend on the laptop zone. Faker's reference date is anchored to `2024-01-15T00:00:00.000Z`.
- Email domains are only `example.test` and `env.test`. Sanitized brownfield rows are accepted only when `seedRecipe.sanitizedBrownfield` is passed explicitly.
