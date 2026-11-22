---
task_id: "Task-136"
branch: "task/136-api-key-onboarding-pricing"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/api-keys/**"
  - "packages/providers/tests/api-keys/**"
  - ".agent-handoffs/task-136.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 136 handoff

API key onboarding lives under `packages/providers/src/api-keys/`. Commit stays on `task/136-api-key-onboarding-pricing`.

## Exports Provided

Produced for Task 053 (native worker turn costing), Task 141 (connections UI and usage analytics), and Task 147 (Claude Code console key injection):

- `ApiKeyPrefixDetector` — local paste inspection. Detects Anthropic console, OpenRouter v1, OpenAI project, OpenAI standard, and Gemini `AIza` families. Subscription OAuth tokens are rejected before any network call with the required console-key message. Leading and trailing whitespace and matching quotes are removed; internal characters stay.
- `ZeroTokenApiKeyValidator` — `GET` model-list only (`/v1/models`, Gemini `/v1beta/models`, custom `{base}/models`). Completion tokens billed are always `0`. Gemini sends `x-goog-api-key` and never a `key` query parameter. Failure classes: `401` invalid key, `402` / billing not active, `403` org restriction, `429` rate limit, `429` insufficient quota (billing setup), and network or proxy blocked.
- `ApiConnectionManager` — vault-backed registry. Multiple labels per provider. Rotate keeps `connectionId` and ledger receipts. Disable keeps the secret and history. Delete wipes the vault entry immediately. Offline save returns `Save unverified (offline) — will verify before first build` and does not mark the row verified.
- `VersionedPriceTableEstimator` — integer micro-USD rates for input, output, cached read, cache write, and reasoning. Estimated rows use `Estimated from published rates (price table v2026.11)` until a policy update changes the version. Provider-reported costs (decimal dollar strings such as OpenRouter `usage.cost`, or integer micro-USD) are a separate `provider_reported` row. Custom endpoints default to `pricing_status: unpriced_custom_endpoint` and `Custom endpoint — cost unpriced`. `cacheEconomics(provider)` exposes prefix stability and cache TTL for Anthropic ephemeral breakpoints (300s), OpenAI automatic prefix (600s), Gemini context cache (3600s), OpenRouter upstream passthrough, and custom (no cache).

Supporting exports from `packages/providers/src/api-keys/index.ts`: port interfaces and local adapters below, `normalizePastedApiKey`, `microUsdForTokens`, `decimalDollarsToMicroUsd`, `VALIDATION_MESSAGES`, and the price-table version constant.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/providers/src/index.ts` on this branch. Integration should add:

```ts
export {
  ApiKeyPrefixDetector,
  ZeroTokenApiKeyValidator,
  ApiConnectionManager,
  VersionedPriceTableEstimator,
} from "./api-keys/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or schema edits.

## Dependency Intents (New Packages Requested)

None. Implementation uses Node built-ins only (`node:sqlite`, `node:crypto`, `node:fs`). No new package dependency.

## Contract Change Requests

Sibling task branches are not in this base (`649773097c387ae534b686ea5825f449f843aa7c`). Local ports stand in for them. Swap these constructors at integration; keep the port method names.

| This branch | Replace with | Swap note |
| --- | --- | --- |
| `GlobalDbConnectionsPort` / `LocalGlobalDbConnections` | Task 014 `GlobalDbRepo.connections` | File-backed `global.db` uses the foundation `connections` columns (`id`, `provider`, `route = api_key`, `vault_ref`, `currency = usd`, `scale = 1000000`, `enabled`, `created_at`) plus child table `api_key_connection_meta` for label, `auth_mode = api_key`, masked preview, discovered models, monthly cap text, `verified_at`, `status`, `resume_status`, custom base URL, and custom rates. No raw key column. |
| `BudgetLedgerPort` / `LocalBudgetLedger` | Task 023 `BudgetLedger` / `BudgetLedgerRepo` | `record` / `listByConnection`. Receipts are integer micro-USD and carry `pricingSource` `estimated`, `provider_reported`, or `unpriced`. |
| `VersionedModelRosterPort` / `LocalVersionedModelRoster` | Task 106 `VersionedModelRoster` | `describe(modelId)` returns `micro_usd`, `ppm`, or `local_slots`. `ppm` and `local_slots` are refused so currencies are not mixed. Optional `rates` fill models missing from the price table. |
| `WindowsDpapiSecretsVaultPort` / `LocalDpapiSecretsVault` | Task 120 `WindowsDpapiSecretsVault` | Same `put` / `rotate` / `getPlaintext` / `delete` / `has` / `metadata`. Secret id format is `api-key:<connectionId>`. |
| `CompliancePolicyLocksPort` / `LocalCompliancePolicyLocks` | Task 135 `CompliancePolicyLocks` | `inspectApiKey` rejects the subscription OAuth family. The detector also rejects that family if a lock port is misconfigured. |
| `SignedProviderPolicyEnginePort` / `LocalSignedProviderPolicyEngine` | Task 135 `SignedProviderPolicyEngine` | `currentPriceTable()` seeds the estimator. `applyPolicyUpdate` applies later signed price rows and the version string. |

Schema request for Task 014, not applied here: add the API-key metadata columns or the child table above to `global.db`. `schema/global.sql` stays untouched.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-136-api-key-onboarding-pricing`:

- `pnpm --filter @ef-harness/providers typecheck` — exit 0.
- `pnpm --filter @ef-harness/providers lint` — exit 0.
- `pnpm --filter @ef-harness/providers test -- api-keys` — exit 0. 4 files, 24 tests passed. Covered prefix families, subscription rejection, quote and whitespace trimming, model-list-only transport, Gemini header transport with no `key` query, `401` / `402` / `403` / `429` / quota / offline classes, cached-read integer micro-USD (7,050 vs 30,000 on a 10,000-token input that is 85% cached), provider-reported vs estimated tags, unpriced custom endpoints, and vault plus `global.db` byte scans with no raw key material.
- `node scripts/verify-harmony.mjs --task 136` — exit 0. `harmony ok for Task-136`.

## Known Limitations / Follow-Ups

- `LocalDpapiSecretsVault` encrypts with AES-256-GCM and a process-local key so plaintext is absent from the vault file. It is not Windows DPAPI. Task 120 must replace it; the port shape is the swap point.
- Delete removes the connection row and the vault secret immediately. Task 023 ledger receipts for that connection id are kept for spend history.
- Connection rename is left to Task 141. Labels are set when the key is saved.
- Bundled table `v2026.11` is the default integer rate card (policy can replace it). It is not a live price scrape.
- An all-zero custom rate table is reported as unpriced, same as omitting the table, so a zero default is not presented as a measured price.
- The local compliance port enforces the subscription-token rejection this task owns. The rest of the Task 135 lock set stays in that task.
