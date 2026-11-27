# Pass 06 — Chunk 001 Audit Report (`packages/ship-deploy` External Effect Ledger, GitHub Connector, PR/CI Loop, Vercel + Docker/SSH Deploy Adapters, Live Expand-Contract Migrations & Post-Deploy Rollback — `Tasks 176–181`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-001`
- **Units Audited (6):**
  - `Task 176` (`task/176-external-effect-ledger` @ `7b46817`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-176-external-effect-ledger`, unmerged, clean)
  - `Task 177` (`task/177-github-connector-queue` @ `b32f60e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-177-github-connector-queue`, unmerged, clean)
  - `Task 178` (`task/178-push-pr-ci-repair` @ `3dcb870`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-178-push-pr-ci-repair`, unmerged, clean)
  - `Task 179` (`task/179-deploy-adapter-vercel-docker` @ `1ad270e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-179-deploy-adapter-vercel-docker`, unmerged, clean)
  - `Task 180` (`task/180-expand-contract-migrations` @ `d6d7f53`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-180-expand-contract-migrations`, unmerged, clean)
  - `Task 181` (`task/181-post-deploy-verify-rollback` @ `53ef907`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-181-post-deploy-verify-rollback`, unmerged, clean)
- **Governing Architecture Documents:** `ship-and-deploy.md`, `open-design-questions.md`, `database-design.md`, `schema/state.sql` (`effects`, `ship_runs`), `schema/global.sql`, `sandbox-and-security.md`, `prompt-contracts.md` (`ci-triage@1`), `ship-and-deploy.mmd`, `research/ci-and-deployment.md`.

## 2. Files Directly Inspected
- `packages/ship-deploy/package.json` & `packages/ship-deploy/src/index.ts` (`task-178`)
- `schema/state.sql` (`effects` lines 547–560, `ship_runs` lines 734–750)
- `packages/ship-deploy/src/effects/{store.ts,ledger.ts}` (`Task 176`)
- `packages/ship-deploy/src/github/rate-queue.ts` (`Task 177`)
- `packages/ship-deploy/src/ci-loop/{ship-run-store.ts,linux-case-sensitivity-auto-repair.ts}` (`Task 178`)
- `packages/ship-deploy/src/deploy-adapters/docker-ssh-adapter.ts` (`Task 179`)
- `packages/ship-deploy/src/live-migrations/state-store.ts` (`Task 180`)
- `packages/ship-deploy/src/post-deploy/store.ts` (`Task 181`)

## 3. Verified Local Strengths
- `ExternalEffectLedger`, `EnvApprovalPolicyEngine`, and `UnknownOutcomeReconciler` (`176`) enforce write-ahead `planned → dispatched` (`sent`) transitions, unconditional `production` explicit approval, payload-bound approval invalidation, and zero blind retries on `unknown_outcome`.
- `GitHubRateAwareQueue` & `ConditionalEtagPoller` (`177`) serialize mutating requests (`>= 1000 ms`, `< 80/min`, `< 500/hr`), honor `Retry-After` / `x-ratelimit-reset`, use `If-None-Match` (`304` zero-quota polling), lock protected branches to PR Mode, and avoid URL-embedded Git tokens.
- `FiveClassCiTriager` & `BoundedCiRepairLoop` (`178`) classify CI failures into all 5 required classes, restrict code edits to Classes 1–2, cap pushes at `<= 3` per fingerprint (`<= 5` total), and build structured graph-sourced PR bodies.
- `VercelDeployAdapter` & `DockerOverSshDeployAdapter` (`179`) enforce `StrictHostKeyChecking=yes` with pinned host fingerprints, `0600` stdin-piped env files (`0` `-e KEY=VAL` argv leaks), name-only env diffs, `sk_live_`↔`preview` / `sk_test_`↔`production` cross-guards, and health-gated container swaps.
- `LiveMigrationOrchestrator` (`180`) enforces 6-phase expand-then-contract DDL safety classification, pausable batched cursor backfills, and contract export backups; `PostDeployPipeline` (`181`) verifies build-ID health, deployed Playwright smoke, 10-min error watch, preview/staging auto-rollback, and offered prod rollback.

## 4. Local Implementation Defects Discovered
1. **Non-Canonical `project_runtime` Table Defeating `LeaseEpochFencingGuard` (`Task 176` `effects/store.ts:19-25,140-145` — `F-076`):**
   - `SqliteEffectStore` creates a private table `project_runtime (singleton, writer_epoch, state)` absent from `schema/state.sql` and seeds `(1, 1, 'RUNNING')`. Neither `Task 114` (`StopCoordinator`) nor `Task 187` (`writer_epoch`) writes to `project_runtime`, so real `STOP` clicks and cross-device epoch bumps never fence `ExternalEffectLedger.dispatchEffect`.
