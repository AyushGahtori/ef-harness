---
task_id: "Task-051"
branch: "task/051-oauth-stripe-mocks-port-fallback"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/test-env/src/auth-payment-mocks/**"
  - "packages/test-env/tests/auth-payment-mocks/**"
  - ".agent-handoffs/task-051.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 051 handoff

Local loopback OAuth/OIDC mock, Stripe API mock plus cryptographic webhook deliverer, and hard-coded port 3000 fallback. Commit stays on `task/051-oauth-stripe-mocks-port-fallback`.

## Exports Provided

- `LocalOAuthMockProvider` — one in-process OIDC server on `127.0.0.1`, issuer path per environment, RS256 JWKS, authorize/token/userinfo, exact redirect URI registration, seeded roles (`admin`, `manager`, `kitchen_staff`, `member`, `unauthorized`), and verifier methods for valid login, tampered state, expired code, expired JWT (`iat`/`exp` overrides), invalid signature, and forbidden role. `destroy(envId)` drops that environment only.
- `StripeMockAndWebhookProvider` — per-project `stripe-mock` when the binary stays up, otherwise a loopback Stripe API-shape emulator. `deliverSignedWebhook(envUrl, eventPayload, signingSecret, options?)` sends valid, forged, expired-timestamp, and sequential or `Promise.all` replay deliveries.
- `GenericWebhookDeliverer` — HMAC-SHA256 for `X-Hub-Signature-256` and Svix/Standard Webhooks (`webhook-*` and `svix-*`), including forged and replayed event ids.
- `HardCodedPortFallbackManager` — precedence (1) Phase 0 / brownfield configurability recommendation, (2) Tier D network namespace when Docker is available, (3) exclusive `port:3000` lease in the global broker database. Also `acquireExternalSandboxAccount` for a single shared external test account. Leases release on `finish`, `releaseEnvironment` (`env.destroy`), job termination, or expiry.

Supporting exports from `packages/test-env/src/auth-payment-mocks/index.ts`: `ServiceProvider`, `JobTerminationHandle`, `SqliteGlobalResourceLeaseStore`, `systemDockerCli`, `SEEDED_ROLES`, `signWebhook`, `verifyStripeSignature`, `parseStripeSignature`, `startStripeBackend`, `resolveStripeMockBinary`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/test-env/src/index.ts` is outside this task's owned subtree. The integrator should re-export `LocalOAuthMockProvider`, `StripeMockAndWebhookProvider`, `GenericWebhookDeliverer`, and `HardCodedPortFallbackManager` from that barrel when registering them on Task 049's `ServiceProviderRegistry`.

Task 040 `WindowsJobManager` / `JobHandle` and Task 049 `ServiceProvider` are not imported here. `sandbox` and `test-env` share a layer, and the orchestrator subtree belongs to a parallel task. `JobTerminationHandle` is the structural slice a `JobHandle` satisfies (`jobId`, `terminated?`, `onTerminate`). `LocalOAuthMockProvider` and `StripeMockAndWebhookProvider` implement the local `ServiceProvider` methods `provision`, `resetData`, and `destroy`.

## Dependency Intents (New Packages Requested)

None. Signing and HTTP use Node `crypto`, `http`, and `node:sqlite` only.

## Contract Change Requests

`schema/global.sql` `port_leases.port` is `CHECK (port BETWEEN 41000 AND 48999)`, so port 3000 cannot be inserted there. `SqliteGlobalResourceLeaseStore` opens the caller-supplied global database and creates `resource_leases` (`resource_key` TEXT PRIMARY KEY, `project`, `environment`, `leased_at`, `expires_at`, `job_id`, `depth`) for `port:3000` and `external-sandbox:<account>`. Add that table to the canonical global schema in a wiring task so the broker does not depend on a runtime `CREATE TABLE`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-051-oauth-stripe-mocks-port-fallback`:

- `pnpm --filter @ef-harness/test-env test -- auth-payment-mocks` — passed, 3 files, 14 tests (OIDC discovery, JWKS, code exchange, valid login, bad state, expired code, expired JWT, invalid signature, forbidden role, exact redirect match, cross-env `invalid_grant`, destroy isolation, Stripe valid/forged/expired/concurrent `evt_123` replay, GitHub and Svix signatures, Tier D selection, exclusive port 3000 serialization with no overlapping bind, job-termination release, external sandbox lease).
- `pnpm --filter @ef-harness/test-env typecheck` — passed (`tsc -b`).
- `pnpm --filter @ef-harness/test-env lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 051` — passed (`harmony ok for Task-051`).

## Known Limitations / Follow-Ups

- This Windows Node build does not resolve `*.localhost` (Chromium does, per RFC 6761). The mock binds only `127.0.0.1` and still emits a consistent `http://env<id>.localhost:<port>/<envId>` issuer, discovery document, and JWT `iss`. HTTP tests dial `127.0.0.1`.
- `stripe-mock` is used when `STRIPE_MOCK_BIN`, an explicit path, or `%LOCALAPPDATA%\EFHarness\components\stripe-mock` stays listening. Otherwise the loopback emulator serves the API shape. The emulator binds `127.0.0.1` only. A third-party `stripe-mock` process may listen more widely; its public URL is still `http://127.0.0.1:<port>`.
- The OIDC server is in-process rather than a separately spawned Node child.
- Tier D calls the injected Docker CLI. Unit tests use a fake CLI. `systemDockerCli()` is the production adapter and is not invoked by the unit tests.
- Delivery targets must be `http://127.0.0.1`, `http://localhost`, or `http://*.localhost`. Non-loopback URLs, including `https://api.stripe.com`, throw `NonLoopbackTargetError` before any socket is opened.
- Signing secrets are ephemeral `whsec_test_mock_<hex>`. API keys issued by the emulator are `sk_test_<hex>`. Live-mode requests are refused.
