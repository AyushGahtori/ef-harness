# Pass 06 — Chunk 004 Audit Report (`packages/meta-lab` Benchmark Registry, Simulated Developers, Statistical Promotion, Chaos Fault Simulator, Red-Team Suite & `Task 194` Architecture Review Trials — `Tasks 189–194`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-004`
- **Units Audited (6):**
  - `Task 189` (`task/189-metalab-benchmark-registry` @ `e5e794e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-189-metalab-benchmark-registry`, unmerged, clean)
  - `Task 190` (`task/190-metalab-simulated-developers` @ `b950b62`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-190-metalab-simulated-developers`, unmerged, clean)
  - `Task 191` (`task/191-metalab-eval-promotion` @ `6bfc3f7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-191-metalab-eval-promotion`, unmerged, clean)
  - `Task 192` (`task/192-metalab-fault-injection` @ `06f62c4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-192-metalab-fault-injection`, unmerged, clean)
  - `Task 193` (`task/193-metalab-red-team-suite` @ `d76f749`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-193-metalab-red-team-suite`, unmerged, clean)
  - `Task 194` (`task/194-architecture-review-trials` @ `da32d6f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-194-architecture-review-trials`, unmerged, clean)
- **Governing Architecture Documents:** `meta-lab.md`, `architecture-review-decisions.md`, `architecture-audit-response.md`, `architecture-deep-review.md`, `verification-and-isolation.md`, `sandbox-and-security.md`, `resume-changer-benchmark.json`, `meta-lab.mmd`, `research/evaluating-prompts-and-skills.md`.

## 2. Files Directly Inspected
- `packages/meta-lab/package.json` & `packages/meta-lab/src/index.ts` (`task-191`)
- `packages/meta-lab/src/benchmarks/registry.ts` (`Task 189`)
- `packages/meta-lab/src/sim-dev/exact-input-cache.ts` (`Task 190`)
- `packages/meta-lab/src/evals/runner.ts` (`Task 191`)
- `packages/meta-lab/src/fault-sim/daemon-stack.ts` (`Task 192`)
- `packages/meta-lab/src/red-team/{lab-session.ts,attacks.ts}` (`Task 193`)
- `tests/e2e/review-trials/lib/{suite.ts,sqlite.ts,area-a.ts,area-h.ts}` (`Task 194`)

## 3. Verified Local Strengths
- `MetaLabBenchmarkRegistry`, `FrozenSuiteIntegrityLoader`, and `PromptContaminationScanner` (`189`) ship SHA-256-pinned definitions for all 7 frozen benchmark suites (`dev` vs `held_out` splits), verify `resume-changer-benchmark.json` parity, and detect held-out n-gram/identifier contamination in candidate prompts/skills.
- `ScriptedRegressionSimDev`, `HiddenSpecPersonaSimDev`, `AnonymizedSessionReplayer`, and `ExactInputModelResponseCache` (`190`) enforce RFC 8785 exact-input cache keys, `--cache-mode` controls, PII/path/secret scrubbing, and persona isolation guards.
- `McNemarAndBootstrapCalculator`, `PairedStatisticalPromotionEngine`, and `ArtifactLifecycleManager` (`191`) compute exact two-sided binomial McNemar p-values, seeded 10,000-resample Bootstrap 95% CIs, `>= 15%` CI-backed efficiency wins, security/contamination vetoes, and strict `draft → evaluated → active → deprecated` transitions.
- `FullDaemonFaultSimulator` & `MinimalFaultReproducerExporter` (`192`) provide deterministic `xoshiro256**`-seeded fault scheduling, TX boundary hooks, and minimal Vitest reproducer export; `VaultCanaryLeakDetector` (`193`) scans raw & base64 canary bytes; `ArchitectureReviewTrialsSuite` (`194`) enforces `.skip`/`.todo` scanning and leaked-PID/temp-dir cleanup.

## 4. Local Implementation Defects Discovered
1. **Hardcoded `LEVEL_1_CASES`, `candidateId.endsWith("-futility")` Hack, Bogus Cost Mapping & Disconnected Mock Ports in `ThreeLevelEvalRunner` (`Task 191` `evals/runner.ts:12-67,81-119` — `F-082`):**
   - `LEVEL_1_CASES` is a hardcoded 6-row constant where `actualPass === expectedPass`, and Level 1 futility triggers only when `options.candidateId.endsWith("-futility")`.
   - `buildPairedFromGrades` maps `tokenCostBaseline: base.durationMs` and `wallClockBaseline: base.durationMs * 150`, keys its mock cache by `"${caseId}:${candidateId}"` instead of `190`'s RFC 8785 `ExactInputModelResponseCache`, and hardcodes `paperworkPct: 0.12` without calling `193` `runRedTeamGate()`.
