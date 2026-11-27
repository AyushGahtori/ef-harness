# Pass 04 — Chunk 005 Audit Report (`packages/providers` Policy, Auth, Local Models, AIMD Pacing & `Task 141` Connections UI)

## 1. Chunk Identification and Scope
- **Pass:** `pass-04`
- **Chunk:** `chunk-005`
- **Units Audited (7):**
  - `Task 135` (`task/135-signed-provider-policy-engine` @ `e6934db`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-135-signed-provider-policy-engine`, unmerged, clean)
  - `Task 136` (`task/136-api-key-onboarding-pricing` @ `80e6ae8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-136-api-key-onboarding-pricing`, unmerged, clean)
  - `Task 137` (`task/137-sign-in-with-chatgpt-oauth` @ `8ffeebd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-137-sign-in-with-chatgpt-oauth`, unmerged, clean)
  - `Task 138` (`task/138-openrouter-oauth-local-models` @ `01daab9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-138-openrouter-oauth-local-models`, unmerged, clean)
  - `Task 139` (`task/139-copilot-cursor-subscription-auth` @ `ec5b8fd` / `task-139-copilot-cursor-subscription-auth`, unmerged, clean)
  - `Task 140` (`task/140-broker-allowance-pacing-aimd` @ `ab3b334`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-140-broker-allowance-pacing-aimd`, unmerged, clean)
  - `Task 141` (`task/141-no-silent-fallback-connections-ui` @ `7067800`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-141-no-silent-fallback-connections-ui`, unmerged, clean)
- **Governing Architecture Documents:** `provider-connections.md`, `open-design-questions.md`, `security-and-governance.md`, `app-shell-and-governor.md`, `kernel-schema-and-protocol.md`, `schema/global.sql`, `schema/telemetry.sql`, `onboarding-providers-and-runtimes.mmd`, `research/provider-subscriptions.md`.

## 2. Files Directly Inspected
- `schema/global.sql` (`1–140`)
- `packages/providers/src/index.ts` (`task-135` & `task-141`)
- `packages/providers/src/policy/{global-db-policy-port.ts,signed-provider-policy-engine.ts,versioned-model-roster-port.ts,compliance-policy-locks.ts}` (`Task 135`)
- `packages/providers/src/api-keys/{local-global-db-connections.ts,local-dpapi-vault.ts,sibling-ports.ts,zero-token-api-key-validator.ts}` (`Task 136`)
- `packages/providers/src/siwc/{store.ts,wire.ts,ports.ts}` (`Task 137`)
- `packages/providers/src/openrouter-local/{ports.ts,memory-ports.ts}` (`Task 138`)
- `packages/providers/src/copilot-cursor-auth/{index.ts,types.ts,local-ports.ts}` + `tests/copilot-cursor-auth/fakes.ts` (`Task 139`)
- `packages/providers/src/pacing/{global-connection-window-repo.ts,model-allowance-weight-learner.ts}` (`Task 140`)
- `packages/providers/src/fallback-guard/guard.ts` + `apps/renderer/src/connections/{ports.ts,screen.ts,secrets.ts,analytics.ts,key-detect.ts,receipts.ts}` (`Task 141`)

## 3. Verified Local Strengths
- `SignedProviderPolicyEngine` (`135`) verifies Ed25519 signatures, monotonic `policyVersion` anti-rollback, `< 5 ms` synchronous offline startup load, `route_revoked` parking, and kernel `CompliancePolicyLocks` (`sk-ant-oat*` / `setup-token` / `~/.claude` / `~/.gemini` / `antigravity` rejection, `gemini --acp` opt-in gate, and SIWC preview constraints).
- `ZeroTokenApiKeyValidator` (`136`) restricts key checks strictly to `GET` model-list endpoints, uses `x-goog-api-key` headers (never `?key=`), rejects `sk-ant-oat*` before network I/O, and computes exact BigInt/integer `micro-USD` rates across input, output, cached read, cache write, and reasoning tokens.
- `SignInWithChatGptAuthFlow`, `SiwcDirectRequestAdapter`, `SiwcTokenRefresher`, and `SiwcStreamCutoffGuard` (`137`) enforce PKCE `S256` + OIDC `nonce`, `chatgpt.tokens.use.direct` scope, single-flight token refresh coalescing, `store: false` + `stream: true` + stripped `max_output_tokens`/`temperature`/`previous_response_id`, and `AbortController` stream-cutoff protection.
- `OpenRouterPkceOAuthFlow`, `LocalModelAutoDiscoverer`, `LocalModelCapabilityProber`, and `LocalVramSlotManager` (`138`) enforce loopback-only Ollama/LM Studio discovery, `>= 16k` context + tool/JSON capability gating, explicit `num_ctx`, VRAM slot capping, and `GpuWhisperPriorityArbiter` yielding.
- `GitHubCopilotDeviceAuthFlow` + `CopilotQuotaReader` + `CursorBrowserAuthFlow` + `CursorKeyExpiryReminderScheduler` (`139`) implement RFC 8628 `+5 s` `slow_down` polling, Copilot paid-overage consent stop, and 90-day Cursor key 7-day reminder scheduling.
- `AimdConcurrencyRegulator` + `BurnRateWindowTracker` + `ModelAllowanceWeightLearner` + `RateLimitVsUsageLimitClassifier` (`140`) implement conservative `cwnd = 2` / `+1` / `÷2` AIMD, `429` vs hard usage-limit classification (`cwnd = 0` without retry storms), `ppm` personal reserve protection, and bounded RLS+EMA `k[model]` learning.
- `NoSilentPaidFallbackGuard` (`141`) and `UsageReceiptsCsvExporter` (`141`) block unapproved `local → paid`, `subscription → paid`, `subscription → overage`, and `cheap → expensive` escalations and neutralize RFC 4180 CSV formula-injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).

## 4. Local Implementation Defects Discovered
1. **Renderer Compliance Bypass Accepting `sk-ant-oat*` Tokens (`Task 141` `apps/renderer/src/connections/key-detect.ts:7,11-14` & `screen.ts:173-210` — `F-058`):** `detectPastedKeyProvider` checks `trimmed.startsWith("sk-ant-")`, matching forbidden `sk-ant-oat*` Claude consumer subscription OAuth tokens as `"anthropic_console"` (`"Anthropic Console"`), and `savePaste()` persists them directly to `SecretVault` as `"Healthy"` without calling `CompliancePolicyLocks` (`135`) or `ApiKeyPrefixDetector` (`136`).
2. **Renderer `node:sqlite` Import + Out-of-Schema Tables (`Task 141` `apps/renderer/src/connections/receipts.ts:1,201-265` — `F-058`):** Directly imports `node:sqlite` (`DatabaseSync`) inside `apps/renderer` (forbidden in isolated Electron renderer) and creates unapproved `usage_receipt_fact` and `usage_api_summary` tables absent from `schema/telemetry.sql`.
3. **Destructive `CHECK` Constraints on `connections` (`Task 136` `local-global-db-connections.ts:69-79` — `F-057`):** Defines `CREATE TABLE IF NOT EXISTS connections` with `CHECK (route = 'api_key')`, `CHECK (currency = 'usd')`, and `CHECK (provider IN ('anthropic','openai','openrouter','gemini','custom'))`, breaking all subscription and local routes if executed on `global.db`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Six Divergent `global.db` Stores & Unpersisted `k[model]` Weights (`Tasks 135–140` vs `Task 014` `GlobalBrokerDb` & `schema/global.sql` — `F-057`):**
   - `135` opens its own `DatabaseSync` creating out-of-schema `policy_history`; `136` opens its own `DatabaseSync` creating `api_key_connection_meta` + narrowed `connections`; `137` opens a third `DatabaseSync` storing profiles in `meta`; `138`, `139`, and `140` run purely in-memory (`InMemoryGlobalConnections`, `LocalGlobalDbConnections`, `InMemoryGlobalConnectionWindowRepo`, and volatile `ModelAllowanceWeightLearner.models` `Map` that loses learned `k[model]` weights across restarts).
   - `schema/global.sql` `connections` (`lines 29-39`) has no JSON metadata or `policy_history` / `model_weights` columns, so canonical connection metadata, policy history, and `k[model]` weights must be persisted through `GlobalBrokerDb` (`014`) via `settings` JSON keys or additive `MigrationRunner` v2 migration on `global.db` under the single-writer broker lock (`024`).
2. **Six Incompatible `WindowsDpapiSecretsVault` (`Task 120`) Ports (`Tasks 120, 136, 137, 138, 139, 141` — `F-057`):**
   - `120` uses async `storeSecret`/`readPlaintextForKernel`/`deleteSecret`; `136` uses sync `put`/`getPlaintext` with ephemeral-key `dpapi-vault.json`; `137` uses `put(name, value): Promise<void>`/`get(name)`; `138` uses `put({ projectId, envScope, name, value })`/`readSecret`; `139` uses sync `writeSecret`/`readSecret` with XOR `^ 0x5a`; `141` uses sync `put(secret): string` in the renderer.
3. **Disconnected Intra-Package `SignedProviderPolicyEngine` (`135`), `VersionedModelRoster` (`106`), and `FallbackGuardPort` (`141`) Ports (`F-057`, `F-058`):**
   - `packages/providers/src/index.ts` is still an empty stub on all 7 branches.
   - `136` calls `policy.currentPriceTable()`, `137` calls `policy.readSiwcPolicy()`, and `139` calls `policy.copilotPremiumMultipliers()` — none of which exist on `135` `SignedProviderPolicyEngine`.
   - `141` `ConnectionsManagementScreen` calls `FallbackGuardPort.evaluate({ activeId, candidateId, ... })` (`apps/renderer/src/connections/ports.ts:27-43`), which does not match `141`'s own `NoSilentPaidFallbackGuard.evaluate({ active: GuardConnection, candidate: GuardConnection, policy, ... })` (`packages/providers/src/fallback-guard/guard.ts:143`).

## 6. Shared-File & Ownership Conflicts
- `packages/providers/src/index.ts` and `packages/providers/package.json` must be unified to export `policy`, `api-keys`, `siwc`, `openrouter-local`, `copilot-cursor-auth`, `pacing`, and `fallback-guard`.
- `Task 141` spans both `packages/providers/src/fallback-guard/**` and `apps/renderer/src/connections/**` and must integrate into `apps/renderer/src/index.ts` (`Task 122` `SingleAppShell`) via typed IPC (`Task 009`/`031`/`067`).

## 7. Runtime Wiring Gaps
- Wire `135`–`140` into `GlobalBrokerDb` (`014`), `BrokerGrantIssuer` (`024`), `BudgetLedger` (`023`), `VersionedModelRoster` (`106`), `WindowsResourceTelemetryCollector` (`117`), `GpuWhisperPriorityArbiter` (`118`), `WindowsDpapiSecretsVault` (`120`), and `BudgetWindDownController` (`128`) inside `apps/daemon`, exposing connection management and usage analytics RPCs to `apps/renderer` (`141`) over IPC (`031`/`067`) with zero `node:sqlite` or vault access in the renderer.

## 8. Architecture & Security Violations
- `F-058`: Renderer acceptance of `sk-ant-oat*` tokens (`key-detect.ts:7,13`) violates the immutable Anthropic Console-only lock; renderer import of `node:sqlite` (`receipts.ts:1`) violates Electron process sandboxing; `LocalDpapiSecretsVault` (`136`) ephemeral random key loses secrets on restart and `LocalWindowsDpapiSecretsVault` (`139`) XOR-masks secrets in memory.

## 9. Test Coverage & Verification Gaps
- Unit tests in `135`–`141` run against isolated `Local*` / `InMemory*` fakes; there is no cross-module test verifying `136` + `137` + `138` + `139` + `140` sharing one real `GlobalBrokerDb` (`014`) + `WindowsDpapiSecretsVault` (`120`), nor a renderer test asserting `sk-ant-oat01-...` is rejected in `ConnectionsManagementScreen.beginPaste`/`savePaste`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-057` (`CRITICAL`):** `packages/providers` (`135`–`140`) Empty Barrel, Six Divergent `global.db` Schemas (Including Destructive `route = 'api_key'` `CHECK` in `136`), Six Incompatible `WindowsDpapiSecretsVault` (`120`) Ports, Unpersisted `k[model]` Weights, and Unwired `SignedProviderPolicyEngine` (`135`) / `VersionedModelRoster` (`106`) Methods.
- **`F-058` (`CRITICAL`):** `Task 141` `apps/renderer/src/connections` Compliance Bypass Accepting `sk-ant-oat*` Subscription OAuth Tokens as `"Anthropic Console"`, Illegal Renderer `node:sqlite` Import & Out-of-Schema `usage_receipt_fact` Tables, and Internal `FallbackGuardPort` Signature Mismatch.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`135, 136, 137, 138, 139, 140, 141`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/global.sql`.
- [x] Intra-package and upstream (`014, 023, 024, 106, 117, 118, 120, 135`) contracts cross-checked.
- [x] Findings recorded immediately in `audit_findings.md` (`F-057`–`F-058`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-04/chunk-006`: `Tasks 142–146` (`packages/runtime-adapters` core supervision, generic ACP, Codex app-server, GitHub Copilot CLI, Cursor CLI — verify integration with `135` `CompliancePolicyLocks`/`CliMinVersionGate`, `137`/`139` auth tokens, `141` `NoSilentPaidFallbackGuard`, and `040`/`045`/`048` sandbox).
- `pass-04/chunk-007`: `Tasks 147–152` (`packages/runtime-adapters` Claude Code, Gemini CLI, OpenCode, checkpoint/resume, conformance harness + `Task 152` M4 Exit Gate).
