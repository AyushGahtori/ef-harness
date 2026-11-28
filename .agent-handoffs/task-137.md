---
task_id: "Task-137"
branch: "task/137-sign-in-with-chatgpt-oauth"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/siwc/**"
  - "packages/providers/tests/siwc/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 137 handoff

Sign in with ChatGPT: OAuth 2.0 PKCE + OIDC loopback, a stable `ext_agent_host_id`, dynamic client registration, single-flight refresh, the direct Responses adapter, and the client-side stream cutoff. Commit stays on `task/137-sign-in-with-chatgpt-oauth`.

## Exports Provided

Import from `packages/providers/src/siwc/index.ts`. The package barrel `packages/providers/src/index.ts` is intentionally unchanged.

- `SignInWithChatGptAuthFlow` — `ensureHostId`, `signIn`, `cancelActive`, `disconnect`, `previewLabel`. Opens the system browser through `SystemBrowserOpener.openExternal` (Electron `shell.openExternal`). Never embeds a WebView and never collects a password.
- `SiwcTokenRefresher.ensureFresh` — one in-flight refresh per connection. Workers that arrive while it is running share that promise. Refresh runs when `expiresAtMs - now < 120_000`.
- `SiwcDirectRequestAdapter` — `prepareWireBody` and `complete`. Always sends `store: false` and `stream: true`, strips unsupported Responses fields, and aborts via `AbortController` when the cutoff guard trips.
- `SiwcStreamCutoffGuard` — output-token ceiling (default `16_384`, trip when count is greater), degenerate repeat (default `512` chars, trip when the run is greater), and wall clock (default `600_000` ms). `finishReason` is `client_stream_cutoff`.
- `SiwcAllowanceHeaderExtractor` — `x-ratelimit-*`, `x-chatgpt-*`, `retry-after`, and error codes including `usage_limit_reached`, `rate_limit_exceeded`, and `reset_at`.
- `SqliteSiwcInstallationStore` — local stand-in that writes `meta` and `connections` with the foundation columns. Tokens are not written here.
- `LocalSignedProviderPolicyEngine` — local stand-in for the signed provider policy. Defaults are the public OpenAI SIWC endpoints.
- `buildSiwcWireBody`, `pkceS256`, `siwcTokenSecretName`.
- Labels and thresholds: `SIWC_PREVIEW_LABEL`, `SIWC_SCOPE_REJECTED_MESSAGE`, `SIWC_SIGN_IN_EXPIRED_MESSAGE`, `SIWC_ROUTE_REVOKED_GUIDANCE`, `CALLBACK_TTL_MS`, `REFRESH_LEAD_MS`, `OUTPUT_TOKEN_CEILING`, `DEGENERATE_RUN_CHARS`.

`SIWC_PREVIEW_LABEL` is `ChatGPT Subscription · Direct Preview · Uses your ChatGPT 5h/weekly allowance`.

A missing `chatgpt.tokens.use.direct` scope throws `SiwcScopeRejectedError` with `Your account didn't grant direct harness access (chatgpt.tokens.use.direct) — check plan eligibility or use an API key` and does not save the connection or the vault bundle.

`invalid_grant` (and the other terminal refresh codes) parks builds once, emits one account card `ChatGPT sign-in expired — Sign in again`, marks the connection `needs_sign_in`, and deletes the vault bundle. There is no paid-API fallback method.

`route_revoked` throws `SiwcRouteRevokedError` with `ChatGPT direct preview was revoked. Switch Connection, or use Codex CLI.` before the browser opens and before a direct request is sent.

## Shared Wiring Needs (Root / Index Barrels)

`packages/providers/src/index.ts` is outside this task. Re-export the SIWC module from it:

```ts
export {
  CALLBACK_TTL_MS,
  DEGENERATE_RUN_CHARS,
  LocalSignedProviderPolicyEngine,
  OUTPUT_TOKEN_CEILING,
  REFRESH_LEAD_MS,
  SIWC_DIRECT_SCOPE,
  SIWC_FORBIDDEN_WIRE_FIELDS,
  SIWC_PREVIEW_LABEL,
  SIWC_ROUTE_REVOKED_GUIDANCE,
  SIWC_SCOPE_REJECTED_MESSAGE,
  SIWC_SIGN_IN_EXPIRED_MESSAGE,
  SignInWithChatGptAuthFlow,
  SiwcAllowanceHeaderExtractor,
  SiwcCallbackTimeoutError,
  SiwcCancelledError,
  SiwcDirectRequestAdapter,
  SiwcError,
  SiwcInvalidStateError,
  SiwcNonceRejectedError,
  SiwcRouteRevokedError,
  SiwcScopeRejectedError,
  SiwcSignInExpiredError,
  SiwcStreamCutoffGuard,
  SiwcTokenRefresher,
  SqliteSiwcInstallationStore,
  STREAM_WALL_CLOCK_MS,
  buildSiwcWireBody,
  pkceS256,
  siwcTokenSecretName,
} from "./siwc/index.js";
export type {
  AccountCardEmitter,
  ActiveBuildParker,
  AllowancePacingFeed,
  SiwcAccessGrant,
  SiwcAllowanceIngest,
  SiwcAllowanceObservation,
  SiwcConnectionRecord,
  SiwcConnectionStatus,
  SiwcDirectResult,
  SiwcDisconnectResult,
  SiwcPolicyDecision,
  SiwcSecretsVault,
  SiwcSignInRequest,
  SignedProviderPolicyEngine,
  StreamCutoffOptions,
  SystemBrowserOpener,
} from "./siwc/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, schema, or package `package.json` change.

Task 140 should call `AllowancePacingFeed.ingest` with `SiwcAllowanceIngest` (`connectionId` plus `observation.kind` of `usage_limit` or `rate_limit`, `retryAfterSeconds`, `resetAtMs`, and the raw `x-ratelimit-*` map). This task does not pace.

Task 141 should render `previewLabel` and call `SignInWithChatGptAuthFlow.signIn` / `disconnect`. Pass Electron `shell` as `SystemBrowserOpener`. Map `SiwcRouteRevokedError` to Switch Connection and Codex CLI. Do not add a silent paid-key fallback.

Task 144 should read a fresh access token from `SiwcTokenRefresher.ensureFresh` and restart Codex with that token. This task does not start Codex.

Task 128 should subscribe to `ActiveBuildParker.park({ reason: "refresh_invalid_grant" })`. This task does not render the stop card.

## Dependency Intents (New Packages Requested)

None. PKCE, JWT (RS256), the loopback listener, and the Responses POST use Node built-ins (`node:crypto`, `node:http`, `node:https`, `node:sqlite`). No new package and no OAuth client library.

## Contract Change Requests

`schema/global.sql` `connections` has no `status` column, so this task does not alter it. `SqliteSiwcInstallationStore` writes the foundation columns (`id`, `provider` `openai`, `route` `siwc`, `plan`, `vault_ref`, `currency` `allowance:<id>`, `scale` 1, `enabled`, `created_at`) and stores the non-secret profile in `meta` under `siwc.profile.<connectionId>`. The profile `status` is `connected`, `disconnected`, or `needs_sign_in`. Disconnect sets `enabled = 0` and `vault_ref` null. Please add a real column later:

```sql
ALTER TABLE connections ADD COLUMN status TEXT NOT NULL DEFAULT 'connected'
  CHECK (status IN ('connected', 'disconnected', 'needs_sign_in'));
```

Until that lands, readers should use the profile JSON. `ext_agent_host_id` lives in `meta` key `ext_agent_host_id` as `urn:uuid:<uuidv4>`, created once per database and reused.

Vault names are `siwc/<connectionId>/tokens`. The value is one JSON object `{ access_token, refresh_token, id_token }` so a rotation is a single put. Swap the put/get/delete to Task 120 `WindowsDpapiSecretsVault` (`projectId: "machine"`, `envScope: "user"`, `name` as above, `providerHint: "openai-siwc"`). Do not copy the JSON into `global.db`, logs, or prompts.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-137-sign-in-with-chatgpt-oauth`.

- `pnpm --filter @ef-harness/providers typecheck` — exit 0 (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/providers lint` — exit 0 (`eslint .`).
- `pnpm --filter @ef-harness/providers test -- siwc` — exit 0. Vitest 5.1.1: 3 files, 24 tests passed. Covers RFC 7636 S256, `ext_agent_host_id` across a reopened `global.db`, `dynamic_agent_client` then the issued `client_id` on the token POST, reauthorization without `agent_name_hint`, missing `chatgpt.tokens.use.direct` rejected before save, bad OIDC nonce, incomplete registration, `400 Invalid state` with no code exchange, cancel and the 120s callback TTL constant (test override 40ms) closing the loopback port, personal and work vault isolation, callback client and subject mismatch leaving the saved bundle untouched, revocation via the discovery `revocation_endpoint`, local wipe when revocation cannot be confirmed, `route_revoked` before the browser opens, 10-worker and 12-worker single-flight refresh, the `< 120s` lead boundary, one `invalid_grant` account card and one park with no paid fallback, wire stripping of `temperature` / `max_output_tokens` / `previous_response_id` (and the rest of the preview unsupported set) with `store: false` and `stream: true`, host and bearer headers, SSE loop abort with `client_stream_cutoff`, the 16384 token ceiling, and `usage_limit_reached` / `rate_limit_exceeded` fed to the pacing port.
- `node scripts/verify-harmony.mjs --task 137` — exit 0, `harmony ok for Task-137` (schema 67/67, diagram check, owned-path scope, then workspace typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not on this base. These local ports must be swapped at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- **Task 014 `GlobalDbRepo.connections`:** `SqliteSiwcInstallationStore` is the port. Swap `ensureHostId`, `get`, `saveConnected`, `updateExpiry`, `markNeedsSignIn`, and `markDisconnected` onto `GlobalDbRepo` once `meta` and `connections` are the broker's tables. Keep tokens out of those tables. The profile JSON is the stand-in for the missing `status` column described above.
- **Task 120 `WindowsDpapiSecretsVault`:** `SiwcSecretsVault.put/get/delete` is the port. Tests use an in-memory vault. Production must use DPAPI. One secret per connection, named `siwc/<connectionId>/tokens`.
- **Task 135 `SignedProviderPolicyEngine`:** `LocalSignedProviderPolicyEngine.readSiwcPolicy` is the port. `routeRevoked` maps to `route_revoked`. `registerDynamicClient` selects `client_id=dynamic_agent_client` only when the connection has no issued client id yet. An empty `revocationEndpoint` is resolved from `revocation_endpoint` on the OpenID discovery document. Swap the method to the signed policy bundle and point the endpoints at that bundle when it disables the preview route.
- **Task 131 shell:** pass Electron `shell.openExternal` as `SystemBrowserOpener`. This package does not spawn a browser itself.
- **Task 140 allowance pacing:** `AllowancePacingFeed.ingest` is the port. Observations include rate-limit headers and `usage_limit_reached`, `rate_limit_exceeded`, `reset_at`, plus the subscription-sharing usage code when a body carries it. This task does not change concurrency.
- **Task 127 / Task 141 account card:** `AccountCardEmitter.emit` fires once per connection for `SIWC_SIGN_IN_EXPIRED_MESSAGE`. The UI owns the card. A second `ensureFresh` after the vault wipe does not emit again while `expiryNotified` is set.
- **Task 128 park:** `ActiveBuildParker.park` fires once with `reason: "refresh_invalid_grant"`. Swap to the checkpoint stop card. Do not continue on a paid API key.
- **Task 144 Codex:** guidance text only. Refresh the access token here, then let Task 144 restart `codex app-server` and call `thread/resume`.
- **Callback path:** the task's CSRF case is `http://127.0.0.1:<port>/callback` returning `400` and `Invalid state`. `CALLBACK_PATH` is `/callback`. OpenAI's current example uses `/auth/callback` and says the path must stay stable. Change `CALLBACK_PATH` in one place if a live authorization server requires `/auth/callback`.
- **Scope failure:** this task rejects and does not save the connection when `chatgpt.tokens.use.direct` is absent. The public SIWC page also describes keeping the sign-in and marking plan usage disabled. The task text is the behavior implemented.
- **Direct request header:** every Responses POST sends `Authorization: Bearer <access_token>` and `ext_agent_host_id`. The public inference example shows the bearer header; the task also requires the host id header, so both are sent.
- **Unsupported wire fields** removed in addition to `max_output_tokens`, `temperature`, and `previous_response_id`: `background`, `conversation`, `max_tool_calls`, `metadata`, `moderation`, `multi_agent`, `prompt`, `prompt_cache_retention`, `safety_identifier`, `top_logprobs`, `top_p`, `truncation`, `user`. System-role input items are moved into `instructions`. Hosted tool types (`file_search`, `code_interpreter`, and the other preview-unsupported types) are dropped. `store` and `stream` are forced after that pass.
- **Package barrel re-exports above are not applied in this commit.**
