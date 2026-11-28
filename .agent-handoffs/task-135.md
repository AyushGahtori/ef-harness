---
task_id: "Task-135"
branch: "task/135-signed-provider-policy-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/providers/src/policy/**"
  - "packages/providers/tests/policy/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 135 handoff

Signed provider policy engine, compliance locks, CLI minimum-version gate, and route-revocation parking. Commit stays on `task/135-signed-provider-policy-engine`.

## Exports Provided

Import these from the providers package barrel once the wiring below lands. Until then they live at `packages/providers/src/policy/index.ts`.

- `SignedProviderPolicyEngine` — bundled plus cached Ed25519 policy, synchronous startup load, daily refresh (`<= 1/24h`, `5s` timeout, fail-open), monotonic version check, history insert, roster merge, and revocation parking.
- `CompliancePolicyLocks` — kernel locks for Anthropic console keys only, Gemini CLI off by default with the required notice and unmodified `gemini --acp` invocation, no vendor-credential directory reads, Sign in with ChatGPT preview wire constraints, and the permanent vendor denylist.
- `CliMinVersionGate` — per-runtime semver floors and denylist ranges. Blocks or downgrades to `disabled` / `observe-only` and returns an upgrade card.
- `RouteRevocationParkHandler` — on a new `route_revoked` status, checkpoints in-flight steps without marking them corrupted, emits one `AccountCard`, blocks new dispatches, and refuses a silent paid API-key fallback.
- Supporting ports and helpers: `VersionedModelRosterPort`, `GlobalDbPolicyPort`, `verifyAndParse`, `signPolicyDocument` (tests and release signing), `POLICY_FETCH_TIMEOUT_MS` (`5000`), `POLICY_REFRESH_MIN_INTERVAL_MS`, `POLICY_STARTUP_REFRESH_DELAY_MS` (`30000`), `POLICY_STARTUP_BUDGET_MS` (`5`).

Host startup, in this order, with no network await:

```ts
const engine = new SignedProviderPolicyEngine({ cacheDirectory, globalDb, roster });
engine.loadStartup();
engine.scheduleDailyRefresh();
```

`engine.transparency()` is the Settings → Connections and Diagnostics view (`policyVersion`, last verified time, last checked time, and per-route `allowed | opt_in_with_notice | disabled_by_policy | route_revoked`). `engine.cliGate().evaluate(runtime, version)` is the runtime probe gate. `engine.complianceLocks()` is the credential and custom-config gate.

Bundled artifact: `packages/providers/src/policy/provider-policy.json` (policy version `2026111701`, published `2026-11-17T00:00:00.000Z`).

## Shared Wiring Needs (Root / Index Barrels)

`packages/providers/src/index.ts` is frozen foundation. Add this re-export when an integrator is allowed to touch the barrel:

```ts
export {
  CliMinVersionGate,
  CompliancePolicyLocks,
  GlobalDbPolicyPort,
  POLICY_FETCH_TIMEOUT_MS,
  POLICY_REFRESH_MIN_INTERVAL_MS,
  POLICY_STARTUP_BUDGET_MS,
  POLICY_STARTUP_REFRESH_DELAY_MS,
  RouteRevocationParkHandler,
  SignedProviderPolicyEngine,
  VersionedModelRosterPort,
  verifyAndParse,
} from "./policy/index.js";
```

`tsc` does not copy JSON into `dist`. `bundledPolicyPath()` reads `provider-policy.json` beside the module, then falls back to `packages/providers/src/policy/provider-policy.json`. A later build step may copy that file next to `dist/policy/`. No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

None. Verification uses `node:crypto` (Ed25519) and `node:sqlite` (`DatabaseSync`). No `package.json` dependency was added.

## Contract Change Requests

`schema/global.sql` is frozen and has no `policy_history` table. Please add this additive table on the schema owner’s branch:

```sql
CREATE TABLE policy_history (
  policy_version INTEGER PRIMARY KEY,
  published_at   TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  applied_at     TEXT NOT NULL,
  diff_summary   TEXT NOT NULL
) STRICT;
```

Row shape consumed by this task: `{ policyVersion, publishedAt, sha256, appliedAt, diffSummary }`. Inserts with `policyVersion` lower than the current maximum must be rejected.

Sibling branches are not in this base (`649773097c387ae534b686ea5825f449f843aa7c`). Local ports:

