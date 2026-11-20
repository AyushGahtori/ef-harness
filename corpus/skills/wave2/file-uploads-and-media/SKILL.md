---
id: file-uploads-and-media
version: 1
status: vetted
description: Magic-byte checks, byte limits, sanitized names, and non-executable responses.
tools: none
license: MIT
---

# Magic-byte checks, byte limits, sanitized names, and non-executable responses.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public file-uploads-and-media practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:file-uploads-and-media

Identify the file from its magic bytes, not from the client filename or the client content type.

Reject a body over the stated byte limit before storing it. Count the bytes you received.

Store the object under a generated name. Do not use the raw client path.

Serve the object with a content type you verified and a disposition that does not execute it in the browser.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
