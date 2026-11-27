# Pass 04 — Chunk 007 Audit Report (`packages/runtime-adapters` Part 2: Claude Code, Gemini CLI, OpenCode, Resume Coordinator, Conformance Suite & `Task 152` M4 Exit Gate — `Tasks 147–152`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-04` (Final Chunk — completes Pass 04!)
- **Chunk:** `chunk-007`
- **Units Audited (6):**
  - `Task 147` (`task/147-claude-code-headless-adapter` @ `de69e3e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-147-claude-code-headless-adapter`, unmerged, clean)
  - `Task 148` (`task/148-gemini-cli-optional-adapter` @ `d200038`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-148-gemini-cli-optional-adapter`, unmerged, clean)
  - `Task 149` (`task/149-opencode-acp-runtime-adapter` @ `90dcdea`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-149-opencode-acp-runtime-adapter`, unmerged, clean)
  - `Task 150` (`task/150-foreign-runtime-checkpoint-resume` @ `2cc3418`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-150-foreign-runtime-checkpoint-resume`, unmerged, clean)
  - `Task 151` (`task/151-automated-adapter-conformance-suite` @ `f8b7b3f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-151-automated-adapter-conformance-suite`, unmerged, clean)
  - `Task 152` (`task/152-m4-plans-conformance-exit-gate` @ `6a166dd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-152-m4-plans-conformance-exit-gate`, unmerged, clean)
- **Governing Architecture Documents:** `agent-runtime-adapters.md`, `open-design-questions.md`, `provider-connections.md`, `sandbox-and-security.md`, `routing-design.md`, `execution-capacity.md`, `roadmap.md` (`Milestone 4`), `schema/state.sql`, `schema/global.sql`.

## 2. Files Directly Inspected
- `packages/runtime-adapters/src/claude-code/adapter.ts` (`Task 147`)
- `packages/runtime-adapters/src/gemini-cli/{runtime-adapter.ts,opt-in-gate.ts}` (`Task 148`)
- `packages/runtime-adapters/src/opencode/runtime-adapter.ts` (`Task 149`)
- `packages/runtime-adapters/src/resume/{checkpoint-store.ts,coordinator.ts}` (`Task 150`)
- `packages/runtime-adapters/src/conformance/{runner.ts,probes.ts}` (`Task 151`)
- `tests/e2e/{tsconfig.json,m4-exit-gate/runner.ts,m4-exit-gate/benchmark.ts}` (`Task 152`)

## 3. Verified Local Strengths
- `ClaudeCodeRuntimeAdapter` (`147`) enforces Console-API-key-only compliance (`sk-ant-api*`, rejecting `sk-ant-oat*` / `setup-token` / `CLAUDE_CODE_OAUTH_TOKEN`), isolates `CLAUDE_CONFIG_DIR`, passes `-p --output-format stream-json --input-format stream-json --permission-prompt-tool stdio --max-budget-usd <cap> --strict-mcp-config`, and forbids `--dangerously-skip-permissions`.
- `GeminiCliRuntimeAdapter` (`148`) enforces default-OFF `GeminiOptInComplianceGate` with exact compliance notice matching, `GeminiHomeGuard` preventing `~/.gemini` access, Antigravity route rejection, and ConPTY interactive login isolation.
- `OpenCodeRuntimeAdapter` (`149`) generates isolated `OPENCODE_CONFIG_DIR` `opencode.json` rules denying built-in `bash`/`webfetch`/`websearch`/`external_directory`, overriding repo-level `opencode.json`, disabling auto-compaction (`compaction.auto: false`), and triggering brief-preserving compaction at `>= 75%` context utilization.
- `ForeignRuntimeResumeCoordinator` (`150`) serializes park-vs-wake per `attemptId` via `AttemptMutex`, enforces single-failure native-resume fallback (`disableNativeResumeForAttempt`), builds `<= 1,500`-token `[PRIOR UNVERIFIED WIP]` fresh-session handoffs, and reclaims idle wrapped CLI RAM at `90 s`.
- `AdapterConformanceRunner` (`151`) implements the 10-probe (`P01`–`P10`) evaluation logic, `wrapped → stripped → disabled` `AutomaticTrustDowngrader`, version-keyed cache invalidation, and `finally`-guaranteed scratch/canary/trap cleanup.

## 4. Local Implementation Defects Discovered
1. **Stripped `attempts` DDL & `contract_versions` Overwrite in `SqliteAttemptCheckpointStore` (`Task 150` `resume/checkpoint-store.ts:20-34,71-73,75-96` — `F-061`):**
   - Executes `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY)` (corrupting schema on fresh DBs) and `INSERT INTO attempts (id) VALUES (?)` (crashing with `SQLITE_CONSTRAINT_NOTNULL` on real `state.db` `attempts` rows!), while overwriting `attempt_checkpoints.contract_versions` with `{ foreignRuntimeCheckpoint }` (wiping `Task 053`'s native checkpoint `contract_versions`).
2. **`AdapterConformanceRunner` Never Drives Real `AgentRuntimeAdapter` Instances (`Task 151` `conformance/runner.ts:73,144-169`, `probes.ts:126-220` — `F-061`):**
   - Evaluates a synthetic `AdapterBehavior` struct against internal `ConformancePermissionEngine` + `OsSandboxBroker` rather than calling `probe()`, `startSession()`, `sendTurn()`, `interrupt()`, `resume()`, and `usage()` on real `143`–`149` adapter instances, and stores verdicts only in volatile `InMemoryAdapterConformanceDb`.
3. **Mocked Self-Contained M4 Exit Gate & Untypechecked `.ts` Specifiers (`Task 152` `tests/e2e/m4-exit-gate/runner.ts:1-10`, `benchmark.ts:46-52`, `tests/e2e/tsconfig.json` — `F-062`):**
   - Re-implements local toy copies of `AllowancePacingController`, `SiwcTokenRefresher`, `KitchenHiddenAcceptanceSuite`, `AdapterConformanceRunner`, and `UsageReceiptsCsvExporter` with zero imports from `@ef-harness/providers` or `@ef-harness/runtime-adapters`, scores `fixtures.suite` statically without executing Kitchen code, and uses `.ts` import specifiers excluded from `tests/e2e/tsconfig.json`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Remaining Runtime Adapters (`147`–`149`) Also Diverge from `142` `AgentRuntimeAdapter` & `143` `GenericAcpAdapter` (`F-061`):**
   - None of `ClaudeCodeRuntimeAdapter` (`147`), `GeminiCliRuntimeAdapter` (`148`), or `OpenCodeRuntimeAdapter` (`149`) defines `readonly runtime: ForeignRuntimeId`, failing `142` `assertAgentRuntimeAdapter`.
   - `147.authStatus()` and `149.probe()`/`149.authStatus()` are synchronous rather than `Promise<...>`.
   - `148` (`LocalGenericAcpAdapter` + hardcoded `http://127.0.0.1:46322/mcp`) and `149` (`LocalGenericAcpClient` + `InMemoryWindowsJobObject`) duplicate ACP framing instead of delegating to `143` `GenericAcpAdapter`, and `148` `GeminiOptInComplianceGate` defaults to `MemoryGlobalSettingsStore` instead of `GlobalBrokerDb` (`014`) `settings`.
