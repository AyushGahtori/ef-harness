---
id: auth-session-rbac
version: 1
status: vetted
description: Server-side authorization, tenant scope, and cookie hygiene.
tools: none
license: MIT
---

# Server-side authorization, tenant scope, and cookie hygiene.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public auth-session-rbac practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:auth-session-rbac

Authorize on the server for every mutation. A hidden button is not an authorization check.

Scope every read and write by the tenant on the session. An id from the client does not select a tenant.

Session cookies are HttpOnly and Secure, and a state-changing request from another site fails the CSRF check.

A missing session is an authentication failure. A session for the wrong role is an authorization failure.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
