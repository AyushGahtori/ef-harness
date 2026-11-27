# Audit Report — `pass-03/chunk-006` (`Tasks 102, 106–108`: Planner Specialists, Crew Levels, HEFT Scheduler & Plan Preview)

## 1. Chunk identification and scope
- **Pass:** `Pass 03` (Discovery, Corpus, Spec Expansion, Research Engine, Planner, Intake, M2 Gate)
- **Chunk ID:** `pass-03/chunk-006`
- **Scope:** Remaining unmerged `packages/planner` submodules: `specialists` (`102`), `crew-levels` (`106`), `scheduler` (`107`), and `plan-preview` (`108`).
- **Isolation state:** All 4 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 102` | `task/102-specialist-review-qa-prompts` | `61496c7` | `C:/Users/Ayush/Desktop/ef-wt/task-102-specialist-review-qa-prompts` | 0 |
| `Task 106` | `task/106-crew-levels-expected-cost` | `279569d` | `C:/Users/Ayush/Desktop/ef-wt/task-106-crew-levels-expected-cost` | 0 |
| `Task 107` | `task/107-heft-scheduler-crew-presets` | `3f1744a` | `C:/Users/Ayush/Desktop/ef-wt/task-107-heft-scheduler-crew-presets` | 0 |
| `Task 108` | `task/108-plan-preview-autostart-gate` | `95c9260` | `C:/Users/Ayush/Desktop/ef-wt/task-108-plan-preview-autostart-gate` | 0 |

## 3. Files inspected
- `Task 102`: `packages/planner/src/specialists/{index.ts,types.ts,ports.ts,high-risk-diff-reviewer.ts,taste-reviewer.ts,ask-owner.ts,state-db.ts}`
- `Task 106`: `packages/planner/src/crew-levels/{index.ts,types.ts,ports.ts,selector.ts,calibrator.ts,roster.ts}`
- `Task 107`: `packages/planner/src/scheduler/{index.ts,types.ts,ports.ts,heft-critical-path-scheduler.ts,dispatch.ts,presets.ts}`
- `Task 108`: `packages/planner/src/plan-preview/{index.ts,types.ts,local-ports.ts,plan-preview-builder.ts,revision-auto-start-policy.ts,auto-start-grace-window.ts}`

## 4. Architecture documents consulted
- `planning-and-crew.md`, `execution-capacity.md`, `provider-connections.md`, `open-design-questions.md`
- `linked-architecture-revisions.md`, `prompt-contracts.md` (`reviewer@1`, `taste-reviewer@1`, `ask-owner-responder@1`)
- `schema/state.sql`, `schema/global.sql`, `schema/telemetry.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 6249–6307`, `6504–6690`)

## 5. Contracts and signatures discovered
- `Task 102`: `HighRiskDiffReviewer.review(req): HighRiskReviewResult` (sync `SpecialistModel`), `AdvisoryTasteVisionReviewer.review(req): TasteReviewResult`, `AskOwnerResponderEngine.{answerQuestion,formatWorkerEscalation,resolveDisputeChoice}`, `SpecialistStateDb`.
- `Task 106`: `TaskDifficultyClassifier`, `ExpectedCostLevelSelector.select(input: LevelSelectionInput): LevelAssignment` (`CrewPreset = "fastest" | "balanced" | "cheapest"`, `WorkerLevel = "junior" | "mid" | "senior" | "principal"`, `bigint` `expectedCost`), `HistoricalPassRateCalibrator`, `VersionedModelRoster`.
- `Task 107`: `HeftCriticalPathScheduler.{rank,project,schedule}`, `WaveParallelismCalculator`, `CrewPresetProfileEngine` (`CrewPreset = "Fastest" | "Balanced" | "Cheapest"`, `CrewLevel = "junior" | "mid" | "senior" | "principal"`), `DynamicScheduleRebalancer`, `dispatchReady`.
- `Task 108`: `PlanPreviewBuilder.build(req): PlanPreview` (`CrewPreset = "Fastest" | "Balanced" | "Cheapest"`, `CrewLevel = "Junior" | "Mid" | "Senior"`), `InteractivePlanEditor`, `FirstBuildApprovalGate`, `RevisionAutoStartPolicy`, `AutoStartGraceWindow`.

## 6. Confirmed findings
- **`F-044` (`HIGH` / `CONTRACT_MISMATCH`):** `packages/planner/src/specialists` (`102`) uses synchronous `SpecialistModel` instead of async `ModelProtocolAdapter` (`053`), calls nonexistent port methods `hintLadder.pushReviewerDefect(...)` (`059`), `staticAuditGate.readReceipt(taskId)` (`054`), and `verifier.captureScreens([taskId])` (`057`), hardcodes fake line grounding `1..400` in `taste-reviewer.ts:81-96`, discards `ask-owner-responder@1` model output in `ask-owner.ts:137,145,158`, and is unwired into `095`/`096`/`114`/`174`.
- **`F-045` (`HIGH` / `CONTRACT_MISMATCH`):** Three-way intra-planner mismatch across `crew-levels` (`106`), `scheduler` (`107`), and `plan-preview` (`108`): preset casing (`"fastest"` vs `"Fastest"`), crew-level casing/tiers (`"junior".."principal"` vs `"Junior"|"Mid"|"Senior"`), `107` defaulting to hardcoded `LocalExpectedCostLevelSelector` (`number` USD-only) and passing tier string `level.level` (`"senior"`) as `model` into `claimTask` (`dispatch.ts:144`) instead of `106`'s `modelId`, `108` re-implementing local `Heft`/`Preset`/`Paperwork`/`RevisionImpact` stubs with incompatible method signatures vs `073`/`074`/`087`/`090`/`107`, and `RevisionAutoStartPolicy` keeping rolling 24h spend (`$5 / 10%` cap) in volatile RAM (`revision-auto-start-policy.ts:34`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 054` (`CompletenessGateRunner`) + `Task 057` (`UiPlaywrightContractVerifier`) + `Task 059` (`PersistentRetryHintController`) → `Task 102` (`specialists`) → `Task 095`/`096`/`114`/`174`.
- `Task 014` (`GlobalBrokerDb` / `TelemetryDb`) + `Task 023` (`BudgetLedger`) + `Task 135`/`138`/`140` (`providers`) → `Task 106` (`crew-levels`) → `Task 107` (`scheduler`) → `Task 108` (`plan-preview`) + `Task 119` (`governor`) + `Task 123`/`156` (`renderer`).
- `Task 073` (`ChosenForYouLedger`) + `Task 074` (`ReadinessCalculator` / `BoundedDeferralPolicy`) + `Task 087` (`HybridRevisionEngine`) + `Task 090` (`PaperworkBudgetEnvelopeAllocator`) → `Task 108` (`PlanPreviewBuilder` / `RevisionAutoStartPolicy`).

