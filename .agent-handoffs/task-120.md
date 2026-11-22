---
task_id: "Task-120"
branch: "task/120-dpapi-secrets-vault-env-injection"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/governor/src/vault/**"
  - "packages/governor/tests/vault/**"
  - ".agent-handoffs/task-120.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 120 handoff

Windows DPAPI secrets vault, runtime-only env injection, live-key test refusal, provider probes, and the gitignored local env writer. Commit stays on `task/120-dpapi-secrets-vault-env-injection`.

Import from `packages/governor/src/vault/index.ts`. `packages/governor/src/index.ts` is frozen and is not edited here.

## Exports Provided

- `WindowsDpapiSecretsVault` — `put`, `rotate`, `delete`, `readSecret`, `listSecretNamesAndHashes(projectId, envScope)`, `diffNames`, `offerChatPastePurge`, `materializeEnvEntries` (requires `explicitOptIn: true`), `invalidateCaches`, `close`. Metadata only (`secretId`, `projectId`, `envScope`, `name`, `lastFourMasked`, `providerHint`, `createdAt`, `rotatedAt`, `verifiedStatus`, credential target, salted HMAC, `taggedProd`, `testOverride`) is written to both `global.db` and `state.db`. Plaintext is encrypted with `CryptProtectData` (`CRYPTPROTECT_UI_FORBIDDEN`, user scope) and stored with `CredWriteW` / `CredReadW` / `CredDeleteW`. Ciphertext larger than 2560 bytes is a DPAPI file under the vault directory with an owner-only ACL; Credential Manager holds a pointer.
- `RuntimeOnlyEnvInjector` — spawns with `shell: false` and a scrubbed env block. Preview and test receive only approved test/dev secrets. Coding-worker tiers A, B, C, and D receive no provider keys, OAuth tokens, GitHub/Vercel tokens, or production secrets. Injected values are registered on the redactor for the child lifetime and forgotten on exit. Stdout and stderr are returned only after redaction.
- `LiveKeyTestRefusalGuard` — `inspect`, `inspectMany`, `assertAllowed`. Refuses the Stripe live secret prefix, `rk_live_`, a publishable live prefix when paired with a live secret, production SendGrid `SG.` keys, live Twilio, prod-tagged AWS access keys, configured production DB hosts, and DB URLs containing a `prod` token unless `explicitTestOverride` is set. The configured-host refusal is not bypassed by that override. Stripe live prefix and Stripe `livemode: true` use `stripeLiveRefusalMessage()`.
- `ProviderSecretProber` — read-only probes: Stripe `GET /v1/balance` (`livemode`), Resend domains, SendGrid scopes, OpenAI/Anthropic/Gemini/OpenRouter model lists, Postgres `SELECT 1` with a default `POSTGRES_PROBE_TIMEOUT_MS` of 5000. Status is `verified_test`, `verified_live`, `invalid`, or `unreachable`.
- `GitignoredLocalEnvWriter` — writes `<project>/.env.local` only after `explicitOptIn: true` and `git check-ignore -q .env.local` exits 0. Otherwise the result `offer` is `Add .env.local to .gitignore first`. The write is a temp file, fsync, rename, then owner-only `icacls`. `.env.example` is never modified.
- Also exported for later tasks: `diffSecretNames` (`N added, N changed, N deleted — [names only]`), `scanPathsForPlaintext`, `LocalPacketSecurityRedactor`, `workerEnvironmentIsCredentialFree`, `WindowsDpapiMaterialStore`, `SqliteVaultMetadataStore`, and the error classes `LiveKeyRefusedError`, `CredentialsNeedReentryError` (`Credentials need to be re-entered on this Windows account`), `ZeroArgvSecretError`, `SecretPurgeUnavailableError`, `WorkerSandboxSecretError`.

`listSecretNamesAndHashes` returns `{ name, hmac }` only. `hmac` is HMAC-SHA256 hex under a 32-byte salt at `<vaultDir>/hmac.salt`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/governor/src/index.ts` and `packages/governor/package.json` stay untouched. Integration should re-export:

```ts
export {
  GitignoredLocalEnvWriter,
  LiveKeyTestRefusalGuard,
  LocalPacketSecurityRedactor,
  ProviderSecretProber,
  RuntimeOnlyEnvInjector,
  WindowsDpapiSecretsVault,
  diffSecretNames,
  stripeLiveRefusalMessage,
  workerEnvironmentIsCredentialFree,
} from "./vault/index.js";
export type {
  EnvScope,
  GlobalDbRepo,
  GuardDecision,
  InjectedProcessResult,
  LocalEnvWriteResult,
  NameOnlySecretDiff,
  PacketSecurityRedactor,
  ProbeProvider,
  ProviderSecretProberPort,
  PurgeOffer,
  PurgeReceipt,
  SecretMetadata,
  SecretNameHash,
  SecretPurgeEngine,
  StoredSecret,
  VerifiedStatus,
} from "./vault/index.js";
```

No root `package.json` or workspace export change. No new dependency.

## Dependency Intents (New Packages Requested)

None. DPAPI and Credential Manager are reached through Windows PowerShell plus `crypt32.dll` / `advapi32.dll`. Postgres probes use `node:net` and `node:crypto`. Metadata uses `node:sqlite`.

## Contract Change Requests

Sibling branches are not merged. These local ports stand in until integration:

- `PacketSecurityRedactor` (`register` / `forget` / `redact`) is the local port of Task 011 `SecretRedactor`. This task's placeholder is `[REDACTED_SECRET:<LABEL>]`. Task 011 emits `[REDACTED:<LABEL>]`. Pass the real redactor when the telemetry barrel is wired, or wrap it if callers need this task's placeholder. Vault values are also matched as Base64, Base64URL, URL-encoded, JSON-escaped, and per line when the line is at least 8 characters.
- `SecretPurgeEngine.executeSecretPurge(secret, { label?, forceShortSecret?, remotePushed? })` matches Task 030. `delete`, `rotate`, and `offerChatPastePurge` return a one-click `PurgeOffer`. The 8-step purge is not reimplemented here.
- `GlobalDbRepo` is the local port of Task 014. `SqliteVaultMetadataStore` creates `vault_secret_metadata` in `global.db` and `state.db` at runtime (additive; `schema/global.sql` was not edited). Columns: `secret_id`, `project_id`, `env_scope`, `name`, `last_four_masked`, `provider_hint`, `created_at`, `rotated_at`, `verified_status`, `credential_target`, `fingerprint`, `tagged_prod`, `test_override`. `credential_target` is `EFHarness:vault:<secretId>` and does not start with an API-key prefix, so it can later be stored in `connections.vault_ref` via Task 014 `upsertConnection`.
- `ProviderSecretProberPort` is optional on the vault. When present, `put` / `rotate` probe before persisting. A Stripe `livemode: true` result in `test` or `dev` is refused before the DPAPI write.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-120-dpapi-secrets-vault-env-injection`:

- `pnpm --filter @ef-harness/governor test -- vault` — pass. Vitest 5.1.1: 6 files, 14 tests. Covers real Windows DPAPI encrypt/decrypt/rotate/delete, a ciphertext-larger-than-2560 round trip, multiline secrets, raw byte scans of `global.db`, `state.db`, CAS, logs, and vault files with 0 plaintext hits, live-prefix refusal before save, Stripe `livemode: true` refusal, salted name-only HMAC diff, one-click purge invocation, DPAPI decrypt failure message, child env injection without argv, worker tiers A/B/C credential-free, redaction of echoed env and PEM lines, gitignore refusal and owner-only `.env.local`, provider probes, Postgres `SELECT 1`, MD5 auth, the 5000 ms default timeout, and a short timeout.
- `pnpm --filter @ef-harness/governor typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/governor lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 120` — pass (`harmony ok for Task-120`). The checker also ran schema 67/67, diagram integrity, owned-path scope, workspace typecheck, lint, and the full test suite.

## Known Limitations / Follow-Ups

- A second Windows account is not available in this runner. Cross-user DPAPI failure is tested by replacing the stored ciphertext; `readSecret` throws `CredentialsNeedReentryError` and does not exit the process.
- Credential Manager blobs are capped at 2560 bytes. Larger DPAPI ciphertext is an owner-only file plus a Credential Manager pointer.
- Postgres probes implement trust, cleartext, MD5, and SCRAM-SHA-256. Certificate authentication is not implemented. A probe that cannot authenticate returns `invalid`; connect and timeout failures return `unreachable`.
- `pk_live_` is refused in test/dev only when paired with a live secret. An AWS access-key prefix is refused in test/dev when `taggedProd` is set or the secret name contains a prod token.
- Coding-worker tiers include D as well as A/B/C. The invariant is that worker processes do not receive provider credentials.
- The package barrel re-export above is not applied on this branch.
