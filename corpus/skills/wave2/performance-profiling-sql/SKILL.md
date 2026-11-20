---
id: performance-profiling-sql
version: 1
status: vetted
description: Explain plans, N+1 removal, indexes, and bounded queries.
tools: none
license: MIT
---

# Explain plans, N+1 removal, indexes, and bounded queries.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public performance-profiling-sql practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:performance-profiling-sql

Read an explain plan for the slow query before adding an index. The index must match the filter, the join, or the order you measured.

Replace a per-row query inside a loop with one bounded query. Do not load an unbounded child set to format a page.

A page has a limit. A search has a limit. A query without a limit needs a written reason that the table is bounded.

Do not add an index you cannot tie to a query.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
