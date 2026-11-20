---
task_id: "Task-105"
branch: "task/105-m2-kitchen-exit-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "benchmarks/m2-kitchen-e2e/**"
  - "tests/e2e/m2-exit-gate/**"
  - "tests/e2e/tests/m2-exit-gate.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 105 handoff

M2 Kitchen exit gate: scripted Discovery-to-completion replay, independent hidden acceptance suite, and signed baseline for Task 134. Commit stays on `task/105-m2-kitchen-exit-gate`. Do not merge.

## Exports Provided

Import from `tests/e2e/m2-exit-gate/` until a package barrel is allowed to re-export them.

- `M2KitchenE2eBenchmarkRunner` (`runner.ts`) — `run()` executes `ci-replay`: scripted developer, real `schema/state.sql`, real Git on `harness/integration`, then the hidden suite. Exit 0 only when `hiddenPassRate >= 0.90`, `paperworkPct <= 0.20`, `leakedPids === 0`, and `secretsFound === 0`, plus static audit, trailer, clean-tree, views, and hidden-leak checks.
- `KitchenHiddenAcceptanceSuite` (`hidden-suite.ts`) — 29 independent checks in `benchmarks/m2-kitchen-e2e/hidden/acceptance-suite.json` (canary `M2-HIDDEN-CANARY-105`). The pipeline file reader refuses any `hidden/` path. Worker prompts carry `checks_hidden_count` only.
- `M2ExitGateReport` — schema id `m2-exit-gate-report@1`. `signReport` is `sha256:` over the canonical signing view (sorted keys, no host clock, no absolute paths).
- `benchmarks/m2-kitchen-e2e/baseline-metrics.schema.json` — `{ totalWallClockSec, phase0Sec, waveBuildSec, completionAuditSec, totalTokens, paperworkPct, hiddenPassCount, hiddenTotalCount, passRatePct }`. `paperworkPct` is a fraction. `passRatePct` is 0–100. Wall-clock fields are the scripted sequential baseline (`2820 / 240 / 1680 / 90` seconds), which Task 134 must beat by `>= 2×` with no pass-rate drop.
- `evaluateExitGate`, `runCertifiedReplay`, `runDefectCutoff`, `runEmailMismatch`, `runForensicsDrill`, `runLiveCertification`, `oracleAuthorVisibleExample`.
- CLI: `node tests/e2e/m2-exit-gate/run-m2-suite.ts` (ci-replay, process exit = gate code) and `--live` (exit 2 unless a future provider run claims the bar).

Opening sentence is the Kitchen prompt prefix from the task, stored in `benchmarks/m2-kitchen-e2e/opening-prompt.txt`. The scripted responder covers a multi-question turn, one retraction of the offline-native / 10:30 claims, `Accept all recommended`, a `.harness/views/orders.md` edit that adds `R-dietary` before workers, and an explicit `Start build` (first build does not auto-start).

## Shared Wiring Needs (Root / Index Barrels)

No barrel edit. `tests/e2e/src/index.ts` and `benchmarks/src/index.ts` stay frozen.

`tests/e2e/vitest.config.ts` is frozen and only includes `tests/**/*.test.ts`. The suite is launched from `tests/e2e/tests/m2-exit-gate.test.ts`, which that include already collects and which the `m2-exit-gate` filter matches. The runner stays in `tests/e2e/m2-exit-gate/`.

When root `package.json` can change, add:

```json
"test:m2-exit-gate:replay": "node tests/e2e/m2-exit-gate/run-m2-suite.ts",
"test:m2-exit-gate:live": "node tests/e2e/m2-exit-gate/run-m2-suite.ts --live"
```

When `tests/e2e/src/index.ts` can change, re-export `M2KitchenE2eBenchmarkRunner`, `KitchenHiddenAcceptanceSuite`, and the report schema id from `tests/e2e/m2-exit-gate/runner.ts` and `hidden-suite.ts`.

Local ports stand in for siblings that are not on this base (`6497730`). Swap them for the package exports when those tasks land:

- Discovery opening / batch / entailment, readiness, depth, and `Accept all recommended` → `@ef-harness/discovery` (Tasks 069–074)
- 12 matrix generators → `@ef-harness/spec-expansion` (Task 079)
- 5-layer contradictions → `@ef-harness/spec-expansion` (Task 081). Layer 2 is a deterministic implication-cycle probe, not the `z3-solver` package.
- Research with zero network calls → `@ef-harness/research-engine` (Task 082)
- Two-level system architecture → `@ef-harness/planner` (Task 083)
- `.harness/views/` export and markdown import → Tasks 085–086
- Revision propagation before build → Task 087
- Paperwork envelope `3/5/6/4/2` and `<= 20%` → Task 090. Recorded spend is discovery 1%, spec 3%, research 5%, architecture 5%, planning 3%, audit 1% (18% total) inside those caps.
- Sealed `OR-*` oracles kept out of worker prompts → Task 091
- Sequential one-leaf workers → `SequentialBuildRunner` (Task 095)
- Feature integrator merges onto `harness/integration` with `EF-Feature`, `EF-Tasks`, `EF-Requirements`, `EF-Checks-Passed`, `EF-Harness-Version` → `FeatureIntegratorEngine` (Task 096)
- Phase 0 / Gate 0 and completion audit → Tasks 093 and 101
- Port lease `41000–48999` → Task 014
- `MailpitProvider` is an in-process Mailpit HTTP API (`POST /api/v1/send`, `GET /api/v1/messages`) because the Mailpit binary from Task 050 is not on this base
- Orders persist in `node:sqlite`, not embedded Postgres (Task 050 binary not required for ci-replay)
- Child-process audit records spawned PIDs and `taskkill /T /F` on Windows. It is not Task 041's Job Object. `leakedPids > 0` fails the gate
- `STATIC_AUDIT` and secret scan → Tasks 058–059. Needles are built by concatenation so the source files do not contain the literal markers
- Playwright Chromium and `axe-core` load through `createRequire` from the workspace root `package.json`. `tests/e2e/package.json` is frozen and does not declare them
- `KITCHEN_BENCH=1` enables `POST /__bench/clock`. Cutoff math uses a fixed UTC−5 kitchen clock (`2026-03-02`), not the host timezone. `11:00` and later are closed. Client `now` fields are ignored

## Dependency Intents (New Packages Requested)

None. No new package and no dependency edit.

When `tests/e2e/package.json` can change, add `playwright` and `axe-core` there and stop resolving them from the workspace root.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-105-m2-kitchen-exit-gate`:

- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b --pretty false`)
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`)
- `pnpm --filter @ef-harness/e2e test -- m2-exit-gate` — pass. Vitest v5.1.1, 1 file, 4 tests, 57.03s. ci-replay gate exit 0, 29/29 hidden checks, paperwork `0.18`, `0` false over-inferences on "link on phones", `0` static-audit failures, `0` secret findings, `0` tracked `.harness/views/` files, `0` leaked PIDs, retraction and views edit before workers, signed baseline JSON. Removing the server cutoff guard fails `H-M2-05` and `H-M2-29`. A totals mismatch fails `H-M2-17` while `OR-email-visible` still passes. A reject-all drill writes forensics under 90% (failing-check traces, screenshot, db snapshot, audit receipt). Two pipeline digests match.
- `node scripts/verify-harmony.mjs --task 105` — pass (`harmony ok for Task-105`). That run includes repo `pnpm typecheck`, `pnpm lint`, and `pnpm test`.

## Known Limitations / Follow-Ups

- Live M2 certification is not claimed. `--live` calls OpenRouter only when both a key (`EF_M2_LIVE_API_KEY` or `OPENROUTER_API_KEY`) and `EF_M2_LIVE_CONFIRM=1` are set, and the prompt is only the opening text. `claimedCertification` stays false on this base. Without a key the CLI exits 2.
- The sequential baseline Task 134 compares against is the cassette (`totalWallClockSec` 2820), not the CI host elapsed time. Host replay of the four Vitest tests finished in 57.03s.
- `tests/e2e/tests/m2-exit-gate.test.ts` is the only file outside `benchmarks/m2-kitchen-e2e/**` and `tests/e2e/m2-exit-gate/**`. It exists because `tests/e2e/vitest.config.ts` is frozen.
- In-process Mailpit and `node:sqlite` are the Task 050 stand-ins. A real Mailpit or Postgres binary was not required.
- Process teardown is PID tracking plus `taskkill`, not a Windows Job Object.
- Failure forensics are written to the caller-supplied directory (the constant `benchmarks/m2-kitchen-e2e/artifacts` is the spec path). `benchmarks/m2-kitchen-e2e/.gitignore` ignores `artifacts/` so a failed gate dump is not committed. The certified run did not dump forensics because the pass rate was 100%.
