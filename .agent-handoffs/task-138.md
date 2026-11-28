---
task_id: "Task-138"
branch: "task/138-openrouter-oauth-local-models"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/openrouter-local/**"
  - "packages/providers/tests/openrouter-local/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 138 handoff

OpenRouter PKCE (`S256`, `127.0.0.1` loopback, DPAPI-only minted key) and local Ollama / LM Studio discovery, capability probing, and VRAM slot control. Sibling packages are not on this branch. Callers use the ports below until integration swaps in the real types. Commit stays on `task/138-openrouter-oauth-local-models`.

## Exports Provided

Import from `packages/providers/src/openrouter-local/index.ts` until the package barrel is wired.

- `OpenRouterPkceOAuthFlow` — browser PKCE `S256` via `ExternalBrowserPort.openExternal` (Electron `shell.openExternal`). Ephemeral callback is `http://127.0.0.1:<port>/callback` only. Exchanges `POST /api/v1/auth/keys` with `code`, `code_verifier`, and `code_challenge_method: "S256"`. Optional consent prefill is the `limit` query param. Reads `GET /api/v1/auth/key` (`limit`, `usage`, `limit_remaining`). Display for a $5 remaining cap is `$5.00 remaining on OpenRouter key`. The minted key is passed only to `DpapiSecretsVaultPort.put`. `global.db` receives `vault_ref` plus `currency: "usd"` and `scale: 1000000`. Cancel (`access_denied`, `flow.cancel()`, timeout) writes no connection. A failed insert deletes the vault entry.
- `ingestOpenRouterUsageCost` — reads provider `usage.cost` into integer `costMicroUsd`. Missing `usage.cost` throws `cost-missing` instead of inventing a price.
- `OpenRouterCreditBalanceGuard` — `onBuildStart`, `afterTurn` (polls when the count is a multiple of 10), `afterHttpStatus` (polls on 402). Each success calls `CreditWindDownPort.bindOpenRouterCredit`. `windDownStartsAtMicroUsd` is 90% of the provider limit. `exhausted` is true at remaining `<= 0` or when a 402 refresh fails.
- `LocalModelAutoDiscoverer` — parallel probes, timeout clamped to `1500` ms, hosts `127.0.0.1` or `localhost` unless `allowLanHost` is explicitly true. Ollama: `GET /api/tags`, `POST /api/show` (`num_ctx`, `*.context_length`), `POST /api/ps` (`size_vram`). LM Studio: `GET /v1/models` and `GET /api/v0/models` (404 on the native route still keeps `/v1/models`). Both refused and unconfigured: `emptyMessage` is `No local servers detected (Ollama / LM Studio)`, `diagnoses` empty, no console logging. A previously configured refused server sets `diagnoses[].message` to `Ollama isn't running — Start Ollama and click Retry` (LM Studio has the matching sentence).
- `rememberDiscoveredServers` — inserts `route: "local"`, `currency: "local_slots"`, `vaultRef: null` only for servers that responded.
- `LocalModelCapabilityProber` — context floor `16384`. Below that, no chat call, `role: "chat_or_summary_only"`, both tool flags false, warning `Context 4k too small for coding tasks (needs >= 16k)` for 4096 tokens. At or above the floor, one tool+JSON probe (`ef_probe_ping`, nonce `ef-probe-1`) capped at 15 s and cached by digest. `tokensPerSecond` comes from Ollama `eval_count` / `eval_duration` or wall-clock completion tokens. Ollama probe bodies include `options.num_ctx` of `16384` or `32768`.
- `LocalVramSlotManager` — required bytes are `ceil(modelBytes * 1.25 + kvCacheBytes)`. Distinct models: 1 slot when the DXGI budget is `<= 16 GiB`, otherwise 2 when the second estimate fits. A second slot on weights already loaded is granted only when `ollamaNumParallel >= 2` (also read from `OLLAMA_NUM_PARALLEL`) and the extra KV fits, and never past 2. `onDictationHotkey` calls `WhisperPriorityPort.activateDictation` and the next `acquire` stays `whisper_priority`. `chooseExplicitNumCtx` / `buildOllamaChatBody` always send `num_ctx` `16384` or `32768` and reject `2048`.
- `localTurnReceipt` — `currency: "local_slots"`, `costMicroUsd: 0`, plus real token counts and wall-clock seconds.
- `LocalOnlyOfflineMode` / `planLocalOfflineRun` — a coding-eligible model yields phases `discover | plan | build | verify | run` with `cloudCalls: 0`. A model under the floor blocks without a cloud URL. `guard` rejects any non-loopback URL before a socket opens.
- `toLocalModelCapabilities` — `{ source: "ollama" | "lm-studio", models }` for Task 106 `VersionedModelRoster.applyLocalCapabilities`. Coding models at `>= 32768` are tier `senior`; other coding models are `junior`. Disqualified models keep `supportsTools` and `supportsStructuredJson` false so they cannot be tool workers. Prices are `0n`, `spendKind: "local"`.

In-memory stand-ins, replaced at integration: `InMemoryDpapiSecretsVault`, `InMemoryGlobalConnections`, `InMemoryCreditWindDown`, `InMemoryVramTelemetry`, `InMemoryWhisperPriority`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/providers/src/index.ts` and `packages/providers/package.json` stay untouched. No new dependency. Integration should re-export:

```ts
export {
  InMemoryCreditWindDown,
  InMemoryDpapiSecretsVault,
  InMemoryGlobalConnections,
  InMemoryVramTelemetry,
  InMemoryWhisperPriority,
  LocalModelAutoDiscoverer,
  LocalModelCapabilityProber,
  LocalOnlyOfflineMode,
  LocalVramSlotManager,
  OpenRouterCreditBalanceGuard,
  OpenRouterLocalError,
  OpenRouterOAuthCancelledError,
  OpenRouterPkceOAuthFlow,
  bindingFromBalance,
  buildOllamaChatBody,
  buildOpenRouterAuthorizeUrl,
  chooseExplicitNumCtx,
  connectionStorageRow,
  estimateRequiredVramBytes,
  ingestOpenRouterUsageCost,
  localTurnReceipt,
  planLocalOfflineRun,
  toLocalModelCapabilities,
} from "./openrouter-local/index.js";
```

```ts
export type {
  CreditWindDownPort,
  DiscoveredLocalModel,
  DpapiSecretsVaultPort,
  ExternalBrowserPort,
  GlobalConnectionRecord,
  GlobalConnectionsPort,
  GpuHeadroomSample,
  LocalModelCapabilitiesUpdate,
  LocalProbeResult,
  LocalRosterModelDraft,
  LocalServerDiagnosis,
  LocalTurnReceipt,
  OpenRouterCostReceipt,
  OpenRouterCreditBinding,
  VramTelemetryPort,
  WhisperPriorityPort,
} from "./openrouter-local/index.js";
```

Desktop wiring passes Electron `shell.openExternal` as `ExternalBrowserPort`. Do not open a password WebView.

## Dependency Intents (New Packages Requested)

None. Implementation uses Node built-ins (`node:crypto`, `node:http`) and the existing `@ef-harness/providers` toolchain. No `package.json` change.

## Contract Change Requests

None that require a schema migration. `schema/global.sql` `connections.currency` is unconstrained `TEXT`. This task writes `usd` for OpenRouter (scale `1000000`, micro-USD) and `local_slots` for Ollama / LM Studio (scale `1`). The column comment only names `usd` and `allowance:<id>`. Integration may extend that comment to mention `local_slots`. No CHECK change is required for these rows to insert.

`connectionStorageRow` is the column mapping: `vault_ref`, `created_at`, `enabled` as `0 | 1`. The secret is never a column.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-138-openrouter-oauth-local-models`:

- `pnpm --filter @ef-harness/providers typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/providers lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/providers test -- openrouter-local` — pass (`vitest` v5.1.1, 3 files, 20 tests, exit 0).
- `node scripts/verify-harmony.mjs --task 138` — pass (`harmony ok for Task-138`, exit 0).

Covered by those tests: PKCE `S256` challenge check against the exchanged verifier, loopback callback host `127.0.0.1`, DPAPI-only storage (connection JSON and vault metadata omit the fixture key), `$5.00` balance binding at 90% (`4500000` micro-USD), cancel and denied consent leave zero rows, insert failure rolls the vault entry back, `usage.cost` `0.001234` → `1234` micro-USD, credit polls on build start / turn 10 / HTTP 402, Ollama tags+show+ps and LM Studio `/v1/models` + `/api/v0/models`, refused probes under 300 ms with the empty-server message and zero `console.error` calls, configured `ECONNREFUSED` pause copy, non-loopback rejection before fetch, parallel hang abort under 2200 ms, 4096-token disqualification copy, cached tool probe at 20 tok/s with explicit `num_ctx` 32768, 12 GiB distinct-model cap, same-weight parallel slot only when `OLLAMA_NUM_PARALLEL` allows, Whisper hotkey deferral, `num_ctx` 16384 vs 32768, rejection of 2048, `local_slots` receipt with `costMicroUsd === 0`, and offline plan vs blocked 4k model with zero cloud calls.

Fixture secrets in tests are `fixture-openrouter-mint-7c2e` and `fixture-auth-code`. No live OAuth secret is committed.

## Known Limitations / Follow-Ups

Sibling branches are not merged. Swap these local ports at integration:

- **Task 120** `WindowsDpapiSecretsVault` satisfies `DpapiSecretsVaultPort` (`put`, `readSecret`, `delete`). This branch does not call `CryptProtectData`.
- **Task 014** `GlobalDbRepo.connections` satisfies `GlobalConnectionsPort`. Persist `connectionStorageRow`. This branch does not open `global.db`.
- **Task 128** `AtomicBudgetReservationLedger`: set `microUsdLimit` from `OpenRouterCreditBinding.limitMicroUsd`, then `postHistoricalSpend("micro-usd", usedMicroUsd)`. `exhausted` or `pastWindDown` is the signal to wind down before the hard credit cap. There is no direct import of `BudgetWindDownController`.
- **Task 117** `HardwareSnapshot.gpu` satisfies `GpuHeadroomSample` (`budgetBytes`, `currentUsageBytes`, `availableForReservationBytes`, `sharedVramBudgetBytes`, `gpuAvailable`, `metricUnavailable`). This branch does not call DXGI.
- **Task 118** `GpuWhisperPriorityArbiter` satisfies `WhisperPriorityPort` (`dictationActive`, `activateDictation`, `deactivateDictation`, `enqueueLocalModel`). Hotkey handling in the shell should call `LocalVramSlotManager.onDictationHotkey`.
- **Task 106** pass `toLocalModelCapabilities(...)` to `VersionedModelRoster.applyLocalCapabilities`. `tokensPerSecond` stays on `LocalProbeResult` for Task 107 HEFT; it is not a roster column.
- **Task 140** reads `local_slots` receipts and the slot manager's distinct/parallel caps. This branch does not implement AIMD.
- **Task 141** can render `display`, `emptyMessage`, and `LocalServerDiagnosis.message` on the Connections screen. This branch has no renderer UI.

Probe cache and credit turn counts are process memory. A restart probes and polls again. Discovery does not follow HTTP redirects. LAN hosts stay blocked until Settings sets `allowLanHost: true`.
