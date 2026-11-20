---
id: docker-ci-deploy-hygiene
version: 1
status: vetted
description: Multi-stage builds, non-root containers, healthchecks, and lockfiles.
tools: none
license: MIT
---

# Multi-stage builds, non-root containers, healthchecks, and lockfiles.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public docker-ci-deploy-hygiene practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:docker-ci-deploy-hygiene

Build in stages. The runtime image contains the built output, not the compiler toolchain.

The runtime process is not root. The image declares a user with no needless write access.

A healthcheck hits the real readiness endpoint and fails when that endpoint fails.

Install from the lockfile so a rebuild does not float to a newer dependency.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
