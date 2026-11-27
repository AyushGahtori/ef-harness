---
id: systematic-debugging
version: 1
status: vetted
description: Reproduce, form a hypothesis, and name the root cause.
tools: none
license: MIT
---

# Reproduce, form a hypothesis, and name the root cause.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public systematic-debugging practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:systematic-debugging

Reproduce the failure with the smallest input that still fails.

Write the hypothesis before changing code. The hypothesis names the root cause you expect.

A fix that hides the symptom without matching the hypothesis is not done.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
