---
id: desktop-electron-ipc-security
version: 1
status: vetted
description: Context isolation, a narrow preload bridge, CSP, and no node integration.
tools: none
license: MIT
---

# Context isolation, a narrow preload bridge, CSP, and no node integration.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public desktop-electron-ipc-security practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:desktop-electron-ipc-security

Enable context isolation. The renderer does not receive Node integration.

The preload script exposes a narrow bridge of named methods. It does not expose a generic IPC send.

The renderer content-security policy does not allow remote script or inline event handlers.

Secrets stay on the main side of the bridge and are stored in the OS keychain, not in a renderer store.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