2. **Miniature Toy `STATE_DDL`/`GLOBAL_DDL` With `REAL` Float Budgets in `SimulatedDaemonStack` (`Task 192` `fault-sim/daemon-stack.ts:10-45` — `F-082`):**
   - Instead of testing `schema/state.sql` + `schema/global.sql` and real recovery modules (`034, 118, 130, 150, 176`), `SimulatedDaemonStack` creates 5 toy tables using `REAL` floating-point `spent`/`units` columns (violating `database-design.md`'s integer `micro-USD`/`ppm` invariant).
3. **Placeholder Sink Files & Local String Helpers in `RedTeamSecuritySuiteRunner` (`Task 193` `red-team/attacks.ts:50-119`, `lab-session.ts:33-40,79-92` — `F-082`):**
   - Writes dummy `"SQLite format 3\x00[redacted]"` strings into placeholder sink files and invokes local string helpers (`permissionForUntrustedText`, `isDeniedRead`, `proxyDenies`, `auditTestProposal`, `scrubHar`) instead of testing real `@ef-harness/{sandbox,verifier,corpus,research-engine,intake,governor,runtime-adapters,portability}` defenses.
4. **Self-Contained Toy Functions in `ArchitectureReviewTrialsSuite` (`Task 194` `tests/e2e/review-trials/lib/{sqlite.ts,area-a.ts..area-j.ts,trials.ts}` — `F-083`):**
   - Defines local 5-line functions (`area-h.ts:22-55`: `connectionRegistry()`, `aimd()`, `grantFromWindow()`, `routeCall()`, `chatGptWire()`, `conformance()`, plus identity `ef_search_text` in `area-a.ts:26`) with zero `@ef-harness/*` workspace imports, reporting `16/16 PASS` even when real `Task 141` `compliance.ts` (`F-058`) accepts `sk-ant-oat*` tokens!

## 5. Cross-Unit Contract & Seam Mismatches
1. **5-Way `packages/meta-lab` Silo Isolation (`189`–`193`) & Empty `src/index.ts` Barrel (`F-082`):**
   - `packages/meta-lab/src/index.ts` exports only `packageIdentity()` across all 5 branches (`189–193`), with zero cross-imports among `benchmarks` (`189`), `sim-dev` (`190`), `evals` (`191`), `fault-sim` (`192`), and `red-team` (`193`), and duplicates `canonical-hash.ts` in `189` and `190` instead of `@ef-harness/shared-contracts` (`007`).

## 6. Shared-File & Ownership Conflicts
- `packages/meta-lab/src/index.ts` and `packages/meta-lab/package.json` must export `benchmarks`, `sim-dev`, `evals`, `fault-sim`, and `red-team` and declare `@ef-harness/*` dependencies under test.
- `tests/e2e/package.json` (`068, 105, 134, 152, 175, 194–200`) is shared across all E2E suites.

## 7. Runtime Wiring Gaps
- Wire `191` `ThreeLevelEvalRunner` to real `189` `MetaLabBenchmarkRegistry`/`PromptContaminationScanner`, `190` `SimDevDriver`/`ExactInputModelResponseCache`, `193` `runRedTeamGate()`, `009` `PromptContractRegistry`, and `078` `SkillManifestRegistry`.
- Wire `192` `FullDaemonFaultSimulator` to real `@ef-harness/{db,sim,governor,steering,runtime-adapters,ship-deploy}`, `193` `RedTeamSecuritySuiteRunner` to real `@ef-harness/{sandbox,verifier,corpus,research-engine,intake,governor,runtime-adapters,portability}`, and `194` `ArchitectureReviewTrialsSuite` to real workspace packages across Areas A–J and Trials 1–6.

## 8. Architecture & Security Violations
- `F-082` / `F-083`: Self-contained mock security/compliance trials in `193` and `194` create false security assurance if not wired to real production packages.

## 9. Test Coverage & Verification Gaps
- `191`, `192`, `193`, and `194` pass their isolated Vitest suites without executing real production implementations from M0–M6.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-082` (`HIGH`):** `packages/meta-lab` (`189`–`193`) 5-Way Internal Silos, Empty Barrel, Hardcoded `ThreeLevelEvalRunner`, Toy `REAL`-Float `SimulatedDaemonStack` & Mock-Sink `RedTeamSecuritySuiteRunner`.
- **`F-083` (`HIGH`):** `Task 194` `ArchitectureReviewTrialsSuite` Self-Contained Inline Toy Functions (Zero Workspace Imports Across Areas A–J & Trials 1–6) Masking Real Production Regressions.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`189, 190, 191, 192, 193, 194`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] Cross-checked against `007, 009, 011, 034, 045, 046, 048, 054, 069, 078, 082, 097, 100, 105, 118, 120, 130, 141, 142, 150, 175, 176`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-082`–`F-083`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-005` (**FINAL CHUNK!**): `Tasks 195–200` (`tests/e2e` cross-milestone full lifecycle suite, Windows NSIS packaging & Authenticode signing, docs/diagram consistency gate, 16 GB laptop performance & scale certification, security/privacy/supply-chain audit, and `Task 200` M6 & v1.0 Release Certification Gate + repo-wide lint/diagram verification).
