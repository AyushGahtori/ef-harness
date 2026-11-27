---
id: react-state-and-forms
version: 1
status: vetted
description: Controlled forms, validation, optimistic state, and race-free effects.
tools: none
license: MIT
---

# Controlled forms, validation, optimistic state, and race-free effects.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public react-state-and-forms practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:react-state-and-forms

Keep each input controlled. The rendered value and the submitted value are the same state.

Validate before submit. Show the field error next to that field. Do not clear the user's text when validation fails.

Optimistic updates render the intended state immediately and roll it back when the server rejects the write. A rollback restores the last confirmed value.

Effects that start a request record the request identity. A slower response for an older identity must not overwrite a newer one. Cancel or ignore the stale response on cleanup.

Do not store a secret in component state that is written to a log or a client store.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
