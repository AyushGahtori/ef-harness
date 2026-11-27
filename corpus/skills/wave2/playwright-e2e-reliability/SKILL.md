---
id: playwright-e2e-reliability
version: 1
status: vetted
description: Role locators, auto-waiting, no fixed sleeps, and isolated fixtures.
tools: none
license: MIT
---

# Role locators, auto-waiting, no fixed sleeps, and isolated fixtures.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public playwright-e2e-reliability practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:playwright-e2e-reliability

Locate controls by role and accessible name. Do not depend on a CSS structure that can move.

Rely on auto-waiting assertions. A fixed sleep is not a synchronization strategy.

Each test gets its own fixture data and its own storage state. Tests must not share a mutable account.

Assert the user-visible result, then the persistent result when the product stores one.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
