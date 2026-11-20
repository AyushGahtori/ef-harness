---
id: test-driven-verification
version: 1
status: vetted
description: Red-before-green and edge-case test design. Use when a task changes behavior that a check can observe.
tools: none
license: MIT
---

# Test-driven verification

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public red-before-green and edge-case testing practice for the EF Harness M2 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:test-driven-verification

Write the failing test first. Production code comes after that test is red for the right reason.

## Order of work

1. Name the observable behavior in one sentence: input, action, and the result a stranger could check.
2. Write the failing test for that behavior before editing production code.
3. Run it and confirm the run is red because the behavior is absent, not because the test does not compile or targets the wrong symbol.
4. Write the smallest production change that turns that test green.
5. Re-run the new test and the neighboring checks the change could affect.
6. Add the edge case the requirement names, one assertion at a time, each of them red before it is green.

## Edge cases to consider

Cover the boundaries the requirement actually has:

- empty, missing, and blank input
- the minimum and the maximum accepted value
- one step past the boundary
- duplicate or repeated submission
- unicode and surrounding whitespace when the field is text

Do not invent a behavior the requirement does not state. If the edge is unspecified, leave it untested and say so.

## Rules

- Do not change an expected value so a broken result looks correct.
- Do not delete a failing test to make the suite green.
- Keep each test specific enough that a failure names the broken behavior.
- A test that never failed does not yet pin the behavior. Show the red run.

## Smoke check

The worker writes a failing test, sees red, and covers the named edge case before calling the task done.

## Output

Return the test names, the red result you observed, the green result after the change, and any edge case you left open because the requirement does not decide it.