2. **Rogue `DatabaseSync` Writer & `idempotency_key` `payload_hash` Overwrite in `MigrationStateStore` (`Task 180` `live-migrations/state-store.ts:61-72,285-311` — `F-076`):**
   - `MigrationStateStore.open` opens a direct `new DatabaseSync(file)` writer on `state.db` without `CoordinatorWriteQueue` or the `ef_search_text` FTS5 UDF, and implements a competing `ExternalEffectLedger.record()` whose `ON CONFLICT(idempotency_key) DO UPDATE SET payload_hash = excluded.payload_hash` overwrites `payload_hash` with `lease_epoch = NULL` instead of throwing `PayloadHashMismatchError`.
3. **Directory-Stripping Bug in `LinuxCaseSensitivityAutoRepair` (`Task 178` `ci-loop/linux-case-sensitivity-auto-repair.ts:36-47,69` — `F-076`):**
   - `rewriteImportLine` computes `const desired = "./" + basenameWithoutExt(resolvedPath)` — stripping intermediate folders and parent traversals (`'./Components/Header'` or `'../utils/DateFormat'` becomes `'./header'` / `'./dateFormat'`), breaking nested relative imports!

## 5. Cross-Unit Contract & Seam Mismatches
1. **6-Way `packages/ship-deploy` Silo Isolation (`176`–`181`), Empty `src/index.ts` Barrel, Volatile In-Memory `ship_runs`/Rate-Queue/CAS & Unbound `commitSha` Payload Hash (`F-077`):**
   - `packages/ship-deploy/src/index.ts` is an empty `packageIdentity()` stub across all 6 branches (`176–181`), with zero cross-imports among `effects`, `github`, `ci-loop`, `deploy-adapters`, `live-migrations`, and `post-deploy`.
   - `178` (`InMemoryShipRunStore`) and `181` (`InMemoryPostDeployStore` + `InMemoryCasBlobStore`) store `ship_runs`, external registration receipts, and smoke screenshots only in memory instead of `state.db.ship_runs` (`013`) and `CasBlobStore` (`028`), breaking crash-resumable `CI_WATCHING` across restarts.
   - `177` `GitHubRateAwareQueue` (`rate-queue.ts:159`) stores rate-limit counters in a process-local `Map` instead of `global.db` (`014`), and `179` `DockerOverSshDeployAdapter.planDeploy` (`docker-ssh-adapter.ts:79`) sets `canonicalPayloadHash: commitSha` instead of RFC 8785 hashing `{ targetEnv, commitSha, envDiff }` via `007`.
   - `176`, `178`, and `181` duplicate `canonical-hash.ts` and `redactor.ts` instead of importing `@ef-harness/shared-contracts` (`007`/`009`) and `@ef-harness/shared-observability` (`011`).

## 6. Shared-File & Ownership Conflicts
- `packages/ship-deploy/src/index.ts` and `packages/ship-deploy/package.json` must export `effects`, `github`, `ci-loop`, `deploy-adapters`, `live-migrations`, and `post-deploy` and declare `@ef-harness/{db,git-engine,governor,shared-observability,verifier}`.

## 7. Runtime Wiring Gaps
- Wire all external writes across `177–181` through `176` `ExternalEffectLedger` backed by `@ef-harness/db` single-writer `EffectsRepo` (`029`) + canonical `StopCoordinator` (`114`) + `writer_epoch` (`187`), persist `ship_runs` (`178`, `180`, `181`) in `state.db.ship_runs`, store tokens/secrets in `120` `WindowsDpapiSecretsVault`, and mount Ship RPC handlers in `apps/daemon` (`066`) + `127` `ApprovalCard`.

## 8. Architecture & Security Violations
- `F-076`: `176`'s disconnected `project_runtime` table bypasses real `STOP` and `writer_epoch` fencing, and `180`'s `ON CONFLICT(idempotency_key)` overwrites `payload_hash`.
- `F-077`: `179` `planDeploy` omits `envDiff` and `targetEnv` from `canonicalPayloadHash`.

## 9. Test Coverage & Verification Gaps
- `178`'s case-repair unit tests only tested same-directory `'./Header'` imports, missing the nested `'./Components/Header'` / `'../utils/DateFormat'` path-stripping bug.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-076` (`CRITICAL`):** `ship-deploy` (`176, 178, 180`) Disconnected `project_runtime` Fencing Table, Rogue `MigrationStateStore` `DatabaseSync` Overwriting `effects.payload_hash`, and Nested-Path Stripping in `LinuxCaseSensitivityAutoRepair`.
- **`F-077` (`HIGH`):** `packages/ship-deploy` (`176`–`181`) 6-Way Internal Silo Isolation, Empty Barrel, Volatile In-Memory `ship_runs`/Rate-Queue/CAS Stores, Unbound `commitSha` Approval Hash & Unwired Upstream Ports.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`176, 177, 178, 179, 180, 181`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `007, 009, 011, 014, 025, 028, 029, 035, 036, 055, 101, 114, 120, 127, 187`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-076`–`F-077`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-002`: `Tasks 182–185` (`packages/investigations` 6-stage mystery-bug pipeline, `git bisect` + `ddmin` localization toolkit, repo-wide sweep `path_leases` ownership, `@ast-grep` codemod & sweep safety guards).
