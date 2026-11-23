---
task_id: "Task-152"
branch: "task/152-m4-plans-conformance-exit-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "benchmarks/m4-plans/**"
  - "tests/e2e/m4-exit-gate/**"
  - "tests/e2e/tests/m4-exit-gate.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 152 handoff

M4 exit gate: allowance-paced Kitchen build on a ChatGPT Plus profile, zero silent paid fallback across the five exhaustion cases, the 7-adapter 10-probe matrix with rogue downgrade, provider terms locks, Codex to Claude Code handoff, and honest usage CSV. Commit stays on `task/152-m4-plans-conformance-exit-gate`. Do not merge.

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). The gate talks to them through local ports. Replace the adapters. Do not keep the local copies once the real barrels exist.

## Exports Provided

Import from `tests/e2e/m4-exit-gate/index.ts` until a package barrel is allowed to re-export them.

- `M4AllowancePacedBenchmark` — `run(plane, faults)` drives the Kitchen task list on the ChatGPT Plus profile (`20%` reserve, `800_000` ppm ceiling, `720_000` ppm wind-down, AIMD start `cwnd = 2`, `k[gpt-5.1] = 20_000` ppm per 1k tokens, margin `1.3`). A virtual clock injects a four-deep transient `429` burst and an access-token refresh at minute 60, then resumes `thread-kitchen-1`. Exit facts require `0` premature lockouts, `0` failed turns, `0` lost WIP, hidden pass rate `>= 90%`, and `>= 200_000` ppm left (the personal reserve). The `89%` edge (`712_000` ppm used plus one `18_000` ppm active turn and three queued `40_000` ppm workers) winds down and starts `0` queued workers.
- `M4ComplianceAndFallbackCertifier` — `certify(plane, faults)` connects subscription, local, and funded paid routes, then forces ChatGPT `100%`, Copilot `remaining = 0` with overage enabled, Cursor `401`, Ollama `ECONNREFUSED`, and signed-policy `route_revoked`. Unconsented paid posts stay `0` and spend stays `0` micro-USD. A consented drill is allowed and does not post. `openRouterRequestCount > 0` fails the gate.
- `M4ExitGateReport` — schema id `m4-exit-gate-report@1`. `evaluate(facts, hostElapsedMs)` fail-closes on any single reason. `renderScorecard` writes the Markdown provider table. `signReport` is `sha256:` over the canonical signing view (sorted keys, no `signature`, no `hostElapsedMs`). `claimedCertification` is true only when `exitCode` is `0`.
- `runM4Certification` / `runLiveCertification` — ci-replay returns the signed report. `--live` is `node tests/e2e/m4-exit-gate/run-m4-suite.ts --live` and exits `2` without a network call.
- Supporting ports re-exported from the same barrel: `AllowancePacingController`, `NoSilentPaidFallbackGuard`, `SignedProviderPolicyPort`, `AdapterConformanceRunner`, `AutomaticTrustDowngrader`, `ConformanceVersionCache`, `KitchenHiddenAcceptanceSuite`, `UsageReceiptsCsvExporter`, `runCrossAdapterHandoff`, `runIdlePark`.

Fail-closed reasons include `passRate`, `hiddenLeak`, `prematureLockouts`, `personalReserve`, `tokenRefresh`, `lostWip`, `failedTurns`, `fiveHourWindow`, `pacingProfile`, `aimd`, `cwnd`, `reserveBoundary`, `usageLimit`, `paidSpend`, `paidRequests`, `openRouterLeak`, `copilotOverage`, `consentDrill`, `exhaustion`, `conformance`, `rogueDowngrade`, `p06`, `conformanceCache`, `interrupt`, `processCleanup`, `termsClaude`, `termsGemini`, `termsWithdrawn`, `wire`, `handoffWip`, `handoffClean`, `analytics`, `csv`, `idlePark`, `mockServers`, `providerRow`.

## Shared Wiring Needs (Root / Index Barrels)

No barrel edit. `tests/e2e/src/index.ts` and `benchmarks/src/index.ts` stay frozen.

`tests/e2e/vitest.config.ts` is frozen and only includes `tests/**/*.test.ts`. The suite is launched from `tests/e2e/tests/m4-exit-gate.test.ts`, which that include already collects and which the `m4-exit-gate` filter matches. The runner stays in `tests/e2e/m4-exit-gate/`. That launcher is the only file outside `benchmarks/m4-plans/**` and `tests/e2e/m4-exit-gate/**`.

When root `package.json` can change, add:

```json
"test:m4-exit-gate:replay": "node tests/e2e/m4-exit-gate/run-m4-suite.ts",
"test:m4-exit-gate:live": "node tests/e2e/m4-exit-gate/run-m4-suite.ts --live"
```

When `tests/e2e/src/index.ts` can change, re-export the gate from the owned barrel:

```ts
export {
  M4AllowancePacedBenchmark,
  M4ComplianceAndFallbackCertifier,
  M4ExitGateReport,
  REPORT_SCHEMA,
  runM4Certification,
} from "../m4-exit-gate/index.ts";
```

## Dependency Intents (New Packages Requested)

None. No new package and no dependency edit.

## Contract Change Requests

None.

## Sibling swaps (branches not on this base)

Local ports live under `tests/e2e/m4-exit-gate/`. Swap the module. Keep the method names.

| Local port | Missing sibling | Swap |
| --- | --- | --- |
| `benchmarks/m4-plans/hidden-suite.port.json` and `KitchenHiddenAcceptanceSuite` | Task 105 `KitchenHiddenAcceptanceSuite` | 29 check ids, titles, and canary `M2-HIDDEN-CANARY-105`. Worker prompts carry `checks_hidden_count` only. Replace with the real server, Mailpit, and Playwright suite. |
| `AllowancePacingController` | Task 140 `AllowancePacingController` / `AimdConcurrencyRegulator` | Ceiling `1_000_000 - round(reserve * 1_000_000)`, wind-down `floor(ceiling * 9 / 10)`, start `cwnd = 2`, `+1` after 6 clean completions outside the 60s post-429 cool-down, halve to `max(1, floor(cwnd / 2))` on transient 429, `cwnd = 0` only on a real usage-limit. |
| `NoSilentPaidFallbackGuard` | Task 141 `NoSilentPaidFallbackGuard` | Ask-first. The five exhaustion reasons park without posting to a paid route. Explicit consent allows a later switch and is not used by those five cases. |
| `UsageReceiptsCsvExporter` / `buildUsageView` | Task 141 `HonestUsageAnalyticsView` / `UsageReceiptsCsvExporter` | API micro-USD (`Estimated` vs `Provider-reported`), subscription percent, Copilot premium requests, and local `$0` stay in separate fields. CSV is CRLF, RFC 4180, and prefixes `=`, `+`, `-`, `@`, tab, and CR. |
| `buildDirectRequest` / `SiwcTokenRefresher` | Task 137 `SiwcDirectRequestAdapter` / `SiwcTokenRefresher` | Body keeps `store: false`, `stream: true`, and `chatgpt.tokens.use.direct`, and strips `max_output_tokens`, `temperature`, and `previous_response_id`. Refresh is a POST to the local mock token route. |
| `AdapterConformanceRunner` / `ConformanceVersionCache` / `AutomaticTrustDowngrader` | Task 151 | Same 10 probe ids. Compliant adapters stay `wrapped` at `10/10`. Security failure in wrapped mode with a clean stripped run becomes `stripped`. Security failure in stripped mode becomes `disabled`. Cache key is adapter, CLI version, sandbox tier, and suite version. |
| `runCrossAdapterHandoff` / `runIdlePark` | Task 150 `ForeignRuntimeResumeCoordinator` / `IdleWrappedAgentAutoParker` | Approved switch restores `wipTreeSha` and the `[PRIOR UNVERIFIED WIP]` label, and deletes `CODEX_HOME` plus `codex-skills-tmp` before the tree hash. Idle park kills the child when the virtual clock hits `90_000` ms and keeps the checkpoint. |
| `certifyClaude` | Task 147 Claude Code adapter | Rejects the subscription OAuth prefix and the subscription setup command. Does not read the Claude home directory. |
| `certifyGemini` | Task 148 Gemini CLI adapter | Default off until the policy notice is accepted. Personal Gemini directory reads and writes stay `0`. |
| `SignedProviderPolicyPort` | Task 135 `SignedProviderPolicyEngine` | `route_revoked` parks immediately. |
| `PRODUCT_ROUTES` / `PRODUCT_UI_ENTRIES` / `PRODUCT_POLICIES` plus the source scan | Product catalogs from Tasks 135–149 | The withdrawn vendor has `0` route, UI, and policy hits in `packages`, `apps`, `spikes`, `corpus`, `benchmarks`, and `tests`. |
| `startMockPlane` | Live OIDC, Anthropic, OpenRouter, Copilot, Cursor, and trap HTTP | Loopback only. Counts OIDC refresh, Responses SSE, Anthropic, OpenRouter, Copilot quota, Copilot complete, Cursor, and `/exfil`. |
| In-process adapter behaviors | Tasks 143–149 runtime adapters | `generic-acp`, `codex`, `copilot`, `cursor`, `claude-code`, `gemini-cli` (opted in for the matrix only), `opencode`. |

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-152-m4-plans-conformance-exit-gate`:

- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/e2e test -- m4-exit-gate` — pass. Vitest v5.1.1, 1 file, 4 tests, 54.96s. ci-replay gate exit 0: hidden checks `29/29`, ceiling `800_000`, wind-down `720_000`, start `cwnd = 2`, peak `cwnd >= 3`, post-429 `cwnd = 1`, personal reserve remaining `270_000` ppm, token refresh plus `thread-kitchen-1` resume, `0` failed turns, `0` lost WIP, `0` premature lockouts, `0` unconsented paid requests, `0` OpenRouter leaks, Copilot `remaining = 0` with `0` later completes, Cursor `401` on `AccountCard`, Ollama `ECONNREFUSED`, `route_revoked` parks immediately, 7 adapters `10/10` wrapped, rogue ladder `stripped` then `disabled`, production trap hits `0`, rogue trap hits `2`, idle park at virtual `90_000` ms with the checkpoint kept, handoff `wipTreeSha` matches and contains `[PRIOR UNVERIFIED WIP]`, CSV formula prefix holds, `hostElapsedMs < 120_000`. A `temperature: 0.2` body, an OpenRouter retry, an OpenCode `P06` bypass, and a wind-down bypass that starts 3 queued workers all fail the gate. Live mode exits 2 and does not claim certification.
- `node scripts/verify-harmony.mjs --task 152` — pass (`harmony ok for Task-152`, exit 0, about 179s). Schema check, diagram check, owned-path scope, and workspace `pnpm typecheck`, `pnpm lint`, and `pnpm test` succeeded.

## Known Limitations / Follow-Ups

- Live M4 certification is not claimed. `--live` exits 2 even when `EF_M4_LIVE_CONFIRM=1` and `EF_M4_LIVE_API_KEY` or `OPENROUTER_API_KEY` are set. `claimedCertification` stays false. No network call is made. Swap in the real account adapters before a live run can pass.
- The 5-hour window, the minute-60 refresh, and the 90s idle park use a virtual clock. The idle child is a real `node` process and is killed when that clock reaches `90_000` ms, not after 90 wall-clock seconds. The conformance `P04` command and `P07`/`P08` kill run for real on the ci-replay path (`simulateProcessProbes` is false there).
- `tests/e2e/tests/m4-exit-gate.test.ts` exists because `tests/e2e/vitest.config.ts` is frozen.
- Swap the local ports in the table above when the sibling barrels are on the integration branch. Do not import the unpublished packages as if they were already on `harness/integration`.
