---
task_id: "Task-068"
branch: "task/068-m1-kitchen-exit-gate"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "benchmarks/m1-kitchen-leaves/**"
  - "tests/e2e/m1-exit-gate/**"
  - "tests/e2e/tests/m1-exit-gate.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 068 handoff

Commit stays on `task/068-m1-kitchen-exit-gate`. Do not merge.

## Exports Provided

Frozen Kitchen benchmark for `Task 105` and `Task 189`:

- `benchmarks/m1-kitchen-leaves/manifest.json` — tasks `K01`–`K20`, feature branch `harness/f/F12`
- `benchmarks/m1-kitchen-leaves/seed/**` — Phase-0 Kitchen Lunch repo. Every contracted export throws until a leaf replaces that file. No `node_modules`. Held-back checks are not in this tree.
- `benchmarks/m1-kitchen-leaves/briefs/K01.json`–`K20.json` — `task-packet@1` briefs with one visible example each
- `benchmarks/m1-kitchen-leaves/hidden/K01.json`–`K20.json` — four sealed held-back cases per rule (`>= 3` spares). Prefix `HK-`. Never put these files in a worker prompt or MCP result.
- `benchmarks/m1-kitchen-leaves/M1_EXIT_REPORT.md` — scripted CI certification. It does not claim the live `>= 17/20` bar.

Runner entry: `tests/e2e/m1-exit-gate/run-m1-suite.ts`.

- `runM1ExitGate` — deterministic CI slice
- `runLiveCertification` — `--live`. Returns `claimedCertification: false` when the key is missing, and does not claim the 20-task bar from a single provider call.
- `certifyCi`, `assertExitGate`, `writeExitReport`, `reportPath`, `renderReport`
- `PIPELINE_STAGES` — `claimTask`, `WorktreeSlotManager`, `TestEnvOrchestrator`, `NativeWorkerLoop`, `AttemptMcpServer`, `harness.run`, `submit_candidate`, `STATIC_AUDIT`, `CleanVerifierRunner`, `CandidateAcceptanceCoordinator`, `squash`, `viewer`

Leaf map: `K01` `toPrintRows`; `K02` print line; `K03` `Europe/Berlin` cutoff; `K04` cutoff instant; `K05` order grouping; `K06` duplicate labels; `K07` cancellation totals; `K08` integer minor-unit pricing `X-04`; `K09` integer rate; `K10` role checks `X-01`; `K11` boundary validation `X-02`; `K12` error body `X-11`; `K13` SQLite notes migration; `K14` Postgres notes migration; `K15` `/kitchen` Print button; `K16` kitchen ARIA; `K17` empty kitchen; `K18` `/order` field errors; `K19` `/order` success; `K20` error banner `X-11`.

## Shared Wiring Needs (Root / Index Barrels)

No barrel edit. Sibling packages on this base only export `packageName` and `layer`. Do not import them as if Tasks 035–067 were already implemented.

`tests/e2e/vitest.config.ts` is frozen by Task 001, so its include stays `tests/**/*.test.ts`. The suite is launched from `tests/e2e/tests/m1-exit-gate.test.ts`, which that include already collects and which the `m1-exit-gate` filter matches. Do not edit the frozen config. The runner itself stays in `tests/e2e/m1-exit-gate/run-m1-suite.ts`.

Local ports in `tests/e2e/m1-exit-gate/pipeline.ts` stand in for unpublished siblings. They use real `schema/state.sql`, real `schema/global.sql`, real Git worktrees, real check processes, and real Playwright against Electron. Swap them for the package exports when those tasks land:

- `WorktreeSlotManager` → `@ef-harness/git-engine`
- `TestEnvOrchestrator` → `@ef-harness/test-env`
- `NativeWorkerLoop` → `@ef-harness/worker-loop`
- `AttemptMcpServer` → `@ef-harness/mcp-server` (`kb.get` denies `HK-` ids)
- `staticAudit` → `@ef-harness/completeness-gate` `STATIC_AUDIT`
- clean checkout plus held-back grading → `@ef-harness/verifier` `CleanVerifierRunner`, including `RedBeforeGreenGate`
- claim / accept / finish / squash onto `harness/f/F12` → `CandidateAcceptanceCoordinator` (`Task 066`)
- `harness.run` allow/deny → `@ef-harness/sandbox`
- `tests/e2e/m1-exit-gate/viewer/main.cjs` → `apps/desktop` M1 viewer (`Task 067`)

`FakeModelAdapter` stays the CI trajectory: `K01` and `K03` fail a held-back check then submit the real rule, `K08` is rejected as a stub then fixed. `--live` is the separate certification mode.

Playwright and Electron are loaded with `createRequire` from the workspace root `package.json`. `tests/e2e/package.json` is frozen, so the e2e package does not declare those dependencies itself.

## Dependency Intents (New Packages Requested)

None. No new package and no dependency edit.

When `tests/e2e/package.json` can change, add `playwright` and `electron` there and stop resolving them from the workspace root.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-068-m1-kitchen-exit-gate`:

- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b`)
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`)
- `pnpm --filter @ef-harness/e2e test -- m1-exit-gate` — pass. Vitest v5.1.1, 1 file, 2 tests, 44.91s. Scripted result: 20/20 accepted, stub block 100% (10/10 rejected, 0 accepted), red-team escapes 0/7, viewer opened with a diff hunk, `Harness-Task: K01` trailer, and green receipt, leftovers 0, Tier C not reported as OS-enforced. The second test clears both API key variables and checks `claimedCertification` is false.
- `node scripts/verify-harmony.mjs --task 068` — pass (`harmony ok for Task-068`). That run includes repo `pnpm typecheck`, `pnpm lint`, and `pnpm test` after the seed stubs were adjusted to satisfy lint. `pnpm test` re-runs this suite. Seed source is 2336 bytes.

`M1_EXIT_REPORT.md` is the scripted receipt. Live certification was not run. `--live` without an API key returns `claimedCertification: false`.

## Known Limitations / Follow-Ups

- Live M1 bar (`>= 17/20` on a real model) is not claimed. CI mode is `FakeModelAdapter` only. Run `node --experimental-transform-types tests/e2e/m1-exit-gate/run-m1-suite.ts --live` with `EF_M1_LIVE_API_KEY` or `OPENROUTER_API_KEY` when certifying a release. Node's strip-only loader rejects the parameter properties in `pipeline.ts`. One provider call must not be treated as the 20-task bar. Without a key, `runLiveCertification` returns `claimedCertification: false`. The CLI then sets exit code 2 because it did not certify.
- OS red-team sign-off is withheld. The kernel policy blocked 7/7 (profile read, outside write, `.git/HEAD`, raw TCP, orphan sleeper, `pnpm add` / `curl | sh`, `kb.get` of a held-back id). Tier C is flagged as advisory and is not reported as OS-enforced. Full sign-off needs `@ef-harness/sandbox` on Tier A, B, or D.
- Upstream packages were not modified. If a sibling implementation disagrees with a port, reproduce it against that package and swap the port listed above.
- `tests/e2e/tests/m1-exit-gate.test.ts` is the only file outside `benchmarks/m1-kitchen-leaves/**` and `tests/e2e/m1-exit-gate/**`. It exists because `tests/e2e/vitest.config.ts` is frozen and only includes `tests/**/*.test.ts`.
