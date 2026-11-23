---
task_id: "Task-194"
branch: "task/194-architecture-review-trials"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "tests/e2e/review-trials/**"
  - "tests/e2e/tests/review-trials.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 194 handoff

External architecture review acceptance trials for areas A–J and verification trials 1–6. The suite stays on `task/194-architecture-review-trials` and is never merged.

## Exports Provided

- `ArchitectureReviewTrialsSuite` from `tests/e2e/review-trials/index.ts`. `run()` executes areas A–J and trials 1–6, rejects skip and todo markers, and returns a `ReviewTrialsCertificationReport`.
- `ReviewTrialsCertificationReport` at version `review-trials-certification/1`, plus `writeReport` and `reportToMarkdown`. Passing `run({ reportDir })` writes `review-trials-certification.json` and `review-trials-certification.md`.
- `LocalPortBroker` binds `127.0.0.1` with `listen(0)` and records the leased ports on the report.

Task 200 should import these from `tests/e2e/review-trials/index.ts`.

## Shared Wiring Needs (Root / Index Barrels)

`tests/e2e/vitest.config.ts` is frozen. Its include is `tests/**/*.test.ts` relative to the e2e package, so `tests/e2e/review-trials/**` is outside the glob. `tests/e2e/tests/review-trials.test.ts` is a side-effect loader that pulls the owned suite into that glob. That is why `pnpm --filter @ef-harness/e2e test -- review-trials` executes all 17 tests.

At integration, add `review-trials/**/*.test.ts` to the frozen include and delete the loader. Do not edit `tests/e2e/src/index.ts` on this branch; it is outside the owned subtree.

## Dependency Intents (New Packages Requested)

None. Sibling task branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. The trials use local engines in `tests/e2e/review-trials/lib` and `node:sqlite`.

When those packages land on `harness/integration`, point the suite at their exports:

- `@ef-harness/db` for the single writer, outbox delivery guard, and 4-step recovery
- `@ef-harness/discovery` for exact-quote grounding and acyclic entailment
- `@ef-harness/verifier` for clean-copy verification and sealed step 3b checks
- `@ef-harness/sandbox` for job containment, the allowlist proxy, and the 8-step secret purge
- `@ef-harness/providers` and `@ef-harness/runtime-adapters` for plan compliance and the 10-probe conformance downgrade
- `@ef-harness/steering` for holds and the calm inbox
- `@ef-harness/integrator` for the merge queue and the additive-vs-breaking classifier
- `@ef-harness/ship-deploy` for the effects ledger and expand-then-contract
- `@ef-harness/investigations` for sweeps and `path_leases`
- `@ef-harness/portability` for `writer_epoch` and age-encrypted `harness-state`

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/e2e test -- review-trials` — pass. Vitest 5.1.1, 1 file, 17 tests, 0 failed, about 22s. Areas A–J, trials 1–6, and the anti-skip certification test all passed. The certification assertion requires 16/16 executed, 0 skipped, and suite duration under 90s.
- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 194` — run by `node scripts/agent-worktree.mjs commit 194` immediately before this commit.

## Known Limitations / Follow-Ups

- Port leases are ephemeral loopback sockets (`127.0.0.1`, port 0). This branch does not take addresses from the machine-wide `41000–48999` range stored in `global.db.port_leases`.
- Process-tree teardown uses `taskkill.exe /T /F` with a 500ms cap. Native Job Object containment arrives with `@ef-harness/sandbox`.
- Trial 5 posts through Playwright's request client when that client opens within 2 seconds. If it does not, the same order is posted with `fetch` to the live local API, SQLite, and mail catcher. Browser binaries were not downloaded.
- Commit only on this branch. Never merge into `main` or `harness/integration`.
