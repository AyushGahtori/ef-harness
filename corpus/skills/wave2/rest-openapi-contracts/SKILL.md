---
id: rest-openapi-contracts
version: 1
status: vetted
description: Schema validation, one error envelope, and cursor pagination.
tools: none
license: MIT
---

# Schema validation, one error envelope, and cursor pagination.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public rest-openapi-contracts practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:rest-openapi-contracts

Validate the request and the response against the published schema. An unknown field is rejected when the schema says so.

Errors use one envelope with a stable code and a message safe for the caller. Do not return a stack, a query, or a filesystem path.

Lists use a cursor. The next page is the next cursor, not a shifting offset, when rows can be inserted during the read.

A breaking response change is a new schema version, not a silent field removal.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
