---
id: codemods-and-sweeps
version: 1
status: vetted
description: AST-safe renames, persisted-name boundaries, and preserved invariants.
tools: none
license: MIT
---

# AST-safe renames, persisted-name boundaries, and preserved invariants.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public codemods-and-sweeps practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:codemods-and-sweeps

Rename through the syntax tree. A text search that also changes strings, comments, and persisted keys is not a rename.

A name stored in a database, a wire contract, or a file format is a persisted name. Do not change it as part of a code rename.

After the sweep, the public behavior you were not asked to change still holds. Run the existing checks that cover it.

If a symbol has two meanings, stop and report the collision instead of rewriting both.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