2. **`150` ↔ `037`/`038`/`053`/`088`/`115`/`119` Disconnected Default Ports (`F-061`):**
   - `ForeignRuntimeResumeCoordinator` defaults to `NoopWorktreeSlot`, `LocalDirtySnapshotEngine`, `IdentityBriefCompiler`, and `LocalAdditiveVsContradictoryResumer` instead of `@ef-harness/{git-engine,worker-loop,planner,steering,governor}`.

## 6. Shared-File & Ownership Conflicts
- `packages/runtime-adapters/src/index.ts` and `packages/runtime-adapters/package.json` must export `142`–`151` (`core`, `acp`, `codex`, `copilot`, `cursor`, `claude-code`, `gemini-cli`, `opencode`, `resume`, `conformance`).
- `tests/e2e/tsconfig.json` and `tests/e2e/src/index.ts` must integrate `m2-exit-gate` (`105`), `m3-exit-gate` (`134`), and `m4-exit-gate` (`152`).

## 7. Runtime Wiring Gaps
- Wire `147`–`149` into `142` `AdapterRegistry` + `143` `GenericAcpAdapter` + `@ef-harness/sandbox` + `@ef-harness/providers`; wire `150` to `@ef-harness/db` `RuntimeLifecycleRepo` (`022`) + `AttemptCheckpointStore` (`053`), `DirtySnapshotEngine` (`037`), `WorktreeSlotPool` (`038`), `ContextSlicerEngine` (`088`), `AdditiveVsContradictoryResumer` (`115`), and `SessionProcessCapGuard` (`119`); persist `151` conformance verdicts in `GlobalBrokerDb` (`014`); and wire `152` M4 Exit Gate to real `@ef-harness/{providers,runtime-adapters,e2e}` and `apps/renderer`.

