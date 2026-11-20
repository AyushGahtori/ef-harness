---
id: test-driven-verification
version: 1
status: vetted
description: Start from a failing test and cover the edge case.
tools: none
license: MIT
---

# Start from a failing test and cover the edge case.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public test-driven-verification practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:test-driven-verification

Start with a failing test that names the missing behavior. That red result is the baseline.

Add the smallest change that turns the failing test green.

Include the edge case the task named, not only the happy path.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
