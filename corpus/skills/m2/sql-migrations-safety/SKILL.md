---
id: sql-migrations-safety
version: 1
status: vetted
description: Expand-then-contract schema changes, indexing, and idempotent migrations.
tools: none
license: MIT
---

# SQL migration safety

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public expand-then-contract migration practice for the EF Harness M2 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:sql-migrations-safety

Change a live schema in expand-then-contract steps. One migration must be safe to retry and safe to deploy beside the previous application version.

## Expand, then contract

1. Expand. Add the new nullable column, table, or index. Do not enforce the new rule yet. Old code must still read and write.
2. Backfill in batches that can resume. Do not lock the table for a single unbounded update when the table can be large.
3. Deploy the application that writes both the old and the new shape.
4. Contract. Enforce the new constraint, drop the old column, or rename, only after every running version has stopped using the old shape.

A rename is an expand (add the new name, copy, switch readers) followed by a later contract (drop the old name). Do not rename a populated column in one step.

## Idempotent migrations

- Each migration is safe to run twice. Guard creates with an existence check the engine supports, or rely on a migration ledger that records success only after the whole step commits.
- A failed step leaves the database at the previous ledger version so the next run retries that step.
- Do not edit a migration that has already been applied. Add a new migration.

## Indexes

- Add an index for a column used in a frequent filter, join, or ordering once you can name that query.
- Build a large index so it does not hold an exclusive write lock for the whole table when the engine allows it.
- Do not add an index you cannot tie to a query. Drop an index only in a later contract step after the query no longer needs it.

## Checks before you finish

- A fresh database from zero migrations reaches the same shape as an upgraded database.
- The previous application version still starts against the expanded schema.
- The down direction, when one exists, restores the previous shape without deleting user data that the expand step already accepted.

## Smoke check

The worker uses expand then contract, keeps the migration idempotent, and adds an index only for a named query.

## Output

List the expand step, the backfill, the contract step, the query the index serves, and how a retry behaves when the step is run again.
