---
task_id: "Task-106"
branch: "task/106-crew-levels-expected-cost"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/crew-levels/**"
  - "packages/planner/tests/crew-levels/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 106 handoff

Crew levels: deterministic difficulty, expected-cost selection, Beta-Binomial pass rates, and a versioned model roster. Commit stays on `task/106-crew-levels-expected-cost`.

Worktree base is `649773097c387ae534b686ea5825f449f843aa7c` (`--base 6497730`). Current `harness/integration` (`30f2e9cb`) was not used: `pnpm install --frozen-lockfile` fails there because `packages/shared-contracts/package.json` adds `zod` without a lockfile update, and that branch already contains integrated tasks 002–089. This base matches the other unintegrated M3 worktrees and the commit named in the task brief.

## Exports Provided

Import from `packages/planner/src/crew-levels/index.ts` after the barrel wire below:

- `TaskDifficultyClassifier` — `trivial | standard | complex | critical` from file count, MUST-band token density, risk tags (`auth`, `payments`, `concurrency`, `migrations`, `security`), contract fan-in, `file_rank`, and prior failures. No model calls.
- `ExpectedCostLevelSelector` — chooses `junior | mid | senior | principal` by minimizing `unit_cost / P(pass) + (1 - P) * next_unit_cost`, with safety floors, Hint 2 escalation, critical-path preference, dual currency, and a one-line rationale.
- `HistoricalPassRateCalibrator` — Beta-Binomial shrinkage (`PRIOR_STRENGTH = 10`) per `(modelId, difficulty, language)` for first-pass and retry streams. Bounds `[0.05, 0.98]`.
- `VersionedModelRoster` — versioned capability and price table, signed policy overlay, local Ollama/LM Studio merge, and Task 140 `k[model]` weight refresh.
- Helpers used by those types: `featuresFromGraphTask`, `selectionInput`, `minimumWorkerLevel`, `betaBinomialMean`, `cascadeExpectedCost`, `levelExpectedCost`, `sameLevelRetryCost`, `compareExpectedCost`, `passObservationsFromTelemetry`, `estimateUnitCost`, `buildRationale`, `passPriors`.

`principal` is the fourth level from this task. Planning prose calls that level Manager. Integrators should treat `principal` as Manager.

Safety floor is `senior` for `auth`, `payments`, `migrations`, destructive and expand-contract migrations, cross-feature conflict merges, and `oracle-author@1`. Hint 2 (`failedAttempts >= 2`) escalates one level, then one more level per further failure, capped at `principal`. `Fastest` and `Balanced` on the critical path prefer a higher first-pass probability (`Balanced` only inside 2× the minimum expected cost). `Cheapest` does not.

Telemetry metric payload read by `passObservationsFromTelemetry`:

```json
{ "modelId": "string", "difficulty": "trivial|standard|complex|critical", "language": "string", "passed": true, "phase": "first_pass|retry" }
```

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. When integrating, re-export the crew-level surface from that barrel:

```ts
export {
  ExpectedCostLevelSelector,
  HistoricalPassRateCalibrator,
  TaskDifficultyClassifier,
  VersionedModelRoster,
  betaBinomialMean,
  buildRationale,
  cascadeExpectedCost,
  compareExpectedCost,
  estimateUnitCost,
  featuresFromGraphTask,
  levelExpectedCost,
  minimumWorkerLevel,
  passObservationsFromTelemetry,
  passPriors,
  sameLevelRetryCost,
  selectionInput,
} from "./crew-levels/index.js";
export type {
  BudgetLedgerPort,
  CodeIndexRepoPort,
  CompiledTaskFeatures,
  CostCurrency,
  CrewPreset,
  CrewRole,
  DifficultyAssessment,
  DifficultyTier,
  GlobalDbRepoPort,
  GraphCompilerTaskPort,
  LevelAssignment,
  LevelQuote,
  ModelRosterEntry,
  PassEstimate,
  PassObservation,
  SignedProviderPolicy,
  TelemetryDbRepoPort,
  WorkerLevel,
} from "./crew-levels/index.js";
```

No root `package.json`, workspace, tsconfig, eslint, or schema edit.

## Dependency Intents (New Packages Requested)

None. `@ef-harness/planner` already depends on `@ef-harness/shared-contracts`. Do not add `@ef-harness/db` until Tasks 014 and 023 are on the integration branch. The local ports below are the swap points.

## Contract Change Requests

None. No schema, barrel, or package manifest change on this branch.

Sibling branches are not merged. Local ports in `packages/planner/src/crew-levels/ports.ts` and `graph-task.ts` stand in for them:

| Sibling | Real contract to swap in | Local port |
|---|---|---|
| Task 014 `GlobalBrokerDb` | `listConnections()` is not on the broker today (`getConnection(id)` is). Adapt enabled rows (`id`, `provider`, `route`, `currency` `usd` or `allowance:<id>`) onto `GlobalDbRepoPort`. | `GlobalDbRepoPort`, `GlobalConnectionView` |
| Task 014 `TelemetryDb.readPage` | Keep `metric` rows shaped as the JSON above. | `TelemetryDbRepoPort`, `passObservationsFromTelemetry` |
| Task 014 / 167 `file_rank` | `{ path, score }` from `code-index.db.file_rank`. | `CodeIndexRepoPort`, `FileRankSignal`, `featuresFromGraphTask` |
| Task 023 `BudgetLedgerRepo.getBudgetRemaining` | Integer `remainingUnits`, `currency`, `overrun`. Micro-USD reads `usd`. ppm reads `allowance:*`. Other currencies are ignored. | `BudgetLedgerPort` |
| Task 092 `DeterministicGraphCompiler` / `PlanTask` | `featuresFromGraphTask` maps `primaryFiles`, `mustBandTokens`, `touches`, `implements`, `obeys`, migration slot, and integration shared-contract edits. | `GraphCompilerTaskPort` |
| Task 107 critical path | Pass `onCriticalPath` and `preset` (`fastest` / `balanced` / `cheapest`). This task does not schedule. | `LevelSelectionInput` |
| Task 135 signed policy | `VersionedModelRoster.applySignedPolicy` (`signed: true`, revocations, upserts, deprecations). Pinned rows survive upserts. Revocation is sticky. | `SignedProviderPolicy` |
| Task 138 local models | `applyLocalCapabilities({ source: "ollama" \| "lm-studio", models })` forces `spendKind: "local"` and does not clobber pinned ids. | `LocalModelCapabilities` |
| Task 140 `k[model]` | `applySubscriptionWeights` sets `allowancePpmPer1M` on `subscription` rows only. | `SubscriptionWeight` |
| Task 059 / 065 hint ladder | `failedAttempts`: 0 first try, 1 Hint 1 (same level), `>= 2` escalates. | `LevelSelectionInput.failedAttempts` |

`compareExpectedCost` throws `CrewLevelsError` code `currency-mix` if a caller puts micro-USD next to ppm. The selector never does that: the pool currency drops the other spend kind first.

Paid API rows (`spendKind: "paid-api"`) are used only when `paidFallbackApproved` is true or their `connectionId` is in `allowedConnectionIds`. A revoked local/subscription model does not fall through to an unapproved paid model.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-106-crew-levels-expected-cost`.

- `pnpm --filter @ef-harness/planner typecheck` — pass (`tsc -b --pretty false`, exit 0).
- `pnpm --filter @ef-harness/planner lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/planner test -- crew-levels` — pass (vitest, 5 files, 24 tests, exit 0).
- `node scripts/verify-harmony.mjs --task 106` — pass (`harmony ok for Task-106`, exit 0).

## Known Limitations / Follow-Ups

- The task narrative writes Junior `E[cost] = $0.145` for `$0.02` at `P = 0.20` plus `$0.15` on failure. Exact integer math for `unit + (1 - P) * escalation` is `140_000` micro-USD (`$0.140`). Mid `$0.08` at `P = 0.88` plus the same `$0.15` is exactly `98_000` micro-USD (`$0.098`). Both readings select Mid. The selector minimizes `unit / P + (1 - P) * next_unit` so a later failure is not priced as a single flat sticker. On the published unit prices that is Junior `164_000` vs Mid `108_909`, and Cheapest still selects Mid. `cascadeExpectedCost` locks the `140_000` / `98_000` reading.
- Beta prior weight is 10 observations. Estimates move by at most `n / (n + 10)` and are clamped to `[0.05, 0.98]`.
- Balanced critical-path upgrades stay inside 2× the minimum expected cost. Fastest on the critical path maximizes first-pass probability above the floor.
- Local models with `contextWindow < 16_384` are micro models. They are skipped for senior-floor tasks when any non-micro model remains. A sole connected model is still used and the rationale says `single_model_mode`.
- Cross-family checks for `oracle-author@1`, `entailment-checker@1`, and `reviewer@1` drop the build worker's family only when another family still has a model at or above the safety floor.
- `packages/planner/src/index.ts` is not modified. Consumers import `./crew-levels/index.js` until the barrel wire lands.
