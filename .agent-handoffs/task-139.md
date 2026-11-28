---
task_id: "Task-139"
branch: "task/139-copilot-cursor-subscription-auth"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/copilot-cursor-auth/**"
  - "packages/providers/tests/copilot-cursor-auth/**"
  - ".agent-handoffs/task-139.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 139 handoff

GitHub Copilot device-flow / CLI reuse, `account.getQuota`, plan-aware premium multipliers, and Cursor browser auth with the 90-day key and 7-day expiry scheduler. Commit stays on `task/139-copilot-cursor-subscription-auth`.

## Exports Provided

Import from `packages/providers/src/copilot-cursor-auth/index.ts` (package barrel is intentionally untouched):

- `GitHubCopilotDeviceAuthFlow` — RFC 8628 device grant (`POST https://github.com/login/device/code`, poll `https://github.com/login/oauth/access_token`) plus official `gh` / `copilot` `--version` + `auth status` + `auth token` reuse. One-click label is `Use your signed-in GitHub account (@login)`. Button label is `Copy code & Open github.com/login/device`. `slow_down` adds 5 seconds to the server interval. `expired_token` and grant deadline stop the poller with retry action `Generate new code`. Cancel aborts the poller and writes nothing. Seat check maps `no_copilot_entitlement` and organization-policy bodies (exact message, not a bare 403). Allowed model subset and `billingMode` (`copilot_subscription` | `byok_api_key`) are stored on the connection. `disconnect` deletes the DPAPI entry and aborts pending pollers.
- `Rfc8628DevicePoller` — interval / `slow_down` / `expired_token` engine used by the flow.
- `OfficialCliAuthProbe` and `assertOfficialCliArgv` — allowlisted read-only CLI probe. Config files are never opened.
- `interpretCopilotSeatHttp` — seat HTTP mapping for entitlement failure vs organization policy.
- `CopilotQuotaReader` — calls `CopilotAccountClient.accountGetQuota` (the `account.getQuota` port) on `connection_verify`, `build_start`, and periodic ticks. Publishes `CopilotPacingSignal` for Task 140. `remaining === 0 && overageEnabled === false` opens a checkpoint card whose message is `Copilot premium requests exhausted — resets on <date> · Switch to 0x included model / Switch Connection / Keep Parked`. `remaining === 0 && overageEnabled === true` on a subscription connection pauses with `task141PaidTransition: true` until `confirmPaidOverage(connectionId, resetDateUtc)`. A later reset date requires a new confirmation. BYOK connections are tagged `billingMode: "byok_api_key"`, `analyticsCurrency: "api_usd"`, `subscriptionQuotaApplies: false`, and are not treated as subscription overage.
- `CopilotPlanCostWeighting` — reads `SignedProviderPolicyEnginePort.copilotPremiumMultipliers` (`0` included, `1` standard, `3` premium reasoning). `balanced` and `cheapest` use `0`/`1` for junior and mid work. `balanced` senior work may use `3`. `cheapest` senior work stays on `1` when a non-premium model is allowed. Models absent from the connection's allowed subset (for example organization-blocked `claude-sonnet`) are never selected. Result carries `task106Roster` and `task140Weight`.
- `CursorBrowserAuthFlow` — `CursorAuthLoginPort.login` is the `Cursor.auth.login()` port. The browser opener is `openExternal(url, "os_browser")` only. The user key is stored in the DPAPI port. `expiresAt = issuedAt + 90 days`. Validation calls `getUsage` (`Agent.getUsage`) and `probeModels`. Cancel aborts the in-flight login and leaves no row. `refresh(connectionId)` replaces the vault entry and resets `expiresAt`. `disconnect` deletes the vault entry.
- `CursorKeyExpiryReminderScheduler` — `onColdOpen` and `onDailyTick`. Day 82 (8 days left) emits nothing. `<= 7 days` emits one calm non-blocking card (`Your Cursor key expires in N days — Refresh in 1 click`, action `Refresh now`). Acknowledgement suppresses that card until `<= 48 hours`, which emits one urgent card. Day 90 (`remaining <= 0`) and `onHttp401` park dispatches, emit `AccountCard` with action `Re-sign in with Cursor`, set `enabled: 0`, and call `NoSilentPaidFallbackPort.refuseSilentPaidFallback` (`cursor_subscription` → `paid_api_key`). The route stays `cursor_sdk`.
- Local stand-ins, swapped at integration: `LocalWindowsDpapiSecretsVault`, `LocalGlobalDbConnections`, `LocalSignedProviderPolicy`, `ManualClock`, `ManualTimerRegistry`, `SystemTimerRegistry`, `abortableDelay`, `RedactingAuditLog`.

Raw `gitHubToken` and Cursor user keys are rejected from `global.db` snapshots, audit lines, and the vault's at-rest export. `vault_ref` matches `vault:...` and is the only credential pointer on the row.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/providers/src/index.ts` on this branch. Integration should add:

```ts
export {
  GitHubCopilotDeviceAuthFlow,
  CopilotQuotaReader,
  CopilotPlanCostWeighting,
  CursorBrowserAuthFlow,
  CursorKeyExpiryReminderScheduler,
} from "./copilot-cursor-auth/index.js";
```

No root `package.json` dependency was added. Copilot SDK and `@cursor/sdk` stay behind the injected ports (`CopilotAccountClient`, `CopilotSeatVerifier`, `CursorAuthLoginPort`, `CommandRunner`, `GitHubDeviceHttp`, `UserAgentActions`). Wire those to the real clients in Tasks 145 and 146.

`LocalGlobalDbConnections` is the stand-in for Task 014 `GlobalDbRepo.connections` / `GlobalBrokerDb`. `LocalWindowsDpapiSecretsVault.writeSecret` / `readSecret` / `deleteSecret` is the stand-in for Task 120 `WindowsDpapiSecretsVault` (`CredWriteW` / `CredReadW` / `CredDeleteW`, DPAPI). `LocalSignedProviderPolicy.copilotPremiumMultipliers` is the stand-in for Task 135 `SignedProviderPolicyEngine`.

Downstream ports to bind:

- `CopilotPacingFeed` → Task 140 `AllowancePacingController`
- `CheckpointStopNotifier` → Task 128 checkpoint stop card
- `CopilotWeightedModelChoice.task106Roster` → Task 106 roster
- `AccountCardSink` and `ReminderCardSink` → Task 127 `AccountCard`
- `NoSilentPaidFallbackPort` → Task 141 `NoSilentPaidFallbackGuard`
- `CursorDispatchParker` → Cursor dispatch parking used by Tasks 140 and 146

## Dependency Intents (New Packages Requested)

None. No package.json changes. Real `@github/copilot` / `@cursor/sdk` clients are integration adapters, not new workspace packages from this task.

## Contract Change Requests

`schema/global.sql` `connections` has no columns for issuance, expiry, billing mode, allowed models, organization policy, or reminder acknowledgement. This task does not edit `schema/`. `LocalGlobalDbConnections.exportSnapshot` writes the frozen columns (`id`, `provider`, `route`, `plan`, `vault_ref`, `currency`, `scale`, `enabled`, `created_at`) plus `metadata_json` for:

- Copilot: `authMode`, `billingMode`, `accountLogin`, `allowedModels`, `orgPolicyMessage`, `maskedPreview`, `verifiedAt`, `overageApprovedForReset`
- Cursor: `issuedAt`, `expiresAt` (`issuedAt + 90 days`), `status`, `reminder`, `chargedCents`, `modelCount`, `maskedPreview`

Task 014 should persist that companion (new columns or a side table) without ever storing secret bytes. `vault_ref` remains a credential-manager name only. Currency is `allowance:<connectionId>` for subscription Copilot and Cursor, and `usd` for Copilot `byok_api_key`, so Task 141 does not add premium requests to API dollars.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-139-copilot-cursor-subscription-auth`:

- `pnpm --filter @ef-harness/providers typecheck` — passed (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/providers lint` — passed (`eslint .`).
- `pnpm --filter @ef-harness/providers test -- copilot-cursor-auth` — passed, 4 files, 29 tests. Covers RFC 8628 `authorization_pending` → `slow_down` (+5s, delays 5000/5000/10000) → success, `expired_token` with `Generate new code`, 15s grant deadline, cancel, cancel-during-seat, `no_copilot_entitlement`, organization-policy message, allowed-model subset excluding `claude-sonnet`, `access_denied`, two-account separation, disconnect wipe, `gh` and `copilot` CLI reuse, official argv refusal, `account.getQuota` verify/build/periodic, exhausted checkpoint copy, paid-overage pause until explicit confirm, BYOK currency split, `0`/`1`/`3` weighting, Cursor 90-day `expiresAt`, OS-browser channel, cancel, login 401, Day 82 silence, Day 83 seven-day card, Day 84 six-day card once, acknowledgement until 48 hours, refresh +90 days, Day 90 and 401 park with no paid fallback, and zero raw tokens in the snapshot, log, and at-rest vault export.
- `node scripts/verify-harmony.mjs --task 139` — passed (`harmony ok for Task-139`).

## Known Limitations / Follow-Ups

- Sibling branches 014, 120, and 135 are not in this foundation base. The three `Local*` classes are the ports to swap. No live GitHub, Copilot SDK, Cursor SDK, DPAPI, or OS browser calls run in tests.
- Fake credentials are the literals `fixture-copilot-user-token-alpha`, `fixture-copilot-user-token-bravo`, `fixture-cursor-user-key-bravo`, and `fixture-cursor-user-key-charlie`. No machine tokens were copied.
- `SystemTimerRegistry` and `abortableDelay` are the process-timer adapters. Tests use `ManualTimerRegistry` and `ControllableSleep`.
- A routine `balanced`/`cheapest` selection falls through to a `3x` model only when the organization allows nothing cheaper.
- Reminder copy uses whole days (`floor`). Inside the last day the calm card says `less than 1 day`.
- Pending Copilot device flows on the same flow instance are aborted by any `disconnect` call, including a disconnect of one saved account, so a second in-progress device grant is not left polling.
