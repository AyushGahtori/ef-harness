---
id: api-security-hardening
version: 1
status: vetted
description: Authorization boundaries, input validation, structured errors, and rate-limit plus idempotency discipline for HTTP and RPC handlers.
tools: none
license: MIT
---

# API security hardening

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public API hardening practice for the EF Harness M2 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:api-security-hardening

Every handler proves who is calling and whether that caller may touch this record. Authentication is not authorization.

## Authorization

- On every read and every mutation of a private record, load the record in the caller's tenant and reject the call when the caller does not own it.
- A missing record and a record in another tenant return the same not-found result. Do not reveal that the other tenant's id exists.
- Check the permission for this action. A signed-in user is not allowed to perform an admin action.
- Public routes are an explicit list. Everything else requires a caller.

## Validation

- Validate the body, query, and path at the boundary, before any write.
- Reject unknown fields when the contract is closed.
- Enforce length, range, format, and enum limits from the contract. Return the field name and the rule that failed.
- Do not trust an id from the client to pick a tenant, a price, or a role.

## Structured errors

- Return a structured error: a stable code, an HTTP status, and a short message safe to show.
- Use 400 for a malformed request, 401 for a missing caller, 403 for a caller who is not allowed, 404 for a missing or cross-tenant record, 409 for a conflict, and 429 when the caller is over the limit.
- Do not put a stack trace, a SQL string, or a secret value in the response.

## Rate limits and idempotency

- Apply a rate limit on sign-in, password, and other abuse-prone routes.
- A POST that creates a record or moves money requires an idempotency key. The same key and the same body return the original result and do not apply the effect twice.
- The same key with a different body is a conflict, not a second success.

## Smoke check

The worker checks authorization on the record, validates input at the boundary, returns a structured error, and keeps idempotency on an unsafe POST.

## Output

Name the authorization check, the validation rules, the structured error codes, the rate limit, and the idempotency behavior for a repeated request.
