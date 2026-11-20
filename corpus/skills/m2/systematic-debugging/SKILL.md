---
id: systematic-debugging
version: 1
status: vetted
description: Root-cause-first debugging protocol. Use when a check fails, a bug report is thin, or a change is about to paper over a symptom.
tools: none
license: MIT
---

# Systematic debugging

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public root-cause debugging practice for the EF Harness M2 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:systematic-debugging

Find the root cause before changing code. A patch that hides a symptom leaves the next failure in place.

## Order of work

1. Reproduce the failure with the smallest input that still fails. Record the exact command, fixture, and output.
2. Read the error, the stack, and the code path that produced them before editing anything.
3. State one hypothesis and the observation that would falsify it. If you cannot name that observation, you are guessing.
4. Gather evidence (the failing check, a log line, a stack frame, or a focused probe) that confirms or kills the hypothesis.
5. Change the root cause, not the message around it.
6. Re-run the same reproduction. It must pass for the reason the hypothesis named.
7. Add a regression check that failed on the old code and passes on the new code.

## Rules

- Do not stack a second change on top of an unproven first change.
- Do not delete, comment out, or rewrite a failing assertion to make the run green.
- If the failure is outside the task's owned files, stop and report the boundary instead of editing those files.
- If two hypotheses fit the evidence, name both and gather one observation that splits them.
- Keep verification on. A green run that skipped the failing check is not a fix.

## Smoke check

The worker can name the root cause, can reproduce the failure, and can state the hypothesis that the evidence supports.

## Output

Return a short note with:

- reproduction steps
- hypothesis
- evidence for or against it
- the root cause
- the files changed and the regression check that now passes
