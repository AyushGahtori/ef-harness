---
task_id: "Task-101"
branch: "task/101-completion-wave-final-audit"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/final-audit/**"
  - "packages/integrator/tests/final-audit/**"
  - ".agent-handoffs/task-101.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 101 handoff

Completion wave on `harness/integration`: deterministic repo audit, live route/CLI/OpenAPI crawl, sharded `final-project-auditor@1` (at most 2 fix rounds and 10% of the project budget), evidence gate, crash-resumable checkpoints, and the landing summary. Commit stays on `task/101-completion-wave-final-audit`.

## Exports Provided

Import from `packages/integrator/src/final-audit/index.ts` until the package barrel is wired:

- `CompletionWaveController` — refuses to start unless every planned feature is `DONE` on `harness/integration`, then runs Layer A, Layer B, and Layer C before any fix. Fix rounds stop at 2. Fix spend stops at 10% of the project limit. A previously passing suite case that fails after a fix blocks landing.
- `DeterministicRepoAuditor` — Layer A at 0 model tokens: level-2 static audit, secret scan, migration cleanliness, `.env.example` coverage, production build, typecheck, lint, and the combined leaf + feature-journey + sealed suite.
- `LiveRouteCrawler` — Layer B at 0 model tokens. Web routes are opened at `375` and `1440`. CLI projects get `--help` / subcommand smoke plus `--json` stdout purity. OpenAPI projects smoke the booted server. Teardown reports leftover pids.
- `ShardedFinalProjectAuditor` — at most one shard per feature, one per seam, and one per active `X-01`–`X-14` rule. Each prompt is that shard's requirements, diff, file excerpts, and Layer A/B receipts. Context is cut until it is under `6000` tokens. Shards run concurrently and reserve the 2% final-audit scope.
- `LandingSummaryGenerator` — plain-English project delivery summary for the Ship/Build view: features and journeys, receipt counts, Chosen for you, Deferred, coding vs paperwork, per-connection window use, `Green — Ready to Land` or `Needs Your Review (N unresolved findings)`, and `Land as-is / Fix manually / Allocate extra fix budget` when the round cap or the 10% cap leaves a blocking finding.
- `parseFinalProjectAuditorV1` — local port of `FinalProjectAuditorV1Schema`. `verdict: "complete"` is rejected when any finding list is non-empty. Extra keys are rejected. `{ blocked: true, reason, missing_ids? }` is the honest exit.
- `FinalAuditStore` — `node:sqlite` checkpoint tables `final_audit_runs`, `final_audit_checks`, `final_audit_shards`, `final_audit_summaries`.
- `InMemoryBudgetLedger` — local port of `BudgetLedger` / `BudgetLedgerRepo` for the 2% audit scope and the 10% fix scope.
- `createLocalStaticAuditGate`, `createLocalSecretScanner`, `createHttpPlaywrightVerifier`, `gateAuditorFindings`, `planShards`, `findingFingerprint`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/integrator/src/index.ts` is frozen. Re-export the completion wave from the package barrel:

```ts
export {
  CompletionWaveController,
  DeterministicRepoAuditor,
  FinalAuditStore,
  InMemoryBudgetLedger,
  LandingSummaryGenerator,
  LiveRouteCrawler,
  ShardedFinalProjectAuditor,
  createHttpPlaywrightVerifier,
  createLocalSecretScanner,
  createLocalStaticAuditGate,
  parseFinalProjectAuditorV1,
} from "./final-audit/index.js";
export type {
  AuditFixTask,
  BudgetLedgerPort,
  CanonicalCatalog,
  CheckRunnerPort,
  CleanVerifierHarnessPort,
  CompletionWaveRequest,
  CompletionWaveResult,
  ConfirmedFinding,
  FinalProjectAuditorV1,
  LandingSummary,
  LayerAReport,
  LayerBReport,
  SecretScannerPort,
  StaticAuditGatePort,
  UiPlaywrightContractVerifierPort,
} from "./final-audit/index.js";
```

No root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig*.json`, or `eslint.config.mjs` edits.

## Dependency Intents (New Packages Requested)

None. Layer B's default session uses `fetch` and `node:http`. Checkpoints use `node:sqlite`. No Playwright, axe-core, gitleaks, or zod dependency was added. `zod` is already a root devDependency; this package does not import it.

## Contract Change Requests

None. No schema, `.opencode`, or `.githooks` edits.

Sibling branches are not on this base. These local ports should be swapped at integration:

- **Task 009.** `parseFinalProjectAuditorV1` stands in for `FinalProjectAuditorV1Schema` / `FinalProjectAuditorV1` from `@ef-harness/shared-contracts`. When that schema is on the barrel, parse model output with it and delete the local parser if the published schema covers the same strict success and blocked shapes, including the rule that `complete` requires all four lists to be empty.
- **Task 023.** `InMemoryBudgetLedger` stands in for `BudgetLedgerRepo`. `ensureCompletionScopes` creates `${projectId}:final-audit` at 2% and `${projectId}:audit-fix` at 10% of the project limit, then uses `reserveAcrossScopes`, `settleReservation`, `releaseReservation`, and `getBudgetRemaining`. Point the controller at `BudgetLedgerRepo.createBudgetScope` for those two scopes. Do not borrow from coding or from other waves.
- **Task 054 in the task text / Tasks 058–059 in the sibling branches.** The task names `StaticAuditGate` as Task 054. The published static gate is Task 059 `CompletenessGateRunner.runFeatureStaticAudit` (`StaticAuditReport`) fed by Task 058 `StaticAuditAstEngine`. `createLocalStaticAuditGate` is the stand-in (unanchored work markers, stubs, `vi.mock` / `jest.mock`, dead nav routes, orphan handlers, unused entry exports, broken relative imports). Inject the feature-level runner as `DeterministicRepoAuditor`'s `staticAudit` port. A marker that already cites an approved `DEF-` id stays a non-finding, matching the foundation marker rule.
- **Task 036.** `createLocalSecretScanner` stands in for `GitSafetyScanner` / gitleaks. It flags private-key banners and the live, cloud, and vendor token prefixes without printing those prefixes as contiguous source text. Swap the `secrets` port. Do not deep-import `packages/git-engine`.
- **Task 055 in the task text / Task 060 in the sibling branch.** The task names `CleanVerifierHarness` as Task 055. The published runner is Task 060 `CleanVerifierRunner`. `CleanVerifierHarnessPort.runCombined` is the stand-in and must return leaf, feature-journey, and sealed-hidden cases. The controller treats a case that passed on the initial suite and fails after a fix as a regression.
- **Task 057 in the task text / Task 062 in the sibling branch.** The task names `UiPlaywrightContractVerifier` as Task 057. The published verifier is Task 062 `UiInteractionContractVerifier` plus `launchChromium`. `createHttpPlaywrightVerifier` implements the same session order (`setViewportSize`, `goto`, `evaluate`, `close`) over HTTP because browser binaries are not installed in this worktree. Swap the `browser` port for Chromium. Keep both `375` and `1440`.
- **Tasks 073–074.** Chosen-for-you and deferred notes are caller input (`ledgerRecap`). The summary copies them verbatim. Swap the caller to the discovery ledger when those packages are wired.
- **Checkpoint tables.** `FinalAuditStore` creates its own tables in the opened database. They are not in `schema/state.sql`. Add them in a later schema task, or keep this store beside `state.db` until that lands. Do not edit `schema/` from this branch.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-101-completion-wave-final-audit`:

- `pnpm --filter @ef-harness/integrator typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/integrator lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/integrator test -- final-audit` — pass. Vitest v5.1.1: 6 files, 19 tests, about 0.8s. Covers a clean Layer A receipt (build, typecheck, lint, leaf + journey + sealed) at 0 tokens; marker, stub, mock, dead `/print` route, orphan handler, unused entry export, broken import, secret, dirty migration, and `.env.example` gap; an approved deferral id left alone; live HTTP crawls at 375 and 1440 including a `/print` 404 with the console stack, mobile-only overflow, broken image, missing alt, unhandled rejection, leaked pid, CLI `--json` purity, and OpenAPI 500 smoke; 12 features + 8 seams + 10 active rules (30 shards) under 6000 tokens, concurrent, inside the 2% cap, with no cross-feature prompt leak; duplicate feature ids collapsed to one shard; schema rejection of `complete` plus findings; ghost path `src/ghost.ts:99` and 12 cosmetic naming nits spawning 0 fix tasks; stop at 2 fix rounds with the third gap left as `Needs Your Review` and the three choices; stop when one critical fix spends the whole 10% cap while one medium edge remains; a round-1 fix that fails previously passing `auth-wave1` before landing; resume that skips a saved static audit and unfinished shards `feature:F-03` / `feature:F-04`; landing text `8 of 10 leaf tests passed` with paperwork `25.0%` marked over the 20% cap.
- `node scripts/verify-harmony.mjs --task 101` — pass (exit 0, `harmony ok for Task-101`, about 34s). Schema tests, diagram check, owned-path scope, and workspace typecheck, lint, and tests succeeded.

## Known Limitations / Follow-Ups

- The default browser is an HTTP document probe, not Chromium. It performs real GETs for the document, `<img>` URLs, and `fetch("…")` URLs in the HTML, treats `naturalWidth === 0` and HTTP 404 images as broken, and flags images with no alt as a serious `image-alt` violation. Console errors, unhandled rejections, forced overflow, and extra axe ids are read from `ef-console-error` / `ef-unhandled-rejection` script blocks and `data-overflow*` / `data-axe` markers. Swap in Task 062 `launchChromium` for a real page console, layout, and axe-core run.
- The static gate does not run knip, the name registry, or the asset scanner. Those stay on the Task 059 port.
- The secret scan does not shell out to gitleaks. Swap the Task 036 scanner.
- `CleanVerifierHarnessPort` and the build/typecheck/lint runner are injected. This package does not create a Task 060 verifier worktree or boot Mailpit.
- The fix executor is injected. This package does not commit onto `harness/integration`. It only emits fix tasks whose branch field is `harness/integration`.
- There is no model provider adapter. Tests pass a fake `final-project-auditor@1`. Invalid JSON and `{ blocked: true }` become non-fix findings and block a green landing.
- Crash resume reloads saved Layer A/B check ids and Layer C shard ids. Attempted fix fingerprints live in the process. A crash during `fixExecutor.apply` can re-apply those fingerprints on the next `run`.
- Medium findings are not auto-fixed. They stay in `Needs Your Review`. Critical and high findings with a real file, line range, and requirement or rule id become fix tasks. Cosmetic wording and fabricated paths do not. Waived fingerprints are dropped.
- `final_audit_*` tables are not in `schema/state.sql`.
- The 20% paperwork cap is reported from the caller's spend snapshot. This package does not move money between coding and paperwork.
- Round 2 is followed by one confirmation pass of Layers A/B and the shards touched by that fix. A new critical finding from that pass is reported and is not given a third fix round.
