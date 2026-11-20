---
task_id: "Task-044"
branch: "task/044-loopback-allowlist-proxy"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/proxy/**"
  - "packages/sandbox/tests/proxy/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 044 handoff

Loopback HTTP and CONNECT allowlisting proxy for per-attempt network profiles. Commit stays on `task/044-loopback-allowlist-proxy`.

## Exports Provided

From `packages/sandbox/src/proxy/index.ts` (package barrel wiring is requested below; this task does not edit `packages/sandbox/src/index.ts`):

- `AllowlistProxyServer` — binds `127.0.0.1` only, on a `PortLease` port in `41000-48999`. `start()`, `stop()`, `registerAttempt()`, `fenceAttempt()` / `revokeAttempt()`, `auditLog`, `deniedCount`, `diagnosticsHealth()`, `listeningAddress`, `secretRedactor`.
- `NetworkPolicyProfile` — `"coding_worker" | "verifier_test" | "kernel_installer" | "researcher" | "wrapped_vendor"`.
- `ProxyTokenHandle` — `{ attemptId, profile, token, proxyAuthorization }` where `proxyAuthorization` is `Bearer <token>`. Basic `proxy:<token>` is also accepted.
- `ProxyAuditLog` — `record`, `recent`, `deniedCount`, `diagnosticsHealth()` (`deniedCount`, `deniedByAttempt`, `deniedByReason`) for Task 133.
- `ProxyConfigError`
- `PortLease` — same shape as Task 014: `{ port, projectId, environment, leasedAt, expiresAt }`
- `AttemptRegistration`, `AllowedTestEndpoint`, `AttemptResourceLimits`, `AttemptFenceReason` (`"fenced" | "paused" | "completed"`)
- `WrappedVendorId` — `openai` (`api.openai.com`), `chatgpt` (`chatgpt.com`), `anthropic` (`api.anthropic.com`), `github_copilot` (`api.githubcopilot.com`), `cursor` (`api2.cursor.sh`), `google` (`generativelanguage.googleapis.com`)
- `SecretRedactor`, `StructuredLogger` — structural ports matching Task 011 `redact` / `scanForSecrets` and `info` / `warn` / `error` / `withContext`
- `CanaryVaultSecretRedactor` — default scanner for builtin prefixes plus registered vault/canary values (raw, base64, base64url, URL-encoded). Minimum registered length 8.
- `CapturingStructuredLogger`
- `evaluateProfileAccess`, `hostMatches`, `normalizeHostname`, `vendorOwnsHost`
- `KERNEL_REGISTRY_HOSTS`, `RESEARCHER_DOCUMENTATION_HOSTS`, `WRAPPED_VENDOR_HOSTS`, `DEFAULT_ATTEMPT_LIMITS`
- `isPublicIp`, `canonicalIp`, `resolveHostDefault`
- `BIND_HOST` (`127.0.0.1`), `HEADER_READ_TIMEOUT_MS` (`5000`), `MAX_HEADER_BYTES` (`16384`), `PORT_LEASE_MIN`, `PORT_LEASE_MAX`

Profile behavior:

- `coding_worker`: deny all external hosts.
- `verifier_test`: only exact `allowedTestEndpoints` host and port.
- `kernel_installer`: `registry.npmjs.org`, `registry.yarnpkg.com`, PyPI hosts, plus `corporateRegistries`.
- `researcher`: documentation hosts (defaults plus per-attempt hosts, including an explicit `.example.com` suffix rule). Plain HTTP allows only `GET` and `HEAD` (`405` otherwise).
- `wrapped_vendor`: only the bound vendor's exact host. That vendor's single `Authorization` header is not treated as exfiltration; every other header, the URL, and query string still are.

Every other host is `403`. `CONNECT` is port 443 unless that exact host and port is listed in `allowedTestEndpoints`. Declared endpoints do not add hosts for `coding_worker`, `wrapped_vendor`, `researcher`, or `kernel_installer`; they only authorize a non-default port for a host that profile already allows. DNS is resolved with `dns.lookup(..., { all: true })` before connect; every address must be public; the socket connects to the pinned address with the original `Host` / SNI. Redirect `Location` values are checked again and replaced with `403` when they escape. Revoking a token destroys that attempt's sockets immediately.

`testOnlyPrivateIpAllowlist` is empty in production and the constructor throws if it is set when `NODE_ENV` is `production`.

## Shared Wiring Needs (Root / Index Barrels)

Re-export the proxy surface from `packages/sandbox/src/index.ts` once this branch is integrated:

```ts
export {
  AllowlistProxyServer,
  CanaryVaultSecretRedactor,
  ProxyAuditLog,
  ProxyConfigError,
  BIND_HOST,
  HEADER_READ_TIMEOUT_MS,
  MAX_HEADER_BYTES,
  KERNEL_REGISTRY_HOSTS,
  RESEARCHER_DOCUMENTATION_HOSTS,
  WRAPPED_VENDOR_HOSTS,
  evaluateProfileAccess,
  hostMatches,
  isPublicIp,
} from "./proxy/index.js";
export type {
  NetworkPolicyProfile,
  ProxyTokenHandle,
  PortLease,
  AttemptRegistration,
  SecretRedactor,
  StructuredLogger,
  NetworkAuditEvent,
  ProxyDiagnosticsSnapshot,
} from "./proxy/index.js";
```

No root manifest or `packages/shared-contracts/src/index.ts` edit.

## Dependency Intents (New Packages Requested)

None. The proxy uses Node built-ins only.

## Contract Change Requests

None. Callers pass a Task 014 `PortLease` and may pass a Task 011 `SecretRedactor` and `StructuredLogger`. This package cannot import `packages/db` (same layer) or the unmerged Task 011 barrel.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-044-loopback-allowlist-proxy`:

- `pnpm --filter @ef-harness/sandbox test -- proxy` — passed, 4 files, 22 tests (vitest v5.1.1). Covers all five profiles, hostname spoofing, redirect escape, private-IP and mixed-answer DNS blocking, per-attempt token isolation, mid-tunnel revoke, secret redaction in the audit log, header overflow, idle header timeout, concurrency, and response byte cap.
- `pnpm --filter @ef-harness/sandbox typecheck` — passed (`tsc -b`).
- `pnpm --filter @ef-harness/sandbox lint` — passed (`eslint .`).
- `node scripts/verify-harmony.mjs --task 044` — passed (`harmony ok for Task-044`).

## Known Limitations / Follow-Ups

- A `CONNECT` tunnel cannot see the HTTP method inside TLS. Researcher `POST` / `PUT` / `DELETE` / `PATCH` are rejected on plaintext HTTP with `405`. `CONNECT` stays available for allowlisted documentation hosts so HTTPS `GET` can be tunneled.
- The daemon must pass a live `port_leases` row. This package does not open `global.db`.
- Until Task 011 is wired, the default `CanaryVaultSecretRedactor` enforces the builtin prefixes and registered vault values. Inject Task 011's `SecretRedactor` to share one vault.
- Upstream TLS for absolute `https://` URLs uses the original hostname as SNI and `rejectUnauthorized: true` unless a test sets it false. Production rejects disabling certificate checks.
- Task 045, Task 046, Task 047, and Task 193 should construct `AllowlistProxyServer` with the attempt's profile and token rather than dialing the network directly.