## 9. Defects and missing integrations
- `packages/planner/src/index.ts` now has **10** unmerged sibling subtrees (`090–095, 102, 106–108`) missing from its barrel exports (`F-040`, `F-044`, `F-045`).
- `dispatchReady` (`107`) never persists claims through `Task 020` `TaskClaimLeasesRepo` (`claimTask` signature in `scheduler/ports.ts:10-35` disagrees with `Task 020`'s `claimTask` parameters and return shape) and passes `level.level` instead of `modelId`.
- `RevisionAutoStartPolicy` (`108`) loses rolling 24h auto-start spend across daemon restarts, permitting unlimited `$0.99` auto-starts after restart unless backed by `state.db` (`F-045`).

## 10. Tests and verification performed
- Reviewed unit tests across `packages/planner/tests/{specialists,crew-levels,scheduler,plan-preview}/**`: each suite passes in isolation against local in-memory ports (`FakeModel`, `InMemoryTaskClaimManager`, `LocalExpectedCostLevelSelector`, `defaultPlanPreviewSources()`).

## 11. Unresolved questions
- How `Task 114` (`packages/steering`), `Task 135`/`138`/`140` (`packages/providers`), and `Task 174` (`packages/integrator/src/ui-checks`) call `102, 106, 107, 108` — scheduled for Pass 04 (`chunk-002`, `chunk-003`, `chunk-005`).

## 12. Explicit files and relationships still requiring inspection
- `pass-03/chunk-007` (final chunk of Pass 03): `Tasks 097–100` (`packages/intake`), `Tasks 096, 101` (`packages/integrator` M2 feature-integrator & final-audit), and `Task 105` (`tests/e2e/m2-exit-gate` + `benchmarks/m2-kitchen-e2e`).
