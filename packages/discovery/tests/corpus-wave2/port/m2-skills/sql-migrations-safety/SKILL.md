---
id: sql-migrations-safety
version: 1
status: vetted
description: Expand, then contract, with idempotent steps and a named index.
tools: none
license: MIT
---

# Expand, then contract, with idempotent steps and a named index.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public sql-migrations-safety practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:sql-migrations-safety

Expand the schema before you contract it. Old code must still run against the expanded shape.

Make the step idempotent. A second run does not fail because the first run committed.

Add an index only for a query you can name.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
