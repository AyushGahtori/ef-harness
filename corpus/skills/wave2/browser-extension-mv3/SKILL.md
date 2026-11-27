---
id: browser-extension-mv3
version: 1
status: vetted
description: Service-worker persistence, strict host permissions, and sanitized DOM injection.
tools: none
license: MIT
---

# Service-worker persistence, strict host permissions, and sanitized DOM injection.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public browser-extension-mv3 practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:browser-extension-mv3

Treat the service worker as ephemeral. Persist anything the next wake must see before the handler returns.

Request the smallest host permission that performs the task. Prefer the active tab or an explicit host list over every URL.

Inject into the DOM with text or a constructed node. Do not assign an HTML string from page content.

Extension pages keep a strict content-security policy. Messaging uses the runtime channel and checks the sender.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
