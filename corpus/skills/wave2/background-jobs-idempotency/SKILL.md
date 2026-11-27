---
id: background-jobs-idempotency
version: 1
status: vetted
description: Transactional outbox, backoff, and dead-letter safety.
tools: none
license: MIT
---

# Transactional outbox, backoff, and dead-letter safety.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public background-jobs-idempotency practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:background-jobs-idempotency

Write the business change and the outbox row in one transaction. A crash after the commit still publishes the row.

The worker claims a row by id. Running the same id twice does not apply the side effect twice.

Retry with exponential backoff and a cap. After the cap, move the row to the dead-letter state and stop retrying it.

A dead-letter row is visible to an operator. It is not deleted by the retry loop.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
