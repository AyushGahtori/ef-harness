---
id: api-security-hardening
version: 1
status: vetted
description: Authorization, validation, structured errors, and idempotency.
tools: none
license: MIT
---

# Authorization, validation, structured errors, and idempotency.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public api-security-hardening practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:api-security-hardening

Check authorization on the server before the state change.

Run schema validation on the body before you trust a field.

Return a structured error. A repeated idempotency key returns the original result.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
