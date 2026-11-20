---
task_id: "Task-060"
branch: "task/060-clean-verifier-harness"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/runner/**"
  - "packages/verifier/tests/runner/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 060 handoff

Clean verifier execution harness. Acceptance runs only in a dedicated verifier slot after the leaf static audit. Comparison, required-id checks, and receipts stay in the host process. Commit stays on `task/060-clean-verifier-harness`.

## Exports Provided

Import from `packages/verifier/src/runner/index.ts` until the package barrel is wired.

- `CleanVerifierRunner`
  - `verifyCandidate(request)` checks out `commitSha` into a verifier slot, attaches the locked dependency digest, runs `CompletenessGateRunnerPort.runLeafStaticAudit`, materializes fingerprinted expectations, provisions a fresh Tier 0–3 environment, executes the pinned command (never the candidate `package.json` test script), compares observations outside the candidate, replays time/network/browser or flaky checks, and writes receipts.
  - `materializeProtectedExpectations(input)` loads runner, command, config, and expectation bytes from CAS, verifies SHA-256 against the dispatch fingerprint, unseals expectations in the host process, and writes held-back expected values only under a host temp directory.
  - `parseCollectedCaseIds(reporter)` parses `ef-oracle@1`, Vitest JSON, Playwright JSON, JUnit, and TAP into collected check ids. Reporter status is advisory. Skip is fail-closed. Stdout cannot set attribution signals.
  - `writeImmutableReceipt(input)` inserts `check_results` `(check_id, attempt, check_version, artifact_digest, status, receipt, recorded_at)` and stores log, trace, and observations in CAS. Retention is `evidence` only when status is `pass` and stability is `stable`; otherwise `diagnostic`. The receipt stamps `sandboxTier`, `commitSha`, and `checkVersions`.
  - `registerSurfaceVerifier(adapter)` adds a `SurfaceVerifierAdapter`. First registered adapter that `supports` a check collects it. The runner still compares.
- `attributeVerificationFailure(input)` classifies a non-pass into `implementation`, `contract_mismatch`, `binding_defect`, `environment`, or `flaky_test`.
- `parseCollectedCaseIds` (pure function, same behavior as the method).
- `VerificationOutcome` — `workerFacing` is the only worker-visible payload. `sealedHintLadder` carries raw held-back input, expected, and observed for Task 065.
- `FailureAttribution` — the five root owners.
- `SurfaceVerifierAdapter`, `SurfaceCollectInput`, `SurfaceCheckResult`.
- `MissingRequiredChecksError` — `MissingRequiredChecksError(missingIds, outcome)` when a required id was not collected (including exit code 0 with zero collected tests).
- `VerifierIntegrityError` — fingerprint, checkout commit, missing protected expectation, or binder path escape. Thrown before the candidate runs.
- `CleanCheckoutSeparationError` — verifier slot resolved to the worker worktree.
- `CROSS_CUTTING_RULE_IDS` (`X-01` through `X-14`), `isCrossCuttingRuleId`, `missingInScopeRules`.
- `CLEAN_VERIFIER_REPLAY_CLOCK` — fixed clock and seed for the clean replay.
- `sealExpectationDocument`, `defaultExpectationUnsealer`, `sha256Hex`, `canonicalJson`.
- Port types: `WorktreeSlotManagerPort`, `TestEnvOrchestratorPort`, `HarnessRunEnginePort`, `CompletenessGateRunnerPort`, `CasBlobStorePort`, `CheckResultsPort`, `ExpectationUnsealer`, `CleanVerifierDeps`.

`requirementResolution` is `passing`, `failing`, `unresolved`, or `not_run`. Environment crashes and flake disagreements set `unresolved` and `affectsWorkerQualityScore: false`. Contract mismatches set `burnsHiddenLadder: false` and do not fill `sealedHintLadder`.

## Shared Wiring Needs (Root / Index Barrels)

`packages/verifier/src/index.ts` is frozen. Re-export the runner surface from the package barrel:

```ts
export {
  CLEAN_VERIFIER_REPLAY_CLOCK,
  CROSS_CUTTING_RULE_IDS,
  CleanCheckoutSeparationError,
  CleanVerifierRunner,
  MissingRequiredChecksError,
  VerifierIntegrityError,
  attributeVerificationFailure,
  canonicalJson,
  defaultExpectationUnsealer,
  isCrossCuttingRuleId,
  missingInScopeRules,
  parseCollectedCaseIds,
  sealExpectationDocument,
  sha256Hex,
} from "./runner/index.js";

export type {
  AttemptLeaseView,
  AttributionInput,
  AttributionRoute,
  CasBlobStorePort,
  CasRetention,
  CheckDbStatus,
  CheckOutcome,
  CheckResultInsert,
  CheckResultsPort,
  CheckRunRecord,
  CheckStability,
  CheckSurface,
  CheckVisibility,
  CleanVerifierDeps,
  CollectedCase,
  CollectedCaseReport,
  CompletenessGateRunnerPort,
  CrossCuttingRuleId,
  DispatchFingerprint,
  EnvironmentFailureKind,
  ExpectationCheckBody,
  ExpectationDocument,
  ExpectationUnsealer,
  FailureAttribution,
  FailureAttributionDecision,
  HarnessRunEnginePort,
  HintFailureType,
  HintLadderPayload,
  ImmutableReceiptInput,
  LeafStaticAuditResult,
  MaterializeProtectedRequest,
  MaterializedCheck,
  MaterializedExpectations,
  PinnedRunRequest,
  PinnedRunResult,
  ProvisionedEnv,
  ReplayClock,
  RequiredCheckRef,
  RequirementResolution,
  RunSignals,
  SandboxCheckInput,
  SandboxTier,
  SurfaceCheckResult,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
  TestEnvOrchestratorPort,
  VerificationOutcome,
  VerifyCandidateRequest,
  VerifierWorktreeSlot,
  WorkerFacingCheck,
  WorkerFacingReport,
  WorktreeSlotManagerPort,
} from "./runner/index.js";
```

No root `package.json` script changes. No new workspace package.

## Dependency Intents (New Packages Requested)

None. The runner uses `node:crypto`, `node:fs`, `node:os`, and `node:path` only. Do not add a dependency to `@ef-harness/verifier/package.json` for this task.

## Contract Change Requests

None. `state.db.check_results.status` stays inside `pass | fail | skip | missing | error`. A disagreeing replay is recorded as SQL status `error` with receipt `stability: "unstable"`. No schema edit.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-060-clean-verifier-harness`.

- `pnpm --filter @ef-harness/verifier typecheck` — exit 0.
- `pnpm --filter @ef-harness/verifier lint` — exit 0.
- `pnpm --filter @ef-harness/verifier test -- runner` — exit 0. Vitest v5.1.1: 2 files, 27 tests passed (clean checkout isolation, fingerprint tamper, binder escape, exit 0 with zero collected ids, skipped check, forged reporter pass, held-back redaction, flake replay, stable double-fail, postgres crash cleanup, X-03 coverage, lease shield, static-audit gate, surface adapter, contract mismatch, Vitest JSON, reporter parsers, five attribution owners).
- `node scripts/verify-harmony.mjs --task 060` — exit 0. Printed `harmony ok for Task-060` (schema 67/67, diagram check, owned-path scope, repo typecheck, lint, and test).

## Known Limitations / Follow-Ups

Sibling branches are not on this base. The runner depends on local ports. Swap them when those tasks integrate. Do not import the stub packages as if they already exported these APIs.

| Local port | Replace with | Notes |
|---|---|---|
| `WorktreeSlotManagerPort` | Task 038 `WorktreeSlotManager` | `checkoutImmutable` must return a verifier slot whose path is not the worker worktree and whose `commitSha` is the candidate. `attachLockedDependencies` mounts the read-only shared store. `release` drops the slot. |
| `TestEnvOrchestratorPort` | Task 049 `TestEnvOrchestrator` | `provision` creates a fresh Tier 0–3 environment isolated from the worker attempt. Replay passes `CLEAN_VERIFIER_REPLAY_CLOCK`. `destroy` runs in `finally`. |
| `HarnessRunEnginePort` | Task 047 `HarnessRunEngine` | `runPinned` executes the fingerprinted command with `hostChannel: "host-owned"`. Inputs omit expected values. Trusted `signals` may report environment, binding, or contract mismatch. Reporter stdout is untrusted. |
| `CompletenessGateRunnerPort` | Task 059 `CompletenessGateRunner.runLeafStaticAudit` | Candidate code runs only when `passed` is true. |
| `CasBlobStorePort` | Task 028 `CasBlobStore` | `get` loads dispatch blobs. `put` stores log, trace, and observations with `evidence` or `diagnostic`. |
| `CheckResultsPort` | state.db via the kernel db package (Task 013) | `listRequiredChecks` must union task requirements with in-scope cross-cutting checks. `insertCheckResult` writes `check_results`. `readAttemptLease` exposes `submissionPending` set by `accept_submission` (Task 021). |
| `ExpectationUnsealer` | host decryptor over CAS bytes | Default envelope is `{ v: 1, alg: "host-seal", body: base64(canonical JSON) }`, decoded only in this process. Swap in real decryption without writing plaintext into the sandbox. |
| `sealedHintLadder` | Task 065 `HintLadderController.processHiddenFailure` | This branch does not import the hint ladder. Pass `sealedHintLadder` only. Never send it, or held-back `checks[].runs`, to the worker. Send `workerFacing`. |
| `SurfaceVerifierAdapter` | Tasks 062–064 | Register UI, API, auth, CLI, migration, and AI-eval adapters. They return observations. They do not edit `runner/`. |
| `requirementResolution` | Task 066 acceptance transaction | This runner does not update `requirement_status`. Do not mark a flake or environment receipt as worker-failing. `affectsWorkerQualityScore: false` on those decisions. |

`workerLocalCheckIds` is ignored when choosing what to run. Required ids come from `listRequiredChecks`. If `inScopeRuleIds` contains a rule with no required check, verification throws `VerifierIntegrityError` before the candidate runs.

Held-back files are shredded (overwrite, then unlink) and every provisioned environment is `destroy()`ed in `finally`, including when `MissingRequiredChecksError` or `VerifierIntegrityError` is thrown.
