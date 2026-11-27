---
id: brownfield-safe-refactoring
version: 1
status: vetted
description: Characterization tests first, narrow diffs, and no unrelated churn.
tools: none
license: MIT
---

# Characterization tests first, narrow diffs, and no unrelated churn.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public brownfield-safe-refactoring practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:brownfield-safe-refactoring

Before changing a legacy path, add a characterization test that records the current behavior you intend to keep.

The diff stays inside the behavior you were asked to change. Formatting, renames, and drive-by edits of unrelated files are out of scope.

If a characterization test fails after the change, the change is wrong unless the task explicitly asked for that new behavior.

Leave a note in the output naming the characterization test and the files you touched.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
