---
task_id: "Task-141"
branch: "task/141-no-silent-fallback-connections-ui"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/fallback-guard/**"
  - "packages/providers/tests/fallback-guard/**"
  - "apps/renderer/src/connections/**"
  - "apps/renderer/tests/connections/**"
  - ".agent-handoffs/task-141.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 141 handoff

No-silent-paid-fallback guard, Settings → Connections, and honest usage analytics on `task/141-no-silent-fallback-connections-ui`. Sibling task branches are not in this base (`649773097c387ae534b686ea5825f449f843aa7c`). Local ports stand in for them. Swap the constructors below; keep the method names.

## Exports Provided

Produced for Task 122 (Settings → Connections navigation), Task 152 (M4 zero-silent-fallback certification), and Task 199 (provider terms UI audit):

- `NoSilentPaidFallbackGuard` — `evaluate`, `assertAllowed`, and `refuseSilentPaidFallback`. Default policy is ask-first. Silent moves are blocked for local/free → any paid billing, subscription → pay-per-token, subscription or Copilot → paid overage, and any paid connection → a higher `costRank`. Window exhaustion, expiry, `route_revoked`, crash, and repeated failure (3) hard-pause onto a checkpoint stop card (`Switch Connection`, cost estimate, one-click consent) unless `neverFallbackWithoutAsking` is false and `explicitFallbackOrder` contains that pair with a hard micro-USD cap. Spend at or above the cap, or a charge that would cross it, stays parked. `refuseSilentPaidFallback({ connectionId, from: "cursor_subscription", to: "paid_api_key" })` matches the Task 139 port and always blocks.
- `ConnectionsManagementScreen` — onboarding cards for Sign in with ChatGPT, Paste API Key, OpenRouter PKCE, GitHub Copilot, Cursor, and local Ollama / LM Studio. Gemini CLI (ACP) stays off until the policy checkbox is accepted, shows `gemini --acp`, and stays off when compliance is `disabled_by_policy` or `route_revoked`. Claude Code shows `Anthropic Console API key required` and `data-auth="console_api_key"`. The withdrawn vendor name is absent. Health rows show label, provider, auth mode, billing badge (`Subscription` | `Pay-per-token` | `Local Free`), masked key or email, status, allowance bar, cwnd, Cursor expiry inside 7 days, CLI conformance, and Test / Refresh / Pause / Remove. Ask-first defaults on. Turning it off shows the loud cap warning. Subscription reserve slider and pay-per-token soft/hard caps are stored on the row. Role pins warn with `Using a different model family for Oracles improves bug detection` and still keep the pin. Removing the last connection during a paused build shows `No active connections left — connect a provider before resuming`.
- `HonestUsageAnalyticsView` — API micro-USD (input, cached, output, reasoning) badged `Estimated from published rates (table vX)` or `Provider-reported (OpenRouter)`, grouped by project, feature, phase (`Coding >= 80%` / `Paperwork <= 20%`), and model. Subscription windows keep 5h / weekly / monthly percent, reset countdown, `k[model]`, and Copilot premium requests. Local shows tokens, tok/s, GPU time, and `$0.00` cloud spend. Currencies are never blended.
- `UsageReceiptsCsvExporter` — `ef-harness-usage-YYYY-MM-DD.csv`, CRLF, RFC 4180 quoting. Cells that start with `=`, `+`, `-`, `@`, tab, or CR are prefixed with `'`. Secret and vault fields are not columns and are not written into `telemetry.data`.

Supporting exports from `packages/providers/src/fallback-guard/index.ts`: `FallbackBlockedNeedsConsentError`, `evaluateScreenFallback`, `evaluateWithLedger`, `dispatchConnectionProbe`, `billingClassForBadge`, `MemoryBudgetLedger`, `MemorySignedProviderPolicy`, `MemoryAllowancePacing`, `classifyEscalation`, `fallbackInput`, `formatMicroUsd`, and the port types.

Supporting exports from `apps/renderer/src/connections/index.ts`: `ConnectionsScreenView`, `renderConnectionsHtml`, `AnalyticsScreenView`, `renderAnalyticsHtml`, `TelemetryReceiptStore`, `EphemeralKeyBuffer`, `probeKindFor`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/providers/src/index.ts` or `apps/renderer/src/index.ts` on this branch. Integration should add:

```ts
export {
  NoSilentPaidFallbackGuard,
  FallbackBlockedNeedsConsentError,
  evaluateScreenFallback,
  evaluateWithLedger,
  dispatchConnectionProbe,
  billingClassForBadge,
  MemoryBudgetLedger,
  MemorySignedProviderPolicy,
  MemoryAllowancePacing,
} from "./fallback-guard/index.js";
```

```ts
export {
  ConnectionsManagementScreen,
  ConnectionsScreenView,
  renderConnectionsHtml,
  HonestUsageAnalyticsView,
  AnalyticsScreenView,
  renderAnalyticsHtml,
  UsageReceiptsCsvExporter,
  TelemetryReceiptStore,
} from "./connections/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or schema edits. The renderer must not import `@ef-harness/providers` until that barrel exports the guard. `evaluateScreenFallback` is the adapter: its request fields match `FallbackGuardPort.evaluate` (`activeId`, `candidateId`, `reason`, `neverFallbackWithoutAsking`, `explicitFallbackOrder`, `spentMicroUsd`, `incomingMicroUsd`, `userConsent`). The integrator adds `connections: GuardConnection[]`.

`renderConnectionsHtml` rewrites React 19's `autoComplete` attribute to `autocomplete="off"` so the masked key field matches the HTML autocomplete contract.

## Dependency Intents (New Packages Requested)

None. `apps/renderer/package.json` is frozen. `react` and `react-dom` already exist as root devDependencies and resolve by walking up `node_modules`. Declare them on `@ef-harness/renderer` at integration. Views are `createElement` calls. Markup is `renderToStaticMarkup`. No new runtime package.

## Contract Change Requests

None for `schema/` or `packages/shared-contracts`. `schema/telemetry.sql` stays untouched.

`TelemetryReceiptStore` writes the foundation `telemetry` row (`attempt`, `ts`, `kind = usage_receipt`, JSON `data` with no secret fields) and, in the same database, typed tables `usage_receipt_fact`, `usage_api_summary`, `usage_window_summary`, `usage_local_summary`, and `usage_currency_count`. Page, search, and totals read those tables so 10,000 receipts stay under 50 ms. `json_extract` over `telemetry.data` does not. Do not add those accelerator tables to the frozen schema; they are a cache beside `telemetry`.

Local ports to swap when sibling branches land:

| This branch | Replace with | Swap note |
| --- | --- | --- |
| `BudgetLedgerPort` / `MemoryBudgetLedger` | Task 023 `BudgetLedger` | `fallbackSpendMicroUsd(projectId, fromConnectionId, toConnectionId)` is cumulative integer micro-USD. `evaluateWithLedger` copies it into `spentMicroUsd`. |
| `SignedProviderPolicyEnginePort` / `MemorySignedProviderPolicy` | Task 135 `SignedProviderPolicyEngine` | `routeCompliance` returns `allowed`, `opt_in_with_notice`, `disabled_by_policy`, or `route_revoked`. Pass that value as `ConnectionsManagementScreen` `geminiCompliance`. |
| `AllowancePacingControllerPort` / `MemoryAllowancePacing` | Task 140 `AllowancePacingController` | `activeCwnd(connectionId)` and `reservePercent(connectionId)`. The screen slider is the local reserve (integer 0–100) until the controller owns `reserveFraction`. |
| `ApiKeyAuthPort.probe` | Task 136 `ZeroTokenApiKeyValidator.validate` | `dispatchConnectionProbe("api_key", ports, connectionId)`. Result is latency, discovered model count, and a diagnostic. Completion tokens stay zero. |
| `SiwcAuthPort.probe` | Task 137 `SignInWithChatGptAuthFlow` | `dispatchConnectionProbe("siwc", ...)`. |
| `OpenRouterAndLocalAuthPort.probe` | Task 138 `OpenRouterPkceOAuthFlow` / `LocalModelAutoDiscoverer` | `dispatchConnectionProbe("openrouter_or_local", ...)`. |
| `CopilotCursorAuthPort.probe` | Task 139 `CopilotQuotaReader` / `CursorBrowserAuthFlow` | `dispatchConnectionProbe("copilot_or_cursor", ...)`. |
| `NoSilentPaidFallbackGuard.refuseSilentPaidFallback` | Task 139 `NoSilentPaidFallbackPort` | Same event: `{ connectionId, from: "cursor_subscription", to: "paid_api_key" }`. Return value may be ignored. |
| `FallbackGuardPort` on the screen | `evaluateScreenFallback(guard, request)` | Screen `previewSwitch` / `consentSwitch` forward the stored cap rules. One-click consent sets `userConsent`. |
| `SingleAppShellNavigationPort.openSettings` | Task 122 `SingleAppShell` | Routes `connections` and `usage`. Screen `routeId` values are `settings/connections` and `settings/usage`. |
| Screen checkpoint aside | Task 128 `CheckpointStopCardView` | Card fields are message, cost estimate, action `Switch Connection`, and `parked`. |
| `probeKindFor` result `conformance` | Task 151 `AdapterConformanceRunner` | CLI and `gemini_cli` use the conformance drawer. Other auth modes use the zero-token probe. |
| `SecretVault.put` | Task 120 `WindowsDpapiSecretsVault` | `EphemeralKeyBuffer.save` drops the raw key immediately. The renderer keeps the mask and the vault ref only. |

Workers, planners, and runtime adapters (Tasks 142–149) call `assertAllowed` before changing connection. A blocked decision throws `FallbackBlockedNeedsConsentError`.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-141-no-silent-fallback-connections-ui`:

- `pnpm --filter @ef-harness/providers typecheck` — exit 0.
- `pnpm --filter @ef-harness/renderer typecheck` — exit 0.
- `pnpm --filter @ef-harness/providers lint` — exit 0.
- `pnpm --filter @ef-harness/renderer lint` — exit 0.
- `pnpm --filter @ef-harness/providers test -- fallback-guard` — exit 0. 1 file, 16 tests passed. Covers Local → Paid, Subscription → Paid, Copilot → Overage, and Cheap → Expensive refused unless an explicit cap opts in; hard stop at $2.00; Ollama crash refused onto OpenAI; expiry, revocation, and repeated failure; Cursor subscription refused onto a paid API key; screen-port adapter; ledger spend; auth-probe dispatch.
- `pnpm --filter @ef-harness/renderer test -- connections` — exit 0. 2 files, 13 tests passed (repeated once, both green). Covers Gemini off until the checkbox, policy revocation lock, Claude Code console-key copy, no withdrawn vendor string, masked password field with `autocomplete="off"`, raw key dropped on save, allowance bar, reserve, caps, Cursor 7-day warning, zero-token and conformance drawers, last-connection banner, oracle family note, ask-first warning, cap rules forwarded into the guard, keyboard order, WCAG AA contrast, separated API / subscription / local currencies, 10,000-row page under 50 ms, and RFC 4180 formula neutralization with no secret columns.
- `node scripts/verify-harmony.mjs --task 141` — exit 0. `harmony ok for Task-141` (schema 67/67, diagram check, owned-path scope, then workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

- `MemoryBudgetLedger`, `MemorySignedProviderPolicy`, and `MemoryAllowancePacing` are in-memory stand-ins. They are not Task 023, Task 135, or Task 140.
- `SecretVault` is injected. This task does not call DPAPI. The buffer forgets the raw key after `put`.
- Opening a pre-existing `telemetry.db` that already has `telemetry` rows does not rebuild `usage_receipt_fact` (`CREATE TABLE IF NOT EXISTS` only). New inserts update both. Rebuild the fact tables to page historical JSON rows.
- The connections screen renders its own checkpoint aside. Mount Task 128 `CheckpointStopCardView` when that branch is on the integration base.
- Role pins and the reserve slider are screen state. They are not yet pushed into Task 106 or Task 140.
- Package barrels stay unwired until integration, as listed above.