## 8. Architecture & Security Violations
- `F-061`: `148` and `149` use `LocalJobObject` / `InMemoryWindowsJobObject` instead of real Windows Job Object containment (`040`); `150` opens a rogue `DatabaseSync` on `state.db`.
- `F-062`: `152` certifies M4 exit criteria against self-contained mock classes rather than actual `@ef-harness/providers` and `@ef-harness/runtime-adapters` code.

## 9. Test Coverage & Verification Gaps
- `151` tests conformance against `AdapterBehavior` data structures rather than real `143`–`149` adapter classes; `152` omits real cross-package execution and `tsc` typechecking.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-061` (`CRITICAL`):** `packages/runtime-adapters` (`147`–`151`) Adapter Contract Mismatches (`147`–`149`), Duplicated ACP/Job Silos, `SqliteAttemptCheckpointStore` (`150`) `attempts` DDL Crash & `contract_versions` Clobber, and Non-Adapter-Driving Volatile `AdapterConformanceRunner` (`151`).
- **`F-062` (`CRITICAL`):** `Task 152` M4 Exit Gate (`tests/e2e/m4-exit-gate`) Self-Contained Fake Stand-In Classes, Static Hidden-Suite Scoring, and Untypechecked `.ts` Import Specifiers.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`147, 148, 149, 150, 151, 152`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and governing architecture docs.
- [x] **Pass 04 (`7/7` chunks) is now 100% COMPLETE!**
- [x] Findings recorded immediately in `audit_findings.md` (`F-061`–`F-062`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- **Pass 05 (`6` chunks):**
  - `pass-05/chunk-001`: `Tasks 122–125` (`apps/renderer` single app shell, secondary pop-out windows `123` vs `067`, 7-lane Board Cockpit `124`, Board health signals `125`).
  - `pass-05/chunk-002`: `Tasks 126–128, 131–133` (`apps/renderer` inspector, inbox, stop-card + `apps/desktop` & `apps/daemon` tray/power, downloader/updater, diagnostics).
  - `pass-05/chunk-003`: `Tasks 153–156, 159` (`apps/renderer` Canvas, popovers, composer, box-chat, spec/plan tabs).
  - `pass-05/chunk-004`: `Tasks 157–158, 160–161` (`packages/dictation`, live preview runner, JSX point-to-fix).
  - `pass-05/chunk-005`: `Tasks 162–165` (`apps/renderer` Cozy Office + 2 duplicate branches).
  - `pass-05/chunk-006`: `Tasks 166–170, 175` (`packages/brownfield` + `Task 175` M5 exit gate).