- `GlobalDbPolicyPort` stands in for `GlobalDbRepo` (Task 014). It opens `<cacheDirectory>/global.db` and creates `policy_history` if missing. If that file already has a `connections` table, `listConnections()` reads `id, provider, route, currency, enabled`. Swap: point the port at the real `global.db` after the table above exists, or replace the port with `GlobalDbRepo` methods of the same names. Do not keep a second database after that wiring.
- `VersionedModelRosterPort` stands in for `VersionedModelRoster` (Task 106). `applyPolicyModels(models, publishedAt)` upserts policy rows, preserves `pinnedByUser` and `origin` `user | ollama | lmstudio`, marks omitted policy-origin rows revoked instead of deleting them, and `resolveReference(modelId)` never throws (it returns a replacement recommendation). `selectable()` hides revoked rows. Swap: pass the real roster into `SignedProviderPolicyEngine` once it implements that merge.
- `AccountCard` is the local value for Task 127. One card per newly revoked route set, actions `Switch Connection` and `Keep Parked`. Task 127 should render `revocationHandler().currentCard()` and call `acknowledgeCard()`. Silent fallback to `billing: "api_key"` stays refused; an explicit user switch goes through `acceptExplicitSwitch({ explicitUserChoice: true })`.
- Connection route aliases until Task 014’s `connections.route` values match policy ids: `siwc` → `siwc_preview`, `gemini_cli` → `gemini_cli_acp`, `codex_app_server` → `codex_cli`, `copilot` → `copilot_sdk`, `cursor` → `cursor_sdk`.

The verification public key is RFC 8032 Ed25519 test vector 1 (`PINNED_POLICY_KEY_ID = "rfc8032-test-1"`). The matching seed is only in `packages/providers/tests/policy/fixtures.ts` so tests can sign updates. Replace `PINNED_POLICY_PUBLIC_KEY_HEX` and re-sign `provider-policy.json` before this pin is treated as a release trust anchor.

Bundled CLI floors other than the Codex scenario (`>= 0.42.0`, denylist `0.40.0`–`0.41.9` disabled) are initial policy data: Claude `>= 2.1.0`, Copilot `>= 1.0.0` with `1.2.0`–`1.2.3` observe-only, Cursor Agent `>= 1.0.0`, OpenCode `>= 0.5.0`, Gemini `>= 0.20.0`. Revise them in a later signed policy when vendor minimums are confirmed.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-135-signed-provider-policy-engine`:

- `pnpm --filter @ef-harness/providers typecheck` — exit 0.
- `pnpm --filter @ef-harness/providers lint` — exit 0.
- `pnpm --filter @ef-harness/providers test -- policy` — 5 files, 16 tests passed. Covers bundled/cache load under 5ms with no fetch, valid Ed25519 refresh, invalid signature, version rollback, offline fail-open, 24h throttle, 5s timeout constant plus abort path, compliance locks, CLI floor and denylist cards, roster pin/local preservation, and `route_revoked` parking with no silent paid fallback.
- `node scripts/verify-harmony.mjs --task 135` — exit 0, `harmony ok for Task-135`.

## Known Limitations / Follow-Ups

- The Ed25519 pin is the public RFC 8032 test vector, not a production trust anchor. Re-sign the bundled file when the release key is chosen.
- Non-Codex CLI floors are initial bundled defaults, not a vendor-published pin.
- There is no Settings, Diagnostics, or Account Card UI here. Tasks 127, 133, and 141 should bind the transparency view and the single revocation card.
- Gemini opt-in is a kernel gate (`geminiCli` / `assertGeminiLaunch`). The checkbox UI is a later task. Opt-in still cannot read the Gemini credential directory or change the invocation away from `gemini --acp`.
- Anthropic acceptance is prefix-only in this package. Storage and network validation stay with Task 136, which should call `CompliancePolicyLocks.inspectCredential` before any request.
- Park state is derived from the verified document. The pending card is stored in `provider-policy.verified.json` until acknowledged, not in a new schema table.
- A policy-origin model omitted from a later signed file is marked revoked and still resolves. User-pinned and local Ollama / LM Studio rows are left intact.
- `scheduleDailyRefresh` waits 30s and then calls `refreshDaily`. The host must not call the network during `loadStartup`.
