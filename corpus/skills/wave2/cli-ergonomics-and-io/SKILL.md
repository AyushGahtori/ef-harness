---
id: cli-ergonomics-and-io
version: 1
status: vetted
description: Clean stdout, stderr logs, JSON output, exit codes, and signal cleanup.
tools: none
license: MIT
---

# Clean stdout, stderr logs, JSON output, exit codes, and signal cleanup.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public cli-ergonomics-and-io practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:cli-ergonomics-and-io

Human logs go to stderr. When JSON output is requested, stdout is one JSON document and nothing else.

Exit codes are stable. Success is zero. A usage error, a missing resource, and an unexpected failure do not share a code.

On interrupt, finish or roll back the current write and release the lock or child process you started.

A non-interactive flag must not prompt. A missing required flag fails with the usage code.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
