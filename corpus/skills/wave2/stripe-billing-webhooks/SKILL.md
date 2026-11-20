---
id: stripe-billing-webhooks
version: 1
status: vetted
description: Signature checks, idempotent webhook tables, and integer minor units.
tools: none
license: MIT
---

# Signature checks, idempotent webhook tables, and integer minor units.

SPDX-License-Identifier: MIT
Attribution: Offline vendor of the public stripe-billing-webhooks practice for the EF Harness v1 catalog. Instruction-only. No scripts, no network, no user-config writes.
Upstream: offline-vendor:stripe-billing-webhooks

Verify the webhook signature before reading the event as trusted. A failed signature is a rejection, not a retryable success.

Store the event id in an idempotency table before the side effect. A second delivery of the same id does not fulfill again.

Store money as integer minor units. Do not use a binary floating point for a charge.

A browser redirect is not proof of payment. Fulfillment waits for the signed webhook.

## Smoke check

The worker follows the rules in this skill and names the checks in the output.

## Output

List the decision, the failure you guarded against, and the check that proves it.
