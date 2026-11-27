# EF Harness — Complete Consolidated Audit Findings (`ALL_FINDINGS.md`)

> **Complete 100% verbatim consolidation** of [`audit_findings.md`](audit_findings.md) (`F-001`–`F-086`), [`audit_progress.md`](audit_progress.md), all **31 detailed chunk reports** (`audit_reports/pass-01..06/`), and [`audit_reports/AUDITOR_CONTINUATION_GUIDE.md`](audit_reports/AUDITOR_CONTINUATION_GUIDE.md). Not a single line is omitted.
> For the sequential 79-task repair and integration execution plan, see [`combination_task.md`](combination_task.md) (`C01`–`C79`).

## Summary & Quick Index

- **Total Units Audited:** `200 / 200` tasks (`201 / 201` `task/*` branches + `Task 001` baseline)
- **Total Confirmed Findings:** `86` (`F-001` through `F-086`) — **CRITICAL:** `37`, **HIGH:** `47`, **MEDIUM:** `2`, **LOW:** `0`
- **Unverified / Blocked:** `0` unverified, `0` blocked
- **Chunk Reports Included:** `31` (`pass-01` through `pass-06`) + Continuation Guide

### Contents
1. [Part 1 — Master Findings Ledger (`F-001`–`F-086`)](#part-1--master-findings-ledger-f-001f-086)
2. [Part 2 — Audit Progress & Architecture Contracts](#part-2--audit-progress--architecture-contracts)
3. [Part 3 — All 31 Chunk Investigation Reports (`pass-01`–`pass-06`)](#part-3--all-31-chunk-investigation-reports-pass-01pass-06)
4. [Part 4 — Auditor Methodology & Continuation Runbook](#part-4--auditor-methodology--continuation-runbook)

---

## Part 1 — Master Findings Ledger (`F-001`–`F-086`)

# EF Harness — Integration Audit Findings Ledger

## Project Identification & Audit Scope

- **REPO_ROOT:** `c:/Users/Ayush/Desktop/ef harness` (checked out on `main` at `649773097c387ae534b686ea5825f449f843aa7c`)
- **SOURCE_OF_TRUTH:**
  - Root architecture & review documents: `/*.md` (52 specification & decision documents, plus `CONTRIBUTING_AGENTS.md`)
  - Editable Mermaid architecture diagrams: `/*.mmd` (31 chapter diagrams + `ef-harness-complete.mmd`)
  - Executable SQL schemas & 67-scenario test suite: `schema/state.sql`, `schema/global.sql`, `schema/telemetry.sql`, `schema/code-index.sql`, `schema/queries.sql`, `schema/schema-test.js`
  - Research evidence notes: `research/*.md` (31 documents)
  - Skill & benchmark manifests: `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`, `stack-manifest.json`
- **AUTHORITY_ORDER:**
  1. Executable SQL schemas & scenario tests (`schema/*.sql`, `schema/schema-test.js`) + `architecture-deep-review.md` (18 Nov 2026 20-fix deep review)
  2. `database-design.md`, `kernel-schema-and-protocol.md` (17–18 Nov 2026) + `open-design-questions.md` (16–18 Nov 2026 confirmed owner decisions)
  3. `architecture-audit-response.md` (16 Nov 2026) + `architecture-review-decisions.md`
  4. Core & topic architecture `.md` and `.mmd` files (`architecture.md`, `build-pipeline.md`, `roadmap.md`, and topic specs; later revisions beat earlier ones)
  5. `research/*.md`, `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`
  6. `IMPLEMENTATION_TASKS.md` (only for what each isolated worker was told to build)
  7. `.agent-handoffs/task-NNN.md` (only as claims)
  8. Task branch / worktree code (only as what exists)
- **IMPLEMENTATION_TASK_FILE:** `IMPLEMENTATION_TASKS.md` (`Task 001` through `Task 200`)
- **ISOLATION:** `mixed` (branches `task/*` + sibling worktrees in `C:/Users/Ayush/Desktop/ef-wt`, including uncommitted working-tree bugfixes in 16 worktrees and 1 dirty lockfile in `integration`)
- **WORKTREE_ROOT:** `C:/Users/Ayush/Desktop/ef-wt` (202 directories: `integration` + 201 `task-*` worktrees)
- **BRANCH_PATTERN:** `task/*` (201 branches: 199 implementation branches `task/002-*`..`task/200-*`, plus 2 empty abandoned initial branches `task/162-office-pixijs-floorplan-sprites` and `task/164-office-animation-director-astar` at `6497730`)
- **INTEGRATION_BASE:** `harness/integration` (currently at `30f2e9cb41169e3cea11f1a9946db74a5b32cfde` in `C:/Users/Ayush/Desktop/ef-wt/integration`, containing mechanical merges + barrel re-exports of `Task 002`–`Task 089` without cross-unit port wiring, and missing `Task 090`–`Task 200` plus 16 uncommitted worktree deltas in `008`–`079`)
- **FINDINGS_PATH:** `c:/Users/Ayush/Desktop/ef harness/audit_findings.md`
- **OUTPUT_PATH:** `c:/Users/Ayush/Desktop/ef harness/combination_task.md`
- **VERIFY_COMMANDS:** `pnpm build` (`tsc -b --pretty false`), `pnpm typecheck` (`tsc -b --pretty false`), `pnpm lint` (`eslint .`), `pnpm test` (`node scripts/run-tests.mjs`), `pnpm test:schema` (`node schema/schema-test.js`), `pnpm verify:diagrams` (`node scripts/verify-diagrams.mjs`), `pnpm verify:env` (`node scripts/verify-env.mjs`), `pnpm verify:harmony` (`node scripts/verify-harmony.mjs`)
- **ENTRY_JOURNEY:** `apps/desktop` Electron main + utility-process named-pipe `MessagePort` bridge connecting to detached per-user `apps/daemon` (`harnessd`) over `\\.\pipe\efharness-<user>` (`session.hello` + Channel 0 JSON-RPC + gap-free `events.subscribe` outbox stream + Channel 1 64 KB credit-windowed binary stream), driving `apps/renderer` single app shell across Discover → Spec Expansion → Research & Architecture → Master/Feature Planning & Graph Compile → Plan Preview (`Start build`) → Phase 0 + Gate 0 → Sandboxed Worker Dispatch (`worker-loop` / `runtime-adapters` + `mcp-server` + `test-env`) → `STATIC_AUDIT` + Clean Red-Before-Green Verification + Transactional Acceptance → Feature Integrator & Project Merge Queue onto `harness/integration` → Board / Office / Canvas / App Preview live supervision, steering, stop/undo/re-entry → Safe Landing onto `main` & Effect-Ledger Ship/Deploy.

---

## Discovered Findings

#### F-001 — Layer-boundary ESLint graph blocks required architectural imports within the same numeric layer

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** ARCHITECTURE_VIOLATION

**Affected units:** `Task 001` (`main` `6497730`), `harness/integration` (`30f2e9c`), affecting `packages/ipc` (`031`–`033`), `packages/sim` (`034`), `packages/sandbox` (`040`–`047`), `packages/mcp-server` (`048`), `packages/test-env` (`049`–`052`), `packages/worker-loop` (`053`–`055`), `packages/verifier` (`060`–`066`), `packages/spec-expansion` (`079`–`081`), `packages/research-engine` (`082`), `packages/planner` (`083`–`095`, `102`, `106`–`108`), `packages/integrator` (`096`, `101`, `109`–`112`, `129`, `171`–`174`), `packages/steering` (`113`–`116`, `130`), `packages/governor` (`117`–`121`), `packages/providers` (`135`–`141`), `packages/runtime-adapters` (`142`–`151`), `packages/portability` (`186`–`188`), and `packages/meta-lab` (`189`–`194`).

**Files and symbols:** `scripts/layers.mjs:6-42` (`PACKAGE_LAYOUT`, `LAYERS`), `eslint.config.mjs:54-62` (`layerBoundary` rule `ef/layer-boundary`).

**Actual implementation:** `scripts/layers.mjs:6-42` assigns coarse integer tiers (`layer = 0` for `shared-contracts`, `shared-observability`; `layer = 1` for `db`, `ipc`, `sim`, `git-engine`, `sandbox`, `mcp-server`, `test-env`; `layer = 2` for `worker-loop`, `completeness-gate`, `verifier`, `discovery`, `spec-expansion`, `research-engine`, `intake`, `dictation`, `brownfield`; `layer = 3` for `planner`, `integrator`, `steering`, `governor`, `providers`, `runtime-adapters`; `layer = 4` for `ship-deploy`, `investigations`, `portability`, `meta-lab`; `layer = 5` for `daemon`, `desktop`, `renderer`, `spikes`, `corpus`, `benchmarks`, `e2e`). `eslint.config.mjs:54-62` reports `upward` whenever `to >= from`, banning every import between two packages sharing the same integer `layer`.

**Required architecture:** `kernel-schema-and-protocol.md`, `agent-runtime-adapters.md`, `build-pipeline.md`, `execution-capacity.md`, and `meta-lab.md` require acyclic producer→consumer dependencies inside those coarse tiers: `ipc -> db`, `mcp-server -> db + sandbox + test-env`, `sim -> db + ipc`, `sandbox -> git-engine`, `worker-loop -> db + sandbox + mcp-server`, `verifier -> completeness-gate + db + sandbox + test-env`, `spec-expansion -> discovery + db`, `research-engine -> spec-expansion + sandbox + db`, `planner -> discovery + spec-expansion + research-engine + intake + brownfield + db`, `integrator -> planner + verifier + git-engine + sandbox + db`, `steering -> planner + integrator + db`, `runtime-adapters -> providers + governor + worker-loop + mcp-server + sandbox + db`, and `meta-lab -> ship-deploy + investigations + portability + sim`.

**Evidence:** `scripts/layers.mjs:6-42` (`{ id: "db", layer: 1 }, { id: "ipc", layer: 1 }, ...`); `eslint.config.mjs:56-62` (`if (from === undefined || to === undefined || to >= from) { context.report({ node, messageId: "upward", ... }); }`).

**Why this is a defect:** Any real cross-package import between architectural producer and consumer within the same tier fails `pnpm lint` (`ef/layer-boundary`), forcing packages (`ipc`, `sim`, `mcp-server`, `verifier`, `spec-expansion`, `integrator`, `steering`, `runtime-adapters`, `meta-lab`) to duplicate logic or remain disconnected behind in-memory/mock port interfaces.

**Required correction:** Refine `PACKAGE_LAYOUT` `layer` numbers in `scripts/layers.mjs` (and each package's `export const layer` constant if asserted by smoke tests, or separate `tier` vs `dagRank` in `scripts/layers.mjs` + `eslint.config.mjs`) into a strict topological DAG order where every architectural producer has a strictly lower `dagRank` than its consumers while keeping `to >= from` cycle-free enforcement active.

**Dependencies:** None.

**Verification:** `pnpm lint && pnpm typecheck && pnpm test`

**Integration priority:** Wave C01 (Foundation, Layer Graph & Shared Observability/Contracts).

---

#### F-002 — Spike Vitest configuration omits M0 spike suites (`windows-sandbox` `.mjs` and sub-package tests)

**Status:** CONFIRMED

**Severity:** MEDIUM

**Category:** TEST_GAP

**Affected units:** `Task 002` (`task/002-spike-node-sqlite-electron`), `Task 003` (`task/003-spike-windows-sandbox`), `Task 004` (`task/004-spike-execution-capacity`), `Task 005` (`task/005-spike-foreign-runtimes`), `Task 006` (`task/006-spike-test-services-windows`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `spikes/vitest.config.ts:3-8`, `spikes/windows-sandbox/windows-sandbox.test.mjs`, `spikes/node-sqlite-electron/node-sqlite-electron.test.ts`, `spikes/execution-capacity/tests/execution-capacity.test.ts`, `spikes/foreign-runtimes/tests/foreign-runtimes.test.ts`.

**Actual implementation:** `spikes/vitest.config.ts:6` sets `include: ["tests/**/*.test.ts", "test-services-windows/tests/**/*.test.ts"]`. It completely skips `windows-sandbox/windows-sandbox.test.mjs` (Task 003's entire test suite, which has no wrapper under `spikes/tests/`) and ignores direct spike test files unless duplicated under `spikes/tests/`.

**Required architecture:** `roadmap.md` (Milestone M0) and `IMPLEMENTATION_TASKS.md` (`Tasks 002–006`) require `pnpm --filter @ef-harness/spikes test` (invoked by `pnpm test`) to execute all five M0 validation spike suites (`node-sqlite-electron`, `windows-sandbox`, `execution-capacity`, `foreign-runtimes`, `test-services-windows`).

**Evidence:** `spikes/vitest.config.ts:6` (`include: ["tests/**/*.test.ts", "test-services-windows/tests/**/*.test.ts"]`); `spikes/windows-sandbox/windows-sandbox.test.mjs` is the sole test file in `spikes/windows-sandbox/`.

**Why this is a defect:** `pnpm test` never executes `windows-sandbox.test.mjs`, leaving regressions in Windows sandbox tier probing and Job Object cleanup undetected in CI and integration verification.

**Required correction:** Update `spikes/vitest.config.ts` `include` globs (or add a Vitest wrapper / include `windows-sandbox/**/*.test.{ts,mjs}`) without double-running `spikes/execution-capacity/template-app/src/format.test.ts` fixture tests, so all 5 M0 spike test suites run cleanly under `pnpm --filter @ef-harness/spikes test`.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/spikes test`

**Integration priority:** Wave C01.

---

#### F-003 — `packages/shared-observability` remains the naive Task-001 stub while real logger/tracer/redactor live in `packages/shared-contracts/src/telemetry` with uncommitted streaming-leak bugfixes in `task-011`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SHARED_FILE_CONFLICT

**Affected units:** `Task 001` (`main` `6497730`), `Task 011` (`task/011-logger-tracer-redactor` `7da4328` + uncommitted working tree in `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor`), `Task 031` (`packages/ipc/src/transport/redaction.ts`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/shared-observability/src/index.ts:1-51` (`redactSecrets`, `formatLog`), `packages/shared-contracts/src/telemetry/redactor.ts:40-197` (`SecretRedactor`, `StreamingRedactor`), `packages/shared-contracts/src/telemetry/tracer.ts:141-342` (`LocalTracer`), `packages/ipc/src/transport/redaction.ts:1-60` (`LocalSecretRedactor`, `createRedactingLogger`).

**Actual implementation:**
1. `packages/shared-observability/src/index.ts:13-19` still contains only the Task-001 bootstrap placeholder `redactSecrets()` (string-splitting 6 prefixes without redacting the secret body!) and `formatLog()`.
2. `Task 011` placed the full `StructuredLogger`, `LocalTracer`, `SecretRedactor`, and `StreamingRedactor` under `packages/shared-contracts/src/telemetry/`.
3. On `harness/integration` (`30f2e9c`), `packages/shared-contracts/src/telemetry/redactor.ts:40-47,165-183` is missing uncommitted bugfixes sitting in `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor`: (a) `SecretRedactor.register(label, shortValue)` overwrites an existing vault entry with `{ variants: [] }` instead of forgetting short values safely, (b) `StreamingRedactor.push` decodes `Uint8Array` via `Buffer.from(chunk).toString("utf8")` (corrupting multi-byte UTF-8 split across chunks instead of `StringDecoder`), and (c) `StreamingRedactor.push` calls `this.redactor.redact(combined)` BEFORE overlap slicing, which replaces the prefix of a variable-length builtin secret (e.g. `sk_live_...`) on chunk 1 and leaks the raw secret tail on chunk 2!
4. `packages/ipc/src/transport/redaction.ts` defines a third local `LocalSecretRedactor` instead of delegating to `SecretRedactor`.

**Required architecture:** `observability-and-testing.md` and `sandbox-and-security.md` require one canonical zero-leak `SecretRedactor` + `StreamingRedactor` + `StructuredLogger` + `LocalTracer` across the entire workspace, redacting exact/Base64/Base64URL/URL-encoded/JSON-escaped secrets and variable-length provider tokens across arbitrary chunk boundaries without leaking secret tails or corrupting UTF-8.

**Evidence:** `packages/shared-observability/src/index.ts:13-19` (`redacted = redacted.split(parts.join("")).join("[redacted]")` — leaves everything after `sk_live_` in cleartext!); `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor` `git diff` on `packages/shared-contracts/src/telemetry/redactor.ts:40-50,153-195` and `tracer.ts:141,398-413`.

**Why this is a defect:** Any package importing `@ef-harness/shared-observability` (`redactSecrets`) leaks full secret payloads after the prefix, while `@ef-harness/shared-contracts/telemetry` on `harness/integration` leaks tails of split variable-length keys across chunk boundaries and corrupts multi-byte UTF-8 chunks.

**Required correction:** Apply the uncommitted `task-011` fixes to `packages/shared-contracts/src/telemetry/redactor.ts`, `tracer.ts`, and tests; re-export the canonical `SecretRedactor`, `StreamingRedactor`, `StructuredLogger`, `LocalTracer`, `getSharedSecretRedactor`, and `scanForSecrets` from `@ef-harness/shared-observability` (replacing the broken prefix-only `redactSecrets` implementation with `getSharedSecretRedactor().redact(value)` after adding `@ef-harness/shared-contracts: workspace:*` if `shared-observability` sits above `shared-contracts`, or delegating cleanly).

**Dependencies:** `F-001`.

**Verification:** `pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/shared-observability test`

**Integration priority:** Wave C01.

---

#### F-004 — `CheckOutcomeSchema` on `harness/integration` accepts `status: "pass"` with `collected_count: 0` (uncommitted `task-008` fix missing)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** LOCAL_DEFECT

**Affected units:** `Task 008` (`task/008-core-packet-schemas` `ee9ba03` + uncommitted working tree in `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas`), `Task 060`–`Task 066` (`packages/verifier`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/shared-contracts/src/packets/receipt.ts:50-56` (`CheckOutcomeSchema`), `packages/shared-contracts/tests/packets/checkpoint.test.ts:149-167`.

**Actual implementation:** On `harness/integration`, `CheckOutcomeSchema` (`packages/shared-contracts/src/packets/receipt.ts:50-55`) validates `{ check_id, check_version, artifact_digest, status, collected_count }` without checking whether `status === "pass"` when `collected_count === 0`. The fix `.refine((check) => !(check.status === "pass" && check.collected_count === 0), ...)` exists only as an uncommitted working-tree diff in `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas`.

**Required architecture:** `verification-and-gates.md` ("Zero collected tests is a failure (`missing`), never a pass") and `architecture-deep-review.md` forbid any verification receipt check outcome from reporting `pass` when `collected_count === 0`.

**Evidence:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/receipt.ts:50-55` vs `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas/packages/shared-contracts/src/packets/receipt.ts:50-58`.

**Why this is a defect:** Empty test files or mismatched Vitest/Playwright filters returning `collected_count: 0` pass `VerificationReceiptSchema` validation and can falsely satisfy requirement acceptance criteria.

**Required correction:** Land the uncommitted `task-008` refinement and regression test in `packages/shared-contracts/src/packets/receipt.ts` and `packages/shared-contracts/tests/packets/checkpoint.test.ts`.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/shared-contracts test`

**Integration priority:** Wave C01.

---

#### F-005 — Mixed `zod` vs `zod/v4` imports and divergent `EvidenceLocatorSchema` vs `LocatorSchema` / intent schemas across `shared-contracts` and `intake`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 007` (`vocabularies`), `Task 008` (`packets`), `Task 009` (`prompts` + uncommitted diff in `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas`), `Task 097`–`Task 100` (`packages/intake`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/shared-contracts/src/packets/*.ts` (`import { z } from "zod/v4"`), `packages/shared-contracts/src/prompts/*.ts` & `src/vocabularies/*.ts` (`import { z } from "zod"`), `packages/shared-contracts/src/packets/locators.ts:26-128` (`EvidenceLocatorSchema`), `packages/shared-contracts/src/prompts/common.ts:147-198` (`LocatorSchema`), `packages/shared-contracts/src/prompts/schemas/execution.ts:4-85` (`LeafWorkerV1Schema`).

**Actual implementation:**
1. `packets/*.ts` imports Zod v4 subpaths (`"zod/v4"`), while `prompts/*.ts`, `vocabularies/*.ts`, and `packages/ipc` import Zod v3 default (`"zod"` from `zod@^3.25.0`), producing incompatible `ZodType` / `ZodError` class instances across barrels.
2. `packets/locators.ts` defines camelCase `EvidenceLocatorSchema` (`turnId`, `charStart`/`charEnd`, `lineStart`/`lineEnd`, `region: [x,y,w,h]`, `ocrText`, `jsonPointer`) plus snake_case `pdf` only, whereas `prompts/common.ts` defines snake_case `LocatorSchema` (`turn`, `char_start`/`char_end`, `line_start`/`line_end`, `{ x, y, w, h, ocr_text }`, `pointer`).
3. On `harness/integration`, `prompts/schemas/execution.ts` (`LeafWorkerV1Schema`) rejects Task 008 `candidate@1` shapes (`dependency_intents: [{ package, version, reason }]`, `migration_intents: [{ table, change, reason }]`, `wiring_needs: [{ kind: "barrel" | "lockfile" | "schema_index", ... }]`) and `prompts/common.ts` rejects `{ kind: "image", region: [x,y,w,h], ocr_text }`; `task-009` has an uncommitted working-tree diff adding union arms for those, but `EvidenceLocatorSchema` still rejects snake_case `docx`/`text`/`turn`/`spec` locators emitted by `IntakeExtractorV1Schema`!

**Required architecture:** `external-intake.md`, `prompt-contracts.md`, and `build-pipeline.md` require locators emitted by `intake-extractor@1` and `leaf-worker@1` prompt outputs to validate directly as packet `EvidenceLocator` and `CandidatePacket` payloads without schema rejection or lossy ad-hoc field renaming, and require one uniform Zod runtime API across `@ef-harness/shared-contracts`.

**Evidence:** `packages/shared-contracts/src/packets/locators.ts:1,26-128`; `packages/shared-contracts/src/prompts/common.ts:1,147-198`; uncommitted diff in `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas/packages/shared-contracts/src/prompts/{common.ts,schemas/execution.ts}`.

**Why this is a defect:** Prompt outputs validated by `IntakeExtractorV1Schema` (`prompts`) fail `EvidenceLocatorSchema` (`packets`) when persisted as `evidence` locators, `LeafWorkerV1Schema` on `harness/integration` rejects canonical `candidate@1` dependency/migration/wiring intents, and `ZodType` instances from `packets` vs `prompts`/`vocabularies` cannot be composed in the same schema helpers.

**Required correction:** Apply the `task-009` uncommitted schema fixes, unify locator normalization/acceptance across `EvidenceLocatorSchema` and `LocatorSchema` (providing a lossless `normalizeEvidenceLocator()` to canonical snake_case/camelCase packet shape as specified in `external-intake.md`), and standardize Zod imports across `shared-contracts` (or isolate `toJSONSchema` behind a single helper so exported schemas share one `ZodType` family).

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/shared-contracts typecheck`

**Integration priority:** Wave C01.

---

#### F-006 — Canonical JSON-RPC schemas in `shared-contracts` vs `packages/ipc` disagree on `op_id` placement, parameter names (`project_id` vs `project`, `question_id` vs `questionId`, `batch_id` vs `batchId`), `artifact.open` mutability, `snapshot.get` pagination, and `stream_epoch` type

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 008` (`packages/shared-contracts/src/packets/rpc.ts`), `Task 032` (`packages/ipc/src/protocol/schemas.ts`), `Task 033` (`packages/ipc/src/streams/*`), `Task 067` (`apps/daemon`, `apps/desktop`, `apps/renderer`), `Tasks 122–165` (`apps/renderer`).

**Files and symbols:** `packages/shared-contracts/src/packets/rpc.ts:33-420` (`JsonRpcRequestSchema`, `EventsSubscribeParamsSchema`, `SnapshotGetParamsSchema`, `SnapshotGetResultSchema`, `ResyncRequiredNotificationSchema`), `packages/ipc/src/protocol/schemas.ts:28-204` (`rpcParamSchemas`, `subscribeParamsSchema`, `snapshotParamsSchema`, `snapshotPageSchema`, `resyncRequiredSchema`).

**Actual implementation:**
1. `shared-contracts/src/packets/rpc.ts:81-91` places `op_id` on the top-level JSON-RPC request object (`{ jsonrpc, id, method, op_id, params }`), whereas `packages/ipc/src/protocol/schemas.ts:92-197` places `op_id` inside `params` (`params: { op_id, ... }`).
2. `packets/rpc.ts` uses `project_id` (`project.open`, `project.close`, `build.*`, `preview.*`), `question_id` (`question.answer`), `batch_id` (`batch.accept`), and omits `project` completely on `chat.send`, `node.*`, `graph.view`, `inbox.*`, `artifact.open`, `diff.get`; `ipc/src/protocol/schemas.ts` uses `project`, camelCase `questionId`, camelCase `batchId`, and requires `op_id` on read-only `artifact.open` (`line 161`)!
3. `packets/rpc.ts:214-227` uses `.strict()` on `EventsSubscribeParamsSchema` (omitting `stream_epoch`) and `SnapshotGetParamsSchema` (omitting `cursor`), and returns `views: Array<{ name, ... }>` in `SnapshotGetResultSchema`, whereas `ipc/src/protocol/schemas.ts:46-78` requires `cursor` pagination, `sections: Record<string, unknown>`, and types `stream_epoch` as `z.string().min(1)` even though `ProjectStateDb.getStreamEpoch()` (`packages/db/src/state-db/project-state-db.ts:227`) returns `number`!

**Required architecture:** `kernel-schema-and-protocol.md:82-117` specifies JSON-RPC 2.0 over the named pipe where:
- Every mutating request carries `op_id` (`artifact.open` is read-only and returns `{ stream_id }`).
- Multi-project daemon sessions scope project-targeted methods by `project` (or `project_id` normalized consistently), `question.answer` uses `question_id`, `batch.accept` uses `batch_id`.
- `events.subscribe { project, topics, since_seq, stream_epoch? }` checks `stream_epoch` (integer or canonical stringified integer) and `snapshot.get { project, views, cursor? }` supports 2 MB paginated sections with `as_of_seq` and `stream_epoch`.

**Evidence:** `packages/shared-contracts/src/packets/rpc.ts:81-95,117-127,214-228,331-343,413-435` vs `packages/ipc/src/protocol/schemas.ts:28-201` vs `packages/db/src/state-db/project-state-db.ts:227-250`.

**Why this is a defect:** Any client/renderer built against `@ef-harness/shared-contracts` RPC packets fails validation in `@ef-harness/ipc` (`RpcRouter` / `EventSubscriptionServer` / `ClientStateSyncer`), `artifact.open` fails without a synthetic `op_id`, `snapshot.get` cannot paginate >2 MB sections, and `stream_epoch` `number` vs `string` crashes `subscribeParamsSchema` / `snapshotPageSchema`.

**Required correction:** Freeze one canonical JSON-RPC contract in `@ef-harness/shared-contracts` matching `kernel-schema-and-protocol.md` (supporting `project`, `question_id`, `batch_id`, `cursor?` on `snapshot.get`, `stream_epoch?: number` on `events.subscribe` and `snapshot.get`/`resync_required`, read-only `artifact.open` without `op_id`, and canonical `op_id` envelope/param handling) and make `@ef-harness/ipc`, `apps/daemon`, `apps/desktop`, and `apps/renderer` import and validate against that single contract.

**Dependencies:** `F-005`.

**Verification:** `pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/ipc test`

**Integration priority:** Wave C01 / Wave C03 (`ipc`).

---

#### F-007 — Hash prefix seam: `"sha256:<64-hex>"` in `shared-contracts` & KB/search vs bare `<64-hex>` in `cas_blobs`, `artifacts`, `ipc` streams, and `portability`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 007` (`packages/shared-contracts/src/canonical/hash.ts`), `Task 008` (`packets/receipt.ts`), `Task 016` (`db/knowledge`), `Task 018` (`db/search`), `Task 028` (`db/cas`), `Task 029` (`db/artifacts`), `Task 030` (`db/secret-purge`), `Task 033` (`ipc/streams`), `Task 186`–`Task 187` (`packages/portability`).

**Files and symbols:** `packages/shared-contracts/src/canonical/hash.ts:7-13` (`digestSha256` -> `"sha256:<hex>"`), `packages/db/src/cas/layout.ts:11-18` (`normalizeCasHash` -> `/^[0-9a-f]{64}$/`), `packages/db/src/artifacts/seekable-zstd.ts:41` (`sha256Hex`), `packages/shared-contracts/src/packets/receipt.ts:34` (`artifact_digest: "sha256:..."`).

**Actual implementation:** `digestSha256()` (`shared-contracts/src/canonical/hash.ts:9-13`), `computeNodeContentHash()`, `computeRequestHash()`, and `VerificationReceiptSchema` (`artifact_digest`) emit `"sha256:<64-hex>"`, whereas `CasBlobStore` (`packages/db/src/cas/layout.ts:11-18` `normalizeCasHash`) throws `TypeError("CAS hash must be a lowercase SHA-256 hex digest")` if given a `"sha256:"` prefix because `schema/state.sql` (`artifacts.hash`) and `schema/global.sql` (`cas_blobs.hash`, `cas_pins.hash`) store bare 64-character hex digests (`cas/sha256/ab/cd/<hash>.zst`).

**Required architecture:** `schema/state.sql`, `schema/global.sql`, and `kernel-schema-and-protocol.md:23,55` store bare lowercase 64-char hex SHA-256 keys in `cas_blobs.hash`, `cas_pins.hash`, and `artifacts.hash`, while structured packet digests (`content_hash`, `request_hash`, `artifact_digest`) may carry `"sha256:<64-hex>"`. Crossing the boundary between packet `artifact_digest` and CAS/DB `hash` requires explicit canonical stripping/formatting helpers rather than ad-hoc string concatenation or runtime `TypeError`s.

**Evidence:** `packages/shared-contracts/src/canonical/hash.ts:7-13` vs `packages/db/src/cas/layout.ts:11-18` (`const HASH_PATTERN = /^[0-9a-f]{64}$/`).

**Why this is a defect:** Passing `VerificationReceipt.checks[i].artifact_digest` (`"sha256:..."`) into `CasBlobStore` or `ArtifactManager` throws `TypeError`, while passing `StoredArtifact.hash` (`"<64-hex>"`) into packet schemas expecting `"sha256:..."` fails validation.

**Required correction:** Export `toBareSha256Hex(digestOrHex: string): string` and `toPrefixedSha256(digestOrHex: string): \`sha256:\${string}\`` from `@ef-harness/shared-contracts` (`canonical/hash.ts`) and accept/normalize `"sha256:<64-hex>"` at packet↔CAS/DB boundaries while keeping `cas_blobs.hash` / `artifacts.hash` strictly bare 64-hex.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/shared-contracts test && pnpm --filter @ef-harness/db test`

**Integration priority:** Wave C01 / Wave C02 (`db`).

---

#### F-008 — Uncommitted `task-022` lifecycle & DONE-invariant bugfixes missing on `harness/integration` (`coversScope` inverted prefix bug, `contractsCurrent` brief-version pin, `BLOCKED` pre-block state & approved exit persistence)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** LOCAL_DEFECT

**Affected units:** `Task 022` (`task/022-feature-project-lifecycles` `864b467` + uncommitted working tree in `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/db/src/lifecycles/done.ts:19-22,94-131` (`coversScope`, `conditionTasks`, `contractsCurrent`), `packages/db/src/lifecycles/repo.ts:214-285,522-646` (`LifecycleRepo.transitionFeature`, `approvedExit`, `readPreBlockState`).

**Actual implementation:** On `harness/integration` (`30f2e9c`):
1. `coversScope(scopePrefix, auditedPaths)` (`packages/db/src/lifecycles/done.ts:19-21`) evaluates `audited === scopePrefix || audited.startsWith(scopePrefix) || scopePrefix.startsWith(audited)`. Because `audited.startsWith(scopePrefix)` is true whenever a narrow child file (`src/a/one.ts`) starts with a broad task scope (`src/a/`), auditing a single file falsely marks the entire directory scope as audited for `DONE`!
2. `contractsCurrent(db, task)` (`done.ts:109-130`) checks `read_sets` across *any* historical attempt (`WHERE a.task = :task`) instead of restricting to `a.state = 'accepted' AND a.brief_version = :brief`, allowing stale superseded attempts' contract reads to satisfy `DONE`.
3. `LifecycleRepo` (`repo.ts:214-285,585-610`) allows a `BLOCKED` feature to jump straight to `LEAVES_MERGED`/`WIRED`/`JOURNEY_PASSED`/`MERGED` instead of resuming to its pre-block state, and `approvedExit` scans prunable `outbox` rows instead of durable `meta` keys (`feature_exit_approved:<feature>`).
All three fixes exist uncommitted in `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles`.

**Required architecture:** `knowledge-database.md`, `verification-and-gates.md`, and `database-design.md` require `DONE` to hold only when `STATIC_AUDIT` covers the full task scope (`scopePrefix.startsWith(audited)`), accepted attempts at the current `brief_version` read current pinned contract versions, `BLOCKED` features resume to their pre-block state, and `DEFERRED`/`ABANDONED` approvals survive 7-day outbox pruning.

**Evidence:** `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles` `git diff` on `packages/db/src/lifecycles/done.ts` and `packages/db/src/lifecycles/repo.ts`.

**Why this is a defect:** Features can illegally transition to `DONE` with unaudited files, stale contract versions, or skipped verification states after unblocking, or lose exit approval after outbox pruning.

**Required correction:** Apply the uncommitted `task-022` changes (and corresponding lifecycle tests) onto `packages/db/src/lifecycles/done.ts` and `packages/db/src/lifecycles/repo.ts`.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/db test`

**Integration priority:** Wave C02 (`db` unification).

---

#### F-009 — `ProjectStateDb` (`Task 013`) and `GlobalBrokerDb` (`Task 014`) bypass `MigrationRunner` (`Task 015`) and hard-fail on upgraded schemas (`user_version !== 1`)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 012` (`db/driver`), `Task 013` (`db/state-db`), `Task 014` (`db/auxiliary-dbs`), `Task 015` (`db/migrations`), `Task 067` (`apps/daemon`).

**Files and symbols:** `packages/db/src/state-db/project-state-db.ts:130-136,434-459` (`ProjectStateDb.open`, `assertExistingVersion`), `packages/db/src/auxiliary-dbs/global-broker-db.ts:134` (`openVerifiedGlobal`), `packages/db/src/migrations/runner.ts:72-180` (`MigrationRunner`, `migrateDatabase`).

**Actual implementation:** `ProjectStateDb.assertExistingVersion()` (`project-state-db.ts:449-458`) checks `if (version > this.supportedSchemaVersion) throw new DatabaseVersionTooNewError(...)` and `if (version !== this.supportedSchemaVersion) throw new DatabaseSchemaVersionError(version, this.supportedSchemaVersion)` where `APP_SUPPORTED_SCHEMA_VERSION = 1`. Similarly `openVerifiedGlobal()` in `global-broker-db.ts` enforces fixed `user_version === 1`. Neither class invokes or integrates with `MigrationRunner` (`packages/db/src/migrations/runner.ts`), and if `MigrationRunner` migrates a database to `version = 2`, `ProjectStateDb.open()` and `GlobalBrokerDb.open()` reject the migrated database unless `supportedSchemaVersion` is dynamically derived from the migration registry AND lazy migration runs before `assertExistingVersion()`!

**Required architecture:** `database-design.md` (§9 Forward-only migrations) and `coordinator-and-recovery.md` require `harnessd` startup to run `MigrationRunner.migrateGlobalDatabase()` before opening `GlobalBrokerDb`, and `project.open` to run lazy per-project `MigrationRunner.migrateProject()` (with `VACUUM INTO` backup + `needs_repair` isolation on failure) before `ProjectStateDb` opens at `maxKnownSchemaVersion(migrations, "state", 1)`.

**Evidence:** `packages/db/src/state-db/project-state-db.ts:449-458` (`if (version !== this.supportedSchemaVersion) throw new DatabaseSchemaVersionError(...)`); `packages/db/src/migrations/runner.ts:80-110`.

**Why this is a defect:** Any schema migration (`version >= 2`) or opening an older v1 project under a v2 app release immediately throws `DatabaseSchemaVersionError` / `GlobalSchemaVersionError` instead of running the forward-only migration safety sequence.

**Required correction:** Wire `ProjectStateDb` and `GlobalBrokerDb` to derive `supportedSchemaVersion` from `maxKnownSchemaVersion(PRODUCTION_MIGRATIONS, targetDb, PRODUCTION_SCHEMA_VERSION)` and expose a coordinated open helper (`openMigratedGlobalDb`, `openMigratedProjectStateDb`) that executes `MigrationRunner` before acquiring the steady-state writer connection.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/db test`

**Integration priority:** Wave C02 (`db` unification).

---

#### F-010 — Divergent `ef_search_text` UDF implementations across `packages/db` omit acronym splitting (`XMLHttpRequest` -> `XML Http Request`), corrupting FTS5 `kb_words` parity

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 007` (`shared-contracts/src/canonical/search-text.ts`), `Task 012` (`db/src/driver/search-text.ts`), `Task 013` (`db/src/state-db/sqlite-session.ts`), `Task 015` (`db/src/migrations/search-text.ts`), `Task 030` (`db/src/secret-purge/search-text.ts`), `Task 034` (`sim/src/m0/schema-cache.ts`).

**Files and symbols:** `packages/shared-contracts/src/canonical/search-text.ts:7-15` (`splitSearchText`), `packages/db/src/state-db/sqlite-session.ts:141-149` (`efSearchText`), `packages/db/src/migrations/search-text.ts:7-14` (`efSearchText`), `packages/db/src/secret-purge/search-text.ts:2-6` (`splitSearchText`).

**Actual implementation:** `shared-contracts` `splitSearchText` (`Task 007`) applies `.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_\-./:]+/g, " ")`. Only `packages/db/src/driver/search-text.ts:15-21` delegates to `shared-contracts` `splitSearchText`. `state-db/sqlite-session.ts:147`, `migrations/search-text.ts:12`, and `secret-purge/search-text.ts:4` hardcode an older 2-regex copy WITHOUT `.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")`.

**Required architecture:** `database-design.md` and `schema/state.sql` (`kb_words` contentless FTS5 triggers calling `ef_search_text(...)`) require `ef_search_text` to be 100% deterministic and identical across every connection that inserts, deletes, migrates, or purges `nodes`, because contentless FTS5 (`content=''`, `contentless_delete=1`) corrupts inverted-index tombstones if the delete/rebuild UDF tokenizes differently from the insert UDF!

**Evidence:** `packages/shared-contracts/src/canonical/search-text.ts:10-14` vs `packages/db/src/state-db/sqlite-session.ts:141-149`, `packages/db/src/migrations/search-text.ts:7-14`, and `packages/db/src/secret-purge/search-text.ts:2-6`.

**Why this is a defect:** Nodes inserted via `driver/connection.ts` (`openDatabase`) and later updated/deleted/rebuilt via `ProjectStateDb`, `MigrationRunner`, or `SecretPurgeEngine` tokenize acronyms (`HTTPServer`, `OAuthCallback`, `JSONSchema`) differently, leaving ghost tokens or corrupting FTS5 `kb_words` queries.

**Required correction:** Replace all local `efSearchText` / `splitSearchText` copies in `packages/db` (`state-db/sqlite-session.ts`, `migrations/search-text.ts`, `secret-purge/search-text.ts`, `driver/search-text.ts`) and `packages/sim` with direct imports of `splitSearchText` from `@ef-harness/shared-contracts`.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/db test && pnpm test:schema`

**Integration priority:** Wave C02 (`db` unification).

---

#### F-011 — Three incompatible `CasBlobStore` contracts inside `packages/db` (`cas/store.ts` vs `artifacts/cas-port.ts` vs `secret-purge/cas-store.ts`), breaking `zstd-seekable` >1 MB log storage

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 028` (`packages/db/src/cas/store.ts`), `Task 029` (`packages/db/src/artifacts/cas-port.ts`, `artifact-manager.ts`), `Task 030` (`packages/db/src/secret-purge/cas-store.ts`, `engine.ts`), `Task 033` (`packages/ipc/src/streams/ports.ts`).

**Files and symbols:** `packages/db/src/cas/store.ts:174-220` (`CasBlobStore`), `packages/db/src/artifacts/cas-port.ts:18-69` (`CasBlobStore`, `CasPutRequest`), `packages/db/src/secret-purge/cas-store.ts:45-85` (`RawFileCasBlobStore`), `packages/db/src/index.ts`.

**Actual implementation:**
1. `Task 028`'s `CasBlobStore` (`packages/db/src/cas/store.ts:208-216`) exposes **async** `putBlob(content: Uint8Array, pin: CasPutPin): Promise<CasWriteResult>` where `WRITE_FORMATS` only permits `"zstd" | "raw"` (throwing `TypeError("unsupported CAS write format: zstd-seekable")`!) and always compresses `content` itself.
2. `Task 029`'s `ArtifactManager` (`packages/db/src/artifacts/cas-port.ts:58-68`) requires a **synchronous** (or adapted) `CasBlobStore` with `putBlob(request: CasPutRequest): CasWriteResult` accepting pre-framed `storedPayload` + `uncompressed` with `format: "zstd" | "zstd-seekable" | "raw"` (so `zstd-seekable` multi-frame logs >1 MB are NOT double-compressed!), plus `readCompressed(hash)`, `verifyBlobIntegrity(hash)`, `pinBlob`, `unpinHolder`, `quarantineBlob`, `markVerified`, `totalPinnedStoredBytes`, and `listVerificationCandidates`.
3. `Task 030`'s `SecretPurgeEngine` (`packages/db/src/secret-purge/cas-store.ts:45`) uses a third synchronous `RawFileCasBlobStore` (`putBlob(bytes, putOptions)`, `getBlob(hash)`, `forceDeletePurgedBlob(hash)`) that only looks up `<hash>.raw` files and fails on `.zst` blobs written by `Task 028` or `Task 029`!

**Required architecture:** `kernel-schema-and-protocol.md:23,53-69` and `database-design.md` (§7 Shared blob store) specify ONE shared CAS store (`%LOCALAPPDATA%\EFHarness\cas\sha256\ab\cd\<hash>.zst`) supporting `raw`, `zstd`, and `zstd-seekable` (pre-framed multi-frame logs with sidecar line index), pinned in `global.db` (`cas_blobs`, `cas_pins`), consumed uniformly by `ArtifactManager`, `SecretPurgeEngine` (bypassing the 7-day grace window on secret purge across `.zst` and `.raw`), and `ipc` binary streams.

**Evidence:** `packages/db/src/cas/store.ts:57,208-216` (`const WRITE_FORMATS = new Set<CasWriteFormat>(["zstd", "raw"])`) vs `packages/db/src/artifacts/cas-port.ts:15-25,58-68` vs `packages/db/src/secret-purge/cas-store.ts:14-16,45-80`.

**Why this is a defect:** `ArtifactManager` cannot instantiate with `Task 028`'s `CasBlobStore` (method arity, sync/async return types, missing `zstd-seekable` pre-framed write path, missing `readCompressed`/`totalPinnedStoredBytes`), and `SecretPurgeEngine` cannot read or purge `.zst`-compressed artifacts containing leaked secrets!

**Required correction:** Extend `packages/db/src/cas/store.ts` (`CasBlobStore`) to support pre-framed `zstd-seekable` writes (`storedPayload` + verified `uncompressed` SHA-256), `readCompressed`, `forceDeletePurgedBlob` (for `.zst` and `.raw`), `totalPinnedStoredBytes`, and `listVerificationCandidates`, and provide unified adapters/bindings so `ArtifactManager` (`Task 029`) and `SecretPurgeEngine` (`Task 030`) run directly against the canonical `CasBlobStore`.

**Dependencies:** `F-007`.

**Verification:** `pnpm --filter @ef-harness/db test`

**Integration priority:** Wave C02 (`db` unification).

---

#### F-012 — Fragmented connection handles and 9 duplicate `queries.sql` parsers inside `packages/db` prevent repositories from sharing `ProjectStateDb` + `CoordinatorWriteQueue`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 012`–`Task 030` (`packages/db`).

**Files and symbols:** `packages/db/src/driver/connection.ts` (`SqliteConnection`), `packages/db/src/state-db/sqlite-session.ts` (`StateConnection`), `packages/db/src/auxiliary-dbs/sqlite-connection.ts` (`SqliteConnection`), `packages/db/src/holds/connection.ts`, `packages/db/src/lifecycles/connection.ts`, `packages/db/src/outbox/connection.ts`, `packages/db/src/leases/db-port.ts`, `packages/db/src/ledger/database.ts`, `packages/db/src/knowledge/sql.ts`, `packages/db/src/read-models/sql.ts`, `packages/db/src/search/connection.ts`, and `packages/db/src/index.ts`.

**Actual implementation:** Because Tasks `012`–`030` branched from `main` in isolation:
1. `ProjectStateDb` (`Task 013`) keeps `private session: StateConnection` completely inaccessible to `KnowledgeRepo` (`016`), `NameRegistryService` (`017`), `SearchService` (`018`), `TaskLeaseManager` (`019`), `BudgetLedgerRepo` (`020`), `HoldRepo` (`023`), `LifecycleRepo` (`022`), `CoordinatorWriteQueue` (`025`), `OutboxRepo` (`026`), `ReadModelRepo` (`027`), and `ArtifactManager` (`029`), each of which defined its own incompatible structural connection interface (`prepare().get(...params)` positional in `StateConnection` vs `prepare().get(recordParams)` named-object in `holds`, `lifecycles`, `outbox`, `knowledge`, `leases`, `ledger`, `driver`)!
2. Nine submodules (`driver`, `artifacts`, `cas`, `grants`, `holds`, `knowledge`, `leases`, `ledger`, `lifecycles`, `outbox`, `read-models`, `write-queue`) each ship their own `loadQueryCatalog` / `findRepoRoot` walking `../../../../schema/queries.sql` relative to `import.meta.url` (which breaks inside packaged Electron ASAR/resources if not routed through `canonicalAssetAbsolute("queriesSql")`).

**Required architecture:** `database-design.md`, `kernel-schema-and-protocol.md`, and `IMPLEMENTATION_TASKS.md` (`Task 001` & `Tasks 012–030`) require one single-writer `ProjectStateDb` per open project exposing a unified `SqliteConnection` + shared `QueryCatalog` (loaded via `@ef-harness/shared-contracts` `canonicalAssetAbsolute`) to all `packages/db` repositories and `CoordinatorWriteQueue`.

**Evidence:** `packages/db/src/state-db/project-state-db.ts:79` (`private session: StateConnection | undefined`), `state-db/sqlite-session.ts:32-45` (positional `...params` only, no `prepare()` exposed!) vs `holds/connection.ts:13-22`, `lifecycles/connection.ts:13-22`, `outbox/connection.ts:13-23` (requiring `prepare(sql)` with named `Record<string, SqlValue>` bindings).

**Why this is a defect:** You cannot pass an open `ProjectStateDb` instance into `KnowledgeRepo`, `TaskLeaseManager`, `BudgetLedgerRepo`, `LifecycleRepo`, `HoldRepo`, `OutboxRepo`, `ReadModelRepo`, or `ArtifactManager` at runtime! Every caller (such as `Task 067`'s `apps/daemon`) was forced to open a raw second `DatabaseSync` directly on `state.db`, violating the single-writer lock and triggering `ProjectSafeModeError("foreign_write")`!

**Required correction:** Expose a canonical writer/reader connection accessor (backed by `driver`'s `SqliteConnection` + `QueryCatalog` supporting `:named` parameter objects) on `ProjectStateDb` and `GlobalBrokerDb` (plus a `ProjectDbBundle` factory assembling `stateDb`, `writeQueue`, `knowledge`, `registry`, `search`, `leases`, `ledger`, `holds`, `lifecycles`, `outbox`, `readModels`, `artifacts`), and route schema path lookups through `canonicalAssetAbsolute`.

**Dependencies:** `F-008`, `F-009`, `F-010`, `F-011`.

**Verification:** `pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/db typecheck`

**Integration priority:** Wave C02 (`db` unification).

---

#### F-013 — `packages/ipc` (`Tasks 032–033`) defines incompatible async port interfaces for `CoordinatorWriteQueue`, `OutboxRepo`, `ReadModelRepo`, and `ArtifactCatalog` instead of binding to `@ef-harness/db`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 025` (`db/write-queue`), `Task 026` (`db/outbox`), `Task 027` (`db/read-models`), `Task 028` (`db/cas`), `Task 029` (`db/artifacts`), `Task 032` (`ipc/protocol`), `Task 033` (`ipc/streams`).

**Files and symbols:** `packages/ipc/src/protocol/ports.ts:24-96` (`CoordinatorWriteQueue`, `OutboxRepo`, `ReadModelRepo`), `packages/ipc/src/streams/ports.ts:23-93` (`ArtifactCatalog`, `ArtifactLogReader`), `packages/ipc/package.json:20-23`.

**Actual implementation:** `packages/ipc` does not depend on `@ef-harness/db` and defines standalone port interfaces in `protocol/ports.ts` whose signatures disagree with `packages/db`:
1. `ipc` `CoordinatorWriteQueue.submitOperation(op: { opId, kind, priority, request, execute: () => Promise<unknown> }): Promise<unknown>` vs `db` `CoordinatorWriteQueue.submitOperation(input: { opId, kind, priority, request, execute: (tx: WriteTransaction) => T }): Promise<OperationReceipt<T>>`.
2. `ipc` `OutboxRepo.replayEventsSince(sinceSeq, topics, limit): Promise<readonly DomainEvent[]>` & `getStreamEpoch(): Promise<string>` (instance-bound, async, string epoch) vs `db` `OutboxRepo.replayEventsSince(conn, sinceSeq, options): OutboxReplayBatch` (connection-passed, sync, batch object, integer epoch on `ProjectStateDb`).
3. `ipc` `ReadModelRepo.getFeatureProgress(): Promise<readonly FeatureProgress[]>` (0 args, array) & `syncRequirementStatusForChecks(checkIds: readonly string[])` vs `db` `ReadModelRepo.getFeatureProgress(feature: string): FeatureProgress` (1 required `feature` arg, single object) & `syncRequirementStatusForChecks(request: RequirementStatusSyncRequest)`.

**Required architecture:** `kernel-schema-and-protocol.md:70-118` requires `ipc`'s `RpcRouter`, `EventSubscriptionServer`, `SnapshotAssembler`, and `BinaryStreamManager` to bind cleanly to `packages/db`'s `CoordinatorWriteQueue`, `OutboxRepo`, `ReadModelRepo`, `ArtifactManager`, and `CasBlobStore`.

**Evidence:** `packages/ipc/src/protocol/ports.ts:24-95` vs `packages/db/src/write-queue/coordinator-write-queue.ts:41-55`, `packages/db/src/outbox/repo.ts:92-160`, and `packages/db/src/read-models/repo.ts:76-95`.

**Why this is a defect:** `apps/daemon` (`harnessd`) cannot pass `@ef-harness/db` repositories into `@ef-harness/ipc` (`RpcRouter`, `EventSubscriptionServer`, `SnapshotAssembler`, `BinaryStreamManager`) without type errors and runtime crashes (which is why `Task 067`'s `apps/daemon` bypassed `@ef-harness/ipc`'s router and `@ef-harness/db`'s repositories altogether!).

**Required correction:** Add `@ef-harness/db: workspace:*` to `packages/ipc/package.json` (after `F-001` places `db` below `ipc` in `scripts/layers.mjs`) and provide canonical DB-backed adapters in `packages/ipc` (`createDbWriteQueuePort`, `createDbOutboxPort`, `createDbReadModelPort`, `createDbSnapshotSource`, `createDbArtifactCatalog`) bridging `@ef-harness/db` `ProjectDbBundle` directly to `RpcRouter`, `EventSubscriptionServer`, `SnapshotAssembler`, and `BinaryStreamManager`.

**Dependencies:** `F-001`, `F-006`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/ipc test && pnpm --filter @ef-harness/ipc typecheck`

**Integration priority:** Wave C03 (`ipc` & `sim`).

---

#### F-014 — `FrameCodec.encode` static vs instance mismatch between `ipc/transport` (`Task 031`) and `ipc/streams` (`Task 033`)

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 031` (`packages/ipc/src/transport/frame-codec.ts`), `Task 033` (`packages/ipc/src/streams/frame-codec.ts`, `packages/ipc/src/streams/frame.ts`).

**Files and symbols:** `packages/ipc/src/transport/frame-codec.ts:45-79` (`FrameCodec.encode` static method, `push`, `reset` instance methods), `packages/ipc/src/streams/frame-codec.ts:21-46` (`ExternalFrameCodec`, `adaptFrameCodec`), `packages/ipc/src/streams/frame.ts` (`StreamFrameCodec`).

**Actual implementation:** `Task 031`'s `FrameCodec` (`packages/ipc/src/transport/frame-codec.ts:48`) defines `static encode(frame: EncodedFrame): Buffer` (a **static** method, NOT an instance method!), while `push()` and `reset()` are instance methods. Meanwhile `Task 033`'s `adaptFrameCodec(codec: ExternalFrameCodec)` (`packages/ipc/src/streams/frame-codec.ts:21-46`) requires `codec.encode(...)`, `codec.push(...)`, and `codec.reset()` ALL on the same instance object, AND `Task 033` also duplicates the wire framing in `StreamFrameCodec` (`streams/frame.ts`)!

**Required architecture:** `kernel-schema-and-protocol.md:78-81` defines a single binary frame wire codec (`4-byte length + 1-byte channel + optional 4-byte streamId + payload`) shared by Channel 0 JSON-RPC and Channel 1 binary streams.

**Evidence:** `packages/ipc/src/transport/frame-codec.ts:45-79` (`static encode(frame: EncodedFrame): Buffer` — no instance `encode` method) vs `packages/ipc/src/streams/frame-codec.ts:21-46` (`ExternalFrameCodec { encode(...): Buffer; push(...); reset() }`).

**Why this is a defect:** Passing `new FrameCodec()` from `ipc/transport` into `adaptFrameCodec()` in `ipc/streams` fails TypeScript compilation (`Property 'encode' does not exist on type 'FrameCodec'`) and throws `codec.encode is not a function` at runtime.

**Required correction:** Add an instance `encode(frame: EncodedFrame): Buffer { return FrameCodec.encode(frame); }` method on `FrameCodec` in `packages/ipc/src/transport/frame-codec.ts` and delegate `StreamFrameCodec` / `adaptFrameCodec` directly to it so Channel 0 and Channel 1 share one canonical wire codec.

**Dependencies:** None.

**Verification:** `pnpm --filter @ef-harness/ipc test && pnpm --filter @ef-harness/ipc typecheck`

**Integration priority:** Wave C03 (`ipc` & `sim`).

---

#### F-015 — `StreamCreditGrantSchema` (`shared-contracts`) vs `packages/ipc/src/streams` credit control message mismatch

**Status:** CONFIRMED

**Severity:** MEDIUM

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 008` (`packages/shared-contracts/src/packets/rpc.ts:367-378`), `Task 033` (`packages/ipc/src/streams/binary-stream-manager.ts`, `artifact-stream-client.ts`).

**Files and symbols:** `packages/shared-contracts/src/packets/rpc.ts:367-378` (`StreamCreditGrantSchema`), `packages/ipc/src/streams/frame.ts` / `binary-stream-manager.ts` / `artifact-stream-client.ts`.

**Actual implementation:** `shared-contracts` defines `StreamCreditGrantSchema` as `{ jsonrpc: "2.0", method: "stream.credit", params: { stream_id, credits } }` (with `.strict()`), whereas `packages/ipc/src/streams` defines its own internal control notifications (`stream.credit`, `stream.end`, `stream.error`, `stream.cancel`) without importing `StreamCreditGrantSchema` or registering `stream.credit` / `stream.cancel` in `rpcParamSchemas` (`packages/ipc/src/protocol/schemas.ts`), causing `RpcRouter` to reject `stream.credit` as `JSON_RPC_METHOD_NOT_FOUND` if routed through the main Channel 0 dispatcher!

**Required architecture:** `kernel-schema-and-protocol.md:115` specifies that `artifact.open` returns a stream ID and content flows on Channel 1 in 64 KB chunks while the client grants chunk credits over Channel 0 without colliding with or being rejected by the Channel 0 JSON-RPC router.

**Evidence:** `packages/shared-contracts/src/packets/rpc.ts:367-378` vs `packages/ipc/src/protocol/schemas.ts:82-201` (missing `stream.credit` / `stream.cancel`).

**Why this is a defect:** When a single `NamedPipeServer` / `MessagePortBridge` multiplexes Channel 0 JSON-RPC requests alongside `stream.credit` / `stream.cancel` notifications, unhandled stream control frames hit `RpcRouter` and fail unless demultiplexed or registered against the shared schema.

**Required correction:** Export canonical `StreamCreditNotificationSchema`, `StreamCancelNotificationSchema`, `StreamEndNotificationSchema`, and `StreamErrorNotificationSchema` in `@ef-harness/shared-contracts` and wire `packages/ipc` Channel 0 demultiplexing so `stream.credit` and `stream.cancel` route directly to `BinaryStreamManager` while `stream.end` and `stream.error` route to `ArtifactStreamClient`.

**Dependencies:** `F-006`, `F-014`.

**Verification:** `pnpm --filter @ef-harness/ipc test`

**Integration priority:** Wave C03 (`ipc` & `sim`).

---

#### F-016 — `packages/sim` (`Task 034` M0 Kernel Simulator) simulates a private standalone SQL/CAS/pipe model instead of exercising `@ef-harness/db` and `@ef-harness/ipc`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 034` (`packages/sim`), `Tasks 012–030` (`packages/db`), `Tasks 031–033` (`packages/ipc`), `Task 193` (`packages/meta-lab` chaos fault sim).

**Files and symbols:** `packages/sim/package.json:21-23`, `packages/sim/src/m0/kernel-session.ts:42-145` (`KernelSession`), `packages/sim/src/m0/cas-store.ts:55-100` (`DiskCasStore` writing `cas/blobs/<hash>` raw UTF-8 strings instead of `cas/sha256/ab/cd/<hash>.zst`), `packages/sim/src/m0/ipc-pipe.ts:16-71` (`exerciseNamedPipe` raw `net.createServer` string echo instead of `NamedPipeServer` + `FrameCodec` + `EventSubscriptionServer`), `packages/sim/src/m0/client-sync.ts` (`ClientStateSyncer` name collision with `packages/ipc`).

**Actual implementation:** `packages/sim/package.json` depends ONLY on `@ef-harness/shared-contracts`. `KernelSession` opens raw `DatabaseSync` handles directly, `DiskCasStore` writes uncompressed files to `cas/blobs/<hash>`, `ClientStateSyncer` reimplements client state sync in isolation, and `exerciseNamedPipe` echoes a raw string over `node:net` without using `NamedPipeServer`, `FrameCodec`, `CoordinatorWriteQueue`, `OutboxRepo`, or `CasBlobStore`!

**Required architecture:** `roadmap.md` (Milestone M0 Exit Gate), `observability-and-testing.md`, and `IMPLEMENTATION_TASKS.md` (`Task 034`) require the M0 deterministic simulator and M0 exit certification (`10,000` seeds, crash fault injection, named-pipe reconnect/resync, write p99 < 50 ms, board query < 20 ms) to certify the **real** M0 kernel (`@ef-harness/db` + `@ef-harness/ipc`), not a parallel toy reimplementation.

**Evidence:** `packages/sim/package.json:21-23` (`dependencies: { "@ef-harness/shared-contracts": "workspace:*" }`); `packages/sim/src/m0/cas-store.ts:60-62` (`path.join(this.root, "cas", "blobs", hash)`); `packages/sim/src/m0/ipc-pipe.ts:30-69`.

**Why this is a defect:** Bugs in `@ef-harness/db` (`CasBlobStore`, `CoordinatorWriteQueue`, `OutboxRepo`, `ProjectStateDb`, `LifecycleRepo`) and `@ef-harness/ipc` (`FrameCodec`, `NamedPipeServer`, `EventSubscriptionServer`, `ClientStateSyncer`) are completely invisible to `certify:m0`, giving false M0 exit certification.

**Required correction:** Add `@ef-harness/db` and `@ef-harness/ipc` workspace dependencies to `packages/sim/package.json` (enabled by `F-001` sub-layer ordering), wire `DiskCasStore` / `exerciseNamedPipe` / `ClientStateSyncer` integration certification paths in `packages/sim` against real `@ef-harness/db` and `@ef-harness/ipc` implementations, and disambiguate `SimClientStateSyncer` vs `ipc`'s `ClientStateSyncer`.

**Dependencies:** `F-001`, `F-012`, `F-013`, `F-014`.

**Verification:** `pnpm --filter @ef-harness/sim test`

**Integration priority:** Wave C03 (`ipc` & `sim`).

---

#### F-017 — `packages/git-engine` `resolveGitBinary` refuses to fall back to `git` on `PATH` when bundled MinGit is absent, and submodules define 5 incompatible `GitRunner` / `RefLeaseStateDb` contracts

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 035` (`git-engine/runner`), `Task 036` (`git-engine/safety-scan`), `Task 037` (`git-engine/snapshots`), `Task 038` (`git-engine/worktrees`), `Task 039` (`git-engine/refs`), `Task 013` (`db/state-db`).

**Files and symbols:** `packages/git-engine/src/runner/resolve-binary.ts:75-141` (`resolveGitBinary`), `packages/git-engine/src/runner/exec-git.ts:100` (`execGit`), `packages/git-engine/src/safety-scan/git-runner.ts:6-23` (`createDefaultGitRunner`), `packages/git-engine/src/snapshots/git-runner.ts:34-70` (`SnapshotGitRunner`), `packages/git-engine/src/worktrees/git-runner.ts:23-40` (`GitRunner`), `packages/git-engine/src/refs/git-runner.ts:25-28` (`GitRunner` synchronous!), `packages/git-engine/src/refs/state-db.ts:18-41` (`openRefLeaseStateDb`).

**Actual implementation:**
1. `resolveGitBinary()` (`resolve-binary.ts:124-141`) checks only `settingsGitPath` and `<resources>/mingit/cmd/git.exe`; in dev/CI environments where `<resources>/mingit/cmd/git.exe` is not packaged and no `settingsGitPath` override is set, it unconditionally throws `GitBinaryNotFoundError` instead of probing `git` (`>= 2.38`) on `PATH`!
2. Inside `packages/git-engine`, all 5 submodules invented incompatible runner interfaces: `runner` exports `execGit(options: ExecGitOptions): Promise<ExecGitResult>` (`exitCode: number | null`), `safety-scan` expects `execGit(args, options): Promise<GitCommandResult>`, `snapshots` expects `run(request: SnapshotGitRequest): Promise<SnapshotGitResult>`, `worktrees` expects `{ execGit(args, options): Promise<GitExecResult>; resolveGitBinary(): Promise<string> }`, and `refs` (`RefLeaseManager`) expects **synchronous** `{ resolveGitBinary(): string; execGit(request: GitExecRequest): GitExecResult }` via `spawnSync`!
3. `openRefLeaseStateDb()` (`refs/state-db.ts:28-41`) opens a raw second `DatabaseSync` on `state.db` and executes its own `REF_LEASES_DDL` (`expected_sha`, `expires_at`) without going through `ProjectStateDb` or `CoordinatorWriteQueue`, triggering `ProjectSafeModeError("foreign_write")` if `ProjectStateDb` is open! (Compare `schema/state.sql` `leases` table vs custom `ref_leases`).

**Required architecture:** `workspace-and-git.md` and `database-design.md` require one canonical Git runner (resolving settings override → bundled MinGit → system `git >= 2.38` in dev/CI, enforcing `core.longpaths=true`, `core.quotepath=false`, scrubbed env, line-ending preservation, and developer-checkout immutability) shared across `safety-scan`, `snapshots`, `worktrees`, and `refs`, and require ref leases to persist in `state.db`'s canonical `leases` table (`kind = 'ref'`, `name = <ref>`) via the single `ProjectStateDb` writer rather than creating rogue DDL tables on a second connection.

**Evidence:** `packages/git-engine/src/runner/resolve-binary.ts:138-140`; `packages/git-engine/src/refs/git-runner.ts:25-28` vs `worktrees/git-runner.ts:23-26` vs `snapshots/git-runner.ts:3`; `packages/git-engine/src/refs/state-db.ts:18-41` (`CREATE TABLE IF NOT EXISTS ref_leases ...`).

**Why this is a defect:** `resolveGitBinary()` fails immediately in local development and CI whenever bundled MinGit is absent; `safety-scan`/`snapshots`/`worktrees`/`refs` bypass `Task 035`'s developer-checkout guard and `index.lock` backoff; and `openRefLeaseStateDb` mutates `state.db` schema and triggers foreign-write safe mode.

**Required correction:** Add system `PATH` fallback (`>= 2.38`) in dev/non-packaged mode to `resolveGitBinary`, provide canonical adapters from `Task 035` `GitRunner` to `safety-scan`, `snapshots`, `worktrees`, and `refs`, and back `RefLeaseStateDb` onto `@ef-harness/db` (`leases` table in `state.db`) without rogue `CREATE TABLE ref_leases` or second writer connections.

**Dependencies:** `F-001`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/git-engine test && pnpm --filter @ef-harness/git-engine typecheck`

**Integration priority:** Wave C04 (`git-engine` & `sandbox`).

---

#### F-018 — CRITICAL SECURITY DEFECT: `HarnessRunEngine` (`Task 047`) executes commands unsandboxed under the developer's token via `NestedCommandJobManager` + `WarmExecutionPool` while falsely reporting `tier: "C"`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** ARCHITECTURE_VIOLATION

**Affected units:** `Task 040` (`sandbox/job-objects`), `Task 041` (`sandbox/tier-a-mxc`), `Task 042` (`sandbox/tier-b-users`), `Task 043` (`sandbox/tier-c-d-selector`), `Task 047` (`sandbox/harness-run`), `Task 048` (`mcp-server`), `Task 060` (`verifier`).

**Files and symbols:** `packages/sandbox/src/harness-run/engine.ts:78-82,186-220` (`HarnessRunEngine`), `packages/sandbox/src/harness-run/pool.ts:17-33` (`WarmExecutionPool`), `packages/sandbox/src/harness-run/job-host.ts:110-128` (`NestedCommandJob`), `packages/sandbox/src/tier-c-d-selector/selector.ts:101-180` (`SandboxTierSelector`), `packages/sandbox/src/tier-a-mxc/policy.ts:99-123` (`compileMxcPolicy`).

**Actual implementation:**
1. `HarnessRunEngine` (`engine.ts:79-81`) defaults `this.selector` to `new WarmExecutionPool()` (`pool.ts:27-32`) which is purely an in-memory counting semaphore hardcoded to `{ tier: "C", mode: "own_loop" }`, and defaults `this.jobs` to `new NestedCommandJobManager()` (`job-host.ts`), which compiles a C# Job Object wrapper via `powershell.exe Add-Type` and spawns `job-host.exe` **directly under the developer's full OS user token** with zero MXC container (`TierAMxcProvider`), zero sandbox user (`TierBSandboxUsersProvider`), zero write-restricted token (`TierCRestrictedTokenProvider`), and zero Docker isolation (`TierDContainerProvider`), while returning `{ tier: "C" }` in `SandboxedCommandResult`!
2. Even if a caller attempts to wire `Task 043`'s real `SandboxTierSelector` (`tier-c-d-selector/selector.ts:101`) into `HarnessRunEngine`, their interfaces are completely disjoint: `Task 047`'s `SandboxTierSelector` (`harness-run/types.ts:71-76`) has `{ acquire({ priority, attemptId }): Promise<ExecutionSlot> }`, whereas `Task 043`'s `SandboxTierSelector` has `{ resolve({ task, runtime, command }): Promise<ResolveDecision> }`! Likewise `WindowsJobManager` has 4 incompatible definitions across `job-objects`, `tier-a-mxc`, `tier-c-d-selector`, and `harness-run`!
3. Furthermore, `compileMxcPolicy` (`tier-a-mxc/policy.ts:120-122`) throws `MxcPolicyPathError("build_output_is_worktree")` if `buildOutputDir === worktree`, and if `HarnessRunEngine.run` fails between `this.selector.acquire()` (`line 186`) and `this.jobs.createJob()` (`line 191`), check whether `slot.release()` is inside `finally` (if `createJob` throws before `try` on line 197, `slot.release()` is skipped, permanently leaking the warm pool slot!).

**Required architecture:** `sandbox-and-security.md` ("No silent unsandboxed fallback; honest tier reporting") and `execution-capacity.md` require `HarnessRunEngine` (`harness.run`) to acquire a warm pool slot AND dispatch command execution through the active `SandboxTierProvider` selected by `SandboxTierSelector` (Tier A MXC → Tier B Sandbox Users → Tier D Container → Tier C Write-Restricted Token only when task `touches` are Tier-C-eligible, otherwise holding the task), inside a `WindowsJobManager` Job Object, releasing the warm pool slot in `finally` on every exit path, and recording `@ef-harness/db` artifacts/telemetry/redactions rather than temp-dir stubs.

**Evidence:** `packages/sandbox/src/harness-run/engine.ts:79-82,186-197` (`slot = await this.selector.acquire(...)` at line 186 BEFORE `try {` at line 197; `job.run(...)` runs `job-host.exe` unsandboxed under current user token); `packages/sandbox/src/harness-run/pool.ts:28-30` (`this.tier = options.tier ?? "C"`).

**Why this is a defect:** Worker and verifier commands executed via `HarnessRunEngine` have full read/write access to the developer's home directory, SSH/cloud credentials, and raw outbound sockets while stamping receipts as `tier: "C"`, violating the core sandbox invariant, and any error in `createJob` leaks warm pool capacity.

**Required correction:** Unify `WindowsJobManager` (onto `Task 040`) and wire `HarnessRunEngine` (`Task 047`) to resolve isolation through `Task 043`'s `SandboxTierSelector` + Tier A/B/C/D providers (`041`–`043`), move `const job = this.jobs.createJob(...)` inside `try { ... } finally { slot.release(); }` so slots never leak, allow `buildOutputDir` inside a subdirectory (`.harness-build` or worktree dist) in `compileMxcPolicy`, and wire `HarnessRunEngine` artifact/tracer/redactor ports to `@ef-harness/db` and `@ef-harness/shared-observability`.

**Dependencies:** `F-001`, `F-003`, `F-011`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/sandbox test && pnpm --filter @ef-harness/sandbox typecheck`

**Integration priority:** Wave C04 (`git-engine` & `sandbox`).

---

#### F-019 — `SecureDocFetcher` (`Task 045`) expects `AllowlistProxyServer.fetch(...)` which `AllowlistProxyServer` (`Task 044`) does not implement

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 044` (`packages/sandbox/src/proxy/allowlist-proxy-server.ts`), `Task 045` (`packages/sandbox/src/doc-fetcher/proxy.ts`, `secure-doc-fetcher.ts`), `Task 014` (`GlobalBrokerDb` `research_cache`), `Task 028` (`CasBlobStore`).

**Files and symbols:** `packages/sandbox/src/doc-fetcher/proxy.ts:24-26` (`AllowlistProxyServer { fetch(request: AllowlistProxyRequest): Promise<AllowlistProxyResponse> }`), `packages/sandbox/src/proxy/allowlist-proxy-server.ts:123` (`AllowlistProxyServer` loopback HTTP/CONNECT proxy server).

**Actual implementation:** `Task 045` (`SecureDocFetcher`) defines a local `AllowlistProxyServer` port interface with a single in-process method `fetch(request: AllowlistProxyRequest): Promise<AllowlistProxyResponse>` and defaults to `DirectResearcherAllowlistProxy` (which connects directly to upstream sockets without going through `Task 044`'s proxy server, token registration, rate/byte budgets, or `ProxyAuditLog`). Meanwhile `Task 044`'s real `AllowlistProxyServer` is a loopback HTTP/HTTPS `CONNECT` proxy (`registerAttempt`, `listen`, `close`) with no `.fetch(...)` method!

**Required architecture:** `sandbox-and-security.md` and `tech-stack-and-research.md` require `fetch_docs` (`SecureDocFetcher`) to route outbound documentation HTTP(S) requests through `Task 044`'s loopback `AllowlistProxyServer` under the `"researcher"` profile (with per-attempt proxy token authentication, DNS-pinning SSRF checks, secret scanning, and `ProxyAuditLog`), storing fetched blobs in `Task 028` `CasBlobStore` (`holderKind: "research"`) and caching entries in `Task 014` `GlobalBrokerDb` (`research_cache`).

**Evidence:** `packages/sandbox/src/doc-fetcher/proxy.ts:24-26` vs `packages/sandbox/src/proxy/allowlist-proxy-server.ts:123-138`.

**Why this is a defect:** Passing `Task 044`'s `AllowlistProxyServer` to `SecureDocFetcher` fails TypeScript compilation and runtime invocation (`proxy.fetch is not a function`), and leaving `DirectResearcherAllowlistProxy` active bypasses `AllowlistProxyServer` attempt fencing, byte caps, and audit logging.

**Required correction:** Add a `createResearcherProxyClient(proxyServer: AllowlistProxyServer, attemptToken): DocFetcherAllowlistProxyServer` adapter (or `.fetch()` method on `AllowlistProxyServer`) routing `AllowlistProxyRequest` through the live loopback `AllowlistProxyServer` with `"researcher"` profile registration, and bind `SqliteResearchCacheStore` / `CasBlobStore` to `@ef-harness/db`.

**Dependencies:** `F-001`, `F-011`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/sandbox test`

**Integration priority:** Wave C04 (`git-engine` & `sandbox`).

---

#### F-020 — `KernelPackageInstaller` (`Task 046`) hand-splices invalid synthetic lockfile text before running `--frozen-lockfile`, breaking real `pnpm` / `npm` / `yarn` dependency additions

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 046` (`packages/sandbox/src/installer/installer.ts`, `commands.ts`), `Task 110` (`packages/integrator` dependency reconciliation).

**Files and symbols:** `packages/sandbox/src/installer/installer.ts:139-143,169-175,328-352,474-552` (`addApprovedDependency`, `applyReconciledIntents`, `installBody`, `writeDependencyUpdate`, `insertPnpmPackages`).

**Actual implementation:** When adding an approved dependency (`addApprovedDependency` or `applyReconciledIntents`), `writeDependencyUpdate` (`installer.ts:474-497`) updates `package.json` `dependencies` and then manually splices a partial text stub (`'pkg@1.0.0':\n  resolution: {integrity: ...}`) under `packages:` in `pnpm-lock.yaml` **without** updating `importers:` (or transitive dependency edges), and immediately invokes `installBody()` which runs `pnpm install --frozen-lockfile` (`commands.ts`) and asserts `hashFile(lockfilePath) === before`! Real `pnpm install --frozen-lockfile` fails immediately with `ERR_PNPM_OUTDATED_LOCKFILE` because `package.json` `dependencies` no longer matches `pnpm-lock.yaml`'s `importers` section!

**Required architecture:** `sandbox-and-security.md` and `build-pipeline.md` specify two distinct installer modes:
1. **Locked install (`installLockedDependencies`)**: runs `--frozen-lockfile` (`npm ci` / `pnpm install --frozen-lockfile` / `yarn install --immutable`) and asserts zero lockfile mutation (`hashFile(lockfilePath) === before`).
2. **Kernel dependency resolution (`addApprovedDependency` / `applyReconciledIntents`)**: after supply-chain vetting (`vetDependencyIntent`, typosquat, license, age, advisory, lifecycle script approval), runs the package manager's lockfile-resolution step (`--lockfile-only` / controlled resolution through `kernel_installer` proxy with `ignore-scripts=true`), then runs `verifyLockfileIntegrity(lockfilePath)` on the newly resolved lockfile, and finally runs the frozen install!

**Evidence:** `packages/sandbox/src/installer/installer.ts:139-143,339-352,474-523` (`insertPnpmPackages` only inserts into `packages:` without `importers:`, followed by `--frozen-lockfile` in `installBody`).

**Why this is a defect:** `addApprovedDependency` and `applyReconciledIntents` only pass in unit tests that mock `jobRunner.runCommand` (`exitCode: 0`) and fail 100% of the time when invoked against the real `pnpm` CLI!

**Required correction:** In `addApprovedDependency` and `applyReconciledIntents`, update `package.json`, invoke the package manager's lockfile resolution (`--lockfile-only --ignore-scripts`) via `jobRunner` through `AllowlistProxyServer` (`kernel_installer`), re-verify `verifyLockfileIntegrity(lockfilePath)` + lifecycle script approvals on all newly resolved transitive packages, and then run `installBody()` (`--frozen-lockfile` + `hashFile(lockfilePath) === before`).

**Dependencies:** `F-018`, `F-019`.

**Verification:** `pnpm --filter @ef-harness/sandbox test`

**Integration priority:** Wave C04 (`git-engine` & `sandbox`).

---

#### F-021 — Uncommitted `task-048` bugfixes missing on `harness/integration` (`globMatch` zero-segment `**/`, `core.quotepath=false`, pull-quota token over-accounting, `shutdownReason`) plus `mcp-server` disconnected from `db`/`sandbox`/`test-env`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 048` (`packages/mcp-server` `f33144d` + uncommitted diff in `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server`), `Task 018` (`db/search`), `Task 023` (`db/holds`), `Task 045` (`sandbox/doc-fetcher`), `Task 047` (`sandbox/harness-run`), `Task 049` (`test-env/orchestrator`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/mcp-server/src/scope.ts:15-46` (`globMatch`, `readGitChangedPaths`), `packages/mcp-server/src/tools.ts:108-115,476-645` (`pullNode`, `TOOL_REGISTRATIONS`), `packages/mcp-server/src/server.ts:338-345` (`scheduleStop`), `packages/mcp-server/src/types.ts:138-180` (`AttemptMcpDependencies`).

**Actual implementation:**
1. On `harness/integration` (`30f2e9c`), `globMatch("src/**/index.ts", "src/index.ts")` and `globMatch("**/foo.ts", "foo.ts")` (`scope.ts:15-36`) return `false` because `/**/` required at least one intermediate path segment, rejecting valid in-scope candidate submissions!
2. `readGitChangedPaths` (`scope.ts:40-41`) runs `git diff` / `git ls-files` without `-c core.quotepath=false`, quoting non-ASCII paths and breaking write-scope checks.
3. `pullNode` and `kb.search`/`kb.neighbors`/`kb.why`/`kb.code` (`tools.ts:67-68,478-479,550-551,609-610,643-644`) call `ctx.commit(tool, Math.max(0, ctx.tokenBudget() - ctx.tokensUsed()))` when a pull exceeds remaining `kb_returned_tokens`, burning 100% of remaining token quota on a rejected pull so smaller subsequent `kb.get` calls also fail!
4. All 4 fixes sit uncommitted in `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server`.
5. `packages/mcp-server/package.json` depends only on `@ef-harness/shared-contracts`, defining local port interfaces (`KnowledgeSearchService`, `TaskHoldAndSubmissionRepo`, `HarnessRunEngine`, `SecureDocFetcher`, `StartService`) with no concrete adapter binding `@ef-harness/db`, `@ef-harness/sandbox`, `@ef-harness/git-engine`, and `@ef-harness/test-env`.

**Required architecture:** `agent-runtime-adapters.md`, `knowledge-database.md`, and `build-pipeline.md` require `AttemptMcpServer` to match `**/` zero-or-more path segments, preserve non-ASCII filenames, charge `0` returned tokens when refusing an over-budget pull, and bind directly to `ProjectDbBundle` (`SearchService`, `HoldRepo`, `TaskLeaseManager`, `ArtifactManager`), `HarnessRunEngine`, `SecureDocFetcher`, `SnapshotManager`, and `TestEnvOrchestrator`.

**Evidence:** `C:/Users/Ayush/Desktop/ef-wt/task-048-attempt-mcp-server` `git diff` on `packages/mcp-server/src/{scope.ts,server.ts,tools.ts}`; `packages/mcp-server/package.json:20-24`.

**Why this is a defect:** Valid candidate files at root segments (`src/index.ts` under `src/**/index.ts`) are rejected as out-of-scope, a single large `kb.search` exhausts the entire attempt's KB token quota, and no factory wires `AttemptMcpServer` to the real kernel engines.

**Required correction:** Apply the uncommitted `task-048` diff + tests, add `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, and `@ef-harness/test-env` dependencies to `packages/mcp-server/package.json`, and export `createKernelAttemptMcpDeps(...)` binding real engines to `AttemptMcpDependencies`.

**Dependencies:** `F-001`, `F-012`, `F-018`, `F-019`.

**Verification:** `pnpm --filter @ef-harness/mcp-server test && pnpm --filter @ef-harness/mcp-server typecheck`

**Integration priority:** Wave C05 (`test-env` & `mcp-server`).

---

#### F-022 — `packages/test-env` (`Tasks 049–052`) duplicates `DatabaseSync` connections on `global.db`/`state.db` and incompatible `WindowsJobManager` / `ServiceProvider` contracts

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 049` (`test-env/orchestrator`), `Task 050` (`test-env/services`), `Task 051` (`test-env/auth-payment-mocks`), `Task 052` (`test-env/synthetic-data`), `Task 013`–`Task 014` (`packages/db`), `Task 040` (`sandbox/job-objects`).

**Files and symbols:** `packages/test-env/src/index.ts:36-41,83,200-209,264` (`SqliteEnvProcessStore`, `SqlitePortLeaseStore`, `openGlobalDatabase`, `openStateDatabase`, 3 `ServiceProvider` interfaces, 2 `WindowsJobManager` interfaces), `packages/test-env/package.json:21-24`.

**Actual implementation:**
1. `packages/test-env` does not depend on `@ef-harness/db` or `@ef-harness/sandbox`. `openGlobalDatabase` and `openStateDatabase` (`orchestrator/ports.ts` & `processes.ts`, plus `SqliteGlobalResourceLeaseStore` in `auth-payment-mocks/resource-lease-store.ts`) open raw independent `DatabaseSync` writers on `global.db` and `state.db`, colliding with `GlobalBrokerDb` and `ProjectStateDb` writer locks and triggering `ProjectSafeModeError("foreign_write")`!
2. Inside `packages/test-env`, `orchestrator` (`Task 049`), `services` (`Task 050`), and `auth-payment-mocks` (`Task 051`) each define their own `ServiceProvider` interface (`ServiceProvider` vs `ServicesServiceProvider` vs `AuthPaymentMocksServiceProvider`) and `WindowsJobManager` (`WindowsJobManager` vs `ServicesWindowsJobManager` vs `Task 040`'s `WindowsJobManager`)!

**Required architecture:** `test-environments.md` and `database-design.md` require `TestEnvOrchestrator` to lease ports (`port_leases`) via `GlobalBrokerDb`, track `env_processes` via `ProjectStateDb` / `CoordinatorWriteQueue`, place service child processes in `Task 040`'s `WindowsJobManager`, and register all backing services (`EmbeddedPostgresProvider`, `SqliteEnvProvider`, `RedisCompatibleProvider`, `MailpitProvider`, `LocalObjectStorageProvider`, `HttpRecordReplayProvider`, `LocalOAuthMockProvider`, `StripeMockAndWebhookProvider`) into `ServiceProviderRegistry` without type shims or rogue DB connections.

**Evidence:** `packages/test-env/src/index.ts:36-40,77,83,200,208,264`; `packages/test-env/package.json:21-24`.

**Why this is a defect:** Starting a test environment while `ProjectStateDb` is open mutates `state.db` from a foreign `DatabaseSync` connection (forcing `state.db` into `foreign_write` safe mode!), and `Task 050`/`051` service providers cannot register directly into `Task 049`'s `ServiceProviderRegistry` without adapters.

**Required correction:** Add `@ef-harness/db` and `@ef-harness/sandbox` dependencies to `packages/test-env/package.json`, unify `ServiceProvider` + `WindowsJobManager` adapters across `orchestrator`/`services`/`auth-payment-mocks`/`synthetic-data` (`createDefaultTestEnvOrchestrator`), and back `PortLeaseStore`, `EnvProcessStore`, and `GlobalResourceLeaseStore` onto `GlobalBrokerDb` and `ProjectDbBundle` instead of raw `DatabaseSync` files.

**Dependencies:** `F-001`, `F-012`, `F-018`.

**Verification:** `pnpm --filter @ef-harness/test-env test && pnpm --filter @ef-harness/test-env typecheck`

**Integration priority:** Wave C05 (`test-env` & `mcp-server`).

---

#### F-023 — Uncommitted bugfixes in `packages/worker-loop` (`task-053`, `task-056`, `task-057`) missing on `harness/integration` (429 `insufficient_quota` misclassification, assistant-text `cost` regex injection, Responses reasoning/tool ordering, CRLF `rangeHash` mismatch, `.GIT` case bypass, `unknown_timeout` crash vs reconciliation, `replace_lines` gate, and `no_progress` spiral bypass)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** LOCAL_DEFECT

**Affected units:** `Task 053` (`task-053-worker-loop-provider-protocols`), `Task 055` (`read-tools`), `Task 056` (`task-056-worker-loop-edit-applier`), `Task 057` (`task-057-worker-loop-executor-checkpoints`), `harness/integration` (`30f2e9c`).

**Files and symbols:**
- `packages/worker-loop/src/protocols/errors.ts:128-132` (`classifyKind`)
- `packages/worker-loop/src/protocols/openai-compatible-chat.ts:143-148,215-235` (`ChatTranslator`, `usageFromChat`)
- `packages/worker-loop/src/protocols/openai-responses.ts:75-120,197-345` (`prepareOpenAIResponses`, `OpenAIResponsesTranslator`)
- `packages/worker-loop/src/protocols/profiles.ts:54-63` (`canAssignCodingTask`)
- `packages/worker-loop/src/edits/dispatcher.ts:158-162`, `edits/parse-apply-patch.ts:137-145`, `edits/paths.ts:15-80`, `edits/text.ts:104-110`
- `packages/worker-loop/src/executor/guards.ts:50-75`, `executor/native-worker-loop.ts:210-226,310-390,458-555,728-760`.

**Actual implementation:** On `harness/integration` (`30f2e9c`), three worker-loop worktrees hold critical uncommitted bugfixes:
1. **`task-053` (`protocols`):** (a) `classifyKind` checks `status === 429` BEFORE `BILLING_CODES`, misclassifying OpenAI HTTP 429 `insufficient_quota` billing exhaustion as transient `rate_limit`! (b) `ChatTranslator` regex-scans raw SSE JSON (`/"cost"\s*:\s*(\d+...)/`) across assistant text deltas, letting model output text `{"cost": 999.5}` corrupt ledger USD cost! (c) `prepareOpenAIResponses` places encrypted `reasoning` replay items AFTER `function_call` or drops `function_call` item names when `response.output_item.added` precedes `delta`s, and emits duplicate `tool_call` events on `done` + `completed`. (d) `canAssignCodingTask` rejects `16k–32k` local models (`!profile.smallContext`) instead of checking `contextWindow >= 16_384`.
2. **`task-056` (`edits`):** (a) `hashLineRange` hashes raw `content.slice(...)` including `\r\n`, disagreeing with `WindowedFileReader`'s logical `\n`-joined `rangeHash` on CRLF files so `replace_lines` always fails with `StaleRangeHashError` on Windows CRLF files! (b) `parseOpenAiApplyPatch` strips `" "` single-space blank context lines (`hunkLine.trim() === ""`), corrupting patch hunks! (c) `resolveEditPath` checks case-sensitive `segments.includes(".git")` / `"node_modules"`, allowing `.GIT/config` and `Node_Modules/...` writes on case-insensitive Windows NTFS!
3. **`task-057` (`executor`):** (a) On `unknown_timeout` after request transmit, `NativeWorkerLoop` throws `CrashInjectedError` instead of `UnknownOutcomeReconciliationError`! (b) `NativeWorkerLoop` blocks `replace_lines` as disallowed even after `EditRecoveryTracker` unlocks it at step 3, and rethrows `NearestCandidateError`/`FreshRegionViewError`/`ReplaceLinesUnlockedError` instead of returning structured tool-error recovery turns! (c) Alternating `read_file` (`fingerprint === null`) with failing `harness.run` resets `streak` to `0` every other turn, defeating the 8-step `no_progress` spiral guard forever, and `countsAsFailedAttempt` was hardcoded `false` even on `stuck`!

**Required architecture:** `worker-loop-and-context.md`, `provider-connections.md`, `sandbox-and-security.md`, and `architecture-deep-review.md` require accurate `billing` vs `rate_limit` classification, structured `usage.cost` parsing, lossless OpenAI Responses encrypted reasoning + tool call streaming, case-insensitive `.git`/`node_modules` write protection on Windows, CRLF-preserving logical `rangeHash`, 4-step edit recovery ladder (`NearestCandidate` → `FreshRegionView` → `ReplaceLinesUnlocked` → `stuck`), `UnknownOutcomeReconciliationError` reservation holding, and tamper-proof `no_progress` spiral detection.

**Evidence:** Uncommitted `git diff` in `C:/Users/Ayush/Desktop/ef-wt/task-053-worker-loop-provider-protocols`, `task-056-worker-loop-edit-applier`, and `task-057-worker-loop-executor-checkpoints`.

**Why this is a defect:** Workers spin infinitely on `429 insufficient_quota` or alternating `read_file`+test loops, corrupt ledger spend when code mentions `"cost":`, fail all `replace_lines` edits on CRLF files, allow `.GIT/config` overwrites on Windows, and crash instead of stepping through the edit recovery ladder.

**Required correction:** Land all uncommitted bugfixes and regression tests from `task-053`, `task-056`, and `task-057` into `packages/worker-loop` (and export `UnknownOutcomeReconciliationError` from `packages/worker-loop/src/index.ts`), plus wire `NativeWorkerLoopDependencies` adapters onto `@ef-harness/db` (`BudgetLedgerRepo`, `TaskLeaseManager`, `ArtifactManager`), `@ef-harness/git-engine` (`SnapshotManager`), `@ef-harness/sandbox` (`HarnessRunEngine`), and `@ef-harness/mcp-server` (`AttemptMcpServer`).

**Dependencies:** `F-001`, `F-012`, `F-017`, `F-018`, `F-021`.

**Verification:** `pnpm --filter @ef-harness/worker-loop test && pnpm --filter @ef-harness/worker-loop typecheck`

**Integration priority:** Wave C06 (`worker-loop`, `completeness-gate`, `verifier`).

---

#### F-024 — Uncommitted bugfixes in `packages/completeness-gate` (`task-058`, `task-059`) missing on `harness/integration` (`return;` / `return false;` / `() => undefined` stubs, standalone dead `<button>`, ESM `.js`->`.ts` reachability, and integrator hunk-line bounds) plus internal `058`↔`059` AST port disconnect

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 058` (`task-058-static-audit-scanners-p1`), `Task 059` (`task-059-static-audit-scanners-p2`), `Task 017` (`db/registry`), `Task 036` (`git-engine/safety-scan`), `harness/integration` (`30f2e9c`).

**Files and symbols:** `packages/completeness-gate/src/ast-scanners/stubs.ts:59-75`, `ast-scanners/dead-controls.ts:113-165`, `gate/check-reachability.ts:334-345`, `gate/check-scope.ts:18-64`, `gate/local-ast-engine.ts`, `gate/ports.ts:41-88`.

**Actual implementation:**
1. On `harness/integration` (`30f2e9c`), `scanStubBodies` (`stubs.ts:60,72`) classifies `return;` as `"real"` instead of `"empty"`, and classifies `return false;` and `() => undefined` as `"real"` instead of `"constant"`, letting trivial stub functions slip straight past `STATIC_AUDIT`!
2. `dead-controls.ts:113` only checks `<button>` inside `<form>` and ignores standalone `<button type="button">Save</button>` with no `onClick`!
3. `check-reachability.ts:334-344` fails to strip `.js`/`.mjs`/`.cjs`/`.jsx` extensions when resolving NodeNext TypeScript imports (`import { x } from "./group.js"` -> `group.ts`), falsely flagging every ESM TypeScript module in EF Harness / target apps as unreachable dead code!
4. `check-scope.ts:24-26` allows an `integrator` actor to modify ANY line in a file that had a 1-line merge conflict instead of restricting edits to `[hunk.startLine, hunk.endLine]`.
5. Even inside `packages/completeness-gate`, `CompletenessGateRunner` (`gate/`) defaults to a simplified `createLocalStaticAuditAstEngine`, `createLocalNameRegistry`, and `createLocalGitSafetyScanner` instead of wiring `Task 058`'s full `StaticAuditAstEngine`, `Task 017`'s `NameRegistryService`, and `Task 036`'s `GitSafetyScanner`!

**Required architecture:** `completeness-gate.md` requires `STATIC_AUDIT` to block `return;` / `false` / `undefined` stubs on unexempted contracts, dead buttons inside and outside forms, ESM `.js`→`.ts` reachability, integrator edits outside conflict hunk line bounds, unregistered/foreign names via `NameRegistryService`, and leaked secrets/large files via `GitSafetyScanner`.

**Evidence:** Uncommitted `git diff` in `C:/Users/Ayush/Desktop/ef-wt/task-058-static-audit-scanners-p1` and `task-059-static-audit-scanners-p2`; `packages/completeness-gate/src/gate/ports.ts:1-88`.

**Why this is a defect:** Stubbed `return false` / `return;` functions and dead toolbar buttons pass `STATIC_AUDIT`, valid NodeNext `.js` imports fail `STATIC_AUDIT` reachability, and `CompletenessGateRunner` ignores `Task 058`'s AST engine, `db`'s `NameRegistryService`, and `git-engine`'s `GitSafetyScanner`.

**Required correction:** Apply the uncommitted `task-058` and `task-059` diffs and tests, wire `CompletenessGateRunner` by default to `Task 058`'s `StaticAuditAstEngine`, and export kernel adapters binding `@ef-harness/db` (`NameRegistryService`) and `@ef-harness/git-engine` (`GitSafetyScanner`).

**Dependencies:** `F-001`, `F-012`, `F-017`.

**Verification:** `pnpm --filter @ef-harness/completeness-gate test && pnpm --filter @ef-harness/completeness-gate typecheck`

**Integration priority:** Wave C06 (`worker-loop`, `completeness-gate`, `verifier`).

---

#### F-025 — Uncommitted security & correctness bugfixes in `packages/verifier` (`task-061`, `062`, `063`, `064`, `066`) missing on `harness/integration` plus 3 incompatible `SurfaceVerifierAdapter` interfaces inside `packages/verifier`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** LOCAL_DEFECT

**Affected units:** `Task 060` (`verifier/runner`), `Task 061` (`task-061-red-before-green-blind-binder`), `Task 062` (`task-062-ui-interaction-contract-verifier`), `Task 063` (`task-063-multi-surface-verifiers`), `Task 064` (`task-064-ai-eval-property-mutation-probes`), `Task 065` (`verifier/hint-ladder`), `Task 066` (`task-066-candidate-acceptance-tx`), `harness/integration` (`30f2e9c`).

**Files and symbols:**
- `packages/verifier/src/binder/adapter-audit.ts:75,160-210` & `binder/containment.ts:4-110` (`task-061`)
- `packages/verifier/src/ui-contract/verifier.ts:459-555` (`task-062`)
- `packages/verifier/src/surfaces/migration-preservation-verifier.ts:90,176-205` (`task-063`)
- `packages/verifier/src/advanced/boundary-mutation-prober.ts:254-360` (`task-064`)
- `packages/verifier/src/acceptance/coordinator.ts:664-755` & `rule-scope.ts:31-35` (`task-066`)
- `packages/verifier/src/index.ts:72,199,267,334` (4 incompatible `SurfaceVerifierAdapter` interfaces!).

**Actual implementation:**
1. **`task-061` (Blind Binder escape):** On `harness/integration`, `auditBinderAdapter` permits `await import("../src/internal")` and undeclared `require("../src/internal")` in blind-binder adapters, and `applyBinderWrites` / `isBinderPath` lacks `hasUnsafePath` checks against `.harness-binder/../../src/evil.ts` or `C:\...` paths, allowing a blind binder to overwrite product files!
2. **`task-062` (UI Verifier crash miss):** `UiInteractionContractVerifier` checks `pageErrors`/`consoleErrors` only before pointer actions and misses unhandled exceptions thrown inside `click` handlers (`postActionCrash`)!
3. **`task-063` (Migration Verifier):** `MigrationPreservationVerifier` lacks `allowCleanRefusalOnRerun` integrity verification when guarded migrations cleanly refuse duplicate re-runs without mutating data.
4. **`task-064` (Mutation Prober):** `TargetedBoundaryMutationProber`'s `drop_role_guard` operator replaces `if (user.role !== "admin") { return []; }` with `return [];` (making the function *always* deny instead of dropping the guard to `{}`!), producing an equivalent/broken mutant instead of testing unauthorized access!
5. **`task-066` (Transactional Acceptance):** `BUILTIN_CROSS_CUTTING_SCOPES["X-01"]` requires `all: ["authz", "route"]` (missing service-layer `authz` without `route`), and `promoteReceiptArtifacts` fails to promote `traceDigest`/`logDigest`/`observationsDigest` JSON-referenced blobs and `artifact_refs` linked rows from `diagnostic` to `evidence`!
6. **Intra-package `SurfaceVerifierAdapter` seam (`060` vs `062` vs `063` vs `064`):** `CleanVerifierRunner` (`runner/ports.ts:134-138`) defines `SurfaceVerifierAdapter { id; supports(check); collect(input): Promise<readonly SurfaceCheckResult[]> }`, whereas `UiInteractionContractVerifier` (`ui-contract`), `ApiContractVerifier`/etc. (`surfaces`), and `AiFeatureVerifier` (`advanced`) each define their own incompatible `SurfaceVerifierAdapter` (`verify(check, context)` vs `collect(input)`), so `062`, `063`, and `064` cannot even be registered on `060`'s `CleanVerifierRunner.registerSurfaceVerifier(...)`!

**Required architecture:** `verification-and-gates.md`, `completeness-gate.md`, and `database-design.md` require hermetic `.harness-binder/**` path/import containment, post-action crash failure attribution, true guard-dropping mutation probes, `X-01` firing on any `authz` touch, full evidence artifact promotion on `accept_submission`, and all surface verifiers (`UI`, `API`, `Auth`, `Webhook`, `Job`, `CLI`, `Migration`, `Time`, `Concurrency`, `RateLimit`, `AI`, `Property`, `Mutation`) plugging directly into `CleanVerifierRunner` and wired to `CompletenessGateRunner`, `WorktreeSlotManager`, `TestEnvOrchestrator`, `HarnessRunEngine`, and `ProjectDbBundle`.

**Evidence:** Uncommitted `git diff` in `C:/Users/Ayush/Desktop/ef-wt/task-061-*`, `task-062-*`, `task-063-*`, `task-064-*`, `task-066-*`; `packages/verifier/src/index.ts:72,199,267,334` (`SurfaceVerifierAdapter`, `UiContractSurfaceVerifierAdapter`, `SurfacesSurfaceVerifierAdapter`, `AdvancedSurfaceVerifierAdapter`).

**Why this is a defect:** Blind-binder path traversal can mutate product source, UI click-handler exceptions pass verification, role-guard mutants don't drop the guard, `traceDigest`/`logDigest` evidence gets garbage-collected after 14 days as `diagnostic`, and `CleanVerifierRunner` cannot invoke UI/API/CLI/Migration/AI surface verifiers!

**Required correction:** Land all 5 uncommitted worktree diffs (`task-061`, `062`, `063`, `064`, `066`) + tests, unify `SurfaceVerifierAdapter` across `runner`, `ui-contract`, `surfaces`, and `advanced` so `createFullCleanVerifierRunner(...)` registers all surface verifiers out of the box, and wire `CleanVerifierDeps` + `CandidateAcceptanceCoordinator` onto `@ef-harness/completeness-gate`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, `@ef-harness/test-env`, and `@ef-harness/db`.

**Dependencies:** `F-001`, `F-004`, `F-011`, `F-012`, `F-017`, `F-018`, `F-022`, `F-024`.

**Verification:** `pnpm --filter @ef-harness/verifier test && pnpm --filter @ef-harness/verifier typecheck`

**Integration priority:** Wave C06 (`worker-loop`, `completeness-gate`, `verifier`).

---

#### F-026 — `apps/daemon` (`Task 067`) bypasses `@ef-harness/db` and `@ef-harness/ipc`, violates SQLite outbox/schema invariants (`outbox_without_deliveries`, missing pragmas/`user_version`), and checks lock PIDs without Windows start-time verification

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** ARCHITECTURE_VIOLATION

**Affected units:** `Task 067` (`apps/daemon`), `Tasks 012–030` (`packages/db`), `Tasks 031–033` (`packages/ipc`), `Task 132` (`apps/daemon` lifecycle).

**Files and symbols:** `apps/daemon/package.json:20-22`, `apps/daemon/src/bootstrap/daemon-server.ts:93-205,342-552,745-752` (`HarnessDaemon`, `acquireLock`, `insertEvent`, `credit`, `alive`), `apps/daemon/src/bootstrap/databases.ts:54-93` (`openWriter`, `splitWords`).

**Actual implementation:**
1. `apps/daemon/package.json` depends ONLY on `@ef-harness/shared-contracts` — it never imports `@ef-harness/db` or `@ef-harness/ipc`, duplicating its own `FrameCodec`, `SimulatedTask`, raw `DatabaseSync` opener, and custom RPC switch!
2. `insertEvent()` (`daemon-server.ts:533-551`) inserts into `outbox` outside `BEGIN IMMEDIATE` and **never inserts into `outbox_deliveries`**, immediately violating the `outbox_without_deliveries` invariant in `schema/queries.sql`!
3. `databases.ts:54-73` omits `PRAGMA journal_size_limit = 67108864`, `PRAGMA temp_store = MEMORY`, `PRAGMA user_version = 1`, `device_id`, and `project_runtime` singleton initialization, and registers the broken 2-regex `splitWords` (`lines 89-93`) instead of `splitSearchText`.
4. `acquireLock()` (`daemon-server.ts:194-204,745-752`) writes bare `process.pid` to a lockfile and probes `process.kill(pid, 0)` without recording or checking `(pid, processStartTime)` — on Windows PID reuse, `harnessd` falsely refuses to start with `PipeInUseError`!
5. `credit()` (`daemon-server.ts:490-504`) expects `{ streamId, chunks }` instead of canonical `{ stream_id, credits }`, and `server.listen(pipePath)` (`line 222`) does not apply Windows Named Pipe per-user SID DACL (`Task 031` `NamedPipeServer`).

**Required architecture:** `desktop-app.md`, `coordinator-and-recovery.md`, `kernel-schema-and-protocol.md`, and `database-design.md` require `harnessd` (`apps/daemon`) to open `GlobalBrokerDb` and `ProjectStateDb` (`ProjectDbBundle` + `MigrationRunner`) from `@ef-harness/db`, bind `NamedPipeServer` (with current-user SID DACL), `SessionTokenStore`, `RpcRouter`, `CoordinatorWriteQueue`, `EventSubscriptionServer`, `SnapshotAssembler`, and `BinaryStreamManager` from `@ef-harness/ipc`, register `outbox_deliveries` atomically with every `outbox` row, and verify `(pid, processStartTime)` on lock ownership.

**Evidence:** `apps/daemon/package.json:20-22`; `apps/daemon/src/bootstrap/daemon-server.ts:194-204,490-504,533-551,745-752`; `apps/daemon/src/bootstrap/databases.ts:54-73`.

**Why this is a defect:** `harnessd` corrupts `state.db` outbox invariants (`outbox_without_deliveries` non-empty), rejects `ProjectStateDb` opens (`user_version === 0`), exposes pipes without Task 031's Windows ACL hardening, fails on Windows PID reuse, and serves only hardcoded M1 mock methods instead of the 29 kernel RPC methods.

**Required correction:** Rewire `apps/daemon` onto `@ef-harness/db` (`GlobalBrokerDb`, `ProjectDbBundle`, `MigrationRunner`, `RecoveryEngine`) and `@ef-harness/ipc` (`NamedPipeServer`, `SessionTokenStore`, `RpcRouter`, `EventSubscriptionServer`, `SnapshotAssembler`, `BinaryStreamManager`), preserving M1 bootstrap compatibility while honoring all SQLite/outbox/ACL/PID-start-time invariants.

**Dependencies:** `F-006`, `F-009`, `F-012`, `F-013`, `F-014`, `F-015`.

**Verification:** `pnpm --filter @ef-harness/daemon test && pnpm --filter @ef-harness/daemon typecheck`

**Integration priority:** Wave C11 (`apps/daemon` & `apps/desktop` full integration).

---

#### F-027 — `apps/desktop` `pipe-client.ts` (`Task 067`) corrupts/duplicates framed bytes after `session.hello` and overwrites a single `renderer` `MessagePort`, breaking multi-window / pop-out bridges

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 067` (`apps/desktop/src/bootstrap/pipe-client.ts`), `Task 031` (`packages/ipc/src/transport/message-port-bridge.ts`), `Task 123` (`apps/desktop` & `apps/renderer` pop-out windows).

**Files and symbols:** `apps/desktop/src/bootstrap/pipe-client.ts:17,73-94,136-160` (`bindRenderer`, `connect`), `packages/ipc/src/transport/message-port-bridge.ts` (`MessagePortBridge`).

**Actual implementation:**
1. `pipe-client.ts` bypasses `@ef-harness/ipc` (`NamedPipeClient` + `MessagePortBridge`) and stores `let renderer: PortLike | null = null` (`line 17, 74`): attaching a second window or pop-out window (`Task 123`) silently overwrites `renderer`, orphaning the main window's `MessagePort`!
2. In `next.on("data")` (`lines 146-158`), when the `session.hello` reply arrives in the same chunk as subsequent frames or a partial frame: (a) `const pending = localCodec.takePending(); if (pending.byteLength > 0) forward(pending)` (`lines 149-150`) strips incomplete half-frame bytes out of `localCodec` and forwards raw unframed/partial bytes before the complete frames that preceded them! (b) `lines 154-157` then iterate `frames` AFTER `pending` was already forwarded, and for `frame.channel !== 0` execute `forward(chunk)` — forwarding the ENTIRE raw TCP/pipe `chunk` (including the `session.hello` response and all other frames) once per binary frame!

**Required architecture:** `kernel-schema-and-protocol.md:72-80,124` ("Two windows open the same project: Both subscribe... The renderer never blocks on the pipe: a utility process owns the connection and hands the renderer a `MessagePort`, transferring binary data without copying") requires the utility process to multiplex/bridge per-window `MessagePort` sessions cleanly via `@ef-harness/ipc` (`NamedPipeClient` + `MessagePortBridge`) without corrupting partial frames or duplicating binary chunks.

**Evidence:** `apps/desktop/src/bootstrap/pipe-client.ts:17,74,149-157`.

**Why this is a defect:** Any coalesced pipe read containing `session.hello` + an event batch or binary chunk delivers out-of-order truncated bytes and duplicated chunks to the renderer, and opening any pop-out window disconnects the primary window.

**Required correction:** Replace `apps/desktop`'s ad-hoc `pipe-client.ts` framing/single-port global with `@ef-harness/ipc`'s `NamedPipeClient` + multi-port `MessagePortBridge` (supporting one dedicated pipe session per attached renderer `MessagePort` so multiple windows subscribe independently without frame corruption).

**Dependencies:** `F-006`, `F-014`, `F-026`.

**Verification:** `pnpm --filter @ef-harness/desktop test && pnpm --filter @ef-harness/daemon test`

**Integration priority:** Wave C11 (`apps/daemon` & `apps/desktop` full integration).

---

#### F-028 — `tests/e2e` M1 Exit Gate (`Task 068`) runs a self-contained mock script instead of exercising the real M1 packages (`db`, `git-engine`, `sandbox`, `test-env`, `mcp-server`, `worker-loop`, `completeness-gate`, `verifier`)

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** TEST_GAP

**Affected units:** `Task 068` (`tests/e2e`), `Tasks 012–067`.

**Files and symbols:** `tests/e2e/package.json:20-22`, `tests/e2e/m1-exit-gate/pipeline.ts:1-120` (`PIPELINE_STAGES`).

**Actual implementation:** `tests/e2e/package.json` depends only on `@ef-harness/shared-contracts`. `tests/e2e/m1-exit-gate/pipeline.ts` defines a string constant `PIPELINE_STAGES = ["claimTask", "WorktreeSlotManager", ...]` and implements its own standalone SQLite queries, inline string `.split(needle).join("[redacted]")` redactor, custom check runner, and custom static audit check in 1,359 lines without importing a single class from `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, `@ef-harness/test-env`, `@ef-harness/mcp-server`, `@ef-harness/worker-loop`, `@ef-harness/completeness-gate`, or `@ef-harness/verifier`!

**Required architecture:** `roadmap.md` (Milestone M1 Exit Gate) and `IMPLEMENTATION_TASKS.md` (`Task 068`) require the M1 20-task Kitchen-Prep end-to-end exit gate (`K01`–`K20`, 4 adversarial bad candidates, 7 red-team escape probes) to drive the **actual integrated M1 pipeline** (`TaskLeaseManager` → `WorktreeSlotManager` → `TestEnvOrchestrator` → `NativeWorkerLoop` + `AttemptMcpServer` + `HarnessRunEngine` → `CompletenessGateRunner` → `CleanVerifierRunner` → `CandidateAcceptanceCoordinator` → `HarnessDaemon`).

**Evidence:** `tests/e2e/package.json:20-22`; `tests/e2e/m1-exit-gate/pipeline.ts:1-32,99-115` (zero `@ef-harness/*` imports).

**Why this is a defect:** `tests/e2e/tests/m1-exit-gate.test.ts` passes (`20/20`) even when every M1 package (`sandbox`, `mcp-server`, `worker-loop`, `completeness-gate`, `verifier`, `daemon`) is completely disconnected or broken!

**Required correction:** Add `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, `@ef-harness/test-env`, `@ef-harness/mcp-server`, `@ef-harness/worker-loop`, `@ef-harness/completeness-gate`, `@ef-harness/verifier`, and `@ef-harness/daemon` to `tests/e2e/package.json` and wire `tests/e2e/m1-exit-gate/pipeline.ts` to execute `K01`–`K20`, the 4 adversarial candidates, and the 7 red-team probes through the real integrated M1 classes.

**Dependencies:** `F-017` through `F-027`.

**Verification:** `pnpm --filter @ef-harness/e2e test`

**Integration priority:** Wave C06 / Wave C15 (E2E certification).

---

#### F-029 — `packages/discovery` (`Tasks 069–074`) splits into 6 disconnected intra-package silos with incompatible `decision` `fields` JSON schemas, sync-vs-async model/session contracts, and zero `@ef-harness/db` wiring

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 069` (`packages/discovery/src/core`), `Task 070` (`packages/discovery/src/prompts`), `Task 071` (`packages/discovery/src/entailment`), `Task 072` (`packages/discovery/src/selector`), `Task 073` (`packages/discovery/src/depth`), `Task 074` (`packages/discovery/src/readiness`), `Task 017` (`packages/db/src/knowledge`), `Task 053` (`packages/worker-loop/src/protocols`).

**Files and symbols:** `packages/discovery/package.json:20-22`, `packages/discovery/src/core/decision-fields.ts:15-36,74-147,167-188` (`DecisionFields`, `parseDecisionFields`, `decisionToJson`), `packages/discovery/src/core/session-manager.ts:182-200,395-436` (`DiscoverySessionManager.send`), `packages/discovery/src/prompts/discovery-prompt-orchestrator.ts:142-225` (`DiscoveryPromptOrchestrator`), `packages/discovery/src/entailment/semantic-entailment-gate.ts:48-60,167-228` (`SemanticEntailmentGate`), `packages/discovery/src/depth/stage-depth-controller.ts:17-74` (`StageDepthController`), `packages/discovery/src/readiness/sql.ts:12-47,363-372` (`CLASSIFIED`, `listFeatureIds`), `packages/discovery/src/readiness/graph.ts:61-69,111-138` (`hashNode`, `patchNodeFields`).

**Actual implementation:**
1. `packages/discovery/package.json` depends only on `@ef-harness/shared-contracts`, and none of the 6 submodules (`core`, `prompts`, `entailment`, `selector`, `depth`, `readiness`) import each other: they define 4 incompatible DB ports (`core/KnowledgeGraphRepo`, `entailment/KnowledgeGraphPort`, `depth/DecisionStore`, and raw `DatabaseSync` in `readiness`), plus local stand-ins (`DeterministicOpeningReviewer`, `LocalExactQuoteEvidenceVerifier`, `LocalGreedyQuestionSelector`, `LocalPremiseSupersessionReopener`).
2. **Incompatible `nodes.fields` JSON contract for `kind = 'decision'`:**
   - `core/decision-fields.ts` (`parseDecisionFields` / `decisionToJson`) requires `evidence[].rubricId` & `evidence[].turnId` (`lines 167-188`) and strips ALL keys outside `{ criterion, status, value, basis, delegation, question_id, options, options_version, acceptance_examples, evidence, needs_confirmation, work_item }` (`lines 129-147`). Reading a `decision` node written by `prompts` (`evidence[].turn`), `entailment` (`evidence[].turnId` without `rubricId`), `depth`, or `readiness` throws `BasisStatusSeparationError("evidence span is incomplete")` or silently erases `must_ask`, `scopeId`, `deferred_reason`, `revisit_wave`, `delegated_at`, `stage_at_delegation`, `recommended_option_id`, `rationale`, `rule`, `premises`, and `entailmentVerdict` on update!
   - `entailment/semantic-entailment-gate.ts:203-206` writes camelCase `mustAsk` and `feature`, whereas `readiness/sql.ts:20,27` queries `json_extract(n.fields, '$.must_ask')` and `n.fields ->> '$.scopeId'` (and `$.workItem` vs `core`'s `work_item`), causing `ReadinessCalculator` to misclassify `entailment`-persisted must-ask decisions as non-must-ask (`must_ask = 0`) and miss scope filtering!
   - `readiness/graph.ts:61-69` computes bare hex SHA-256 over `{ kind, title, text, fields }` instead of `Task 007`/`017` canonical `computeNodeContentHash`.
3. **Sync vs Async Execution Mismatch:** `DiscoverySessionManager.send()` (`069`) and `SemanticEntailmentGate.checkAll()` (`071`) are synchronous, whereas `DiscoveryPromptOrchestrator` (`070`) and `ModelProtocolAdapter.complete()` (`053`) are `async` (`Promise`-returning).

**Required architecture:** `project-discovery.md`, `opening-prompts.md`, `discovery-depth-and-catalog.md`, and `database-design.md` require ONE unified discovery pipeline over `packages/db` `KnowledgeGraphRepo` (`Task 017`) where explicit Send runs long-turn chunking (`069`) → prompt orchestration & quote verification (`070`) → cross-chunk retraction & independent `entailment-checker@1` (`071`) → stage depth / `ask_value` / must-ask floor (`073`) → greedy next-batch selection (`072`) → SQL readiness & handoff gate (`074`), sharing a single canonical `DecisionNodeFields` schema.

**Evidence:** `packages/discovery/src/core/decision-fields.ts:129-188`; `packages/discovery/src/entailment/semantic-entailment-gate.ts:167-212`; `packages/discovery/src/readiness/sql.ts:19-28,367`.

**Why this is a defect:** Running an actual discovery turn across `069→070→071→072→073→074` cannot execute async model calls, throws `BasisStatusSeparationError` on batch/entailment evidence, loses must-ask/deferral/delegation fields on node updates, and miscounts must-ask readiness in SQL.

**Required correction:** Add `@ef-harness/db` and `@ef-harness/worker-loop` to `packages/discovery/package.json`; freeze one canonical `DecisionNodeFields` schema (preserving snake_case `must_ask`, `work_item`, `scope_id`, `deferred_reason`, `revisit_wave`, `delegated_at`, `stage_at_delegation`, `recommended_option_id`, `rationale`, `rule`, `premises`, `entailment_verdict` and optional `rubric_id` on evidence spans); make `SemanticEntailmentGate.checkAll`/`check` and `DiscoverySessionManager.sendAsync` async; and wire `069–074` onto `@ef-harness/db`'s `KnowledgeGraphRepo` + `SqliteConnection`.

**Dependencies:** `F-001`, `F-005`, `F-010`, `F-012`, `F-023`.

**Verification:** `pnpm --filter @ef-harness/discovery test && pnpm --filter @ef-harness/discovery typecheck`

**Integration priority:** Discovery integration tasks (Wave M2 Discovery).

---

#### F-030 — `packages/discovery` `valueSatisfiesLimits` (`Task 069`) hardcodes only `sqlite`, rejecting all other bounded-delegation selections

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 069` (`packages/discovery/src/core`), `Task 073` (`packages/discovery/src/depth`).

**Files and symbols:** `packages/discovery/src/core/decision-fields.ts:199-207` (`VALUE_LIMIT_TAGS`, `valueSatisfiesLimits`), `packages/discovery/src/core/session-manager.ts:456-460` (`selectDelegatedValue`).

**Actual implementation:** `core/decision-fields.ts:199-207` defines `const VALUE_LIMIT_TAGS = { sqlite: ["free", "local"] }` and returns `false` whenever `VALUE_LIMIT_TAGS[value.trim().toLowerCase()]` is undefined. Calling `DiscoverySessionManager.selectDelegatedValue` with any other option in the catalog (e.g., `postgres`, `valkey`, `playwright`, `vitest`, `mailpit`, `sse`, `cookie_session`, or any catalog option carrying matching tags) throws `DelegationBoundsError`!

**Required architecture:** `project-discovery.md` ("Delegating to recommended defaults") and `IMPLEMENTATION_TASKS.md` (`Task 069`) require bounded delegations (`{ scope, limits, turn }`) to validate candidate options against the active catalog option metadata / constraint tags (not a single hardcoded test fixture `{ sqlite: ["free", "local"] }`).

**Evidence:** `packages/discovery/src/core/decision-fields.ts:199-207`.

**Why this is a defect:** Bounded delegation fails at runtime for 100% of non-`sqlite` catalog options across every domain pack.

**Required correction:** Replace hardcoded `VALUE_LIMIT_TAGS` lookup with catalog-backed option attribute/tag matching (falling back to option-token/tag metadata supplied from the active `CatalogQuestion` / `StageDepthController`, while keeping `sqlite: ["free", "local"]` in default catalog metadata).

**Dependencies:** `F-029`.

**Verification:** `pnpm --filter @ef-harness/discovery test -- core`

**Integration priority:** Discovery integration tasks (Wave M2 Discovery).

---

#### F-031 — `packages/discovery` `prompts/ports.ts` (`Task 070`) walks filesystem for `pnpm-workspace.yaml` (breaking packaged Electron builds), duplicates `Task 009` schemas, and adds 3 more divergent `ef_search_text` UDFs

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** ARCHITECTURE_VIOLATION

**Affected units:** `Task 070` (`packages/discovery/src/prompts`), `Task 069` (`core/sqlite-state.ts`), `Task 073` (`depth/sqlite-state.ts`), `Task 074` (`readiness/sql.ts`), `Task 009` (`packages/shared-contracts/src/prompts`), `Task 196` (`apps/desktop` NSIS packaging).

**Files and symbols:** `packages/discovery/src/prompts/ports.ts:36-627,698-748` (`repositoryRoot`, `loadDiscoveryPromptText`, `loadInferOrAskSkillDigest`, `OpeningReviewV1Schema`, `BatchResolveV1Schema`, `ClarifyV1Schema`, `buildPromptEnvelope`), `packages/discovery/src/core/sqlite-state.ts:10-14`, `packages/discovery/src/depth/sqlite-state.ts:40-44`, `packages/discovery/src/readiness/sql.ts:161-166`.

**Actual implementation:**
1. `prompts/ports.ts:698-709` walks up 8 parent directories searching for `fs.existsSync(path.join(dir, "opening-prompts.md")) && fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))` and throws `Error("repository root not found from discovery prompts")` when absent. In packaged Windows NSIS installs (`Task 196`), `pnpm-workspace.yaml` is not shipped, crashing `DiscoveryPromptOrchestrator` on first call!
2. `prompts/ports.ts:36-627` re-implements `OpeningReviewV1Schema`, `BatchResolveV1Schema`, `ClarifyV1Schema`, `buildPromptEnvelope`, `buildFormatRepairMessage`, and `OPENING_RUBRIC_MAP_V1` instead of importing `@ef-harness/shared-contracts` (`Task 009`) and `./core` (`Task 069`).
3. `core/sqlite-state.ts`, `depth/sqlite-state.ts`, and `readiness/sql.ts` define 3 additional copies of `splitSearchText` missing `([A-Z]+)([A-Z][a-z])` acronym splitting (see `F-010`).

**Required architecture:** `shared-contracts` (`Task 007` `canonicalAssetAbsolute` / bundled assets, `Task 009` prompt schemas & envelope, `Task 007` `splitSearchText`) must be the single source of truth for prompt contracts, canonical asset resolution (compatible with both monorepo and packaged `process.resourcesPath`), and `ef_search_text`.

**Evidence:** `packages/discovery/src/prompts/ports.ts:698-748`; `packages/discovery/src/core/sqlite-state.ts:10-14`; `packages/discovery/src/depth/sqlite-state.ts:40-44`; `packages/discovery/src/readiness/sql.ts:161-166`.

**Why this is a defect:** Packaged desktop builds crash when launching discovery prompts, schema drift arises between `shared-contracts` and `discovery/prompts`, and FTS5 `kb_words` tokens drift across DB helpers.

**Required correction:** Resolve prompt templates and `skills/infer-or-ask/SKILL.md` via `@ef-harness/shared-contracts` `canonicalAssetAbsolute` (with `EF_HARNESS_RESOURCES_DIR` / `process.resourcesPath` support), replace local prompt schemas/envelopes/`OPENING_RUBRIC_MAP_V1` in `prompts/ports.ts` with imports from `@ef-harness/shared-contracts` and `../core/index.js`, and delegate all `ef_search_text` registration to `shared-contracts` `splitSearchText` / `@ef-harness/db`.

**Dependencies:** `F-005`, `F-010`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/discovery test && pnpm --filter @ef-harness/discovery typecheck`

**Integration priority:** Discovery integration tasks (Wave M2 Discovery).

---

#### F-032 — `CorpusPackLoader` (`Task 075`) crashes on `Task 076`, `Task 077`, and `Task 104` corpus YAML files due to incompatible schemas, rejected YAML anchors, sidecar manifests, and mismatched `core-data-auth` option IDs

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 075` (`packages/discovery/src/corpus-loader`, `corpus/packs/core-data-auth`), `Task 076` (`corpus/packs/web-api-cli`, `corpus/elaborations`, `corpus/policies`), `Task 077` (`corpus/rules-seams`, `packages/planner/src/tag-detector`), `Task 103` (`corpus/packs/wave1-expanded`, `corpus/elaborations/wave1`), `Task 104` (`corpus/packs/wave2-expanded`, `corpus/elaborations/wave2`).

**Files and symbols:** `packages/discovery/src/corpus-loader/load.ts:53-85,109-131` (`CorpusPackLoader.load`, `collectCorpusFiles`), `packages/discovery/src/corpus-loader/interpret.ts:31,65-344` (`inferDocumentKind`, `readQuestionPack`, `readElaborationPack`, `readPolicyPack`, `readRulePack`, `readSeamPack`), `packages/discovery/src/corpus-loader/yaml.ts:73-78,249-268,546` (`parseStrictYaml`), `corpus/packs/web-api-cli/{manifest.yaml,web.yaml,api.yaml,cli.yaml}`, `corpus/elaborations/{core-data-auth.yaml,web.yaml,api.yaml,cli.yaml}`, `corpus/policies/universal-policies.yaml`, `corpus/rules-seams/{cross-cutting-rules.yaml,seam-templates.yaml}`, `corpus/packs/wave2-expanded/{manifest.yaml,activation-table.yaml,browser-extension.yaml,desktop.yaml,mobile.yaml}`.

**Actual implementation:**
1. **YAML parser rejection:** `corpus-loader/yaml.ts` rejects YAML anchors/aliases (`&a1`, `*a1`) and multi-line plain scalars without `>`/`|`, which `Task 076` (`web.yaml`, `elaborations/*.yaml`) and `Task 104` (`desktop.yaml`, `mobile.yaml`, `browser-extension.yaml`, `elaborations/wave2/*.yaml`) use extensively.
2. **Sidecar manifest collision:** `collectCorpusFiles` walks every `.yaml` file under `corpus/packs/**`, feeding `corpus/packs/web-api-cli/manifest.yaml` (`076`) and `corpus/packs/wave2-expanded/{manifest.yaml,activation-table.yaml}` (`104`) into `readQuestionPack`, which throws `CorpusShapeError`.
3. **Incompatible YAML schemas across all 5 document kinds:**
   - `075` (`core-data-auth`) and `103` (`wave1-expanded`) author `{ kind: "question_pack", id, version, title, questions: [{ id: "Q-CORE-01", domains, criteria, applies_when, risk_tier, options: [{ consequences }], positive_examples, negative_examples, stage_applicability, status, eval }] }` and `{ kind: "option_elaborations", id, version, elaborations: [{ id, question, option, cells, edge_cases, bounds: string[], oracle_hints }] }`.
   - `076` (`web-api-cli`) and `104` (`wave2-expanded`) author `{ pack, pack_version, activation?, questions: [{ id: "ui.responsive_targets", code: "Q-WEB-01", options: [{ frequency, conflicts_with }], examples: { positive, negative } }] }`, elaborations with `{ question_id, option_id, summary, touches, clauses, bounds: [{ key, value, unit }] }`, and `universal-policies.yaml` without `kind`/`id`/`version`/`cell`/`value`.
   - `077` (`cross-cutting-rules.yaml` & `seam-templates.yaml`) authors `{ version: 1, tags_closed: 28, rules: [{ id: "X-01", title, requirement, verification_check, match_cases, covers }] }` and `{ version: 1, seams: [{ id: "S-01", name, left, right, contract_shape, failure_modes, integration_oracle, rules, activation, match_cases }] }`, both rejected by `075`'s `readRulePack` / `readSeamPack`.
4. **Dangling question & option references in `corpus/elaborations/core-data-auth.yaml` (`Task 076`):** `076` wrote elaborations against its private mock `packages/discovery/tests/corpus-web-api-cli/port/task-075-questions.json` (`question_id: product.purpose`, `option_id: internal_workflow`; `question_id: product.audience`, `option_id: office_staff`) instead of `Task 075`'s real `Q-CORE-01..18`, `Q-DATA-01..06`, `Q-AUTH-01..05` IDs and options (`known_group`, `public_customers`, `single_operator`, etc.), failing `CorpusQualityValidator.validateAttachments` (`validate.ts:151-164`).

**Required architecture:** `discovery-depth-and-catalog.md` requires a single unified, validated v1 corpus bundle loaded deterministically by `CorpusPackLoader` (`075`) across all question packs (`Q-*`), option elaborations (`ELAB-*`), universal policies (`UP-01..08`), cross-cutting rules (`X-01..12`), and seam templates (`S-01..10`) with zero broken cross-references and zero test-only `port/` loaders.

**Evidence:** `packages/discovery/src/corpus-loader/interpret.ts:31,82-344`; `packages/discovery/src/corpus-loader/yaml.ts:73-78,546`; `corpus/packs/web-api-cli/web.yaml:1-74`; `corpus/elaborations/core-data-auth.yaml:1-35`; `corpus/rules-seams/cross-cutting-rules.yaml:1-24`.

**Why this is a defect:** Calling `loadCorpusPacks(repositoryCorpusRoot())` on `harness/integration` fails immediately with `YamlParseError` / `CorpusShapeError`, making the real corpus unusable at runtime.

**Required correction:** Normalize all YAML files in `076` (`web-api-cli`, `elaborations`, `universal-policies`) and `104` (`wave2-expanded`, `elaborations/wave2`) to `Task 075`'s canonical anchor-free `question_pack` (`Q-*` IDs) and `option_elaborations` / `universal_policies` schemas (preserving `clauses`/`touches` metadata as structured fields), align `corpus/elaborations/core-data-auth.yaml` with `Task 075`'s exact `Q-CORE-*`/`Q-DATA-*`/`Q-AUTH-*` IDs and option IDs, align `CorpusPackLoader` (`readRulePack`/`readSeamPack` + skipping `manifest.yaml`/`activation-table.yaml` index files) with `Task 077`'s rich `cross-cutting-rules.yaml` and `seam-templates.yaml` schemas, wire `RulesSeamsCatalogLoader.loadStageCatalog()` (`077`) to `loadCorpusPacks`, and delete test-only `port/` duplicate loaders in `076`, `103`, `104`.

**Dependencies:** `F-001`, `F-029`.

**Verification:** `pnpm --filter @ef-harness/discovery test && pnpm --filter @ef-harness/planner test -- tag-detector`

**Integration priority:** Corpus & Discovery integration tasks (Wave M2 Corpus).

---

#### F-033 — `packages/meta-lab/src/skill-vetting` (`Task 078`) uses non-canonical `allowedTouches` tags outside `TOUCHES_TAGS` and cannot load `Task 104`'s 14 Wave 2 skills

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 078` (`packages/meta-lab/src/skill-vetting`, `corpus/skills/m2`, `corpus/skills/manifest.json`), `Task 104` (`corpus/skills/wave2`), `Task 010` (`packages/shared-contracts/src/vocabularies/touches.ts`).

**Files and symbols:** `packages/meta-lab/src/skill-vetting/catalog.ts:41-96` (`M2_CATALOG_META`), `packages/meta-lab/src/skill-vetting/registry.ts:30-36,106-120` (`SkillManifestRegistry.manifestFile`, `skillDirectory`), `corpus/skills/manifest.json:18-21,38-41,58-61,78-81,98-101`, `corpus/skills/wave2/manifest.json:1-90`.

**Actual implementation:**
1. `M2_CATALOG_META` (`catalog.ts:41-96`) and `corpus/skills/manifest.json` (`Task 078`) declare `allowedTouches` values `"requirements"`, `"decisions"`, `"debugging"`, `"regression"`, `"tests"`, `"verification"`, `"accessibility"`, `"schema"`, `"migrations"`, and `"validation"` — none of which exist in `Task 010`'s closed 28-tag `TOUCHES_TAGS` vocabulary (`packages/shared-contracts/src/vocabularies/touches.ts`), whereas `Task 104` (`corpus/skills/wave2/manifest.json`) uses canonical `TOUCHES_TAGS` (`"form_input"`, `"interactive_ui"`, `"money"`, `"inbound_webhook"`, etc.).
2. `SkillManifestRegistry` (`registry.ts:30-36`) hardcodes `corpus/skills/manifest.json` (containing only the 6 M2 skills) and resolves every skill directory exclusivamente under `corpus/skills/m2/<skillId>`. `Task 104` places its 14 Wave 2 skills under `corpus/skills/wave2/<skillId>` with a separate `corpus/skills/wave2/manifest.json` (which also adds top-level `"wave"`, `"tokenizer"`, and per-entry `"quarantineReceipt"` keys) plus a duplicate test copy of M2 skills under `packages/discovery/tests/corpus-wave2/port/m2-skills/`.

**Required architecture:** `security-and-governance.md` and `IMPLEMENTATION_TASKS.md` (`Tasks 078, 104`) require ONE unified, hash-pinned 20-skill v1 catalog (`6` M2 + `14` Wave 2) in `corpus/skills/manifest.json` whose `allowedTouches` strictly belong to `TOUCHES_TAGS` (`Task 010`) so `KnowledgePacketSlicer` (`Task 088`) can match skills to task `touches` tags and mount any vetted v1 skill via `SkillManifestRegistry.loadForMount`.

**Evidence:** `packages/meta-lab/src/skill-vetting/catalog.ts:49,58,67,76,85,94`; `packages/meta-lab/src/skill-vetting/registry.ts:30-36`; `corpus/skills/wave2/manifest.json:1-40`.

**Why this is a defect:** Tag-based skill mounting never matches M2 skills' invented `allowedTouches` strings against canonical task `touches` tags, and calling `SkillManifestRegistry.loadForMount` for any of the 14 Wave 2 skills throws `SkillManifestError("unknown skill ...")`.

**Required correction:** Map M2 skills' `allowedTouches` in `M2_CATALOG_META` and `corpus/skills/manifest.json` to canonical `TOUCHES_TAGS` (`Task 010`), merge the 6 M2 skills and 14 Wave 2 skills into the single `corpus/skills/manifest.json` (supporting explicit `skillPath` or `m2`/`wave2` directory lookup and optional `quarantineReceipt` in `SkillManifestRegistry`), and remove `packages/discovery/tests/corpus-wave2/port/m2-skills/`.

**Dependencies:** `F-001`, `F-032`.

**Verification:** `pnpm --filter @ef-harness/meta-lab test -- skill-vetting && pnpm --filter @ef-harness/discovery test -- corpus-wave2`

**Integration priority:** Corpus & Skill Catalog integration tasks (Wave M2 Corpus).

---

#### F-034 — `Tasks 079, 081, 082` insert `edges` with `type IN ('expands', 'contradicts', 'informs')` that are not registered in `schema/state.sql` `edge_types`, causing `SQLITE_CONSTRAINT_FOREIGNKEY` on real `state.db`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 079` (`packages/spec-expansion/src/generators/persistence.ts`), `Task 081` (`packages/spec-expansion/src/contradictions/engine.ts`), `Task 082` (`packages/research-engine/src/feature-research-orchestrator.ts`), `Task 013` / `Task 015` / `Task 017` (`packages/db`).

**Files and symbols:** `schema/state.sql:41-44,64-67,147-157` (`edge_types`, `edges`), `packages/spec-expansion/src/generators/persistence.ts:94,374-377` (`MatrixCellPersistenceRepo.insertEdge`), `packages/spec-expansion/src/contradictions/engine.ts:22,307` (`CONTRADICTION_EDGE_TYPE`), `packages/research-engine/src/feature-research-orchestrator.ts:541-543` (`type: "informs"`).

**Actual implementation:** `schema/state.sql:64-67` seeds 14 `edge_types` (`implements`, `verifies`, `consumes_contract`, `produces_contract`, `obeys`, `handles_edge_case`, `derived_from`, `depends_on`, `waives`, `belongs_to`, `documents`, `cites`, `comments_on`, `supersedes`). `Task 079` inserts `'expands'` (working in its unit test only because `openMemory()` runs `INSERT OR IGNORE INTO edge_types VALUES ('expands', 1)`), `Task 081` inserts `'contradicts'` (tested only against in-memory `memory-store.ts` without SQLite FK checks), and `Task 082` inserts `'informs'` (tested only against `memory-knowledge-graph.ts` without SQLite FK checks).

**Required architecture:** `schema/state.sql:14-15` ("Extensible vocabularies are lookup tables with foreign keys, not CHECK lists, so adding a node kind or task state is an INSERT, not a table rebuild"), `spec-expansion.md`, and `build-pipeline.md` require `edge_types` in `state.db` to register `('expands', 1)`, `('contradicts', 1)`, and `('informs', 1)` via an additive migration (`MigrationRunner` `Task 015`) + closed-vocabulary parity (`Task 010`) so `KnowledgeGraphRepo` (`Task 017`) accepts these temporal edges under `PRAGMA foreign_keys = ON`.

**Evidence:** `schema/state.sql:64-67,149`; `packages/spec-expansion/src/generators/persistence.ts:94,375`; `packages/spec-expansion/src/contradictions/engine.ts:307`; `packages/research-engine/src/feature-research-orchestrator.ts:542`.

**Why this is a defect:** Persisting spec matrices (`079`), contradiction edges (`081`), or verified research facts (`082`) into a real `ProjectStateDb` fails immediately with `SqliteError: FOREIGN KEY constraint failed`.

**Required correction:** Register `('expands', 1)`, `('contradicts', 1)`, and `('informs', 1)` in `@ef-harness/shared-contracts` `EDGE_TYPES` (`Task 010`) and in `@ef-harness/db`'s bootstrap/additive migration (`Tasks 013, 015`) without mutating frozen `schema/state.sql` v1 DDL if `schema-test.js` pins the initial 14 rows (or via additive migration `0002_m2_edge_types` run automatically by `ProjectStateDb.open` per `F-009`).

**Dependencies:** `F-009`, `F-012`.

**Verification:** `pnpm test:schema && pnpm --filter @ef-harness/db test && pnpm --filter @ef-harness/spec-expansion test`

**Integration priority:** Kernel DB & Spec-Expansion integration tasks.

---

#### F-035 — `packages/spec-expansion` (`Tasks 079–081`) lacks `task-079`'s uncommitted collapse/requirements-view fixes, calls nonexistent sibling methods (`listCells`, `listMaterializedRequirements`), reads nonexistent `selectedOptionId`/`groupId` decision fields, and leaves `z3-solver` WASM unwired

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 079` (`packages/spec-expansion/src/generators` + dirty worktree `task-079`), `Task 080` (`packages/spec-expansion/src/filler`), `Task 081` (`packages/spec-expansion/src/contradictions`), `Tasks 069–075` (`packages/discovery`).

**Files and symbols:** `packages/spec-expansion/src/generators/collapse.ts:98-104` vs `task-079` `collapse.ts:76-156` (`ScopedRuleCollapser.collapse`), `packages/spec-expansion/src/generators/persistence.ts:55-71,202-223,251-276,310-341` vs `task-079` `persistence.ts:56-70,207-227,255-279,313-343` (`MatrixCellPersistenceRepo`), `packages/spec-expansion/src/filler/pipeline.ts:99-105,159-168` (`OrderedCellFillerPipeline`), `packages/spec-expansion/src/contradictions/engine.ts:119,129,153,346-350,431-438` (`FiveLayerContradictionEngine`), `packages/spec-expansion/src/contradictions/z3-solver.ts:43-62` (`Z3UnsatCoreSolver`).

**Actual implementation:**
1. **Uncommitted `task-079` fixes missing from branch tip & `harness/integration`:** On `harness/integration`, `ScopedRuleCollapser` truncates `bucket.rest` at `47` cells and anchors on `first.signature` (turning majority rules into dozens of exceptions whenever cell 0 is an exception); `MatrixCellPersistenceRepo` writes `matrix-manifest` and `matrix:M01..M12` as active `kind = 'rule'` and unfilled skeleton cells as active `kind = 'spec_item'`, polluting the `requirements` SQL view (`schema/state.sql`) and breaking `requirements_without_task` / `requirements_without_check`; and `contentHash` hashes `fields` as a raw JSON string with `status` instead of parsed JCS object. All three are fixed in the uncommitted `task-079` worktree diff.
2. **Broken intra-package calls & schemas (`079` ↔ `080` ↔ `081` ↔ `discovery`):**
   - `FiveLayerContradictionEngine` (`081` `engine.ts:129,347`) calls `this.matrixRepo.listCells()` (absent on `079` `MatrixCellPersistenceRepo`) and `this.filler.listMaterializedRequirements()` (absent on `080` `OrderedCellFillerPipeline`), while `080` uses `MatrixCellPersistencePort` (`upsertCell`/`saveFill`/`getCell`) incompatible with `079` `MatrixCellPersistenceRepo`.
   - `engine.ts:431-438` (`asDecision`) requires `fields.selectedOptionId` and `fields.groupId` — keys never written by `packages/discovery` (`069–074`, which writes `fields.value` and `fields.criterion`), causing Layer 1 catalog contradiction checks to see **zero settled decisions (`[]`)**!
   - Both `OrderedCellFillerPipeline.run` (`080`, Pass 3 `spec-expander@1`) and `FiveLayerContradictionEngine.check` (`081`, Layer 5 `contradiction-check@1`) are synchronous and cannot await async `ModelProtocolAdapter.complete` (`053`) or async Z3 WASM initialization!
3. **Unwired `z3-solver` WASM (`081`):** `packages/spec-expansion/package.json` includes `"z3-solver": "^5.4.1"`, yet `z3-solver.ts:46-49` runs a local exponential DPLL solver instead of `z3-solver` WASM `init()` / `Solver` `check()` + `unsatCore()`.

**Required architecture:** `spec-expansion.md` and `IMPLEMENTATION_TASKS.md` (`Tasks 079–081`) require lossless majority-signature scoped-rule collapse, clean separation of draft/metadata matrix nodes from active `requirements`, unified `KnowledgeGraphRepo` persistence (`Task 017`), real in-process `z3-solver` WASM minimal UNSAT-core solving with 2,000 ms timeout, async Pass 3 / Layer 5 model execution, and exact alignment with `packages/discovery` `DecisionNodeFields` (`criterion`, `value`) + `CorpusPackLoader` (`075`).

**Evidence:** `packages/spec-expansion/src/generators/collapse.ts:103`; `packages/spec-expansion/src/generators/persistence.ts:209,258,320,334`; `packages/spec-expansion/src/contradictions/engine.ts:129,347-349,434-435`; `packages/spec-expansion/src/contradictions/z3-solver.ts:46-48`.

**Why this is a defect:** Matrix expansion pollutes `requirements`, `079→080→081` cannot be wired together without TypeScript/runtime method errors, Layer 1 silently skips all real discovery decisions, and async LLM/Z3 calls cannot run inside synchronous `run()`/`check()`.

**Required correction:** Apply `task-079`'s uncommitted fixes to `collapse.ts` and `persistence.ts`; add `@ef-harness/db`, `@ef-harness/discovery`, and `@ef-harness/worker-loop` to `packages/spec-expansion/package.json`; expose `listCells()` on `MatrixCellPersistenceRepo` and `listMaterializedRequirements()` on `OrderedCellFillerPipeline`; make `OrderedCellFillerPipeline.run` and `FiveLayerContradictionEngine.check`/`recheck` async; read canonical `DecisionNodeFields` (`criterion`, `value`, `question_id`) in `asDecision`; and wire `Z3UnsatCoreSolver` to `"z3-solver"` WASM (keeping deterministic timeout fallback).

**Dependencies:** `F-001`, `F-012`, `F-029`, `F-032`, `F-034`.

**Verification:** `pnpm --filter @ef-harness/spec-expansion test && pnpm --filter @ef-harness/spec-expansion typecheck`

**Integration priority:** Spec-Expansion integration tasks (Wave M2 Spec Expansion).

---

#### F-036 — `packages/research-engine` `ResearchFactCache` (`Task 082`) stores fact payloads only in an in-memory `Map` (losing 100% of cached facts on restart), misses runtime `"typescript"` dependency, and mismatches `SecureDocFetcher`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** LOCAL_DEFECT

**Affected units:** `Task 082` (`packages/research-engine`), `Task 014` (`packages/db/src/auxiliary-dbs/global-broker-db.ts`), `Task 028` (`packages/db/src/cas`), `Task 045` (`packages/sandbox/src/doc-fetcher`).

**Files and symbols:** `packages/research-engine/src/research-fact-cache.ts:56-135` (`ResearchFactCache.bodies`, `put`, `get`), `packages/research-engine/package.json:20-28`, `packages/research-engine/src/installed-type-api-verifier.ts:3`, `packages/research-engine/src/feature-research-orchestrator.ts:214` (`fetcher.fetchDocs`).

**Actual implementation:**
1. `ResearchFactCache` (`research-fact-cache.ts:57,81-102,121-127`) writes only metadata (`packageName`, `versionRange`, `docUrl`, `artifactHash`, `fetchedAt`) to `GlobalResearchCachePort` (`global.db.research_cache`) and stores the actual `CachedResearchRecord` (`facts`, `sourceExcerpt`) solely in `private readonly bodies = new Map<string, CachedResearchRecord>()`. Across daemon restarts or separate projects in new processes, `this.store.lookupResearchCache` finds the SQLite row, `this.bodies.get(key)` returns `null`, and `get()` returns `{ cache_hit: false, status: "miss", record: null }`!
2. `installed-type-api-verifier.ts:3` executes `import * as ts from "typescript"` at runtime, while `packages/research-engine/package.json:20-28` lists `"typescript"` only in `devDependencies` (not `dependencies`), and omits `@ef-harness/db`, `@ef-harness/sandbox`, and `@ef-harness/worker-loop`.
3. `FeatureResearchOrchestrator` (`feature-research-orchestrator.ts:214`) calls `fetcher.fetchDocs(url, { role: "researcher" })`, which does not match `Task 045` `SecureDocFetcher.fetch(...)`.

**Required architecture:** `build-pipeline.md`, `schema/global.sql` (`research_cache.artifact_hash`), and `IMPLEMENTATION_TASKS.md` (`Task 082`) require 90-day cross-project, cross-restart persistence of verified research facts backed by `global.db.research_cache` + CAS blob storage (`CasBlobStore` keyed by `artifact_hash`), runtime availability of `typescript` for `InstalledTypeApiVerifier`, and fetching exclusively through `Task 045` `SecureDocFetcher`.

**Evidence:** `packages/research-engine/src/research-fact-cache.ts:57,101,121-134`; `packages/research-engine/package.json:20-28`; `packages/research-engine/src/feature-research-orchestrator.ts:214`.

**Why this is a defect:** Every daemon restart wipes all cached research facts (wasting research tokens and breaking offline fallback after restart), packaged production installs without `devDependencies` fail to import `"typescript"`, and `SecureDocFetcher` cannot plug into `FeatureResearchOrchestrator`.

**Required correction:** Persist serialized `{ facts, sourceExcerpt }` blobs via `@ef-harness/db` `CasBlobStore` (`artifact_hash` in `global.db.research_cache`) and rehydrate on `ResearchFactCache.get()`; move `"typescript"` to `dependencies` and add `@ef-harness/db`, `@ef-harness/sandbox`, and `@ef-harness/worker-loop` to `packages/research-engine/package.json`; and adapt `SecureDocFetcher` (`Task 045`) to `SecureDocFetcherPort`.

**Dependencies:** `F-001`, `F-007`, `F-011`, `F-019`, `F-034`.

**Verification:** `pnpm --filter @ef-harness/research-engine test && pnpm --filter @ef-harness/research-engine typecheck`

**Integration priority:** Research-Engine integration tasks (Wave M2 Research).

---

#### F-037 — `views-export` (`Task 085`) and `views-import` (`Task 086`) disagree on `.manifest.json` schema, `<!-- ef:node -->` `base_hash`/anchor/escape syntax, and `ExportPauseLock`, breaking `.harness/views/` round-trip editing

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 085` (`packages/planner/src/views-export`), `Task 086` (`packages/planner/src/views-import`), `Task 087` (`packages/planner/src/revisions`).

**Files and symbols:** `packages/planner/src/views-export/exporter.ts:294-344,376-382` (`buildManifest`, `loadManifest`), `packages/planner/src/views-export/ef-node-marker.ts:51,88-103,115-121` (`EfNodeMarkerFormatter.formatBlock`, `escapeMarkerText`), `packages/planner/src/views-export/locks.ts` (`ExportPauseLock`), `packages/planner/src/views-import/manifest.ts:16-25,42-117,142-168` (`loadManifest`, `writeCanonicalViews`), `packages/planner/src/views-import/markers.ts:5-10,42-74,204-250` (`OPEN_PATTERN`, `escapeMarkerText`, `renderNodeBlock`, `extractHeadingAndFields`), `packages/planner/src/views-import/importer.ts:146-180,530-543` (`MarkdownDirectEditImporter.reconcile`).

**Actual implementation:**
1. **Incompatible `.manifest.json` schema:** `KnowledgeViewExporter` (`085`) serializes `{ revision: number, records: ManifestRecord[] }` (`exportedAt: string`), while `MarkdownDirectEditImporter` (`086`) expects `{ files: ManifestFileRecord[], nodes: ManifestNodeRecord[] }` (`exportedAt: number`). `086`'s `loadManifest` silently returns `emptyManifest()` (`{ files: [], nodes: [] }`) on `085`'s manifest, and `085`'s `loadManifest` flags `086`'s `writeCanonicalViews()` manifest as `state: "corrupt"` and locks every file with `"manifest_unreadable"`!
2. **Incompatible `ef:node` block syntax:**
   - `085` writes `base_hash=${input.baseHash}` (canonical `"sha256:<64-hex>"` node hash), whereas `086` `OPEN_PATTERN` (`markers.ts:10`) matches only bare 64-hex `base_hash=([0-9a-f]{64})` (hash of `blockInterior(node)`), causing `086` to fail to match `<!-- ef:node -->` openers exported by `085` and treat every node as an unmarked section!
   - `085` inserts `<a id="${input.anchor}"></a>` inside the block before `## ${title}`, which `086` `extractHeadingAndFields` (`markers.ts:243-248`) leaves inside `proseLines`, corrupting `localProse` on every exported node.
   - `085` escapes nested markers as `\\<!-- /ef:node -->` (`ef-node-marker.ts:116`), whereas `086` unescapes `<!-- ef:escaped /ef:node -->` (`markers.ts:6,46-48`).
3. **Incompatible `ExportPauseLock` & sync `doc-import@1` model port:** `085` calls `pause(path, reason)` / `isPaused(path)` while `086` calls `acquire(path, reason)` / `release(path)`, and `086` `reconcile()` invokes `DocImportModel.complete(request)` synchronously instead of awaiting async `ModelProtocolAdapter`.

**Required architecture:** `knowledge-database.md` ("Markdown views and direct editing") requires lossless zero-diff round-tripping between `KnowledgeViewExporter` (`085`) and `MarkdownDirectEditImporter` (`086`) over ONE canonical `.harness/views/.manifest.json` format, ONE `<!-- ef:node id=... rev=... base_hash=... -->` + `ef-fields` grammar, ONE shared `ExportPauseLock` instance, and async `doc-import@1` model execution feeding `HybridRevisionEngine` (`087`).

**Evidence:** `packages/planner/src/views-export/exporter.ts:312-343`; `packages/planner/src/views-import/manifest.ts:20-24`; `packages/planner/src/views-export/ef-node-marker.ts:88-90,116`; `packages/planner/src/views-import/markers.ts:6-10,243-248`.

**Why this is a defect:** Exporting `.harness/views/` with `085` and editing any Markdown file with `086` fails to recognize any exported node or manifest record, and running `086` causes `085` to lock the entire `.harness/views/` tree as corrupt.

**Required correction:** Unify `.manifest.json` (`{ revision, files, nodes }` or unified `ViewManifest` shared module in `packages/planner/src/views-shared`), unify `ef:node` formatting/parsing (strip `<a id="...">` or place it outside `prose`, support canonical `sha256:<64-hex>` `base_hash`, unify marker escaping and `ef-fields` YAML codec), share one `ExportPauseLock` interface, replace `086`'s `writeCanonicalViews` stand-in with `085`'s `KnowledgeViewExporter`, and make `MarkdownDirectEditImporter.reconcile` async.

**Dependencies:** `F-007`, `F-012`.

**Verification:** `pnpm --filter @ef-harness/planner test -- views-export views-import`

**Integration priority:** Planner Views & Revisions integration tasks (Wave M2 Planner).

---

#### F-038 — `system-arch` (`Task 083`) and `feature-arch` (`Task 084`) define conflicting `SkeletonLockEnforcer` / `DeterministicArchConsistencyGate` contracts, omit `fields.names` SQL trigger format, and leave `feature-architect@1` synchronous & unpersisted

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** INTEGRATION_SEAM

**Affected units:** `Task 083` (`packages/planner/src/system-arch`), `Task 084` (`packages/planner/src/feature-arch`), `Task 019` (`packages/db/src/registry`), `Task 112` (`packages/integrator/src/ccr`).

**Files and symbols:** `packages/planner/src/system-arch/skeleton-lock.ts:66-117` (`SkeletonLockEnforcer`), `packages/planner/src/system-arch/synthesizer.ts:159-238` (`SystemArchitectureSynthesizer.seed`), `packages/planner/src/feature-arch/skeleton-lock.ts:5-65` (`SkeletonLockEnforcer`), `packages/planner/src/feature-arch/synthesizer.ts:40-50,170-189,388-402,435` (`JitFeatureArchitectureSynthesizer.synthesize`).

**Actual implementation:**
1. Both `system-arch` (`083`) and `feature-arch` (`084`) export identically named `SkeletonLockEnforcer` and `DeterministicArchConsistencyGate` classes with incompatible signatures and node schemas (`083` uses `ArchitectureStore` + `fields.arch_role` + `fields.skeleton_locked`, while `084` uses in-memory `SkeletonSnapshot` + `fields.role`).
2. `JitFeatureArchitectureSynthesizer.synthesize` (`084` `synthesizer.ts:49,170-189`) is synchronous, expects pre-constructed `FeatureInput[]` rather than invoking `feature-architect@1` via `ModelProtocolAdapter`, returns `persisted: true` without committing anything to `state.db`, and writes `fields.registeredNames` (`line 435`) instead of `fields.names` (the JSON key watched by `schema/state.sql`'s `names` table triggers and `Task 019` `NameRegistryRepo`!).
3. `SystemArchitectureSynthesizer.seed` (`083` `synthesizer.ts:159-238`) unconditionally inserts `input.decisions`, `input.requirements`, `input.researchFacts`, and `input.crossCuttingRules` as brand-new nodes owned by `phase0-foundation`, colliding with existing `nodes.id` rows in a real `ProjectStateDb`.

**Required architecture:** `build-pipeline.md`, `database-design.md`, and `schema/state.sql` (`names` triggers on `fields.names`) require `SystemArchitectureSynthesizer` (`083`) and `JitFeatureArchitectureSynthesizer` (`084`) to read existing settled `state.db` nodes via `KnowledgeGraphRepo` (`Task 017`), call `system-architect@1` and `feature-architect@1` asynchronously, share ONE `SkeletonLockEnforcer` + `DeterministicArchConsistencyGate`, and persist `arch_node`/`contract`/`journey` nodes with canonical `fields.names` so SQLite triggers populate `names` atomically.

**Evidence:** `packages/planner/src/system-arch/skeleton-lock.ts:66-117`; `packages/planner/src/feature-arch/skeleton-lock.ts:5-65`; `packages/planner/src/feature-arch/synthesizer.ts:49,172,435`.

**Why this is a defect:** `084` never invokes `feature-architect@1`, never persists feature architecture nodes into `state.db`, never triggers `names` uniqueness enforcement in SQLite, and collides on exported symbol names and `arch_role` vs `role` fields with `083`.

**Required correction:** Consolidate `SkeletonLockEnforcer` and `DeterministicArchConsistencyGate` on `KnowledgeGraphRepo`, make `SystemArchitectureSynthesizer` read existing nodes instead of re-seeding duplicate IDs, add async `feature-architect@1` model orchestration + `KnowledgeGraphRepo` persistence to `JitFeatureArchitectureSynthesizer`, and emit canonical `fields.names` entries (`[{ kind, value }]`) matching `schema/state.sql`.

**Dependencies:** `F-001`, `F-012`, `F-034`.

**Verification:** `pnpm --filter @ef-harness/planner test -- system-arch feature-arch && pnpm --filter @ef-harness/planner typecheck`

**Integration priority:** Planner Architecture integration tasks (Wave M2 Planner).

---

#### F-039 — Three-way MCP `kb.*` tool-name, worker-level, band-casing, and `task_holds.reason` mismatch across `AttemptMcpServer` (`048`), `HybridRevisionEngine` (`087`), `KnowledgePacketSlicer` (`088`), `KbPullToolHandlers` (`089`), and `Scheduler` (`107`)

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 048` (`packages/mcp-server`), `Task 087` (`packages/planner/src/revisions`), `Task 088` (`packages/planner/src/slicer`), `Task 089` (`packages/planner/src/rule-matching`), `Task 095` (`packages/planner/src/sequential-runner`), `Task 107` (`packages/planner/src/scheduler`).

**Files and symbols:** `packages/planner/src/slicer/types.ts:1-21` (`WORKER_LEVELS`, `KB_PULL_TOOL_IDS`), `packages/planner/src/rule-matching/kb-pull-tool-handlers.ts:51-98` (`KbPullToolHandlers.definitions`), `packages/planner/src/rule-matching/pull-to-push-feedback-analyzer.ts:62-63,159-172` (`PullToPushFeedbackAnalyzer.apply`), `packages/planner/src/revisions/engine.ts:128-134` (`reason: "revision_in_flight"`), `schema/state.sql:324-330` (`task_holds`).

**Actual implementation:**
1. **Three conflicting `kb.*` MCP tool sets:**
   - `Task 088` `KB_PULL_TOOL_IDS` (`slicer/types.ts:13-21`) advertises `["kb.search", "kb.get", "kb.neighbors", "kb.contract", "kb.why", "kb.code", "kb.get_fact"]` in worker briefs.
   - `Task 089` `KbPullToolHandlers` (`kb-pull-tool-handlers.ts:51-98`) registers `["kb.search", "kb.get_node", "kb.get_contract", "kb.list_rules_for_tags"]`.
   - `Task 048` (`AttemptMcpServer`) and `Task 095` (`WORKER_TOOLS`) expose `["kb.get_fact", "kb.contract", "kb.code", "harness.run"]` without registering `Task 089`'s handlers or analytics recorder!
2. **Band casing & worker-level split between `088` and `089` / `090–108`:** `088` uses lowercase `"must" | "should" | "could"` bands, `WORKER_LEVELS = ["junior", "senior"]` only (missing `"mid"` and `"principal"`/`"manager"` used in `090, 091, 093, 102, 106, 107, 108`), and does not implement `089`'s `SlicerPromotionHook.upsertBand` (which emits uppercase `"MUST" | "SHOULD" | "COULD"`).
3. **Invalid `task_holds.reason` in `087`:** `HybridRevisionEngine` (`revisions/engine.ts:130`) writes `reason: "revision_in_flight"`, whereas `schema/state.sql:326`, `Task 021` (`HoldsSubmissionsRepo`), and `Task 107` (`HOLD_REASONS`) specify `"requirement_change"`.

**Required architecture:** `knowledge-database.md`, `verification-and-runtime.md`, and `schema/state.sql:326` require a single canonical `kb.*` pull-tool surface wired into `AttemptMcpServer` (`048`) with `PullReadAnalyticsRecorder` (`089`), matching `Could` brief pointers in `KnowledgePacketSlicer` (`088`), unified band/level enums (`junior` / `mid` / `senior` / `principal` mapped to token ceilings), and canonical `task_holds.reason = 'requirement_change'`.

**Evidence:** `packages/planner/src/slicer/types.ts:1,13-21`; `packages/planner/src/rule-matching/kb-pull-tool-handlers.ts:54,68,78,88`; `packages/planner/src/rule-matching/pull-to-push-feedback-analyzer.ts:62-63`; `packages/planner/src/revisions/engine.ts:130`; `schema/state.sql:326`.

**Why this is a defect:** Workers following `Could` pointers in their compiled brief call MCP tool names (`kb.get`, `kb.neighbors`, `kb.why`) that do not exist on `AttemptMcpServer` or `KbPullToolHandlers`, pull-to-push promotions never reach `KnowledgePacketSlicer`, `"mid"`/`"principal"` crew levels fail or mis-budget in `088`, and revision holds fail `HoldReason` validation in `Task 021`/`107`.

**Required correction:** Freeze canonical MCP tool names across `AttemptMcpServer` (`048`), `KnowledgePacketSlicer` (`088`), `KbPullToolHandlers` (`089`), and `SequentialBuildRunner` (`095`) (supporting `kb.search`, `kb.get_node` + alias `kb.get`/`kb.get_fact`, `kb.get_contract` + alias `kb.contract`, `kb.list_rules_for_tags`, `kb.code`, `harness.run`), implement `SlicerPromotionHook` on `KnowledgePacketSlicer` normalizing band casing and `mid`/`principal` level budgets, and change `HybridRevisionEngine`'s hold reason from `"revision_in_flight"` to `"requirement_change"`.

**Dependencies:** `F-001`, `F-012`, `F-021`, `F-033`.

**Verification:** `pnpm --filter @ef-harness/planner test -- revisions slicer rule-matching && pnpm --filter @ef-harness/mcp-server test`

**Integration priority:** Planner Slicer, Revisions & MCP integration tasks (Wave M2 Planner).

---

### [F-040] Unexported `packages/planner` Execution Submodules (`090–095`), Conflicting `ProjectKind` / `CrewLevel` Enums & Sync Model Ports

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 053` (`packages/worker-loop`), `Task 088` (`packages/planner/src/slicer`), `Task 090` (`packages/planner/src/master-plan`), `Task 091` (`packages/planner/src/feature-plan`), `Task 093` (`packages/planner/src/phase0`), `Task 094` (`packages/planner/src/design-system`), `Task 095` (`packages/planner/src/sequential-runner`).

**Files and symbols:** `packages/planner/src/index.ts`, `packages/planner/src/master-plan/types.ts:1-45` (`ProjectKind`, `TaskLevel`), `packages/planner/src/master-plan/master-plan-orchestrator.ts:45-98` (`MasterPlanOrchestrator.plan`), `packages/planner/src/feature-plan/ports.ts:1-35` (`PlannerOracleModel.complete`), `packages/planner/src/feature-plan/types.ts:1-40` (`CrewLevel`), `packages/planner/src/phase0/types.ts:1-35` (`ProjectKind`), `packages/planner/src/design-system/types.ts:1-30` (`ProjectKind`), `packages/planner/src/design-system/scaffold.ts:12-40` (`HEADLESS`, `DesignSystemScaffoldBuilder`).

**Actual implementation:**
1. **Unexported planner barrels:** Because `Tasks 090–095` (and `102, 106–108`) branched from `main`'s stub `packages/planner/src/index.ts` and are unmerged on `harness/integration`, none of `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, or `sequential-runner` are exported from `@ef-harness/planner`.
2. **Incompatible `ProjectKind` union (silent headless CLI UI pollution):** `Task 090` and `Task 093` define `ProjectKind = "web_saas" | "headless_cli" | "api" | "brownfield"`, whereas `Task 094` defines `ProjectKind = "web" | "cli" | "api" | "headless"` with `HEADLESS = new Set(["cli", "api", "headless"])` (`scaffold.ts:12`). Passing `"headless_cli"` from `090`/`093` into `094` fails `HEADLESS.has("headless_cli")` and scaffolds React/Tailwind UI files into a headless CLI repo; passing `"web_saas"` fails TypeScript compilation!
3. **Incompatible `CrewLevel` / `TaskLevel` casing & tiers:** `088` uses `"junior" | "senior"`, `090`/`093` use `"junior" | "mid" | "senior" | "manager"`, and `091` uses TitleCase `"Junior" | "Mid" | "Senior"`.
4. **Synchronous LLM ports:** `MasterPlanOrchestrator.plan` (`090`) expects `features`/`modelOutput` pre-supplied synchronously without calling `master-planner@1`, and `JitFeaturePlanner.plan` / `IndependentOracleAuthorSealer.author` (`091`) call synchronous `PlannerOracleModel.complete(...)` instead of async `ModelProtocolAdapter.complete(...)` (`Task 053`).

**Required architecture:** `build-pipeline.md`, `planning-and-crew.md`, `ui-design-system.md`, and `prompt-contracts.md` require one canonical `ProjectKind` and lowercase `CrewLevel` (`"junior" | "mid" | "senior" | "principal"` / `"manager"` role mapping) across `@ef-harness/shared-contracts` and `@ef-harness/planner`, full barrel exports in `packages/planner/src/index.ts`, and async `ModelProtocolAdapter` execution for `master-planner@1`, `feature-planner@1`, and `oracle-author@1`.

**Evidence:** `packages/planner/src/master-plan/types.ts:1-45`; `packages/planner/src/design-system/types.ts:1-30`; `packages/planner/src/design-system/scaffold.ts:12-40`; `packages/planner/src/feature-plan/ports.ts:1-35`.

**Why this is a defect:** `Phase0ExecutionController` (`093`) cannot invoke `DesignSystemScaffoldBuilder` (`094`) without type errors or scaffolding UI files into headless CLI projects, `JitFeaturePlanner`/`IndependentOracleAuthorSealer` (`091`) cannot call real async LLM providers (`053`/`135–140`), and downstream consumers (`105`, `107`, `108`, `daemon`) cannot import `090–095` from `@ef-harness/planner`.

**Required correction:** Normalize `ProjectKind` (mapping `"web_saas"`/`"web"` to UI-enabled and `"headless_cli"`/`"cli"`/`"api"`/`"headless"` to headless) and lowercase `CrewLevel` in `@ef-harness/shared-contracts` + `@ef-harness/planner`, convert `MasterPlanOrchestrator`, `JitFeaturePlanner`, and `IndependentOracleAuthorSealer` model calls to async `ModelProtocolAdapter`, and re-export all planner submodules from `packages/planner/src/index.ts`.

**Dependencies:** `F-001`, `F-023`, `F-038`, `F-039`.

**Verification:** `pnpm --filter @ef-harness/planner typecheck && pnpm --filter @ef-harness/planner test -- master-plan feature-plan design-system`

**Integration priority:** Planner Execution & Compilation integration tasks (Wave M2 Planner).

---

### [F-041] Five Private SQLite Schemas in `packages/planner` (`090–093, 095`) Colliding with `schema/state.sql` & Missing `DeterministicGraphCompiler` Sibling Methods

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SCHEMA_MISMATCH

**Affected units:** `Task 014` (`packages/db`), `Task 017` (`NodesEdgesRepo`), `Task 023` (`BudgetLedger`), `Task 028` (`CasBlobStore`), `Task 056` (`BlindCheckBinder`), `Task 081` (`FiveLayerContradictionEngine`), `Task 088` (`KnowledgePacketSlicer`), `Task 090`–`Task 093`, `Task 095`.

**Files and symbols:** `packages/planner/src/master-plan/state-db.ts:9-82,139-164,181-186` (`MasterPlanStore`), `packages/planner/src/feature-plan/state-db.ts:22-61,123-136,179-196,227-263` (`FeaturePlanDatabase`), `packages/planner/src/feature-plan/hidden-check-pool-store.ts:20-33` (`HiddenCheckPoolStore`), `packages/planner/src/graph-compiler/traceability-sql-gate.ts:71-88` (`TraceabilitySqlGate`), `packages/planner/src/graph-compiler/compiler.ts:127-137` (`DeterministicGraphCompiler`), `packages/planner/src/phase0/state-store.ts:8-78,117-123` (`Phase0StateStore`), `packages/planner/src/sequential-runner/state-db.ts:70-77,977-996` (`StateDb`).

**Actual implementation:**
1. **`Task 091` `FeaturePlanDatabase` (`feature-plan/state-db.ts:22-61,131`) is `:memory:`-only and schema-incompatible with `state.db`:** It runs `CREATE TABLE nodes (...)` and `CREATE TABLE edges (...)` (without `IF NOT EXISTS`, omitting `NOT NULL` columns `content_hash`, `created_rev`, `updated_rev`, `change_set`, `valid_from_rev`) plus custom `hidden_checks` and `cas_blobs` tables. Running against real `state.db` crashes immediately (`table nodes already exists` / `NOT NULL constraint failed`), and `HiddenCheckPoolStore` (`hidden-check-pool-store.ts:20-33`) stores sealed checks in `hidden_checks` instead of `schema/state.sql`'s `nodes(kind='oracle', visibility='held_back')` + `CasBlobStore` (`Task 028`) consumed by `BlindCheckBinder` (`Task 056`).
2. **`Task 090` `MasterPlanStore` (`master-plan/state-db.ts:9-82,139-164,181`) opens a rogue `DatabaseSync`:** Creates 5 custom tables (`master_plans`, `waves`, `phase0_tasks`, `feature_wave_assignments`, `budget_envelopes`) plus a duplicate triggerless `budgets` table, and `ledgerRows` (`lines 154-159`) emits child rows with `scopeKind: "project"` and `parentKind: "project"`, violating `Task 023` `BudgetLedger`'s project-root hierarchy.
3. **`Task 092` `DeterministicGraphCompiler` & `TraceabilitySqlGate` (`traceability-sql-gate.ts:71-88`, `compiler.ts:127-137`):** `TraceabilitySqlGate` spins up a throwaway `:memory:` `DatabaseSync` with 11 custom tables (`task_requirements`, `check_requirements`, `contradiction_edges`, `must_ask_criteria`, etc.) instead of running `schema/queries.sql` against `ProjectStateDb`, and `compiler.ts:127-137` calls nonexistent methods `slicer.measureMust(task)` (missing on `088`), `contradictionEngine.unresolvedContradictions(input)` (missing on `081`), and `oracleSealer.sealedCheckIds(input, featureId)` (missing on `091`).
4. **`Task 093` `Phase0StateStore` (`phase0/state-store.ts:8-78,117`) and `Task 095` `StateDb` (`sequential-runner/state-db.ts:70-77,977-996`):** Both open separate `DatabaseSync` writer handles on `state.db` and create private tables (`phase0_*` and `sequential_attempt_receipts`), violating `database-design.md`'s single-writer rule (`F-012`).

**Required architecture:** `database-design.md`, `schema/state.sql`, and `schema/queries.sql` require all planner persistence and traceability queries to execute against the shared single-writer `ProjectStateDb` (`Task 014`) + `MigrationRunner` (`Task 015`), storing tasks/features/waves/oracles in `nodes`/`edges`/`feature_runtime`/`task_runtime`/`budgets`/`meta` + `CasBlobStore` (`Task 028`), with additive `MigrationRunner` migration only for genuinely new receipt metadata tables and exact adapter methods between `081`, `088`, `091`, and `092`.

**Evidence:** `packages/planner/src/feature-plan/state-db.ts:22-61,131-136`; `packages/planner/src/master-plan/state-db.ts:70-81,154-160,181-185`; `packages/planner/src/graph-compiler/traceability-sql-gate.ts:71-88`; `packages/planner/src/graph-compiler/compiler.ts:127-137`; `packages/planner/src/phase0/state-store.ts:8-78,117-123`; `packages/planner/src/sequential-runner/state-db.ts:70-77,977-996`.

**Why this is a defect:** None of `090`, `091`, `092`, `093`, or `095` can share a single `state.db` — `090` plans into `master_plans`/`waves`, `091` plans into `:memory:` `FeaturePlanDatabase`, `092` validates a `:memory:` `TraceabilitySqlGate` and calls missing methods on `081`/`088`/`091`, `056` cannot find `091`'s sealed checks, and `095` queries `schema/state.sql` tables that neither `090` nor `091` populated!

**Required correction:** Refactor `MasterPlanStore` (`090`), `FeaturePlanDatabase` + `HiddenCheckPoolStore` (`091`), `TraceabilitySqlGate` (`092`), `Phase0StateStore` (`093`), and `SequentialBuildRunner` (`095`) to operate on `@ef-harness/db` (`SqliteConnection` / `NodesEdgesRepo` / `RuntimeStateRepo` / `BudgetLedger` / `CasBlobStore`), persist Step 3b sealed checks as `nodes(kind='oracle', visibility='held_back')` + CAS blobs readable by `BlindCheckBinder` (`056`), register any additive planner checkpoint/receipt tables via `MigrationRunner` (`015`), and wire exact `measureMust` / `unresolvedContradictions` / `sealedCheckIds` methods across `081`, `088`, `091`, and `092`.

**Dependencies:** `F-007`, `F-009`, `F-010`, `F-011`, `F-012`, `F-025`, `F-034`, `F-035`, `F-039`, `F-040`.

**Verification:** `pnpm --filter @ef-harness/planner test -- master-plan feature-plan graph-compiler phase0 sequential-runner`

**Integration priority:** Planner Execution & Compilation integration tasks (Wave M2 Planner).

---

### [F-042] Unsandboxed `Phase0ExecutionController` (`093`), Non-Installing `LocalKernelPackageInstaller`, and Regex/Solid-PNG `StyleguideRouteVerifier` (`094`)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SECURITY

**Affected units:** `Task 028` (`CasBlobStore`), `Task 040` (`WindowsJobObjectManager`), `Task 046` (`KernelPackageInstaller`), `Task 047` (`HarnessRunEngine`), `Task 050` (`TestEnvOrchestrator`), `Task 057` (`UiPlaywrightContractVerifier`), `Task 093` (`packages/planner/src/phase0`), `Task 094` (`packages/planner/src/design-system`).

**Files and symbols:** `packages/planner/src/phase0/command-runner.ts:5-45` (`NodeCommandRunner`), `packages/planner/src/phase0/controller.ts:593-600` (`killPid`), `packages/planner/src/phase0/installer.ts:8-36` (`LocalKernelPackageInstaller`), `packages/planner/src/design-system/styleguide.ts:53-87,100-108,231-256` (`MemoryCasBlobStore`, `OfflineUiPlaywrightContractVerifier`, `solidPng`).

**Actual implementation:**
1. **Unsandboxed Phase 0 command execution & leaky single-PID kill:** `NodeCommandRunner` (`phase0/command-runner.ts:5-45`) executes arbitrary repo build/test/smoke commands directly via host `child_process.spawn` with a hardcoded `15000 ms` timeout and zero sandbox/Job Object containment (`F-018`), and `controller.ts:593-600` (`killPid`) calls `process.kill(pid)` on single PIDs rather than terminating a Windows Job Object tree (`Task 040`).
2. **Fake synchronous `LocalKernelPackageInstaller`:** `phase0/installer.ts:8-36` implements synchronous `install(req): InstallResult` that **never invokes `pnpm` or installs `node_modules`** — it merely returns a synthetic string `canonicalLockfile(deps)` while real `KernelPackageInstaller` (`Task 046`) is async (`Promise<InstallReceipt>`).
3. **Regex/solid-color PNG `StyleguideRouteVerifier`:** `design-system/styleguide.ts:64-87` defaults to `OfflineUiPlaywrightContractVerifier`, which never boots Playwright or renders HTML/CSS — it checks `input.routeSource.includes("console.error")` and `label.length * 8 + 32 > viewport.width - 32`, fabricates a solid single-color rectangle PNG via `solidPng(...)` (`lines 231-256`), and writes bare-hex digests into `MemoryCasBlobStore` (`lines 53-62`, violating `F-007`/`F-011` `"sha256:"` format and bypassing `Task 028` CAS and `Task 057` `UiPlaywrightContractVerifier`).

**Required architecture:** `build-pipeline.md` (`Phase 0 & Gate 0`), `security-and-governance.md`, and `ui-design-system.md` require Phase 0 commands and Gate 0 checks to execute inside `HarnessRunEngine` (`Task 047`) + Windows Job Object (`Task 040`) + `TestEnvOrchestrator` (`Task 050`), dependency installation to run asynchronously through `KernelPackageInstaller` (`Task 046`), and `/__styleguide` Gate 0 verification to render `375px` and `1440px` viewports through `UiPlaywrightContractVerifier` (`Task 057`) storing real screenshots in `CasBlobStore` (`Task 028`) with `"sha256:<64-hex>"` digests.

**Evidence:** `packages/planner/src/phase0/command-runner.ts:5-45`; `packages/planner/src/phase0/controller.ts:593-600`; `packages/planner/src/phase0/installer.ts:8-36`; `packages/planner/src/design-system/styleguide.ts:53-87,231-256`.

**Why this is a defect:** Phase 0 executes unsandboxed commands on the host, leaves `node_modules` uninstalled after `P0.1` (`LocalKernelPackageInstaller` never runs `pnpm`), orphans grandchild dev-server processes on Windows (`process.kill`), and certifies Gate 0 `/__styleguide` using fake solid-color rectangles without ever rendering the app in a browser.

**Required correction:** Wire `Phase0ExecutionController` and `FoundationGate0Verifier` (`093`) to async `KernelPackageInstaller` (`046`), `HarnessRunEngine` (`047`), `WindowsJobObjectManager` (`040`), `WorktreeSlotPool` (`038`), `TestEnvOrchestrator` (`050`), and `TemplateDbManager` (`052`), and wire `StyleguideRouteVerifier` (`094`) to `UiPlaywrightContractVerifier` (`057`) + `CasBlobStore` (`028`) with canonical `"sha256:<64-hex>"` IDs (retaining `OfflineUiPlaywrightContractVerifier` strictly for unit tests).

**Dependencies:** `F-007`, `F-011`, `F-017`, `F-018`, `F-020`, `F-022`, `F-025`, `F-040`, `F-041`.

**Verification:** `pnpm --filter @ef-harness/planner test -- phase0 design-system`

**Integration priority:** Phase 0 & Design System integration tasks (Wave M2 Planner).

---

### [F-043] `SequentialBuildRunner` (`095`) Toy Regex Default Ports, Broken `LocalFeatureIntegrator` (`journeys === 0`), Non-Executing `PostMergeSmokeChecker`, and Divergent `StateDb` Helpers

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** RUNTIME_WIRING

**Affected units:** `Task 020`–`Task 023` (`packages/db`), `Task 038`–`Task 039` (`packages/git-engine`), `Task 053` (`NativeWorkerLoop`), `Task 054` (`CompletenessGateRunner`), `Task 055`–`Task 060` (`packages/verifier`), `Task 077` (`DiffAutoTagDetector`), `Task 095` (`packages/planner/src/sequential-runner`), `Task 096` (`FeatureIntegratorEngine`), `Task 101` (`FinalAuditOrchestrator`).

**Files and symbols:** `packages/planner/src/sequential-runner/runner.ts:128-136,805-880` (`SequentialBuildRunner`, `LocalStaticAudit`, `LocalCleanVerifier`, `LocalFeatureIntegrator`, `FinalWaveAdvancement`), `packages/planner/src/sequential-runner/smoke.ts:16-112` (`PostMergeSmokeChecker`, `BarrelTypecheck`, `FastUnitSmoke`), `packages/planner/src/sequential-runner/state-db.ts:74,950-954,1029-1033` (`splitWords`, `insertNode`).

**Actual implementation:**
1. **Regex toy default ports in `SequentialBuildRunner` (`runner.ts:128-136,805-880`):** Unless overridden manually, `SequentialBuildRunner` defaults to `LocalStaticAudit` (`!diff.includes("STATIC_AUDIT_FAIL")`), `LocalCleanVerifier` (`!diff.includes("VERIFIER_FAIL")`), `FinalWaveAdvancement` (`return { status: "final_wave" }` without running Wave `W+1` JIT planning or `Task 101`), and `LocalFeatureIntegrator` which computes `journeyPassed: journeys === 0` — **automatically failing every feature that declares `>= 1` journey!**
2. **Non-executing `PostMergeSmokeChecker` (`smoke.ts:16-112`):** Defaults to `[new BarrelTypecheck(), new FastUnitSmoke()]` where `BarrelTypecheck` (`lines 62-87`) only regex-matches `export ... from "..."` in `src/index.ts` via `fs.existsSync` (never running `tsc` / `typecheck`!) and `FastUnitSmoke` (`lines 100-112`) only checks whether a synthetic file `smoke/cases.json` has `"fail": true` (returning `{ ok: true }` on all real repositories!).
3. **Divergent `StateDb` hashing & FTS UDF (`sequential-runner/state-db.ts:74,950-954,1029-1033`):** Registers yet another custom `splitWords` `ef_search_text` UDF (`F-010`/`F-031`) and writes bare 64-hex `sha256Hex(...)` into `nodes.content_hash` (`F-007`).

**Required architecture:** `build-pipeline.md` (`Step 4: Execute Tasks`), `worker-loop.md`, and `verification-and-isolation.md` require `SequentialBuildRunner` (`095`) to drive real `TaskClaimLeasesRepo` (`020`), `HoldsSubmissionsRepo` (`021`), `RuntimeLifecycleRepo` (`022`), `BudgetLedger` (`023`), `WorktreeSlotPool` + `GitRefCasUpdater` (`038`/`039`), `NativeWorkerLoop` (`053`), `CompletenessGateRunner` (`054`), `DiffAutoTagDetector` (`077`), `CleanVerifierRunner` + `PersistentRetryHintController` + `CandidateAcceptanceCommitter` (`055`–`060`), real sandboxed `typecheck` + unit smoke via `HarnessRunEngine` (`047`) in `PostMergeSmokeChecker`, `FeatureIntegratorEngine` (`096`) on `LEAVES_MERGED`, and JIT Wave `W+1` (`084`→`091`→`092`) / `FinalAuditOrchestrator` (`101`) on wave completion.

**Evidence:** `packages/planner/src/sequential-runner/runner.ts:128-136,805-880`; `packages/planner/src/sequential-runner/smoke.ts:16-112`; `packages/planner/src/sequential-runner/state-db.ts:74,950-954,1029-1033`.

**Why this is a defect:** With default ports, `SequentialBuildRunner` accepts broken unverified code (anything lacking literal `"VERIFIER_FAIL"`), misses real post-merge TypeScript/test regressions in `PostMergeSmokeChecker`, fails every feature with a journey in `LocalFeatureIntegrator`, and halts after Wave 1 without advancing to Wave 2 or Completion Wave `101`.

**Required correction:** Wire `SequentialBuildRunner` (`095`) to the canonical `@ef-harness/{db,git-engine,sandbox,worker-loop,completeness-gate,verifier,integrator}` implementations, replace `BarrelTypecheck`/`FastUnitSmoke` production defaults in `PostMergeSmokeChecker` with bounded (`<= 30 s`) `HarnessRunEngine` (`047`) incremental typecheck + unit smoke execution, and remove `sequential-runner/state-db.ts`'s duplicate `splitWords` UDF and bare-hex `content_hash` in favor of `@ef-harness/db` (`F-007`, `F-010`, `F-041`).

**Dependencies:** `F-007`, `F-008`, `F-010`, `F-012`, `F-017`, `F-018`, `F-023`, `F-024`, `F-025`, `F-032`, `F-039`, `F-041`.

**Verification:** `pnpm --filter @ef-harness/planner test -- sequential-runner`

**Integration priority:** Sequential Build Runner & M2 Pipeline integration tasks (Wave M2 Planner / Integrator).

---

### [F-044] `packages/planner/src/specialists` (`102`) Sync Model Port, Nonexistent Verifier/Audit/Hint Methods, Hardcoded `1..400` Line Grounding & Discarded `ask-owner-responder@1` Output

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 014` (`packages/db`), `Task 053` (`packages/worker-loop`), `Task 054` (`CompletenessGateRunner`), `Task 057` (`UiPlaywrightContractVerifier`), `Task 059` (`PersistentRetryHintController`), `Task 095` (`SequentialBuildRunner`), `Task 096` (`FeatureIntegratorEngine`), `Task 102` (`packages/planner/src/specialists`).

**Files and symbols:** `packages/planner/src/specialists/high-risk-diff-reviewer.ts:100-133,226-236` (`HighRiskDiffReviewer.review`), `packages/planner/src/specialists/taste-reviewer.ts:81-96,158-190` (`sourceLines`, `groundFor`, `AdvisoryTasteVisionReviewer.review`), `packages/planner/src/specialists/ask-owner.ts:134-167,207-217` (`AskOwnerResponderEngine`), `packages/planner/src/specialists/state-db.ts:7-44,80-91` (`SpecialistStateDb`).

**Actual implementation:**
1. **Sync `SpecialistModel` & nonexistent upstream port methods:** All three specialist engines invoke synchronous `consultModel(this.model, ...)` instead of async `ModelProtocolAdapter.complete(...)` (`Task 053`). `HighRiskDiffReviewer` calls `this.staticAuditGate.readReceipt(request.taskId)` (`line 111`, nonexistent on `Task 054` `CompletenessGateRunner`) and `this.hintLadder.pushReviewerDefect(...)` (`line 226`, nonexistent on `Task 059` `PersistentRetryHintController`), while `AdvisoryTasteVisionReviewer` calls `this.verifier.captureScreens([request.taskId])` (`line 176`, nonexistent on `Task 057` `UiPlaywrightContractVerifier`).
2. **Fake `1..400` line-range grounding in `taste-reviewer.ts:81-96`:** `sourceLines()` populates a hardcoded set `{1..400}` for every file without inspecting real file line counts, accepting out-of-bounds line citations on short files and dropping valid citations past line 400.
3. **Discarded LLM output & stripped DB in `AskOwnerResponderEngine` (`ask-owner.ts:137,145,158`, `state-db.ts:7-44`):** `this.askModel(...)` invokes `ask-owner-responder@1` and ignores its return value completely, answering only 5 hardcoded regex patterns (`why is task`, `which database table stores`, `auth tests`, `stripe webhook`, `did we add`) against a standalone `SpecialistStateDb` instead of `@ef-harness/db`.

**Required architecture:** `prompt-contracts.md` (`reviewer@1`, `taste-reviewer@1`, `ask-owner-responder@1`), `completeness-gate.md`, and `ui-design-system.md` require async `ModelProtocolAdapter` execution, real file line-count grounding, direct wiring of `HighRiskDiffReviewer` into `SequentialBuildRunner` (`095`) + `PersistentRetryHintController` (`059`) + `PaperworkBudgetEnvelopeAllocator` (`090` `4%` envelope), wiring of `AdvisoryTasteVisionReviewer` to `UiPlaywrightContractVerifier` (`057`) screenshots, and grounded `ProjectStateDb` (`014`) + `AskOwnerResponderV1Schema` synthesis in `AskOwnerResponderEngine`.

**Evidence:** `packages/planner/src/specialists/high-risk-diff-reviewer.ts:111,126,226`; `packages/planner/src/specialists/taste-reviewer.ts:81-96,176,183`; `packages/planner/src/specialists/ask-owner.ts:137,145,158,207-217`; `packages/planner/src/specialists/state-db.ts:7-44`.

**Why this is a defect:** None of the three specialist engines can call real async LLM providers (`053`), `reviewer@1` never runs during `SequentialBuildRunner` (`095`) and cannot push defects into `Task 059`'s hint ladder, `taste-reviewer@1` misvalidates file line ranges, and `ask-owner-responder@1` burns model tokens whose output it throws away while failing on non-regex developer questions.

**Required correction:** Convert `HighRiskDiffReviewer`, `AdvisoryTasteVisionReviewer`, and `AskOwnerResponderEngine` to async `ModelProtocolAdapter`, adapt `CompletenessGateRunner` (`054`), `UiPlaywrightContractVerifier` (`057`), and `PersistentRetryHintController` (`059`) ports to match canonical methods, compute real file line counts in `groundFor`, validate and use `AskOwnerResponderV1Schema` output backed by `@ef-harness/db` reader queries, and export `specialists` from `@ef-harness/planner`.

**Dependencies:** `F-012`, `F-023`, `F-024`, `F-025`, `F-040`, `F-043`.

**Verification:** `pnpm --filter @ef-harness/planner test -- specialists`

**Integration priority:** Planner Specialists & Review integration tasks (Wave M2/M3 Planner).

---

### [F-045] Three-Way `crew-levels` (`106`) ↔ `scheduler` (`107`) ↔ `plan-preview` (`108`) Contract Mismatches, Tier-Name-As-Model Dispatch Bug & Volatile RAM 24h Auto-Start Cap

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 020` (`TaskClaimLeasesRepo`), `Task 073` (`ChosenForYouLedger`), `Task 074` (`BoundedDeferralPolicy` / `ReadinessCalculator`), `Task 087` (`HybridRevisionEngine`), `Task 090` (`PaperworkBudgetEnvelopeAllocator`), `Task 106` (`packages/planner/src/crew-levels`), `Task 107` (`packages/planner/src/scheduler`), `Task 108` (`packages/planner/src/plan-preview`).

**Files and symbols:** `packages/planner/src/crew-levels/selector.ts:288-299` (`choosePolicy`), `packages/planner/src/scheduler/presets.ts:75-116` (`LocalExpectedCostLevelSelector`, `CrewPresetProfileEngine`), `packages/planner/src/scheduler/dispatch.ts:136-157` (`dispatchReady`), `packages/planner/src/plan-preview/local-ports.ts:13-113` (`defaultPlanPreviewSources`), `packages/planner/src/plan-preview/revision-auto-start-policy.ts:32-36,165-180` (`RevisionAutoStartPolicy`).

**Actual implementation:**
1. **Preset & crew-level casing/tier split across `106`, `107`, `108`:** `106` defines lowercase `CrewPreset = "fastest" | "balanced" | "cheapest"` and `WorkerLevel = "junior" | "mid" | "senior" | "principal"`; `107` defines TitleCase `CrewPreset = "Fastest" | "Balanced" | "Cheapest"` with lowercase `CrewLevel = "junior" | "mid" | "senior" | "principal"`; `108` defines TitleCase `CrewPreset = "Fastest" | "Balanced" | "Cheapest"` with TitleCase `CrewLevel = "Junior" | "Mid" | "Senior"` (omitting `"Principal"`!).
2. **`107` ignores `106` and passes tier name instead of `modelId` into `claimTask`:** `CrewPresetProfileEngine` (`scheduler/presets.ts:115`) defaults to `LocalExpectedCostLevelSelector` (hardcoded `number` USD-only table, no `ppm` or `HistoricalPassRateCalibrator`), its `ExpectedCostLevelSelectorPort.selectLevel` signature disagrees with `106`'s `ExpectedCostLevelSelector.select`, `scheduler/ports.ts:10-35` (`TaskClaimManagerPort.claimTask`) disagrees with `Task 020` `TaskClaimLeasesRepo.claimTask`, and `dispatch.ts:144` passes `model: level.level` (e.g. `"senior"`) instead of a concrete `modelId` from `VersionedModelRoster` (`106`)!
3. **`108` re-implements 4 sibling engines with incompatible port signatures & keeps rolling 24h auto-start spend in volatile RAM:** `defaultPlanPreviewSources()` (`local-ports.ts:106-113`) substitutes `LocalHeftCriticalPathScheduler`, `LocalCrewPresetProfileEngine`, `LocalPaperworkEnvelopeAllocator`, and `LocalRevisionImpactPreviewer` whose method signatures disagree with `107`, `090`, `087`, `073` (`forPlanPreview()` missing on `ChosenForYouLedger`), and `074` (`listDeferred`/`project` missing). Meanwhile, `RevisionAutoStartPolicy` (`revision-auto-start-policy.ts:34`) stores 24-hour auto-start spend only in `private readonly history: AutoStartHistoryEntry[] = []`, resetting the `$5.00 / 10%` 24h cap to zero on every restart!

**Required architecture:** `planning-and-crew.md` and `open-design-questions.md` require unified `CrewPreset` and `CrewLevel` types across `106`–`108`, `HeftCriticalPathScheduler` (`107`) to delegate level/model selection to `ExpectedCostLevelSelector` + `VersionedModelRoster` (`106`) and claim tasks via `TaskClaimLeasesRepo` (`020`) with concrete `modelId`, `PlanPreviewBuilder` (`108`) to consume real `073`, `074`, `087`, `090`, `106`, `107` engines, and `RevisionAutoStartPolicy` (`108`) to persist rolling 24h auto-start spend durably in `state.db`.

**Evidence:** `packages/planner/src/crew-levels/selector.ts:288,291`; `packages/planner/src/scheduler/presets.ts:75-116`; `packages/planner/src/scheduler/dispatch.ts:136-157`; `packages/planner/src/plan-preview/local-ports.ts:13-113`; `packages/planner/src/plan-preview/revision-auto-start-policy.ts:34,165-180`.

**Why this is a defect:** `106`'s Beta-Binomial pass-rate calibration, dual-currency `ppm`/`micro-USD` expected-cost math, and signed model roster are completely bypassed by `107` and `108`; `dispatchReady` (`107`) records `"senior"` instead of a real model ID on claimed attempts; `108` cannot read `ChosenForYouLedger` (`073`) or `ReadinessCalculator` (`074`) without adapter glue; and restarting the daemon wipes the `$5.00 / 10%` 24-hour auto-start safety cap.

**Required correction:** Standardize `CrewPreset` and `CrewLevel` in `@ef-harness/shared-contracts` + `@ef-harness/planner` (normalizing case boundaries cleanly), wire `CrewPresetProfileEngine` & `dispatchReady` (`107`) to `ExpectedCostLevelSelector` + `VersionedModelRoster` (`106` — propagating `modelId`) and `TaskClaimLeasesRepo` (`020`), wire `PlanPreviewBuilder` (`108`) to real `073`, `074`, `087`, `090`, `106`, `107` instances, persist `RevisionAutoStartPolicy` history in `state.db`, and export `crew-levels`, `scheduler`, and `plan-preview` from `@ef-harness/planner`.

**Dependencies:** `F-012`, `F-029`, `F-038`, `F-039`, `F-040`, `F-041`.

**Verification:** `pnpm --filter @ef-harness/planner test -- crew-levels scheduler plan-preview`

**Integration priority:** M3 Crew Levels, HEFT Scheduler & Plan Preview integration tasks.

---

### [F-046] `packages/intake` (`097–100`) `NormalizedDocument` Seam Mismatch (`097` vs `098`), Stub Package Barrel, Sync CAS/Model Ports & Rogue `SqliteBrandAssetState`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 011` (`PacketSecurityRedactor`), `Task 014` (`packages/db`), `Task 028` (`CasBlobStore`), `Task 040`/`045` (`packages/sandbox`), `Task 053` (`ModelProtocolAdapter`), `Task 070`/`071` (`packages/discovery`), `Task 094` (`DesignSystemScaffoldBuilder`), `Task 097`–`Task 100` (`packages/intake`).

**Files and symbols:** `packages/intake/src/index.ts:1-9`, `packages/intake/src/converters/types.ts:53-68,91-120` (`DocumentLocator`, `NormalizedBlock`, `NormalizedDocument`), `packages/intake/src/converters/ports/sandbox-runner.ts:30-99` (`NodeSandboxRunner`), `packages/intake/src/extraction/types.ts:18-79` (`NormalizedBlock`, `NormalizedDocument`, `IntakeLocator`), `packages/intake/src/extraction/pipeline.ts:217-223` (`IntakeExtractionPipeline.run`), `packages/intake/src/assets/brand-asset-registry.ts:173-186,214` (`BrandAssetRegistry`), `packages/intake/src/assets/sqlite-brand-state.ts:23-29,150-154` (`SqliteBrandAssetState`), `packages/intake/src/bug-scrubber/triager.ts:10-12,74-78` (`ToolLessIssueTriager.triage`).

**Actual implementation:**
1. **`NormalizedDocument` & locator structural mismatch between `097` and `098`:** `Task 097` (`converters/types.ts:91-120`) emits `{ schema: "normalized-document@1", sourceHash, fileName, mediaType, text, blocks: [{ id, kind: "heading"|"paragraph"|"list_item"|"table_cell"|"figure"|"schema", text, charStart, charEnd, utf8ByteStart, utf8ByteEnd, locator }], warnings, ocrDerived, stats }`, whereas `Task 098` (`extraction/types.ts:20-43`) expects `{ sourceId, sourceName, sourceHash, mimeType, pageCount, text, blocks: [{ id, kind: "heading"|"paragraph"|"table"|"page_break"|"list", level, text, page, paragraph, line, section, charStart, charEnd }], ocrDerived }` and a separate `IntakeLocator` union (`F-005`). Passing `097`'s output into `098` fails compilation and produces `undefined` `sourceName`/`pageCount`/`block.page`.
2. **Stub `@ef-harness/intake` barrel:** `packages/intake/src/index.ts` exports only `packageIdentity()` — none of `converters` (`097`), `extraction` (`098`), `assets` (`099`), or `bug-scrubber` (`100`) are exported.
3. **Sync CAS, sync model, and duplicate sandbox/DB/redactor ports:** `097` uses a custom `NodeSandboxRunner` + `WindowsJobSupervisor` (`sandbox-runner.ts:30-99`) and `cas.readNormalized`/`writeNormalized` absent on `Task 028`; `098` (`pipeline.ts:217`) and `100` (`triager.ts:74`) call synchronous `model.complete(...)` instead of async `ModelProtocolAdapter` (`053`); `099` (`brand-asset-registry.ts:173-186,214`) calls synchronous `cas.putBlob`/`getBlob`/`verifyBlobIntegrity`, calls nonexistent `designSystem.suggestBrandColors(...)` on `094`, and opens a separate `DatabaseSync` with duplicate `splitSearchText` UDF in `SqliteBrandAssetState` (`sqlite-brand-state.ts:23-29`); `100` duplicates `PacketSecurityRedactor` instead of importing `@ef-harness/shared-observability` (`011`, `F-003`).

**Required architecture:** `external-intake.md`, `sandbox-and-security.md`, and `prompt-contracts.md` require `097` and `098` to share one canonical `NormalizedDocument` + `SourceLocator` contract, `097` converters to run inside `@ef-harness/sandbox` (`040`/`045`), `097`/`099`/`100` to persist blobs through async `CasBlobStore` (`028`) and `@ef-harness/db` single-writer `SqliteConnection` (`014`), `098`/`100` to invoke tool-less prompts via async `ModelProtocolAdapter` (`053`) + `@ef-harness/shared-observability` (`011`), and `@ef-harness/intake` to re-export all four submodules.

**Evidence:** `packages/intake/src/index.ts:1-9`; `packages/intake/src/converters/types.ts:91-120`; `packages/intake/src/extraction/types.ts:20-43`; `packages/intake/src/extraction/pipeline.ts:217`; `packages/intake/src/assets/brand-asset-registry.ts:176,180,186,214`; `packages/intake/src/assets/sqlite-brand-state.ts:23-29`; `packages/intake/src/bug-scrubber/triager.ts:74`.

**Why this is a defect:** Dropped PDFs/DOCX/CSVs converted by `097` cannot be chunked or extracted by `098`, `BrandAssetRegistry` (`099`) cannot talk to async `CasBlobStore` (`028`) or `DesignSystemScaffoldBuilder` (`094`), `098`/`100` cannot call async LLM providers, and external packages cannot import anything from `@ef-harness/intake`.

**Required correction:** Unify `NormalizedDocument` and `DocumentLocator` across `097`, `098`, and `@ef-harness/shared-contracts`, wire `097` to `@ef-harness/sandbox`, convert `099` CAS calls and `098`/`100` model calls to async (`CasBlobStore` `028`, `ModelProtocolAdapter` `053`), replace `SqliteBrandAssetState` with `@ef-harness/db` (`NodesEdgesRepo` + `ArtifactsRepo`), add `suggestBrandColors` hook to `LookAndFeelInterviewFlow`/`DesignSystemScaffoldBuilder` (`094`), import `StreamingRedactor`/`PacketSecurityRedactor` from `@ef-harness/shared-observability` (`011`), and re-export all 4 submodules from `packages/intake/src/index.ts`.

**Dependencies:** `F-001`, `F-003`, `F-005`, `F-010`, `F-011`, `F-012`, `F-018`, `F-023`, `F-029`, `F-040`.

**Verification:** `pnpm --filter @ef-harness/intake typecheck && pnpm --filter @ef-harness/intake test`

**Integration priority:** External Intake & Asset Pipeline integration tasks (Wave M2 Intake).

---

### [F-047] `FeatureIntegratorEngine` (`096`) & `CompletionWaveController` (`101`) Stub Barrel, In-Memory Sync Verifier/Binder Stand-Ins, Private `FinalAuditStore` & Missing `BudgetLedger` Methods

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** RUNTIME_WIRING

**Affected units:** `Task 014` (`packages/db`), `Task 022` (`RuntimeLifecycleRepo`), `Task 023` (`BudgetLedger`), `Task 039` (`GitRefCasUpdater`), `Task 050` (`TestEnvOrchestrator`), `Task 053` (`ModelProtocolAdapter`), `Task 054` (`CompletenessGateRunner`), `Task 055`–`Task 057` (`packages/verifier`), `Task 095` (`SequentialBuildRunner`), `Task 096` (`packages/integrator/src/feature-integrator`), `Task 101` (`packages/integrator/src/final-audit`).

**Files and symbols:** `packages/integrator/src/index.ts:1-9`, `packages/integrator/src/feature-integrator/engine.ts:79-130,158-208` (`FeatureIntegratorEngine`), `packages/integrator/src/feature-integrator/journey-gate.ts:16-37,50-88` (`passthroughBinder`, `auditTexts`, `viewportProblems`, `FeatureJourneyGate`), `packages/integrator/src/final-audit/completion-wave-controller.ts:39-65,141-160,185-203,235` (`CompletionWaveController`), `packages/integrator/src/final-audit/state-db.ts:7-34,74-82` (`FinalAuditStore`).

**Actual implementation:**
1. **Stub `@ef-harness/integrator` barrel:** `packages/integrator/src/index.ts` exports only `packageIdentity()`.
2. **Synchronous in-memory `FeatureIntegratorEngine` (`096`):** `FeatureIntegratorEngine.integrate` (`engine.ts:87-208`) is synchronous, defaults `this.binder` to `passthroughBinder` (`{ bind: (check) => check }`, `journey-gate.ts:16-20`) instead of async `BlindCheckBinder` (`Task 056`), evaluates `bound.run(input.base)` / `check.render(check.width)` / 4-word regex `auditTexts` (`journey-gate.ts:24-37,56-88`) on in-memory `CodeSnapshot` string maps instead of running `CleanVerifierRunner` (`055`), `UiPlaywrightContractVerifier` (`057`), `CompletenessGateRunner` (`054`), and `TestEnvOrchestrator` (`050`), expects `request.modelOutput` pre-supplied instead of calling `feature-integrator@1` (`053`), and uses custom `LifecyclePort` / `createGitRefCas` instead of `RuntimeLifecycleRepo` (`022`) and `GitRefCasUpdater` (`039`).
3. **Disconnected `CompletionWaveController` (`101`):** Defines `ProjectKind = "web" | "cli" | "openapi"` (conflicting with `090`/`093`/`094`, `F-040`), opens a standalone `DatabaseSync` (`FinalAuditStore`, `final-audit/state-db.ts:7-34,77-82`) creating 4 custom `final_audit_*` tables outside `@ef-harness/db`, and calls `request.ledger.ensureCompletionScopes(...)`, `reserveAcrossScopes(...)`, and `getBudgetRemaining(...)` (`completion-wave-controller.ts:156,185,235`), none of which exist on `Task 023` `BudgetLedger`!

**Required architecture:** `parallel-feature-integration.md`, `build-pipeline.md` (`Step 5` & `Completion Wave`), and `completeness-gate.md` require `FeatureIntegratorEngine` (`096`) and `CompletionWaveController` (`101`) to execute asynchronously against real `RuntimeLifecycleRepo` (`022`), `BudgetLedger` (`023`), `GitRefCasUpdater` (`039`), `TestEnvOrchestrator` (`050`), `ModelProtocolAdapter` (`053`), `CompletenessGateRunner` (`054`), `CleanVerifierRunner` + `BlindCheckBinder` + `UiPlaywrightContractVerifier` (`055`–`057`), and single-writer `ProjectStateDb` (`014`), exported cleanly from `@ef-harness/integrator`.

**Evidence:** `packages/integrator/src/index.ts:1-9`; `packages/integrator/src/feature-integrator/engine.ts:84,87,117-126`; `packages/integrator/src/feature-integrator/journey-gate.ts:16-37,56-88`; `packages/integrator/src/final-audit/completion-wave-controller.ts:143,156,185,235`; `packages/integrator/src/final-audit/state-db.ts:7-34,77-82`.

**Why this is a defect:** `FeatureIntegratorEngine` never boots a real server, browser, database, or blind-check binder during feature integration; `CompletionWaveController` crashes against real `BudgetLedger` (`023`) and writes audit checkpoints into `:memory:` or a rogue `DatabaseSync` handle; and `SequentialBuildRunner` (`095`) cannot invoke either engine.

**Required correction:** Convert `FeatureIntegratorEngine` (`096`) to async execution wired to `RuntimeLifecycleRepo` (`022`), `GitRefCasUpdater` (`039`), `ModelProtocolAdapter` (`053`), `CompletenessGateRunner` (`054`), `CleanVerifierRunner` (`055`), `BlindCheckBinder` (`056`), and `UiPlaywrightContractVerifier` (`057`); adapt `CompletionWaveController` (`101`) to canonical `ProjectKind`, `BudgetLedger` (`023`), and `@ef-harness/db` (`MigrationRunner` `015` for `final_audit_*` checkpoint tables); and export both modules from `packages/integrator/src/index.ts`.

**Dependencies:** `F-001`, `F-008`, `F-012`, `F-017`, `F-022`, `F-023`, `F-024`, `F-025`, `F-040`, `F-043`.

**Verification:** `pnpm --filter @ef-harness/integrator typecheck && pnpm --filter @ef-harness/integrator test -- feature-integrator final-audit`

**Integration priority:** M2 Feature Integrator & Completion Wave integration tasks.

---

### [F-048] `Task 105` M2 Kitchen Exit Gate Copies Pre-Baked Static HTML/JS Fixtures (Zero M2 Package Execution), Uses Untypechecked `.ts` Import Extensions & Lacks Root Replay Scripts

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** TEST_GAP

**Affected units:** `Task 068` (`tests/e2e`), `Task 069`–`Task 102` (entire M2 pipeline), `Task 105` (`tests/e2e/m2-exit-gate`, `benchmarks/m2-kitchen-e2e`), `Task 134` (M3 Exit Gate).

**Files and symbols:** `tests/e2e/m2-exit-gate/pipeline.ts:6-8,86-95,125-159,212-226,240-271,300-493` (`copyFixture`, `generateMatrices`, `openState`, `insertDecision`, `loadTokens`, `executePipeline`), `tests/e2e/m2-exit-gate/runner.ts:7-24,106-202` (`runCertifiedReplay`), `tests/e2e/tsconfig.json:8-10`, `tests/e2e/package.json:20-22`, `package.json`.

**Actual implementation:**
1. **100% static fixture bypass of M2 packages:** `executePipeline` (`pipeline.ts:300-493`) and `tests/e2e/package.json` (`dependencies: { "@ef-harness/shared-contracts": "workspace:*" }` only) import **zero** `@ef-harness/{discovery,spec-expansion,research-engine,planner,intake,integrator,worker-loop,completeness-gate,verifier,db,git-engine,sandbox,test-env}` packages! Instead, `executePipeline` copies a hand-authored static Kitchen App from `benchmarks/m2-kitchen-e2e/fixture/` into a temp folder (`copyFixture`, `lines 86-95, 306`), computes matrix counts by multiplying array lengths (`generateMatrices`, `lines 125-159`), reads hardcoded timing/token numbers from `sequential-baseline.json` (`loadTokens`, `lines 240-271`), opens a raw `DatabaseSync` with an identity `(value) => value` `ef_search_text` UDF (`line 215`) and bare-hex `content_hash` (`line 222`), and runs `runHiddenSuite` against the hand-authored `fixture/server.mjs`!
2. **Untypechecked `m2-exit-gate` directory with illegal `.ts` import specifiers:** `tests/e2e/tsconfig.json:8-10` includes only `["src/**/*.ts"]`, completely skipping `tests/e2e/m2-exit-gate/**/*.ts` during `pnpm build` / `pnpm typecheck`. Every file in `tests/e2e/m2-exit-gate/` uses `.ts` import extensions (`from "./audit.ts"`, `from "./pipeline.ts"`, `from "./report.ts"`, `from "./types.ts"`), which fail TypeScript `NodeNext` compilation (`TS2846`/`TS5096`) when `m2-exit-gate` is included in `tsconfig.json`!
3. **Missing root CI scripts:** Root `package.json` is missing `test:m2-exit-gate:replay` and `test:m2-exit-gate:live` required by `IMPLEMENTATION_TASKS.md` (`Task 105`).

**Required architecture:** `roadmap.md` (`Milestone 2 Exit Gate`), `opening-prompts.md`, and `build-pipeline.md` require `M2KitchenE2eBenchmarkRunner` (`105`) in `ci-replay` and `live-provider` modes to drive the **real** integrated M2 packages (`Discovery` `069–075` → `.harness/views` `085–086` + `HybridRevisionEngine` `087` → `SpecExpansion` `079–081` → `ResearchEngine` `082` → `SystemArch` `083` → `MasterPlan` `090` → `PlanPreview` `108` → `Phase0` + `Gate0` `093–094` → `FeatureArch` `084` + `FeaturePlan`/`SealedOracles` `091` + `GraphCompiler` `092` + `SequentialBuildRunner` `095` + `FeatureIntegratorEngine` `096` → `CompletionWaveController` `101`), building the Kitchen App through deterministic replay/live model adapters and evaluating the resulting built app against the independent `KitchenHiddenAcceptanceSuite` (`>= 90%` pass rate).

**Evidence:** `tests/e2e/m2-exit-gate/pipeline.ts:6-8,86-95,125-159,215,222,240-271,306`; `tests/e2e/m2-exit-gate/runner.ts:7-24,114`; `tests/e2e/tsconfig.json:8-10`; `tests/e2e/package.json:20-22`.

**Why this is a defect:** `Task 105` would report `PASS (100%)` even if every M2 package (`discovery`, `spec-expansion`, `planner`, `integrator`, `worker-loop`, `verifier`) failed to compile or crashed immediately on startup, defeating the entire Milestone 2 certification gate and invalidating `Task 134`'s M2-vs-M3 speedup baseline!

**Required correction:** Convert all relative imports in `tests/e2e/m2-exit-gate/*.ts` from `.ts` to `.js`, include `m2-exit-gate/**/*.ts` (or move under `tests/e2e/src/m2-exit-gate/**`) in `tests/e2e/tsconfig.json` and export `M2KitchenE2eBenchmarkRunner` from `@ef-harness/e2e`, wire `executePipeline` to execute the real integrated M2 packages (`069–102`) with deterministic recorded-model responses in `ci-replay` mode (generating the Kitchen App via real Phase 0 + worker/integrator commits rather than `copyFixture`) and real provider adapters in `live-provider` mode, and add `test:m2-exit-gate:replay` + `test:m2-exit-gate:live` scripts to `package.json`.

**Dependencies:** `F-007`, `F-010`, `F-028`, `F-029`..`F-047`.

**Verification:** `pnpm --filter @ef-harness/e2e typecheck && pnpm test:m2-exit-gate:replay`

**Integration priority:** M2 Exit Gate certification task (end of Wave M2).

---

### [F-049] Five Isolated SQLite Schemas (`36` Custom Tables) Across M3 `packages/integrator` (`109–112, 129`), Unwired `harness.read_result` MCP Tool & 12 `Local*` CCR Mock Ports

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SCHEMA_MISMATCH

**Affected units:** `Task 014`–`Task 022` (`packages/db`), `Task 028` (`CasBlobStore`), `Task 038`–`Task 039` (`packages/git-engine`), `Task 048` (`AttemptMcpServer`), `Task 083` (`SkeletonLockEnforcer`), `Task 087` (`HybridRevisionEngine`), `Task 108` (`RevisionAutoStartPolicy`), `Task 109`–`Task 112`, `Task 116` (`QuestionArbiter`), `Task 129` (`packages/integrator/src/undo`).

**Files and symbols:** `packages/integrator/src/handoffs/ddl.ts:1-137` (`HANDOFF_DDL`), `packages/integrator/src/handoffs/mcp-surface.ts:6-15` (`HandoffMcpSurface`), `packages/integrator/src/feature-branches/state-db.ts:14-84` (`openFeatureBranchStateDb`), `packages/integrator/src/merge-queue/state-db.ts:13-72` (`openMergeQueueStateDb`), `packages/integrator/src/ccr/ledger.ts:17-70,109-116` (`CCR_DDL`, `CcrLedger`), `packages/integrator/src/ccr/engine.ts:96-114` (`ContractChangeRequestEngine`), `packages/integrator/src/undo/state-db.ts:15-90` (`KnowledgeGraphPort`).

**Actual implementation:**
1. **36 private SQLite tables across 5 raw `DatabaseSync` handles:**
   - `Task 109` (`handoffs/ddl.ts:1-137`) creates 14 private tables (`cas_blobs` storing raw `BLOB` in SQLite instead of `CasBlobStore` `028`, `graph_edges` instead of `edges`, `contract_owners` instead of `nodes`/`names`, `handoff_artifacts`, `role_mailbox`, etc.).
   - `Task 110` (`feature-branches/state-db.ts:14-69`) creates 6 private tables (`ref_leases`, `feature_branch_runtime`, `feature_read_sets`, `feature_write_scopes`, `feature_turns`, `feature_worktree_slots`).
   - `Task 111` (`merge-queue/state-db.ts:13-60`) creates 5 private tables (`ref_leases`, `merge_queue_items`, `feature_queue_runtime` — a third incompatible `feature_runtime` table!, `merge_queue_events`, `merge_queue_worktrees`).
   - `Task 112` (`ccr/ledger.ts:17-70`) creates 5 private tables (`ccr_requests`, `ccr_audit_ledger`, `ccr_wait_edges`, `ccr_notices`, `ccr_id_sequences`).
   - `Task 129` (`undo/state-db.ts:15-67`) creates 6 private tables (`undo_nodes`, `undo_edges`, `undo_inbox`, `undo_workers`, `undo_ownership`, `ref_leases`), noting that `schema/state.sql` lacks `'undone'` in `nodes.status` / `feature_states`.
2. **Disconnected intra-package & MCP wiring:** `HandoffMcpSurface` (`handoffs/mcp-surface.ts:6-15`) is never registered on `AttemptMcpServer` (`048`, `F-021`) and throws `FreeFormChatRejectedError` if handed any other tool name. `ContractChangeRequestEngine` (`ccr/engine.ts:96-114`) defaults to **12 separate `Local*` mock ports** instead of connecting to sibling `109` (`DurableRoleMailbox` / `WaitGraphCycleDetector`), `110` (`MigrationIntentAndConflictLinter`), `111` (`ProjectMergeQueue`), `083` (`SkeletonLockEnforcer`), `087` (`HybridRevisionEngine` / `ReverseImpactWalker`), `021` (`HoldsSubmissionsRepo`), or `108` (`RevisionAutoStartPolicy`). None of `109–112, 129` are exported from `packages/integrator/src/index.ts`.

**Required architecture:** `database-design.md`, `agent-handoffs.md`, `parallel-feature-integration.md`, and `stops-undo-and-reentry.md` require all integrator modules to share the single-writer `ProjectStateDb` (`014`), `leases` (`020`/`039`), `feature_runtime` (`022`), `nodes`/`edges`/`read_sets` (`017`–`021`), and `CasBlobStore` (`028`), with additive `MigrationRunner` (`015`) migrations for `handoff_artifacts`, `role_mailbox`, `merge_queue_items`, `ccr_requests`, and undone archival metadata (`nodes.status = 'retired'` with `fields.archived_reason = 'undone'` or `feature_states` `'UNDONE'`), `harness.read_result` registered on `AttemptMcpServer` (`048`), and `109–112, 129` wired directly to each other and exported from `@ef-harness/integrator`.

**Evidence:** `packages/integrator/src/handoffs/ddl.ts:1-137`; `packages/integrator/src/handoffs/mcp-surface.ts:11-14`; `packages/integrator/src/feature-branches/state-db.ts:14-84`; `packages/integrator/src/merge-queue/state-db.ts:13-72`; `packages/integrator/src/ccr/ledger.ts:17-70`; `packages/integrator/src/ccr/engine.ts:96-114`; `packages/integrator/src/undo/state-db.ts:15-90`.

**Why this is a defect:** `ParallelFeatureBranchManager` (`110`), `ProjectMergeQueue` (`111`), `FeatureUndoEngine` (`129`), and `RuntimeLifecycleRepo` (`022`) each track feature state and Git ref leases in separate uncoordinated tables (`feature_runtime` vs `feature_branch_runtime` vs `feature_queue_runtime` vs `undo_nodes`; `leases` vs three separate `ref_leases` tables), causing immediate split-brain state, `SQLITE_BUSY` multi-writer contention, dead `harness.read_result` tool calls, and isolated CCR no-ops.

**Required correction:** Consolidate `109–112, 129` persistence onto `@ef-harness/db` (`SqliteConnection` + `MigrationRunner` migration for `handoff_artifacts`, `role_mailbox`, `merge_queue_items`, `ccr_requests`, and undone archival), route blobs to `CasBlobStore` (`028`) and ref/worktree operations to `@ef-harness/git-engine` (`038`/`039`), register `ReadResultToolHandler` on `AttemptMcpServer` (`048`), wire `ContractChangeRequestEngine` (`112`) and `FeatureUndoEngine` (`129`) to real `021, 083, 087, 108, 109, 110, 111, 116` implementations, and re-export all modules from `packages/integrator/src/index.ts`.

**Dependencies:** `F-001`, `F-008`, `F-009`, `F-011`, `F-012`, `F-017`, `F-021`, `F-038`, `F-039`, `F-045`, `F-047`.

**Verification:** `pnpm --filter @ef-harness/integrator typecheck && pnpm --filter @ef-harness/integrator test -- handoffs feature-branches merge-queue ccr undo`

**Integration priority:** M3 Parallel Integrator, Merge Queue, CCR & Undo integration tasks.

---

### [F-050] `CombinedRegressionGate` (`111`), `ProjectIntegratorEngine` (`111`), and `FeatureUndoEngine` (`129`) Hardcode Toy `build.mjs` / `features/*/manifest.json` Conventions & Spawn Unsandboxed Host Commands

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** RUNTIME_WIRING

**Affected units:** `Task 046` (`KernelPackageInstaller`), `Task 047` (`HarnessRunEngine`), `Task 052` (`TemplateDbManager`), `Task 053` (`ModelProtocolAdapter`), `Task 054` (`CompletenessGateRunner`), `Task 055` (`CleanVerifierRunner`), `Task 110` (`DependencyIntentAggregator`), `Task 111` (`packages/integrator/src/merge-queue`), `Task 129` (`packages/integrator/src/undo`).

**Files and symbols:** `packages/integrator/src/merge-queue/gate.ts:90-218` (`CombinedRegressionGate.typecheck`, `build`, `migrations`, `suite`), `packages/integrator/src/merge-queue/engine.ts:82-215` (`ProjectIntegratorEngine.resolve`, `defaultModel`, `disambiguate`), `packages/integrator/src/undo/engine.ts:44` (`FeatureUndoEngine`), `packages/integrator/src/undo/gate.ts:13-57` (`CombinedRegressionGatePort`).

**Actual implementation:**
1. **Toy fixture conventions & unsandboxed execution in `CombinedRegressionGate` (`merge-queue/gate.ts:90-218`):**
   - `typecheck(worktree)` (`lines 90-110`) filters only `/\.(?:mjs|cjs|js)$/` — **skipping 100% of `.ts` and `.tsx` files** — and runs unsandboxed `node --check <file>` via `spawnCaptured`!
   - `build(worktree)` (`lines 126-145`) hardcodes `statSync(path.join(worktree, "build.mjs"))` and `node build.mjs`, failing with `ENOENT` on any real TypeScript/Vite/Next/Node target project!
   - `migrations(worktree)` (`lines 147-175`) hardcodes `template/app.sqlite` instead of `TemplateDbManager` (`052`).
   - `suite(worktree)` (`lines 177-218`) reads only `features/*/manifest.json` and spawns `node <script>` directly on the host without `HarnessRunEngine` (`047`) or `CleanVerifierRunner` (`055`).
2. **Sync `ProjectIntegratorEngine` (`merge-queue/engine.ts:82-215`) & non-injectable `CombinedRegressionGatePort` (`undo/engine.ts:44`, `undo/gate.ts:13-57`):** `ProjectIntegratorEngine.resolve` is synchronous and defaults to `defaultModel` (`disambiguate` mutating `features/<later>/manifest.json`) instead of calling async `ModelProtocolAdapter` (`053`) with `project-integrator@1` (`ccr@1` in `112` similarly runs a synchronous local heuristic reviewer in `ccr/semantic.ts` instead of `ModelProtocolAdapter`). Meanwhile, `FeatureUndoEngine` (`129`) hardcodes `new CombinedRegressionGatePort()` (which runs `spawnSync(process.execPath, [script])` only on `features/**/*.test.{mjs,cjs,js}`), ignoring `111`'s `CombinedRegressionGate` and skipping all `.ts`/`.tsx` tests!

**Required architecture:** `parallel-feature-integration.md`, `stops-undo-and-reentry.md`, and `verification-and-isolation.md` require `CombinedRegressionGate` (`111`) — shared by `FeatureUndoEngine` (`129`) — to run real project `typecheck`, `lint`, `build`, migration apply (`TemplateDbManager` `052`), `CompletenessGateRunner` (`054`), `gitleaks` (`036`), and combined feature/sealed test suites inside `CleanVerifierRunner` (`055`) + `HarnessRunEngine` (`047`), and `ProjectIntegratorEngine` (`111`) / `CcrSemanticCompatibilityReviewer` (`112`) to invoke `project-integrator@1` / `ccr@1` via async `ModelProtocolAdapter` (`053`).

**Evidence:** `packages/integrator/src/merge-queue/gate.ts:92,128,153,181,193`; `packages/integrator/src/merge-queue/engine.ts:82,97,144,182`; `packages/integrator/src/undo/engine.ts:44`; `packages/integrator/src/undo/gate.ts:13-57`.

**Why this is a defect:** Any real TypeScript application fails `CombinedRegressionGate.build` immediately (`build.mjs` missing), TypeScript type errors in `.ts`/`.tsx` files pass `CombinedRegressionGate.typecheck` undetected, tests execute unsandboxed on the host, and `FeatureUndoEngine` (`129`) passes undo commits without running TypeScript or non-`features/*.test.js` suites.

**Required correction:** Wire `CombinedRegressionGate` (`111`) to `CleanVerifierRunner` (`055`), `HarnessRunEngine` (`047`), `TemplateDbManager` (`052`), `CompletenessGateRunner` (`054`), and `SafetyScanner` (`036`) executing the target repo's real manifest commands (`typecheck`, `lint`, `build`, `test`) in sandboxed clean worktrees; inject `111`'s `CombinedRegressionGate` into `FeatureUndoEngine` (`129`); convert `ProjectIntegratorEngine.resolve` (`111`) and `112`'s `ccr@1` semantic check to async `ModelProtocolAdapter` (`053`); and wire `DependencyIntentAggregator` (`110`) to async `KernelPackageInstaller` (`046`).

**Dependencies:** `F-017`, `F-018`, `F-020`, `F-022`, `F-023`, `F-024`, `F-025`, `F-047`, `F-049`.

**Verification:** `pnpm --filter @ef-harness/integrator test -- merge-queue undo feature-branches ccr`

**Integration priority:** M3 Merge Queue & Feature Undo integration tasks.

---

### [F-051] `EditorCoexistenceWatcher` (`171`), `ZeroStashLandingExecutor` (`172`), and `HumanFixFlowEngine` (`173`) Hold/Dependency Mismatches, Unsafe Branch Cleanup, RAM-Only Landing Receipts & 7th Private SQLite DB

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 014` (`packages/db`), `Task 021` (`HoldsSubmissionsRepo`), `Task 035`–`Task 039` (`packages/git-engine`), `Task 110` (`ParallelFeatureBranchManager`), `Task 130` (`ReEntryReconciler`), `Task 171` (`packages/integrator/src/coexistence-watcher`), `Task 172` (`packages/integrator/src/landing`), `Task 173` (`packages/integrator/src/human-fix`), `Task 178` (`packages/ship-deploy`).

**Files and symbols:** `packages/integrator/package.json:20-28`, `packages/integrator/src/coexistence-watcher/watch-backend.ts:49-67` (`loadParcelWatcher`), `packages/integrator/src/coexistence-watcher/active-scope-overlap-detector.ts:52-58,70-76` (`ActiveScopeOverlapDetector`), `packages/integrator/src/landing/zero-stash-executor.ts:134-160,189-213` (`applyLandingToBranch`, `postLandingCleanup`), `packages/integrator/src/landing/receipt-store.ts:4-18` (`persistLandingReceipt`), `packages/integrator/src/human-fix/state-db.ts:8-35,115-125` (`HumanFixStateDb`).

**Actual implementation:**
1. **`Task 171` (`coexistence-watcher`) missing runtime dependency & `task_holds` contract mismatch:** `@parcel/watcher` is listed only in root `devDependencies` (`package.json:28`) and absent from `packages/integrator/package.json`, forcing `loadParcelWatcher()` (`watch-backend.ts:49-67`) to walk up 12 parent directories (which fails in packaged builds!). `ActiveScopeOverlapDetector` (`active-scope-overlap-detector.ts:52-58,74`) calls `holds.placeHold(taskId, 'editor_overlap', source)` expecting `{ holdId }` and `holds.releaseHold(hold.holdId)`, whereas `schema/state.sql:324-330` and `Task 021` `HoldsSubmissionsRepo` have **no `holdId` column** (`PRIMARY KEY (task, reason, source)`) and validate `reason` against `['user_pause', 'requirement_change', 'budget', 'ccr', 'governor']` (rejecting `'editor_overlap'`).
2. **`Task 172` (`landing`) volatile RAM receipts, checkout mutation & indiscriminate `harness/f/*` deletion:** `persistLandingReceipt` (`landing/receipt-store.ts:4-18`) writes landing receipts only into a module-global `new Map()` instead of `state.db` (`Task 130` and `Task 178` lose all landing history on restart!). `applyLandingToBranch` (`zero-stash-executor.ts:136,149`) runs `git checkout <targetBranch>` directly in the developer's checkout even if `HEAD` moved, and `postLandingCleanup` (`lines 193-212`) runs un-leased/non-CAS `git update-ref` on `harness/integration` and deletes **every** `refs/heads/harness/f/*` branch indiscriminately (wiping unmerged Wave `N+1` or deferred feature branches!).
3. **`Task 173` (`human-fix`) 7th private SQLite schema:** `HumanFixStateDb.open(filePath)` (`human-fix/state-db.ts:8-35,115-125`) opens another raw `DatabaseSync` creating `hf_tasks`, `hf_contracts`, and `hf_active_workers` instead of mutating `task_runtime` (`HUMAN_OWNED`), `nodes`, and `attempts` in `ProjectStateDb` (`014`).

**Required architecture:** `editor-coexistence.md`, `stops-undo-and-reentry.md`, and `schema/state.sql` require `@parcel/watcher` in `packages/integrator` dependencies, `task_holds` placement/release via canonical `(task, reason, source)` keys (adding `'editor_overlap'` cleanly to `HoldReason` or mapping to `'user_pause'` with `source = 'editor_overlap:<path>'`), landing receipts persisted in `state.db`, CAS/leased ref updates pruning ONLY ancestors of `landedSha` (`Task 110`), and `HUMAN_OWNED` transitions persisted directly in `ProjectStateDb` (`task_runtime` + `nodes`).

**Evidence:** `packages/integrator/package.json:20-28`; `packages/integrator/src/coexistence-watcher/watch-backend.ts:50-66`; `packages/integrator/src/coexistence-watcher/active-scope-overlap-detector.ts:52-56,74`; `packages/integrator/src/landing/zero-stash-executor.ts:136,149,195,198-212`; `packages/integrator/src/landing/receipt-store.ts:4-18`; `packages/integrator/src/human-fix/state-db.ts:8-35,115-125`.

**Why this is a defect:** Overlapping VS Code edits fail to place/release holds on `HoldsSubmissionsRepo` (`021`), `@parcel/watcher` fails to load in packaged NSIS installs, landing wipes unmerged `harness/f/*` branches and loses receipts on restart, and `HUMAN_OWNED` takeovers in `hf_tasks` remain invisible to the real scheduler/board (`task_runtime`).

**Required correction:** Add `@parcel/watcher` to `packages/integrator/package.json` `dependencies`, align `ActiveScopeOverlapDetector` with `HoldsSubmissionsRepo` (`(task, reason, source)` composite key, extending `HoldReason` with `'editor_overlap'`), persist `LandingReceipt` in `state.db` via `@ef-harness/db`, guard `applyLandingToBranch` when developer `HEAD !== targetBranch` and prune only `harness/f/*` refs reachable from `landedSha` via `ParallelFeatureBranchManager` (`110`) + `GitRefCasUpdater` (`039`), and migrate `HumanFixStateDb` (`173`) onto `@ef-harness/db` (`task_runtime`, `nodes`, `attempts`).

**Dependencies:** `F-001`, `F-012`, `F-017`, `F-039`, `F-049`.

**Verification:** `pnpm --filter @ef-harness/integrator test -- coexistence-watcher landing human-fix`

**Integration priority:** M5 Coexistence, Safe Landing & Human-Fix integration tasks.

---

### [F-052] `UiConsistencyPipeline` (`174`) 5th Conflicting `ProjectKind` (`"ui"`), Passive Pre-Computed Audit Inputs (No Playwright Execution), 1×1 Pixel `InMemoryCasStore` & Toy Default Ports

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** RUNTIME_WIRING

**Affected units:** `Task 028` (`CasBlobStore`), `Task 054` (`CompletenessGateRunner`), `Task 057` (`UiPlaywrightContractVerifier`), `Task 094` (`DesignTokenLintRuleset`), `Task 099` (`BrandAssetRegistry`), `Task 102` (`AdvisoryTasteVisionReviewer`), `Task 161` (`BeforeAfterBaselineApprover`), `Task 174` (`packages/integrator/src/ui-checks`).

**Files and symbols:** `packages/integrator/src/ui-checks/ui-consistency-pipeline.ts:27-30,64-74,113-167` (`hasUiSignals`, `UiConsistencyPipeline`), `packages/integrator/src/ui-checks/local-ports.ts:5-61` (`defaultConsumedPorts`).

**Actual implementation:**
1. **5th conflicting `ProjectKind` string (`"ui"`):** `hasUiSignals` (`ui-consistency-pipeline.ts:28`) returns `false` (`not_applicable_no_ui`) whenever `input.projectKind !== "ui"`, whereas `090`/`093` emit `"web_saas"`, `094`/`101` emit `"web"` (`F-040`, `F-047`) — causing `UiConsistencyPipeline` to skip all 6 UI stages silently on `"web_saas"` / `"web"` projects!
2. **Passive Stages 3–6 (zero Playwright / `axe-core` execution) & 1×1 red pixel CAS:** Stages 3–6 (`lines 113-156`) never call `UiPlaywrightContractVerifier` (`Task 057`) — they only inspect optional pre-supplied arrays (`input.routeAudits ?? []`, `input.axeViolations ?? []`, `input.rhythmMetrics ?? []`, `input.screenshots ?? []`), passing vacuously with 0 checks if omitted! On Stage 3 layout errors (`lines 120-126`), it writes a dummy 1×1 red pixel (`width: 1, height: 1, pixels: [255,0,0,255]`) into `InMemoryCasStore` instead of storing real expected/actual/diff PNGs in `CasBlobStore` (`Task 028`).
3. **5 disconnected toy default ports (`local-ports.ts:5-61`):** `defaultConsumedPorts` wires `LocalStaticAuditGate` (checks only `console.log(`), `LocalDesignTokenLint`, `LocalBrandAssetRegistry`, `MemoryBeforeAfterBaseline`, and `LocalTasteReviewer` whose interfaces disagree with `054`, `094`, `099`, `161`, and `102`.

**Required architecture:** `ui-design-system.md` (`Verifying UI Consistency`) requires `UiConsistencyPipeline` (`174`) to recognize canonical UI `ProjectKind`s, drive `DesignTokenLintRuleset` (`094`) + `BrandAssetRegistry` (`099`) + `CompletenessGateRunner` (`054`), execute real 3-width (`375`/`768`/`1440`) light/dark Playwright + `axe-core` + computed-style rhythm + screenshot captures via `UiPlaywrightContractVerifier` (`057`), store real PNG diff artifacts in `CasBlobStore` (`028`) with `"sha256:<64-hex>"` digests, read approved baselines from `Task 094`/`161`, and forward passing screenshots to `AdvisoryTasteVisionReviewer` (`102`).

**Evidence:** `packages/integrator/src/ui-checks/ui-consistency-pipeline.ts:28,64-74,114-156,164-167`; `packages/integrator/src/ui-checks/local-ports.ts:5-61`.

**Why this is a defect:** Passing `"web_saas"` or `"web"` causes `UiConsistencyPipeline` to skip 100% of UI checks as `"not_applicable_no_ui"`, omitting `routeAudits`/`axeViolations` causes Stages 3–6 to pass vacuously without launching a browser, and visual diff artifacts vanish in `InMemoryCasStore`.

**Required correction:** Normalize `hasUiSignals` to canonical `ProjectKind` (`F-040`), wire `UiConsistencyPipeline` (`174`) to `UiPlaywrightContractVerifier` (`057`), `CompletenessGateRunner` (`054`), `DesignTokenLintRuleset` (`094`), `BrandAssetRegistry` (`099`), `AdvisoryTasteVisionReviewer` (`102`), `BeforeAfterBaselineApprover` (`161`), and `CasBlobStore` (`028`), and export `ui-checks` from `packages/integrator/src/index.ts`.

**Dependencies:** `F-007`, `F-011`, `F-024`, `F-025`, `F-040`, `F-042`, `F-044`, `F-046`, `F-047`.

**Verification:** `pnpm --filter @ef-harness/integrator test -- ui-checks`

**Integration priority:** M5 UI Consistency Pipeline integration tasks.

---

### [F-053] `packages/steering` (`113–116, 130`) Stub Barrel, Three Conflicting SQLite Schemas (`task_runtime` DDL Crash & `qa_*` Shadow Tables), and RAM-Only `SteeringRuntime` / `InMemoryReentryStore`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SCHEMA_MISMATCH

**Affected units:** `Task 014`–`Task 026` (`packages/db`), `Task 113`–`Task 116`, `Task 130` (`packages/steering`, `apps/renderer/src/cockpit/welcome-back`).

**Files and symbols:** `packages/steering/src/index.ts:1-9`, `packages/steering/src/router/ddl.ts:6-91` (`ROUTER_DDL`), `packages/steering/src/dispatcher/dispatcher.ts:47-74,124` (`RouteTelemetry`, `FourRouteSteeringDispatcher`), `packages/steering/src/holds/database.ts:18-128` (`HOLD_SCHEMA_SQL`, `openHoldDatabase`), `packages/steering/src/question-arbiter/ddl.ts:1-136` (`QUESTION_ARBITER_DDL`, `TELEMETRY_DDL`), `packages/steering/src/reentry/state-store.ts:66-180` (`InMemoryReentryStore`), `apps/renderer/src/cockpit/welcome-back/welcome-back-screen.ts:27-43` (`WelcomeBackScreen`).

**Actual implementation:**
1. **Stub `@ef-harness/steering` barrel:** `packages/steering/src/index.ts` exports only `packageIdentity()`.
2. **Three conflicting private SQLite schemas across `113`, `115`, `116`:**
   - `Task 113` (`router/ddl.ts:6-91`) creates `user_messages`, `message_clauses`, `input_focus_snapshots`, `router_catalog` (duplicating `nodes`/`kb_words` FTS), plus duplicate triggerless `outbox` and `outbox_deliveries` tables.
   - `Task 115` (`holds/database.ts:18-128`) executes `CREATE TABLE task_runtime (...)` and `CREATE TABLE task_holds (...)` **without `IF NOT EXISTS`** alongside 8 custom tables (`hold_reason_details`, `task_checkpoints`, `quarantined_candidates`, etc.) — **crashing immediately (`table task_runtime already exists`) when opened against real `state.db`**!
   - `Task 116` (`question-arbiter/ddl.ts:1-136`) creates parallel shadow tables `qa_inbox_items` (with `status IN (...,'retired')`), `qa_inbox_subscribers`, `qa_holds`, `qa_settled_facts`, and `qa_settled_fts` right next to `schema/state.sql`'s canonical `inbox_items` (whose `CHECK` allows only `'open'|'answered'|'superseded'|'dismissed'`) and `inbox_subscribers`, plus embeds `TELEMETRY_DDL` inside `state.db` instead of `TelemetryDb` (`014`).
3. **RAM-only runtime stores in `114` & `130` + invalid `attempts.state`:** `FourRouteSteeringDispatcher` (`114`) mutates an in-memory `SteeringRuntime` and `RouteTelemetry` array instead of `project_runtime` (`state.db`) and `telemetry.db`. `Task 130` (`reentry/state-store.ts:66-180`) provides only `InMemoryReentryStore`, where `markCheckpointed` writes `status: "CHECKPOINTED"` — invalid against `schema/state.sql:343` `attempts.state CHECK (state IN ('running','submitted','accepted','rejected','parked','fenced','crashed'))`! Furthermore, `WelcomeBackScreen` (`welcome-back-screen.ts:27-43`) returns a plain view-model object and is not mounted into `apps/renderer`.

**Required architecture:** `database-design.md`, `routing-design.md`, `agent-graph-routing.md`, and `stops-undo-and-reentry.md` require all steering and re-entry persistence to run against single-writer `ProjectStateDb` + `TelemetryDb` (`014`), using canonical `nodes`/`kb_words`/`kb_ident` (`017`/`018`), `task_runtime`/`task_holds`/`attempts`/`candidates` (`020`–`022`, using `'parked'`/`'crashed'` attempt states), `inbox_items`/`inbox_subscribers`/`outbox` (`025`/`026`), additive `MigrationRunner` (`015`) migrations only for `user_messages`, `message_clauses`, `input_focus_snapshots`, and `hold_reason_details` (plus extending `inbox_items.status` or mapping `'retired'` cleanly), and full exports from `@ef-harness/steering`.

**Evidence:** `packages/steering/src/index.ts:1-9`; `packages/steering/src/router/ddl.ts:62-90`; `packages/steering/src/holds/database.ts:19-38`; `packages/steering/src/question-arbiter/ddl.ts:2-135`; `packages/steering/src/reentry/state-store.ts:66,179`; `schema/state.sql:343`.

**Why this is a defect:** `MultiInterpretationHoldEngine` (`115`) crashes on open against `state.db`; `SharedQuestionArbiter` (`116`) writes to `qa_inbox_items` while `InboxOutboxRepo` (`026`) and renderer read `inbox_items`; `ImmediateKernelStopController` (`114`) flips an in-memory variable instead of `project_runtime.state` in `state.db`; and `ColdOpenReconciler` (`130`) writes `"CHECKPOINTED"` which violates `attempts.state` CHECK constraints.

**Required correction:** Migrate `113–116, 130` onto `@ef-harness/db` (`SqliteConnection`, `FtsSearchRepo` `018`, `HoldsSubmissionsRepo` `021`, `RuntimeLifecycleRepo` `022`, `InboxOutboxRepo` `026`, `TelemetryDb` `014`) with a single additive `MigrationRunner` (`015`) migration for `user_messages`, `message_clauses`, `input_focus_snapshots`, and `hold_reason_details` (mapping retired inbox items to `'superseded'`/`'dismissed'` or migrating `inbox_items` cleanly, and mapping recovered orphaned attempts to `'parked'` with `attempt_checkpoints`), mount `WelcomeBackScreen` in `apps/renderer`, and export all 5 modules from `packages/steering/src/index.ts`.

**Dependencies:** `F-001`, `F-008`, `F-009`, `F-010`, `F-012`, `F-026`, `F-039`, `F-051`.

**Verification:** `pnpm --filter @ef-harness/steering typecheck && pnpm --filter @ef-harness/steering test`

**Integration priority:** M3 Steering, Holds, Question Arbiter & Re-Entry integration tasks.

---

### [F-054] `SteeringMessageRouter` (`113`) Discards `router@1` LLM Output, `FourRouteSteeringDispatcher` (`114`) Rejects `AskOwnerResponderEngine` (`102`) & Emits Invalid `"user_paused"` Hold Reason

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 021` (`HoldsSubmissionsRepo`), `Task 053` (`ModelProtocolAdapter`), `Task 087` (`HybridRevisionEngine`), `Task 102` (`AskOwnerResponderEngine`), `Task 108` (`RevisionAutoStartPolicy`), `Task 113`–`Task 116`, `Task 130` (`packages/steering`).

**Files and symbols:** `packages/steering/src/router/runtime.ts:203-249` (`SteeringMessageRouter.route`, `gateModel`), `packages/steering/src/dispatcher/dispatcher.ts:141-163` (`FourRouteSteeringDispatcher.dispatchReadOnlyQuery`), `packages/steering/src/dispatcher/types.ts:11` (`USER_PAUSED_REASON`), `packages/steering/src/dispatcher/kernel-stop.ts:164,197` (`pauseFeature`, `resumeFeature`).

**Actual implementation:**
1. **`SteeringMessageRouter` (`113`) discards `router@1` output:** In `router/runtime.ts:203-215`, `this.gateModel(...)` invokes synchronous `this.model` (`router@1`) up to twice and validates its `RouterV1` JSON against `allowed` target IDs, **then discards the model's returned clauses completely** and runs local regex heuristic `planMessage(...)` (`decompose.ts`) instead! Moreover, `RouterModelPort` is synchronous rather than async `ModelProtocolAdapter` (`053`).
2. **`FourRouteSteeringDispatcher` (`114`) crashes when wired to `AskOwnerResponderEngine` (`102`):** `dispatchReadOnlyQuery` (`dispatcher/dispatcher.ts:145-150`) calls synchronous `this.askOwner.answerQuestion(input.text)` and throws `SteeringError("READ_ONLY_LLM")` whenever `answer.llmCalls !== 0`. However, `Task 102` `AskOwnerResponderEngine.answerQuestion` (`specialists/ask-owner.ts:134-139`) invokes `ask-owner-responder@1` and returns `OwnerAnswer` **without an `llmCalls` field** (`undefined !== 0`), causing every Route-1 developer question to throw `READ_ONLY_LLM`!
3. **4th conflicting `task_holds.reason` string (`"user_paused"`):** `dispatcher/types.ts:11` and `kernel-stop.ts:164,197` use `USER_PAUSED_REASON = "user_paused"`, whereas `schema/state.sql:326`, `Task 021`, and `Task 107` specify `"user_pause"` (`F-039`, `F-051`).
4. **Disconnected intra-steering & cross-package ports:** `113` (`OrderedMultiClauseExecutor`), `114` (`FourRouteSteeringDispatcher`), `115` (`MultiInterpretationHoldEngine`), `116` (`SharedQuestionArbiter`), and `130` (`ColdOpenReconciler`) define mutually incompatible local port interfaces (`ClauseDispatchPort` vs `FourRouteSteeringDispatcher`, `AmbiguityHoldPort` vs `MultiInterpretationHoldEngine`, etc.).

**Required architecture:** `routing-design.md`, `prompt-contracts.md` (`router@1`, `ask-owner-responder@1`), and `schema/state.sql:326` require `SteeringMessageRouter` (`113`) to execute async `router@1` via `ModelProtocolAdapter` (`053`) and materialize the validated `RouterV1` clauses into `OrderedMultiClauseExecutor`, `FourRouteSteeringDispatcher` (`114`) Route 1 to await `AskOwnerResponderEngine` (`102` — enforcing 0 graph mutations and 0 holds, NOT 0 LLM synthesis calls for `ask-owner-responder@1`!), `pauseFeature`/`resumeFeature` to use canonical `"user_pause"`, and `113`→`114`→`115`→`116` + `130` to connect seamlessly.

**Evidence:** `packages/steering/src/router/runtime.ts:203-215,223-249`; `packages/steering/src/dispatcher/dispatcher.ts:145-150`; `packages/steering/src/dispatcher/types.ts:11`; `packages/steering/src/dispatcher/kernel-stop.ts:164,197`.

**Why this is a defect:** Free-form multi-clause messages burn `router@1` LLM calls whose parsed intents are thrown away; Route-1 status questions crash immediately with `READ_ONLY_LLM`; `pauseFeature` fails `HoldReason` validation (`"user_paused"` vs `"user_pause"`); and none of the 5 steering modules can invoke each other without adapter rewrites.

**Required correction:** Convert `SteeringMessageRouter` (`113`) and `FourRouteSteeringDispatcher` (`114`) to async execution, propagate the validated `RouterV1` clauses from `gateModel` instead of overwriting them with `planMessage` (keeping `planMessage` only as offline fallback), remove the `answer.llmCalls !== 0` throw in `dispatchReadOnlyQuery` while preserving the read-only state/hold fingerprint invariant, change `USER_PAUSED_REASON` from `"user_paused"` to `"user_pause"`, and wire `113`↔`114`↔`115`↔`116` + `130` to canonical `@ef-harness/{db,git-engine,sandbox,worker-loop,discovery,planner,integrator}` ports.

**Dependencies:** `F-012`, `F-023`, `F-039`, `F-044`, `F-045`, `F-049`, `F-051`, `F-053`.

**Verification:** `pnpm --filter @ef-harness/steering test`

**Integration priority:** M3 Steering Router & Dispatcher integration tasks.

---

### [F-055] `packages/governor` (`117–121`) Stub Barrel, `"GREEN"` vs `"Green"` Pressure Crash (`118`→`119`), Dual-DB `SqliteVaultMetadataStore` (`120`), and Invalid `"waiting_on_human_step"` Hold Reason (`121`)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 011` (`PacketSecurityRedactor`), `Task 014` (`GlobalBrokerDb` / `TelemetryDb` / `ProjectStateDb`), `Task 021` (`HoldsSubmissionsRepo`), `Task 040` (`WindowsJobObjectManager`), `Task 107` (`HeftCriticalPathScheduler`), `Task 117`–`Task 121` (`packages/governor`), `Task 196` (NSIS Packaging).

**Files and symbols:** `packages/governor/src/index.ts:1-9`, `packages/governor/src/telemetry/collector.ts:185-206` (`openWindowsResourceTelemetryCollector`), `packages/governor/src/admission/types.ts:1,38-62` (`PRESSURE_LEVELS`, `FootprintRecord`), `packages/governor/src/admission/learned-footprint-store.ts:52-91` (`LearnedFootprintStore`), `packages/governor/src/capacity-pools/scheduler.ts:105-108,192-198` (`ThreePoolCapacityScheduler.setPressure`), `packages/governor/src/vault/metadata-store.ts:29-50,146-156` (`SqliteVaultMetadataStore`), `packages/governor/src/human-steps/store.ts:65-90` (`HumanStepStateStore.create`).

**Actual implementation:**
1. **Stub `@ef-harness/governor` barrel:** `packages/governor/src/index.ts` exports only `packageIdentity()`.
2. **Intra-package pressure-level casing crash (`118` vs `119` & `107`):** `Task 118` (`admission/types.ts:1`) emits uppercase `PRESSURE_LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"]`, whereas `Task 119` (`capacity-pools/scheduler.ts:105-108,192-195`) and `Task 107` validate TitleCase `"Green" | "Yellow" | "Orange" | "Red"` and throw `CapacityError("invalid_request", "Unknown governor pressure")` when handed `"GREEN"` or `"ORANGE"`!
3. **`LearnedFootprintStore` (`118`) vs `GlobalBrokerDb` (`014`):** `LearnedFootprintStore` (`learned-footprint-store.ts:52-91`) expects `db.footprints.get/upsert` storing 14 fields (`p90Mb`, `peakRamMb`, `peakCpuTimeMs`, `diskWriteBytes`, `wallClockMs`, `highWatermarkMb`, `predictedMb`, `peakRamSamplesMb`), whereas `schema/global.sql` `footprints` only has `(consumer, project, p50_mb, p95_mb, samples, updated_at)` and `014` `GlobalBrokerDb` has no `footprints` repository object.
4. **Dual raw `DatabaseSync` writers in `SqliteVaultMetadataStore` (`120`) + duplicate redactor:** `vault/metadata-store.ts:34-50,146-156` opens separate `DatabaseSync` connections on **both** `global.db` and `state.db`, creates `vault_secret_metadata` outside `MigrationRunner`, performs non-atomic cross-file writes (violating `schema/global.sql:2-3` single-writer rule and `F-012`), and duplicates `PacketSecurityRedactor` (`vault/redactor.ts`) instead of `@ef-harness/shared-observability` (`011`).
5. **5th conflicting `task_holds.reason` (`"waiting_on_human_step"`) in `121` & uncompiled C# helper in `117`:** `HumanStepStateStore.create` (`human-steps/store.ts:84-89`) inserts `reason: "waiting_on_human_step"` into `task_holds` (rejected by `021`/`107` `HoldReason` validation, `F-039`/`F-051`/`F-054`) and creates `human_steps` outside `MigrationRunner` (`015`). Meanwhile `117` (`collector.ts:185-206`) relies on compiling `win32-helper.cs` at runtime or silently degrades on Windows to `PosixFallbackTelemetryProvider` (losing commit charge, Job accounting, DXGI VRAM, disk queue, and `MsMpEng.exe` signals).

**Required architecture:** `app-shell-and-governor.md`, `execution-capacity.md`, `sandbox-and-security.md`, `schema/global.sql`, and `schema/state.sql` require one canonical `GovernorPressure` enum across `118`, `119`, `107`, and `165`, `LearnedFootprintStore` (`118`) and `WindowsDpapiSecretsVault` (`120`) routed through single-writer `GlobalBrokerDb` / `ProjectStateDb` (`014` + `MigrationRunner` `015`) and `StreamingRedactor` (`011`), canonical `HoldReason` handling for `human_steps` (`121`), pre-built/bundled Win32 telemetry helper (`117`/`196`), and full exports from `@ef-harness/governor`.

**Evidence:** `packages/governor/src/index.ts:1-9`; `packages/governor/src/admission/types.ts:1,38-62`; `packages/governor/src/capacity-pools/scheduler.ts:105-108,192-195`; `packages/governor/src/vault/metadata-store.ts:34-50,146-156`; `packages/governor/src/human-steps/store.ts:65-90`; `packages/governor/src/telemetry/collector.ts:185-206`.

**Why this is a defect:** Connecting `PressureHysteresisStateMachine` (`118`) to `ThreePoolCapacityScheduler` (`119`) throws immediately on every pressure transition; `120` causes `SQLITE_BUSY` contention on both `global.db` and `state.db`; `121` hold rows fail `HoldReason` validation; `117` silently loses Windows-specific hardware protection if `csc.exe` is absent on user machines; and external consumers cannot import `@ef-harness/governor`.

**Required correction:** Normalize `GovernorPressure` casing across `118`, `119`, `107`, and `@ef-harness/shared-contracts`; wire `117`→`118`→`119` and pre-compile `win32-helper.exe` during build/packaging; route `LearnedFootprintStore` (`118`), `SqliteVaultMetadataStore` (`120`), and `HumanStepStateStore` (`121`) through `@ef-harness/db` (`GlobalBrokerDb` / `ProjectStateDb` + `MigrationRunner` `015`) and `@ef-harness/shared-observability` (`011`); align `HoldReason` (`'governor'` / extended union across `021`, `107`, `121`); and export all 5 submodules from `packages/governor/src/index.ts`.

**Dependencies:** `F-001`, `F-003`, `F-009`, `F-012`, `F-018`, `F-039`, `F-045`, `F-051`, `F-054`.

**Verification:** `pnpm --filter @ef-harness/governor typecheck && pnpm --filter @ef-harness/governor test`

**Integration priority:** M3 Hardware Governor, Capacity Pools, Vault & Human-Steps integration tasks.

---

### [F-056] `Task 134` M3 Parallel Exit Gate Re-Implements Local Fake `HeftCriticalPathScheduler` / `ProjectMergeQueue` / `WindowsDpapiSecretsVault` Classes (Zero M3 Package Execution) & Uses `.ts` Imports

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** TEST_GAP

**Affected units:** `Task 068` (`tests/e2e`), `Task 105` (M2 Exit Gate), `Task 106`–`Task 133` (entire M3 parallel stack), `Task 134` (`tests/e2e/m3-exit-gate`, `benchmarks/m3-parallel`).

**Files and symbols:** `tests/e2e/m3-exit-gate/runner.ts:4-19,21-58,66-120` (`M3ParallelBenchmarkRunner.run`), `tests/e2e/tsconfig.json:8-10`, `tests/e2e/package.json:20-22`.

**Actual implementation:**
1. **100% mock re-implementation of M3 packages:** `tests/e2e/m3-exit-gate/runner.ts:4-19` imports **zero** `@ef-harness/*` packages! Instead, `./kitchen.ts`, `./merge-queue.ts`, `./schedule.ts`, `./scale.ts`, and `./scenarios.ts` define fake local classes named `HeftCriticalPathScheduler`, `DynamicScheduleRebalancer`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner`, and `KitchenHiddenAcceptanceSuite`. `M3ParallelBenchmarkRunner.run` (`lines 21-58, 83-109`) evaluates `suite.run(kitchenFromLanded(landed))` over 4 hardcoded 1-line strings (`"Orders close at 11:00 and ignore a client clock.\n"`) without building or booting any Kitchen App, HTTP server, SQLite database, Mailpit, Playwright, `CoordinatorWriteQueue` (`025`), or `BoardCockpitView` (`124`)!
2. **Untypechecked `.ts` relative imports:** Like `Task 105` (`F-048`), all files in `tests/e2e/m3-exit-gate/*.ts` use `.ts` import extensions (`from "./fixtures.ts"`, `from "./kitchen.ts"`, etc.) outside `tests/e2e/tsconfig.json`'s `"include": ["src/**/*.ts"]`.

**Required architecture:** `roadmap.md` (`Milestone 3 Exit Gate`) requires `M3ParallelBenchmarkRunner` (`134`) to execute the **real** integrated M3 stack (`HeftCriticalPathScheduler` `107`, `ParallelFeatureBranchManager` `110`, `ProjectMergeQueue` `111`, `ContractChangeRequestEngine` `112`, `SteeringMessageRouter`/`FourRouteSteeringDispatcher`/`MultiInterpretationHoldEngine` `113–115`, `ThreePoolCapacityScheduler`/`PressureHysteresisStateMachine`/`WindowsDpapiSecretsVault` `118–120`, `FeatureUndoEngine` `129`, `ColdOpenReconciler` `130`, `CoordinatorWriteQueue` `025`, `BoardCockpitView` `124`) against `Task 105`'s real `KitchenHiddenAcceptanceSuite` (`>= 2.0×` speedup, `0%` pass-rate drop, 50-worker `p99 < 50 ms`, 500-task Board `< 10 ms`).

**Evidence:** `tests/e2e/m3-exit-gate/runner.ts:4-19,21-58,88-118`; `tests/e2e/tsconfig.json:8-10`; `tests/e2e/package.json:20-22`.

**Why this is a defect:** `Task 134` passes 100% of its assertions without importing or executing a single line of M3 production code from `packages/planner`, `packages/integrator`, `packages/steering`, `packages/governor`, `packages/db`, or `apps/renderer`!

**Required correction:** Convert `.ts` relative import specifiers in `tests/e2e/m3-exit-gate/*.ts` to `.js`, include `m3-exit-gate` in `tests/e2e/tsconfig.json` and `@ef-harness/e2e` exports, and replace the local fake stand-ins in `m3-exit-gate/{kitchen,merge-queue,schedule,scale,scenarios}.ts` with real imports of `@ef-harness/{db,planner,integrator,steering,governor,e2e}` and `apps/renderer` (`BoardCockpitView`), comparing head-to-head against `Task 105`'s real `M2ExitGateReport`.

**Dependencies:** `F-028`, `F-045`, `F-048`..`F-055`.

**Verification:** `pnpm --filter @ef-harness/e2e typecheck && pnpm --filter @ef-harness/e2e test -- m3-exit-gate`

**Integration priority:** M3 Exit Gate certification task (end of Wave M3).

---

### [F-057] `packages/providers` (`135`–`140`) Empty Barrel, Six Divergent `global.db` Schemas (Including Destructive `route = 'api_key'` `CHECK` in `136`), Six Incompatible `WindowsDpapiSecretsVault` (`120`) Ports, Unpersisted `k[model]` Weights & Unwired Policy/Roster Methods

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 014` (`GlobalBrokerDb`), `Task 023` (`BudgetLedger`), `Task 024` (`BrokerGrantIssuer`), `Task 106` (`VersionedModelRoster`), `Task 117`–`Task 118` (`WindowsResourceTelemetryCollector` / `GpuWhisperPriorityArbiter`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 128` (`BudgetWindDownController`), `Task 135`–`Task 140` (`packages/providers`).

**Files and symbols:** `packages/providers/src/index.ts:1-9`, `packages/providers/src/policy/global-db-policy-port.ts:5-41` (`GlobalDbPolicyPort`), `packages/providers/src/policy/versioned-model-roster-port.ts:10-107` (`VersionedModelRosterPort`), `packages/providers/src/api-keys/local-global-db-connections.ts:68-98` (`LocalGlobalDbConnections`), `packages/providers/src/api-keys/local-dpapi-vault.ts:30-38,61-64` (`LocalDpapiSecretsVault`), `packages/providers/src/api-keys/sibling-ports.ts:41-43`, `packages/providers/src/siwc/store.ts:71-103` (`SqliteSiwcInstallationStore`), `packages/providers/src/siwc/ports.ts:26-28,47-51`, `packages/providers/src/openrouter-local/ports.ts:27-31,59-64`, `packages/providers/src/copilot-cursor-auth/types.ts:139-150,201-231`, `packages/providers/src/copilot-cursor-auth/local-ports.ts:23-73,235-242` (`LocalWindowsDpapiSecretsVault`), `packages/providers/src/pacing/global-connection-window-repo.ts:38-73` (`InMemoryGlobalConnectionWindowRepo`), `packages/providers/src/pacing/model-allowance-weight-learner.ts:42-65` (`ModelAllowanceWeightLearner`).

**Actual implementation:**
1. **Empty barrel & six competing `global.db` schemas/stores:** `packages/providers/src/index.ts` remains the empty `packageIdentity()` stub across `135`–`141`. `135` (`GlobalDbPolicyPort`) opens a standalone `DatabaseSync` creating out-of-schema `policy_history` with ISO strings; `136` (`LocalGlobalDbConnections`) opens a standalone `DatabaseSync` creating out-of-schema `api_key_connection_meta` AND creating `connections` with **`CHECK (provider IN ('anthropic','openai','openrouter','gemini','custom'))`, `CHECK (route = 'api_key')`, and `CHECK (currency = 'usd')`** — which causes `SQLITE_CONSTRAINT_CHECK` crashes on every subscription or local route (`siwc`, `copilot_sdk`, `cursor_sdk`, `local`)! `137` (`SqliteSiwcInstallationStore`) opens a third `DatabaseSync`; `138`, `139` (which assumes a nonexistent `metadata_json` column on `connections`), and `140` (`InMemoryGlobalConnectionWindowRepo` + volatile in-memory `ModelAllowanceWeightLearner.models` `Map`) run only in RAM without persisting `connection_windows` or learned `k[model]` weights to `GlobalBrokerDb` (`014`).
2. **Six mutually incompatible `WindowsDpapiSecretsVault` (`Task 120`) contracts & insecure local vaults:** Real `Task 120` uses async `storeSecret`/`readPlaintextForKernel`/`deleteSecret`; `136` uses sync `put`/`getPlaintext` backed by `dpapi-vault.json` encrypted with an ephemeral `randomBytes(32)` key per boot (losing all saved API keys on process restart!); `137` uses `put(name, value): Promise<void>`/`get(name)`; `138` uses `put({ projectId, envScope, name, value })`/`readSecret`; `139` uses sync `writeSecret`/`readSecret` backed by **single-byte XOR `^ 0x5a`** in memory (`local-ports.ts:235-242`).
3. **Disconnected intra-`providers` sibling ports:** `136` calls `policy.currentPriceTable()`, `137` calls `policy.readSiwcPolicy()`, and `139` calls `policy.copilotPremiumMultipliers()` — none of which exist on `135` `SignedProviderPolicyEngine` (`activeDocument()`, `complianceLocks()`, `cliGate()`, `revocationHandler()`, `rosterPort()`), and `135`'s `VersionedModelRosterPort` is an isolated in-memory map disconnected from `Task 106` `VersionedModelRoster` and `Task 140` `ModelAllowanceWeightLearner.feeds()`.

**Required architecture:** `provider-connections.md`, `security-and-governance.md`, and `schema/global.sql` require `GlobalBrokerDb` (`014`) + `BrokerGrantIssuer` (`024`) to own the single writer lock on `global.db` (storing `connections`, `connection_windows`, `settings`, and an additive `MigrationRunner` v2 migration for connection profile metadata, `policy_history`, and `model_weights`), `WindowsDpapiSecretsVault` (`120`) to store all API keys and OAuth tokens exclusively in Windows DPAPI, and `SignedProviderPolicyEngine` (`135`) + `AllowancePacingController` (`140`) to feed `VersionedModelRoster` (`106`) directly.

**Evidence:** `packages/providers/src/api-keys/local-global-db-connections.ts:68-98`; `packages/providers/src/api-keys/local-dpapi-vault.ts:30-38,61-64`; `packages/providers/src/policy/global-db-policy-port.ts:5-41`; `packages/providers/src/siwc/store.ts:71-103`; `packages/providers/src/copilot-cursor-auth/local-ports.ts:23-73,235-242`; `packages/providers/src/pacing/global-connection-window-repo.ts:38-73`.

**Why this is a defect:** Running `135`–`140` together causes multi-writer SQLite lock contention, `SQLITE_CONSTRAINT_CHECK` failures on `connections`, lost API keys and `k[model]` calibration across restarts, unencrypted/XOR-masked tokens if default ports remain active, and TypeScript/runtime `TypeError`s on missing `SignedProviderPolicyEngine` methods.

**Required correction:** Add a `MigrationRunner` v2 additive migration to `@ef-harness/db` `global.db` for `policy_history`, `connection_profiles`, and `model_weights` (keeping `schema/global.sql` `connections` unconstrained across all routes), replace all `LocalGlobalDb*` / `InMemoryGlobal*` / `SqliteSiwcInstallationStore` stores with `@ef-harness/db` `GlobalBrokerDb` (`014`), adapt `136`–`139` to async `WindowsDpapiSecretsVault` (`120`), add `currentPriceTable()`, `readSiwcPolicy()`, and `copilotPremiumMultipliers()` to `SignedProviderPolicyEngine` (`135`), wire `135` + `140` into `VersionedModelRoster` (`106`), and export all submodules from `packages/providers/src/index.ts`.

**Dependencies:** `F-009`, `F-012`, `F-045`, `F-055`.

**Verification:** `pnpm --filter @ef-harness/providers typecheck && pnpm --filter @ef-harness/providers test`

**Integration priority:** Provider Connections & Pacing integration tasks (Wave M4 Providers).

---

### [F-058] `Task 141` `apps/renderer/src/connections` Compliance Bypass Accepting `sk-ant-oat*` Subscription OAuth Tokens as `"Anthropic Console"`, Illegal Renderer `node:sqlite` Import & Internal `FallbackGuardPort` Mismatch

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SECURITY

**Affected units:** `Task 009` / `Task 031` (`shared-contracts` / `ipc`), `Task 014` (`GlobalBrokerDb`), `Task 023` (`BudgetLedger`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 135` (`CompliancePolicyLocks`), `Task 136` (`ApiKeyPrefixDetector` / `ZeroTokenApiKeyValidator`), `Task 141` (`packages/providers/src/fallback-guard` & `apps/renderer/src/connections`).

**Files and symbols:** `apps/renderer/src/connections/key-detect.ts:7,11-18` (`detectPastedKeyProvider`), `apps/renderer/src/connections/screen.ts:173-210` (`ConnectionsManagementScreen.beginPaste`, `savePaste`), `apps/renderer/src/connections/secrets.ts:7-9` (`SecretVault`), `apps/renderer/src/connections/receipts.ts:1,201-265` (`TelemetryReceiptStore`), `apps/renderer/src/connections/ports.ts:27-43` (`FallbackGuardPort`), `packages/providers/src/fallback-guard/guard.ts:142-144` (`NoSilentPaidFallbackGuard.evaluate`).

**Actual implementation:**
1. **Anthropic subscription OAuth compliance bypass in renderer (`key-detect.ts:7,11-18`, `screen.ts:173-210`):** `detectPastedKeyProvider(raw)` checks `trimmed.startsWith("sk-ant-")`, which matches **both** valid `sk-ant-api...` Console keys AND **prohibited `sk-ant-oat01-...` Claude consumer subscription OAuth tokens**, labeling both `"anthropic_console"` (`"Anthropic Console"`). `ConnectionsManagementScreen.savePaste(vault)` then stores the raw `sk-ant-oat*` token directly into `vault.put(raw)` and adds a `"Healthy"` `"Anthropic Console"` connection without invoking `CompliancePolicyLocks` (`135`) or `ApiKeyPrefixDetector` / `ZeroTokenApiKeyValidator` (`136`).
2. **Illegal `node:sqlite` import & unapproved tables in `apps/renderer` (`receipts.ts:1,201-265`):** `apps/renderer/src/connections/receipts.ts:1` imports `{ DatabaseSync } from "node:sqlite"` directly inside the `apps/renderer` browser bundle (where `nodeIntegration: false` / `contextIsolation: true` forbids Node built-ins and filesystem access) and creates two non-schema tables (`usage_receipt_fact`, `usage_api_summary` — absent from `schema/telemetry.sql`). Similarly, `screen.ts:181` passes a synchronous `SecretVault` handle into the renderer instead of sending keys one-way over IPC to `harnessd` (`136`/`120`).
3. **Intra-`141` `FallbackGuardPort` signature mismatch (`apps/renderer/src/connections/ports.ts:27-43` vs `packages/providers/src/fallback-guard/guard.ts:143`):** `ConnectionsManagementScreen` calls `guard.evaluate({ activeId, candidateId, neverFallbackWithoutAsking, explicitFallbackOrder, ... })`, whereas `NoSilentPaidFallbackGuard.evaluate` expects `{ active: GuardConnection, candidate: GuardConnection, policy: { neverFallbackWithoutAsking, explicitFallbackOrder }, ... }` and returns `FallbackAllow | FallbackBlock` (no top-level `message`/`costEstimate` fields on `FallbackAllow`).

**Required architecture:** `open-design-questions.md` (Nov 16–17, 2026), `provider-connections.md`, `security-and-governance.md`, and `kernel-schema-and-protocol.md` strictly prohibit `sk-ant-oat*` subscription tokens at **both** UI and kernel layers, prohibit `node:sqlite` or vault handles inside `apps/renderer` (requiring typed IPC queries to `harnessd` backed by `GlobalBrokerDb`, `BudgetLedger`, and `telemetry.db`), and require `ConnectionsManagementScreen` to delegate fallback checks to `NoSilentPaidFallbackGuard`.

**Evidence:** `apps/renderer/src/connections/key-detect.ts:7,11-18`; `apps/renderer/src/connections/screen.ts:173-210`; `apps/renderer/src/connections/receipts.ts:1,201-265`; `apps/renderer/src/connections/ports.ts:27-43`; `packages/providers/src/fallback-guard/guard.ts:142-144`.

**Why this is a defect:** Users pasting `sk-ant-oat01-...` into Settings → Connections bypass the mandatory Anthropic compliance lock in the UI; bundling `apps/renderer` for Chromium fails on `import { DatabaseSync } from "node:sqlite"`; and `ConnectionsManagementScreen` cannot call `NoSilentPaidFallbackGuard` without a runtime signature adapter.

**Required correction:** Fix `apps/renderer/src/connections/key-detect.ts` to match `sk-ant-api` strictly and reject `sk-ant-oat*` / `setup-token` with `ANTHROPIC_COMPLIANCE_MESSAGE` (`135`/`136`), move `TelemetryReceiptStore` SQLite queries into `apps/daemon` / `@ef-harness/db` exposed via typed IPC (`shared-contracts/src/packets/rpc.ts`) so `apps/renderer/src/connections` has zero `node:sqlite` imports and sends pasted keys one-way over IPC to `ApiConnectionManager` (`136`), and align `FallbackGuardPort` with `NoSilentPaidFallbackGuard.evaluate`.

**Dependencies:** `F-006`, `F-013`, `F-026`, `F-055`, `F-057`.

**Verification:** `pnpm --filter @ef-harness/providers test -- fallback-guard && pnpm --filter @ef-harness/renderer typecheck && pnpm --filter @ef-harness/renderer test -- connections`

**Integration priority:** Provider Connections & Renderer Settings integration tasks (Wave M4/M5).

---

### [F-059] `packages/runtime-adapters` (`142`–`146`) Empty Barrel, Missing `runtime` Property Failing `assertAgentRuntimeAdapter`, Five Divergent 10-Method `AgentRuntimeAdapter` Signatures & Disconnected `core`/`acp` Silos

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 142` (`core`), `Task 143` (`acp`), `Task 144` (`codex`), `Task 145` (`copilot`), `Task 146` (`cursor`).

**Files and symbols:** `packages/runtime-adapters/src/index.ts:1-9`, `packages/runtime-adapters/src/core/interface.ts:113-142` (`AgentRuntimeAdapter`, `assertAgentRuntimeAdapter`), `packages/runtime-adapters/src/acp/adapter.ts:99,152-177` (`GenericAcpAdapter`), `packages/runtime-adapters/src/codex/adapter.ts:135,200,203-250` (`CodexRuntimeAdapter`), `packages/runtime-adapters/src/copilot/runtime-adapter.ts:23-84` (`CopilotRuntimeAdapter`), `packages/runtime-adapters/src/cursor/adapter.ts:24-77` (`CursorRuntimeAdapter`).

**Actual implementation:**
1. **Empty barrel & zero intra-package imports:** `packages/runtime-adapters/src/index.ts` remains the empty `packageIdentity()` stub across `142`–`146`, and none of `143` (`acp`), `144` (`codex`), `145` (`copilot`), or `146` (`cursor`) imports `../core/index.js` (`142`).
2. **All four adapters fail `assertAgentRuntimeAdapter` (`core/interface.ts:127-142`) and diverge on 5 of the 10 contract methods:**
   - `142` requires `readonly runtime: ForeignRuntimeId` (`assertAgentRuntimeAdapter` throws `SupervisionError("adapter_contract", "Adapter must name its runtime")` when absent) — **none** of `GenericAcpAdapter` (`143`), `CodexRuntimeAdapter` (`144`), `CopilotRuntimeAdapter` (`145`), or `CursorRuntimeAdapter` (`146`) defines `readonly runtime`!
   - `probe()`: `142`/`144` return `status: "ready" | ...`; `143` returns `"ok" | "missing"`.
   - `authStatus`: `142`/`143` take `0` args returning `Promise<AuthStatus>`; `144` returns synchronous `CodexAuthStatus`; `145` requires `(connectionId: string): Promise<CopilotAuthStatus>`.
   - `startSession`: `142` takes `SessionStartSpec`; `143` takes `AcpSessionSpec` (`attemptId`, `taskId`); `144` takes `CodexSessionSpec` (`connection`, `modelId`, `attemptId`); `145` takes `CopilotSessionSpec`; `146` takes `CursorSessionSpec`.
   - `resume`: `142`/`143`/`144` take `checkpointRef: string`; `145` takes `CopilotCheckpointRef` (`{ attemptId }`); `146` takes `CursorCheckpointRef`.
   - `respondPermission` & `usage`: synchronous in `142` (`PermissionReply`, `NormalizedUsage`), async `Promise<...>` in `145` and `146`.
3. **Duplicated ACP fallbacks & supervision silos:** `144` (`CodexAcpFallbackTransport`), `145` (`CopilotAcpFallbackAdapter`), and `146` (`CursorAcpFallbackAdapter`) each invent their own `GenericAcpAdapterPort` / mini ACP fallback instead of delegating to `143`'s `GenericAcpAdapter`, and each duplicates `LocalSupervisionPolicy`, `LocalEventBus`, and `LocalRedactor` instead of sharing `142` (`DeterministicSupervisionPolicyEngine`, `NormalizedRuntimeEventBus`) and `011` (`PacketSecurityRedactor`).

**Required architecture:** `agent-runtime-adapters.md` (`The 10-Method Adapter Contract` & `Generic ACP Adapter`) requires one canonical `AgentRuntimeAdapter` contract in `core/interface.ts` (`142`) satisfied identically by every runtime adapter (`143`–`149`), with all ACP-capable runtimes sharing `GenericAcpAdapter` (`143`) and all permission checks routed through `DeterministicSupervisionPolicyEngine` (`142`).

**Evidence:** `packages/runtime-adapters/src/core/interface.ts:113-142`; `packages/runtime-adapters/src/acp/adapter.ts:99,152-177`; `packages/runtime-adapters/src/codex/adapter.ts:135,200,203-250`; `packages/runtime-adapters/src/copilot/runtime-adapter.ts:23-84`; `packages/runtime-adapters/src/cursor/adapter.ts:24-77`.

**Why this is a defect:** `AdapterRegistry` (`142`) rejects every adapter in `143`–`146` at registration time (`Adapter must name its runtime`), and no caller (`SequentialBuildRunner`, `ParallelWaveDispatcher`, or `Task 151` Conformance Suite) can invoke `authStatus`, `startSession`, `resume`, `respondPermission`, or `usage` uniformly across foreign runtimes.

**Required correction:** Freeze `core/interface.ts` (`142`) as the single `AgentRuntimeAdapter` contract (enriching `SessionStartSpec` with optional `attemptId`, `taskId`, `modelId`, `connectionId` and allowing `Promise<NormalizedUsage> | NormalizedUsage`), implement `readonly runtime` and exact 10-method conformance across `GenericAcpAdapter` (`143`), `CodexRuntimeAdapter` (`144`), `CopilotRuntimeAdapter` (`145`), and `CursorRuntimeAdapter` (`146`), wire `144`–`146` ACP fallbacks directly onto `GenericAcpAdapter` (`143`) + `DeterministicSupervisionPolicyEngine` (`142`), and export all adapters from `packages/runtime-adapters/src/index.ts`.

**Dependencies:** `F-003`, `F-004`, `F-057`.

**Verification:** `pnpm --filter @ef-harness/runtime-adapters typecheck && pnpm --filter @ef-harness/runtime-adapters test -- core acp codex copilot cursor`

**Integration priority:** Runtime Adapter Core & ACP/Codex/Copilot/Cursor integration tasks (Wave M4 Runtime Adapters).

---

### [F-060] `packages/runtime-adapters` (`142`–`146`) Broken PowerShell Job Object Helper (Missing `KILL_ON_JOB_CLOSE` + 20s Main-Thread `Atomics.wait` Freeze), Non-Job `taskkill`/`InMemoryJobSupervisor` Fallbacks & Dead `127.0.0.1:9` Proxy Default

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SECURITY

**Affected units:** `Task 040`–`Task 048` (`packages/sandbox` & `packages/mcp-server`), `Task 078` (`SkillVettingPipeline`), `Task 119` (`WarmExecutionPool`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 135`–`Task 141` (`packages/providers`), `Task 142`–`Task 146` (`packages/runtime-adapters`).

**Files and symbols:** `packages/runtime-adapters/package.json:20-22`, `packages/runtime-adapters/src/core/windows-job.ts:11-56,126-171` (`POWERSHELL_SCRIPT`, `ensureHelper`, `exchange`), `packages/runtime-adapters/src/acp/job.ts:20-78` (`LocalWindowsJob`, `killProcessTree`), `packages/runtime-adapters/src/codex/adapter.ts:132,188` (`DEFAULT_PROXY`), `packages/runtime-adapters/src/codex/process.ts:145-160` (`killPid`), `packages/runtime-adapters/src/cursor/local-ports.ts:70-129,184-200` (`InMemoryJobSupervisor`, `LocalLoopbackProxy`, `InMemoryCursorSdk`).

**Actual implementation:**
1. **`core/windows-job.ts` missing `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + 20-second main-thread `Atomics.wait` freeze (`142`):** Instead of using `Task 040` `@ef-harness/sandbox` `WindowsJobObjectManager`, `core/windows-job.ts` spawns `powershell.exe -ExecutionPolicy Bypass` with `Add-Type` C# P/Invoke (`CreateJobObject` + `AssignProcessToJobObject`) **without ever calling `SetInformationJobObject(..., JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)`** (`lines 23-35`) — so if `harnessd` crashes, foreign CLI process trees survive orphaned! Worse, `ensureHelper()` and `exchange()` call **`Atomics.wait(view, ..., 20_000)` synchronously on the main Node.js thread** (`lines 141, 154`), freezing the daemon's entire event loop for up to 20 seconds during cold `csc.exe` C# compilation and on every job `ASSIGN`/`KILL`.
2. **Non-Job-Object `taskkill` / `InMemoryJobSupervisor` & dead `127.0.0.1:9` proxy default (`143`–`146`):** `packages/runtime-adapters/package.json` declares ONLY `@ef-harness/shared-contracts` (zero `@ef-harness/sandbox`, `@ef-harness/mcp-server`, `@ef-harness/providers`, `@ef-harness/governor`, `@github/copilot-sdk`, or `@cursor/sdk` dependencies). `143` (`acp/job.ts`) and `144` (`codex/process.ts`) track PIDs in a JS `Set` and call `taskkill /PID <pid> /T /F` (which misses detached breakaway grandchildren); `144` (`codex/adapter.ts:132,188`) defaults `HTTP_PROXY`/`HTTPS_PROXY` to dead discard port `http://127.0.0.1:9`; and `145`/`146` default to `InMemoryJobSupervisor` (never killing any OS process!), `LocalLoopbackProxy` (`http://127.0.0.1/proxy/...`), and `InMemoryCopilotSdk`/`InMemoryCursorSdk`.

**Required architecture:** `sandbox-and-security.md` and `agent-runtime-adapters.md` require every foreign runtime session to execute inside `WindowsJobObjectManager` (`Task 040`, with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` + non-blocking async supervision), `SandboxTierSelector` (`Task 045`), `AllowlistProxyServer` (`Task 046`), `HarnessRunEngine` (`Task 047`), `AttemptMcpServer` (`Task 048`), `WarmExecutionPool` (`Task 119`), and `WindowsDpapiSecretsVault` (`Task 120`).

**Evidence:** `packages/runtime-adapters/package.json:20-22`; `packages/runtime-adapters/src/core/windows-job.ts:11-56,141,154`; `packages/runtime-adapters/src/acp/job.ts:20-78`; `packages/runtime-adapters/src/codex/adapter.ts:132,188`; `packages/runtime-adapters/src/cursor/local-ports.ts:70-129,184-200`.

**Why this is a defect:** `core/windows-job.ts` freezes `harnessd` for up to 20s and leaks orphan foreign CLI trees on crash; `144`'s `http://127.0.0.1:9` default breaks Codex network traffic unless manually overridden; and `145`/`146` run against in-memory mock SDKs and no-op job supervisors without real OS sandbox/proxy containment.

**Required correction:** Add `@ef-harness/{sandbox,mcp-server,corpus,providers,governor,shared-observability}` to `packages/runtime-adapters/package.json`, delete `core/windows-job.ts`'s synchronous `Atomics.wait` PowerShell helper and `143`–`146`'s `LocalWindowsJob`/`InMemoryJobSupervisor`/`DEFAULT_PROXY = "http://127.0.0.1:9"` production defaults, and wire `142`–`146` directly to `@ef-harness/sandbox` (`WindowsJobObjectManager`, `SandboxTierSelector`, `AllowlistProxyServer`, `HarnessRunEngine`), `@ef-harness/mcp-server` (`AttemptMcpServer`), `@ef-harness/governor` (`WarmExecutionPool`, `WindowsDpapiSecretsVault`), and `@ef-harness/providers`.

**Dependencies:** `F-018`, `F-019`, `F-021`, `F-055`, `F-057`, `F-059`.

**Verification:** `pnpm --filter @ef-harness/runtime-adapters test -- core acp codex copilot cursor`

**Integration priority:** Runtime Adapter Sandbox & Supervision integration tasks (Wave M4 Runtime Adapters).

---

### [F-061] `packages/runtime-adapters` (`147`–`151`) Adapter Contract Mismatches (`147`–`149`), Duplicated ACP/Job Silos, `SqliteAttemptCheckpointStore` (`150`) `attempts` DDL Crash & Non-Adapter-Driving `AdapterConformanceRunner` (`151`)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 014` (`GlobalBrokerDb`), `Task 022` (`RuntimeLifecycleRepo`), `Task 037`–`Task 038` (`DirtySnapshotEngine` / `WorktreeSlotPool`), `Task 040` (`WindowsJobObjectManager`), `Task 053` (`AttemptCheckpointStore`), `Task 088` (`ContextSlicerEngine`), `Task 115` (`AdditiveVsContradictoryResumer`), `Task 119` (`SessionProcessCapGuard`), `Task 142` (`core`), `Task 143` (`GenericAcpAdapter`), `Task 147`–`Task 151` (`packages/runtime-adapters`).

**Files and symbols:** `packages/runtime-adapters/src/claude-code/adapter.ts:108,203-235` (`ClaudeCodeRuntimeAdapter`), `packages/runtime-adapters/src/gemini-cli/runtime-adapter.ts:105,145-149,189-240` (`GeminiCliRuntimeAdapter`), `packages/runtime-adapters/src/gemini-cli/opt-in-gate.ts:50-51` (`GeminiOptInComplianceGate`), `packages/runtime-adapters/src/opencode/runtime-adapter.ts:160,172,188,195-217` (`OpenCodeRuntimeAdapter`), `packages/runtime-adapters/src/resume/checkpoint-store.ts:20-34,71-96` (`SqliteAttemptCheckpointStore`), `packages/runtime-adapters/src/resume/coordinator.ts:119-128` (`ForeignRuntimeResumeCoordinator`), `packages/runtime-adapters/src/conformance/runner.ts:73,144-169,225-243` (`AdapterConformanceRunner`, `createConformanceStack`), `packages/runtime-adapters/src/conformance/probes.ts:126-220` (`runProbeSuite`).

**Actual implementation:**
1. **`147`–`149` fail `assertAgentRuntimeAdapter` (`142`) and duplicate ACP/Job infrastructure:** None of `ClaudeCodeRuntimeAdapter` (`147`), `GeminiCliRuntimeAdapter` (`148`), or `OpenCodeRuntimeAdapter` (`149`) defines `readonly runtime: ForeignRuntimeId`. `147.authStatus()` and `149.probe()`/`149.authStatus()` are synchronous instead of `Promise<...>`. Neither `148` (`LocalGenericAcpAdapter` + hardcoded `http://127.0.0.1:46322/mcp`) nor `149` (`LocalGenericAcpClient` + `InMemoryWindowsJobObject`) delegates to `143` `GenericAcpAdapter`, and `148` `GeminiOptInComplianceGate` defaults to `MemoryGlobalSettingsStore` instead of `GlobalBrokerDb` (`014`) `settings`.
2. **`150` `SqliteAttemptCheckpointStore` stripped `attempts` DDL crash & `contract_versions` overwrite:** `resume/checkpoint-store.ts:20-34` opens a standalone `DatabaseSync`, executes `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY)` (corrupting schema on fresh DBs), and runs `INSERT INTO attempts (id) VALUES (?)` (`line 72`), which crashes with `SQLITE_CONSTRAINT_NOTNULL` on real `state.db` `attempts` (`schema/state.sql` requires `task, number, agent, state, started_at`). Saving a checkpoint overwrites `attempt_checkpoints.contract_versions` with `{ foreignRuntimeCheckpoint: record }`, wiping `Task 053` `AttemptCheckpointStore`'s native `contract_versions` JSON on cross-adapter `Codex ↔ Native` handoffs! Meanwhile `ForeignRuntimeResumeCoordinator` defaults to `NoopWorktreeSlot`, `LocalDirtySnapshotEngine`, `IdentityBriefCompiler`, and `LocalAdditiveVsContradictoryResumer`.
3. **`151` `AdapterConformanceRunner` never calls any `AgentRuntimeAdapter` & uses volatile `InMemoryAdapterConformanceDb`:** `AdapterConformanceRunner.run(request)` (`runner.ts:73,144-169`, `probes.ts:126-220`) evaluates a synthetic `AdapterBehavior` struct against internal `ConformancePermissionEngine` + `OsSandboxBroker` without ever invoking `probe()`, `startSession()`, `sendTurn()`, `interrupt()`, `resume()`, or `usage()` on real `143`–`149` adapter instances, and `createConformanceStack()` (`runner.ts:225-243`) stores verdicts only in volatile `InMemoryAdapterConformanceDb` (losing conformance cache on every restart).

**Required architecture:** `agent-runtime-adapters.md` (`Checkpoints, Resume, and Idle Parking` & `Automated Conformance Suite`) and `schema/state.sql` / `schema/global.sql` require `147`–`149` to satisfy `142`'s 10-method `AgentRuntimeAdapter` contract and share `143` `GenericAcpAdapter` + `040` `WindowsJobObjectManager`, `150` to persist foreign checkpoint fields cooperatively inside `@ef-harness/db` `RuntimeLifecycleRepo` (`022`) + `AttemptCheckpointStore` (`053`) without rogue `DatabaseSync` DDL, and `151` to drive real `AgentRuntimeAdapter` instances (`143`–`149`) while persisting version-keyed conformance verdicts in `GlobalBrokerDb` (`014`).

**Evidence:** `packages/runtime-adapters/src/claude-code/adapter.ts:108,203-235`; `packages/runtime-adapters/src/gemini-cli/runtime-adapter.ts:105,145-149,189-240`; `packages/runtime-adapters/src/opencode/runtime-adapter.ts:160,172,188,195-217`; `packages/runtime-adapters/src/resume/checkpoint-store.ts:20-34,71-96`; `packages/runtime-adapters/src/conformance/runner.ts:73,144-169,225-243`; `packages/runtime-adapters/src/conformance/probes.ts:126-220`.

**Why this is a defect:** `147`–`149` cannot register in `AdapterRegistry` (`142`); `150` crashes on real `state.db` `attempts` NOT NULL constraints and clobbers native checkpoint metadata; and `151`'s conformance suite never exercises the real `143`–`149` adapter classes.

**Required correction:** Implement `readonly runtime` and async 10-method `AgentRuntimeAdapter` conformance on `ClaudeCodeRuntimeAdapter` (`147`), `GeminiCliRuntimeAdapter` (`148`), and `OpenCodeRuntimeAdapter` (`149`) backed by `GenericAcpAdapter` (`143`), `WindowsJobObjectManager` (`040`), and `GlobalBrokerDb.settings` (`014`); refactor `150` `SqliteAttemptCheckpointStore` to read/write through `@ef-harness/db` (`022`/`053`, merging `foreignRuntimeCheckpoint` into `contract_versions` without overwriting sibling keys or running `CREATE TABLE attempts`) and wire `037`/`038`/`088`/`115`/`119`; and wire `151` `AdapterConformanceRunner` to execute `P01`–`P10` directly against `AgentRuntimeAdapter` instances (`143`–`149`) persisted in `GlobalBrokerDb` (`014` additive `adapter_conformance` migration).

**Dependencies:** `F-008`, `F-009`, `F-012`, `F-017`, `F-023`, `F-053`, `F-055`, `F-057`, `F-059`, `F-060`.

**Verification:** `pnpm --filter @ef-harness/runtime-adapters typecheck && pnpm --filter @ef-harness/runtime-adapters test`

**Integration priority:** Runtime Adapters Part 2, Resume & Conformance integration tasks (Wave M4 Runtime Adapters).

---

### [F-062] `Task 152` M4 Exit Gate (`tests/e2e/m4-exit-gate`) Self-Contained Fake Stand-In Classes, Static Hidden-Suite Scoring & Untypechecked `.ts` Import Specifiers

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** TEST_GAP

**Affected units:** `Task 105` (`M2 Exit Gate`), `Task 135`–`Task 141` (`packages/providers` & `apps/renderer/src/connections`), `Task 142`–`Task 151` (`packages/runtime-adapters`), `Task 152` (`tests/e2e/m4-exit-gate`).

**Files and symbols:** `tests/e2e/tsconfig.json:8-15`, `tests/e2e/m4-exit-gate/runner.ts:1-10,17-30,105-117` (`runM4Certification`, `runLiveCertification`), `tests/e2e/m4-exit-gate/benchmark.ts:1-6,46-59` (`M4AllowancePacedBenchmark`).

**Actual implementation:**
1. **100% local fake stand-in classes & static hidden-suite scoring (`m4-exit-gate/runner.ts:1-10,105-117`, `benchmark.ts:46-59`):** `m4-exit-gate` imports **zero** modules from `@ef-harness/providers`, `@ef-harness/runtime-adapters`, or `apps/renderer` (`runner.ts:114` explicitly admits `"this base has no sibling provider adapters"`). Instead, `m4-exit-gate/{pacing,wire,kitchen,certifier,conformance,handoff,analytics}.ts` define local toy stand-ins (`AllowancePacingController`, `SiwcTokenRefresher`, `KitchenHiddenAcceptanceSuite`, `AdapterConformanceRunner`, `UsageReceiptsCsvExporter`), and `KitchenHiddenAcceptanceSuite.score()` (`benchmark.ts:50-51`) computes `passRate` statically from `benchmarks/m4-plans/hidden-suite.port.json` minus `faults.failHiddenIds` without building or running any Kitchen code!
2. **Untypechecked `.ts` import specifiers excluded from `tsconfig.json`:** Every file in `tests/e2e/m4-exit-gate/*.ts` uses `.ts` relative import extensions (`./analytics.ts`, `./benchmark.ts`, etc.), and `tests/e2e/tsconfig.json` (`include: ["src/**/*.ts"]`, `references: ["../../packages/shared-contracts"]`) excludes `m4-exit-gate/**` from `pnpm --filter @ef-harness/e2e typecheck` and `build`.

**Required architecture:** `roadmap.md` (`Milestone 4 Exit Gate`), `provider-connections.md`, and `agent-runtime-adapters.md` require `Task 152` to certify the real integrated `@ef-harness/providers` (`135`–`141`), `@ef-harness/runtime-adapters` (`142`–`151`), `apps/renderer/src/connections` (`141`), and `KitchenHiddenAcceptanceSuite` (`105`) end-to-end under `pnpm --filter @ef-harness/e2e typecheck` and `test`.

**Evidence:** `tests/e2e/tsconfig.json:8-15`; `tests/e2e/m4-exit-gate/runner.ts:1-10,17-30,105-117`; `tests/e2e/m4-exit-gate/benchmark.ts:1-6,46-59`.

**Why this is a defect:** `m4-exit-gate.test.ts` passes even if `@ef-harness/providers` and `@ef-harness/runtime-adapters` fail to compile or violate compliance/fallback/conformance invariants (`F-057`–`F-061`), and `pnpm --filter @ef-harness/e2e typecheck` skips `m4-exit-gate` completely.

**Required correction:** Convert `.ts` relative imports in `tests/e2e/m4-exit-gate/*.ts` to `.js`, add `m4-exit-gate` + workspace references (`@ef-harness/{providers,runtime-adapters,renderer}`) to `tests/e2e/tsconfig.json`, and wire `M4AllowancePacedBenchmark`, `M4ComplianceAndFallbackCertifier`, and `runM4Certification` to real `@ef-harness/providers`, `@ef-harness/runtime-adapters`, `apps/renderer/src/connections`, and `Task 105` `KitchenHiddenAcceptanceSuite`.

**Dependencies:** `F-048`, `F-057`..`F-061`.

**Verification:** `pnpm --filter @ef-harness/e2e typecheck && pnpm --filter @ef-harness/e2e test -- m4-exit-gate`

**Integration priority:** M4 Exit Gate certification task (end of Wave M4).

---

### [F-063] `SingleAppShell` (`122`) & `PopOutWindowCoordinator` (`123`) Undeclared `react`/`react-dom` Dependencies, Incompatible `BridgePayload` vs `009`/`032`/`067` IPC Protocol, Governor Casing Drop & `SharedHarnessdStream` Epoch-Reset Crash

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 009` (`shared-contracts/src/packets/rpc.ts`), `Task 032` (`packages/ipc`), `Task 067` (`apps/desktop`), `Task 118` (`PressureHysteresisStateMachine`), `Task 122` (`apps/renderer/src/shell`), `Task 123` (`apps/renderer/src/presets` & `apps/desktop/src/windows`).

**Files and symbols:** `apps/renderer/package.json:20-28`, `apps/renderer/src/shell/shell.ts:1-2,53-71,161-183` (`SingleAppShell`), `apps/renderer/src/shell/ports.ts:10-36` (`BridgePayload`, `NamedPipeClient`), `apps/renderer/src/shell/daemon-store.ts:56-64` (`isPressure`), `apps/renderer/src/presets/phase-workspace-controller.ts:57,153` (`PhaseWorkspaceController`), `apps/desktop/src/windows/shared-harnessd-stream.ts:18-23` (`SharedHarnessdStream.publish`), `apps/desktop/src/windows/pop-out-window-coordinator.ts:46-85` (`PopOutWindowCoordinator`).

**Actual implementation:**
1. **Undeclared `react` & `react-dom` dependencies in `apps/renderer/package.json`:** `apps/renderer/src/shell/shell.ts:1-2` imports `"react"` and `"react-dom/server"`, which are completely absent from `apps/renderer/package.json` (`dependencies` lists only `@ef-harness/shared-contracts`), breaking strict workspace builds when hoisted packages change.
2. **Incompatible IPC/preload contract & uppercase Governor event drop (`122` vs `009`/`032`/`067`/`118`):** `shell/ports.ts:10-36` defines a bespoke `BridgePayload` (`kind: "events.subscribe" | "snapshot.get" | "rpc"` with `method: "build.stop" | "build.pause" | "build.resume"` and zero `op_id`) and passes `NamedPipeClient` into `SingleAppShellOptions` inside the renderer, whereas `009`/`032`/`067` use `MessagePort` preload bridges carrying `run.stop` / `run.pause` / `run.resume` (requiring `op_id`), `project.open`, and `stream.credit`. Moreover, `daemon-store.ts:56-64` (`isPressure`) accepts only lowercase `"green" | "yellow" | "orange" | "red"`, silently dropping uppercase `"GREEN" | "YELLOW" | "ORANGE" | "RED"` emitted by `Task 118` `PressureHysteresisStateMachine` (`F-055`).
3. **`SharedHarnessdStream` epoch-reset crash & `applyPreset` mismatch (`123`):** `apps/desktop/src/windows/shared-harnessd-stream.ts:18-23` throws `Error("harnessd seq ... does not advance ...")` without tracking `streamEpoch` (crashing multi-window event fan-out whenever `harnessd` restarts at `seq = 1`) and retains an unbounded `events[]` array in RAM; `PopOutWindowCoordinator` is unwired from `067` `apps/desktop/src/main.ts` (`F-027`); and `PhaseWorkspaceController` (`presets/phase-workspace-controller.ts:57,153`) calls `shell.applyPreset(...)`, which does not exist on `122`'s `ShellLayoutContext`.

**Required architecture:** `app-shell-and-governor.md`, `desktop-app.md`, and `kernel-schema-and-protocol.md` require `apps/renderer` to declare its runtime dependencies explicitly, communicate exclusively over `Task 067`'s `contextIsolation` `MessagePort` preload bridge using `Task 009`'s canonical RPC methods (`run.stop`, `run.pause`, `run.resume` with `op_id`), normalize Governor pressure levels consistently, support `stream_epoch` resets in `PopOutWindowCoordinator` / `SharedHarnessdStream`, and drive `SingleAppShell` layout presets through one shared `ShellLayoutContext`.

**Evidence:** `apps/renderer/package.json:20-28`; `apps/renderer/src/shell/shell.ts:1-2,53-71`; `apps/renderer/src/shell/ports.ts:10-36`; `apps/renderer/src/shell/daemon-store.ts:56-64`; `apps/renderer/src/presets/phase-workspace-controller.ts:57,153`; `apps/desktop/src/windows/shared-harnessd-stream.ts:18-23`.

**Why this is a defect:** `SingleAppShell` cannot communicate over `067`'s real preload bridge, drops all `118` Governor updates due to casing mismatch, crashes multi-window pop-out streaming on daemon restart, and cannot connect `123`'s `PhaseWorkspaceController` to `122`'s `ShellLayoutContext`.

**Required correction:** Add `react`, `react-dom`, `@types/react`, and `@types/react-dom` to `apps/renderer/package.json`; replace `BridgePayload` / renderer `NamedPipeClient` in `122` with a typed preload `MessagePort` client speaking `shared-contracts/src/packets/rpc.ts` (`run.stop`/`run.pause`/`run.resume` with `op_id`); normalize pressure levels across `118`/`119`/`122`; add `streamEpoch` handling + bounded snapshot state to `SharedHarnessdStream` (`123`) wired into `067` `apps/desktop` multi-window `MessagePort` fan-out (`F-027`); and align `ShellLayoutContext.applyPreset` between `122` and `123`.

**Dependencies:** `F-006`, `F-015`, `F-027`, `F-055`.

**Verification:** `pnpm --filter @ef-harness/renderer typecheck && pnpm --filter @ef-harness/renderer test -- shell presets && pnpm --filter @ef-harness/desktop test -- windows`

**Integration priority:** Desktop Shell & Multi-Window Presets integration tasks (Wave M3/M5 Desktop & Renderer).

---

### [F-064] `BoardCockpitView` (`124`) & `BoardHealthSignalEngine` (`125`) Disconnected `DaemonStore` Snapshot Shapes, Missing `StateDbBoardRow` Daemon Projection & Duplicate `CockpitExplainerV1Schema`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 009` (`shared-contracts`), `Task 066` (`apps/daemon`), `Task 119` (`ThreePoolCapacityScheduler`), `Task 122` (`DaemonStore`), `Task 124` (`apps/renderer/src/cockpit/board`), `Task 125` (`apps/renderer/src/cockpit/health`).

**Files and symbols:** `apps/renderer/src/shell/daemon-store.ts:84,186-196` (`DaemonStore`, `WorkerView`), `apps/renderer/src/cockpit/board/daemon-store-port.ts:4-17` (`InMemoryDaemonStore`), `apps/renderer/src/cockpit/board/state-db-adapter.ts:18-55` (`StateDbBoardRow`), `apps/renderer/src/cockpit/health/explainer.ts:2,108-118` (`OnDemandCockpitExplainer`), `apps/renderer/src/cockpit/health/board-slot.ts:13-27` (`attachHealthSlots`), `apps/renderer/src/cockpit/health/telemetry-log.ts:11-21` (`InMemoryTelemetryLog`).

**Actual implementation:**
1. **`122` `DaemonStore` vs `124` `DaemonStorePort` mismatch & missing daemon projection:** `122` `DaemonStore` (`shell/daemon-store.ts:84,186-196`) maintains minimal `workers: readonly WorkerView[]` (`{ id, status, detail, updatedSeq }`), whereas `124` `BoardCockpitView` (`cockpit/board/daemon-store-port.ts:4-17`) requires `DaemonStorePort` returning `{ revision, tasks: BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot }` built from `StateDbBoardRow` (`state-db-adapter.ts:18-55`) — a join over `task_runtime`, `task_holds`, `inbox`, and `ThreePoolCapacityScheduler` (`119`) that `apps/daemon` (`066`) never computes or streams!
2. **Disconnected `125` health slots, duplicate `CockpitExplainerV1Schema`, and in-memory telemetry sink:** `125` (`cockpit/health/explainer.ts:2,108-118`) defines a custom `CockpitExplainerV1Schema` class instead of validating against `@ef-harness/shared-contracts` `CockpitExplainerOutputSchema` (`009`), never wires `attachHealthSlots` (`board-slot.ts:13-27`) into `124` `BoardCockpitView`, and writes health metrics only to `InMemoryTelemetryLog` (`telemetry-log.ts:11-21`) instead of forwarding to `harnessd` `telemetry.db`.

**Required architecture:** `build-cockpit.md` and `prompt-contracts.md` (`cockpit-explainer@1`) require `harnessd` (`066`) to stream canonical task/board/pool snapshots into `122` `DaemonStore`, `124` `BoardCockpitView` to render `125` `HealthSignalBadgeStrip` slots inline, and `125` `OnDemandCockpitExplainer` to request `cockpit-explainer@1` via `harnessd` IPC validated against `Task 009`'s schema while logging health metrics to `telemetry.db`.

**Evidence:** `apps/renderer/src/shell/daemon-store.ts:84,186-196`; `apps/renderer/src/cockpit/board/daemon-store-port.ts:4-17`; `apps/renderer/src/cockpit/board/state-db-adapter.ts:18-55`; `apps/renderer/src/cockpit/health/explainer.ts:2,108-118`; `apps/renderer/src/cockpit/health/board-slot.ts:13-27`; `apps/renderer/src/cockpit/health/telemetry-log.ts:11-21`.

**Why this is a defect:** Mounting `BoardCockpitView` (`124`) inside `SingleAppShell` (`122`) fails because `DaemonStore` lacks `BoardTaskRecord[]` and `ThreePoolCapacitySnapshot`, health badges (`125`) never appear on Board cards, and health post-mortem telemetry never reaches `telemetry.db` for `Task 133` Diagnostics or `Task 191` Meta-Lab.

**Required correction:** Extend `apps/daemon` (`066`) snapshot/event projection to emit `StateDbBoardRow[]` + `ThreePoolCapacitySnapshot` (`119`) into `122` `DaemonStore`, adapt `DaemonStoreProvider` (`122`) to satisfy `124` `DaemonStorePort`, wire `125` `BoardHealthSignalEngine` + `attachHealthSlots` into `124` `BoardCockpitView`, validate `OnDemandCockpitExplainer` via `@ef-harness/shared-contracts` (`009`) over daemon IPC, and forward `TelemetryMetricRow` events to `telemetry.db`.

**Dependencies:** `F-005`, `F-026`, `F-055`, `F-063`.

**Verification:** `pnpm --filter @ef-harness/renderer test -- cockpit-board cockpit-health`

**Integration priority:** Build Cockpit & Health Signals integration tasks (Wave M3/M5 Renderer).

---

### [F-065] `WorkerInspectorPanel` (`126`), `CalmInboxPanel` (`127`) & `BudgetWindDownController` (`128`) Credit-Exhaustion Throw Bug, Rogue `stop_events` SQLite Writer, Volatile `AtomicBudgetReservationLedger` & Upstream RPC/Method Mismatches

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 023` (`BudgetLedgerRepo`), `Task 029` (`SeekableZstdLogReader`), `Task 033` (`BinaryStreamClient`), `Task 036`–`Task 039` (`git-engine`), `Task 088` (`ContextSlicerEngine`), `Task 109` (`ArtifactHandoffStore`), `Task 116` (`SharedQuestionArbiter` / `StaleReplyReconciler`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 121` (`HumanStepProbeRegistry`), `Task 126` (`cockpit/inspector`), `Task 127` (`cockpit/inbox`), `Task 128` (`steering/budget-stops` & `cockpit/stop-card`), `Task 140` (`GlobalConnectionWindowRepo`).

**Files and symbols:** `apps/renderer/src/cockpit/inspector/credit-stream.ts:44-48` (`CreditLimitedStream.run`), `apps/renderer/src/cockpit/inspector/ports.ts:36-105`, `apps/renderer/src/cockpit/inbox/ports.ts:19-23,68-81`, `packages/steering/src/budget-stops/stop-events.ts:1,7-15,29-36` (`StopEventStore`), `packages/steering/src/budget-stops/ledger.ts:27-39` (`AtomicBudgetReservationLedger`), `packages/steering/src/budget-stops/exporter.ts:4,37-61` (`WipBranchHandoffExporter`).

**Actual implementation:**
1. **`CreditLimitedStream` throws instead of queuing (`126` `credit-stream.ts:44-48`) & missing daemon RPC handlers:** When `this.outstanding >= INITIAL_STREAM_CREDITS`, `CreditLimitedStream.run` immediately throws `RangeLimitError("stream credits exhausted")` instead of awaiting credit replenishment! Moreover, `126` expects RPC methods `fetchDiffRange`, `fetchLogChunk`, `fetchScreenshot`, `locateLineWindow` (`029` has no `locateLineWindow`), `pinnedManifest`/`previewManifest` (`088` has `sliceForTask`), and `readsForAttempt` (`109` has `readResult`), none of which exist on `apps/daemon` (`066`) or `packages/ipc` (`033`).
2. **`127` `CalmInboxPanel` method mismatches against `116`, `120`, `121`:** `inbox/ports.ts:68-81` calls synchronous `StaleReplyReconciler.receive(card, reply)` inside the renderer (`116` runs daemon-side with `reconcile(...)`), `HumanStepProbePort.checkAgain(stepId)` (`121` exposes `verify`/`runProbe`), and `PreloadSecretIpc.put({ projectId, envScope, name, value })` (`120` uses `secretName`/`plaintext`).
3. **`128` (`packages/steering/src/budget-stops`) rogue `DatabaseSync` `stop_events` table, volatile `AtomicBudgetReservationLedger`, and host `git` spawn:** `StopEventStore` (`stop-events.ts:29-36`) opens a standalone `DatabaseSync` and creates an out-of-schema `stop_events` table; `AtomicBudgetReservationLedger` (`ledger.ts:27-39`) is a purely in-memory map disconnected from `023` `BudgetLedgerRepo` and `140` `GlobalConnectionWindowRepo`; `WipBranchHandoffExporter` (`exporter.ts:4,37-61`) spawns host `PATH` `git` instead of `036` `MinGit` + `039` `GitRefCasUpdater`; and `packages/steering/src/index.ts` remains an empty stub (`F-053`).

**Required architecture:** `build-cockpit.md`, `stops-undo-and-reentry.md`, `kernel-schema-and-protocol.md`, and `database-design.md` require `CreditLimitedStream` (`126`) to queue backpressured reads cleanly over `033` binary streams, `harnessd` (`066`) to serve Inspector and Inbox RPCs backed by `029`/`088`/`109`/`116`/`120`/`121`, and `BudgetWindDownController` + `WipBranchHandoffExporter` (`128`) to persist `stop_events` and reservations through `@ef-harness/db` (`023`/`015` additive migration) + `140` `GlobalConnectionWindowRepo` and execute Git operations through `@ef-harness/git-engine` (`036`/`039`).

**Evidence:** `apps/renderer/src/cockpit/inspector/credit-stream.ts:44-48`; `apps/renderer/src/cockpit/inspector/ports.ts:36-105`; `apps/renderer/src/cockpit/inbox/ports.ts:19-23,68-81`; `packages/steering/src/budget-stops/stop-events.ts:7-36`; `packages/steering/src/budget-stops/ledger.ts:27-39`; `packages/steering/src/budget-stops/exporter.ts:4,37-61`.

**Why this is a defect:** Concurrent diff/log/screenshot range loads in Inspector throw `RangeLimitError`; Inbox and Inspector calls fail over IPC due to missing/mismatched daemon methods; and budget wind-down (`128`) loses spend state on restart, opens a competing SQLite writer on `state.db`, and bypasses pinned `MinGit`.

**Required correction:** Queue requests in `CreditLimitedStream` (`126`) until credits free up; register typed daemon RPC/binary handlers for `126` (`029`/`033`/`088`/`109`) and `127` (`116`/`120`/`121`); add `stop_events` to `@ef-harness/db` `state.db` v2 migration (`015`), wire `BudgetWindDownController` (`128`) to `BudgetLedgerRepo` (`023`) + `GlobalConnectionWindowRepo` (`140`), wire `WipBranchHandoffExporter` (`128`) to `@ef-harness/git-engine` (`036`/`039`), and export `budget-stops` from `@ef-harness/steering`.

**Dependencies:** `F-006`, `F-009`, `F-012`, `F-015`, `F-017`, `F-026`, `F-049`, `F-053`, `F-055`, `F-057`, `F-063`.

**Verification:** `pnpm --filter @ef-harness/steering test -- budget-stops && pnpm --filter @ef-harness/renderer test -- cockpit-inspector cockpit-inbox stop-card`

**Integration priority:** Cockpit Inspector, Inbox & Budget Wind-Down integration tasks (Wave M3/M5 Steering & Renderer).

---

### [F-066] Desktop Lifecycle (`131`), Component Downloader & Auto-Updater (`132`) & Diagnostics (`133`) Unwired from `apps/daemon`/`apps/desktop`, Missing `electron-updater`, Nonexistent `reconcileAfterWake` & Live `telemetry.db` WAL Unlink Race

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** RUNTIME_WIRING

**Affected units:** `Task 014`–`Task 016` (`TelemetryDb` / `MigrationRunner` / `BackupManager`), `Task 031` (`NamedPipeServer`), `Task 066` (`apps/daemon`), `Task 067` (`apps/desktop`), `Task 118` (`PressureHysteresisStateMachine` / `DiskHeadroomGuard`), `Task 130` (`ColdOpenReconciler`), `Task 131` (`lifecycle`), `Task 132` (`components` & `updater`), `Task 133` (`diagnostics`).

**Files and symbols:** `apps/desktop/src/lifecycle/electron-binding.ts:147-188` (`bindElectronLifecycleHost`), `apps/daemon/src/lifecycle/sqlite-wal.ts:34-47` (`NodeSqliteCheckpoint`), `apps/desktop/src/updater/park-first-auto-updater.ts:46-75` (`ParkFirstAutoUpdater`), `apps/daemon/src/components/signed-component-downloader.ts:133-200` (`SignedComponentDownloader`), `apps/daemon/src/diagnostics/telemetry-db.ts:30-56` (`openTelemetryDatabase`, `rebuildTelemetryDatabase`).

**Actual implementation:**
1. **`131`, `132`, `133` completely unwired from `apps/daemon` (`066`) and `apps/desktop` (`067`):** Neither `apps/daemon/src/index.ts` nor `apps/desktop/src/main.ts` / `src/index.ts` imports or mounts `131` (`DesktopLifecycleCoordinator`, `DaemonShutdownCoordinator`, `PowerMonitorSleepReconciler`, `SystemTrayController`), `132` (`SignedComponentDownloader`, `AvQuarantineIntegrityChecker`, `ParkFirstAutoUpdater`, `CheckpointSchemaUpcasterRegistry`), or `133` (`DiagnosticsMetricsAggregator`, `CrashDumpIndexer`, `RedactedDiagnosticsBundleExporter`, `DiagnosticsHealthView`).
2. **Protocol & method mismatches in `131` & `132`:** `131` (`apps/daemon/src/lifecycle/lifecycle-router.ts`) models daemon shutdown as an HTTP `/lifecycle/shutdown` route instead of registering on `031` `NamedPipeServer` (`daemon.shutdown` / `run.pause`), and `PowerMonitorSleepReconciler` (`131`) expects `reconcileAfterWake()` which does not exist on `Task 130` `ColdOpenReconciler` (`reconcile()`). `132` omits `electron-updater` from `apps/desktop/package.json` and leaves `CheckpointSchemaUpcasterRegistry` disconnected from `015` `MigrationRunner` and `053`/`150` checkpoint stores.
3. **Live `telemetry.db` WAL unlink race (`133` `apps/daemon/src/diagnostics/telemetry-db.ts:30-56`):** `openTelemetryDatabase` opens independent `DatabaseSync` handles outside `@ef-harness/db` `TelemetryDb` (`014`), and `rebuildTelemetryDatabase` calls `rmSync` directly on `telemetry.db`, `-wal`, and `-shm` without closing `TelemetryDb`'s active writer handle (causing `EBUSY`/`EPERM` on Windows or corrupting an open WAL session).

**Required architecture:** `desktop-app.md` and `database-design.md` require `apps/desktop` (`067`) to boot `131` lifecycle/tray/sleep hooks and `132` `ParkFirstAutoUpdater`, `apps/daemon` (`066`) to expose `131` shutdown/WAL drain, `132` `SignedComponentDownloader` + `CheckpointSchemaUpcasterRegistry`, and `133` `DiagnosticsMetricsAggregator` + `RedactedDiagnosticsBundleExporter` over `NamedPipeServer` (`031`), and `telemetry.db` rebuilds (`133`) to coordinate exclusively through `Task 014` `TelemetryDb` close/reopen.

**Evidence:** `apps/desktop/src/lifecycle/electron-binding.ts:147-188`; `apps/desktop/src/updater/park-first-auto-updater.ts:46-75`; `apps/daemon/src/diagnostics/telemetry-db.ts:30-56`.

**Why this is a defect:** Production `apps/desktop` and `apps/daemon` run without tray/quit-while-building/sleep protection (`131`), without component download or park-first auto-updates (`132`), and without diagnostics/support-bundle export (`133`), while clicking `"Rebuild Telemetry DB"` (`133`) fails on Windows file locks when `TelemetryDb` (`014`) is open.

**Required correction:** Wire `131` and `132` into `apps/desktop/src/main.ts` (`067`, adding `electron-updater` to `apps/desktop/package.json` or binding `ElectronUpdaterPort` cleanly), wire `131`, `132`, and `133` RPC handlers into `apps/daemon` (`066` / `031` `NamedPipeServer`), align `PowerMonitorSleepReconciler` (`131`) with `ColdOpenReconciler.reconcile()` (`130`) + `TaskClaimLeasesRepo` (`020`), wire `CheckpointSchemaUpcasterRegistry` (`132`) into `015`/`053`/`150`, and route `133` `telemetry.db` reads/rebuilds through `@ef-harness/db` `TelemetryDb` (`014`).

**Dependencies:** `F-003`, `F-009`, `F-012`, `F-013`, `F-026`, `F-027`, `F-053`, `F-055`, `F-061`, `F-063`.

**Verification:** `pnpm --filter @ef-harness/desktop test -- lifecycle updater && pnpm --filter @ef-harness/daemon test -- lifecycle components diagnostics && pnpm --filter @ef-harness/renderer test -- diagnostics`

**Integration priority:** Desktop & Daemon Lifecycle, Updater & Diagnostics integration tasks (Wave M3/M5 Desktop & Daemon).

---

### [F-067] `apps/renderer/src/canvas/{intents,tabs}` (`156`, `159`) Illegal Renderer `node:sqlite`/`node:fs`/`node:crypto` Imports, Fabricated 20-Column `nodes` Schema, 8th `ef_search_text` UDF & Undeclared `@xyflow/react`/`elkjs` Dependencies (`153`)

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** SECURITY

**Affected units:** `Task 014`–`Task 019` (`packages/db`), `Task 066`–`Task 067` (`apps/daemon` & `apps/desktop`), `Task 153` (`canvas/graph`), `Task 156` (`canvas/intents`), `Task 159` (`canvas/tabs`).

**Files and symbols:** `apps/renderer/package.json:20-28`, `apps/renderer/src/canvas/graph/react-flow-canvas-view.ts:1-8`, `apps/renderer/src/canvas/intents/graph.ts:1,27-41` (`IntentGraph`), `apps/renderer/src/canvas/intents/sql.ts:32-115` (`INTENT_GRAPH_SCHEMA_SQL`), `apps/renderer/src/canvas/tabs/state-db.ts:1-4,52-58,93-122` (`CanonicalStateDb`, `splitSearchText`).

**Actual implementation:**
1. **Illegal `node:sqlite`, `node:fs`, and `node:crypto` imports inside `apps/renderer` (`156` & `159`):** `apps/renderer/src/canvas/intents/graph.ts:1` imports `{ DatabaseSync } from "node:sqlite"` inside the Chromium renderer bundle and instantiates a fabricated 20-column `nodes` schema (`INTENT_GRAPH_SCHEMA_SQL` in `sql.ts:32-115` with non-existent columns `value`, `lifecycle`, `built`, `landed`, `provenance_quote`, `code_status`, `revision_source`, `amber`, `dictation_badge`, `freshly_dictated`, `newly_extracted`, `age`, plus out-of-schema `vocabulary_corrections`). Likewise, `apps/renderer/src/canvas/tabs/state-db.ts:1-4,52-58,93-122` imports `"node:crypto"`, `"node:fs"`, and `{ DatabaseSync } from "node:sqlite"`, reads `state.sql` from disk via `fs.readFileSync(canonicalAssetAbsolute("stateSql"))` inside `apps/renderer`, registers an **8th divergent `ef_search_text` UDF** (`F-010`), and writes directly to `nodes`, `task_runtime`, `attempts`, `budget_ledger`, `candidates`, `task_scopes`, and `inbox_items` inside the renderer!
2. **Undeclared `@xyflow/react` and `elkjs` dependencies in `apps/renderer/package.json` (`153`):** `apps/renderer/src/canvas/graph/react-flow-canvas-view.ts:8` imports `@xyflow/react` (and `elk-incremental-layout-engine.ts` uses ELK), neither of which is declared in `apps/renderer/package.json` (`F-063`).

**Required architecture:** `security-and-governance.md`, `desktop-app.md`, `database-design.md`, and `interactive-architecture.md` strictly prohibit Node.js built-ins (`node:sqlite`, `node:fs`, `node:crypto`) inside the `contextIsolation: true` / `nodeIntegration: false` Electron renderer process — all `state.db` reads, `impact_walk` queries, and proposal/spec mutations must execute in `harnessd` (`apps/daemon`) via `@ef-harness/db` over typed preload IPC (`Task 009`/`031`/`067`), and `apps/renderer/package.json` must declare `@xyflow/react` and `elkjs`.

**Evidence:** `apps/renderer/package.json:20-28`; `apps/renderer/src/canvas/graph/react-flow-canvas-view.ts:1-8`; `apps/renderer/src/canvas/intents/graph.ts:1,27-41`; `apps/renderer/src/canvas/intents/sql.ts:32-115`; `apps/renderer/src/canvas/tabs/state-db.ts:1-4,52-58,93-122`.

**Why this is a defect:** Bundling `apps/renderer` for Electron's sandboxed renderer fails immediately on `node:sqlite`, `node:fs`, and `node:crypto` imports (and undeclared `@xyflow/react`/`elkjs`), while `156`'s fabricated 20-column `nodes` table cannot even run against real `schema/state.sql` on the daemon side.

**Required correction:** Add `@xyflow/react` and `elkjs` to `apps/renderer/package.json`, relocate `156` impact/intent graph queries and `159` Spec/Matrix/Plan/Runtime query projections into `apps/daemon` (`066`) backed by canonical `@ef-harness/db` (`014`–`023`) + `@ef-harness/planner` (`087`, `108`) + `@ef-harness/spec-expansion` (`079`, `080`), remove all `node:sqlite`/`node:fs`/`node:crypto` imports from `apps/renderer/src/canvas/{intents,tabs}/**`, and expose typed IPC query/mutation ports to the renderer.

**Dependencies:** `F-006`, `F-010`, `F-012`, `F-026`, `F-035`, `F-039`, `F-045`, `F-058`, `F-063`.

**Verification:** `pnpm --filter @ef-harness/renderer build && pnpm --filter @ef-harness/renderer typecheck && pnpm --filter @ef-harness/renderer test -- canvas-graph canvas-intents canvas-tabs`

**Integration priority:** Canvas, Box-Chat Intents & Spec/Plan Tabs integration tasks (Wave M5 Renderer & Daemon).

---

### [F-068] Canvas & Composer Silos (`153`–`156`, `159`) Missing `canvas_layout` SQLite Table, Missing `ShellLayoutContext.readCanvas`/`writeCanvas`, Duplicate Composer State in `156` & Nine `Local*` Stand-Ins Disconnected from `harnessd`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** CONTRACT_MISMATCH

**Affected units:** `Task 015` (`MigrationRunner`), `Task 071` (`PremiseSupersessionReopener`), `Task 087` (`HybridRevisionEngine`), `Task 102` (`AskOwnerResponderEngine`), `Task 108` (`RevisionAutoStartPolicy`), `Task 113` (`InputStartFocusSnapshotter`), `Task 122` (`SingleAppShell`), `Task 129` (`PlannedFeatureUndoEngine`), `Task 153`–`Task 156`, `Task 158` (`DictationVocabularyManager`), `Task 159`.

**Files and symbols:** `apps/renderer/src/canvas/graph/local-ports.ts:18-38,99-120` (`MemoryCanvasLayoutPersistence`, `MemoryShellLayoutContext`), `apps/renderer/src/canvas/popovers/registry.ts:65-200` (`NodeTypePopoverRegistry`), `apps/renderer/src/composer/composer-target-state-machine.ts:76-115` (`ComposerTargetStateMachine`), `apps/renderer/src/canvas/intents/controller.ts:56-149` (`BoxChatIntentController`).

**Actual implementation:**
1. **Missing `canvas_layout` table in `schema/state.sql` & missing `ShellLayoutContext` methods (`153` vs `015`/`122`):** `schema/state.sql` contains no `canvas_layout` table; `153` defaults to volatile `MemoryCanvasLayoutPersistence` (losing user-pinned node coordinates on restart) and calls `shell.readCanvas()`/`writeCanvas()` (`local-ports.ts:112-120`), which do not exist on `122`'s `ShellLayoutContext`.
2. **Zero cross-unit imports across `153`–`156` & `159`, duplicate Composer state, and 9 `Local*` stand-ins:** None of `153` (`canvas/graph`), `154` (`canvas/popovers`), `155` (`composer`), `156` (`canvas/intents`), or `159` (`canvas/tabs`) imports any sibling module. `156` `BoxChatIntentController` (`controller.ts:56-149`) maintains its own duplicate `draft`/`cursor`/`locks` state instead of binding to `155` `ComposerTargetStateMachine` + `113` `InputStartFocusSnapshot`, and calls 9 local stand-in classes (`LocalAskOwnerResponder`, `LocalReverseImpactWalker`, `LocalChangeClassifier`, `LocalEarlyCutoffReverifier`, `LocalReverifyBeforeReworkGate`, `LocalRevisionAutoStartPolicy`, `LocalPremiseSupersessionReopener`, `LocalDictationVocabulary`, `LocalPostSendChangeHighlighter`) instead of routing to `071`, `087`, `102`, `108`, `129`, `154`, and `158`.

**Required architecture:** `interactive-architecture.md` and `routing-design.md` require `state.db` to persist `canvas_layout(node_id, view_level, x, y, pinned_by_user)`, `153`+`154`+`159` to drive `155` `ComposerTargetStateMachine` as the single unified composer in `122` `SingleAppShell`, and `156` `BoxChatIntentController` to trigger `154` `PostSendChangeHighlighter` and invoke `071`, `087`, `102`, `108`, `129`, and `158` over `harnessd` IPC.

**Evidence:** `apps/renderer/src/canvas/graph/local-ports.ts:18-38,99-120`; `apps/renderer/src/composer/composer-target-state-machine.ts:76-115`; `apps/renderer/src/canvas/intents/controller.ts:56-149`.

**Why this is a defect:** Dragged Canvas box positions reset on restart, selecting boxes in `153`/`154` never updates `155`'s Composer Target Pill, and submitting Box-Chat intents in `156` never updates `state.db`, `HybridRevisionEngine` (`087`), `PlannedFeatureUndoEngine` (`129`), `DictationVocabularyManager` (`158`), or `PostSendChangeHighlighter` (`154`).

**Required correction:** Add `canvas_layout` to `@ef-harness/db` `state.db` v2 migration (`015`) exposed via daemon IPC to `SavedNodePositionStore` (`153`); add `readCanvas`/`writeCanvas` to `122` `ShellLayoutContext`; wire `153` `CanvasSelectionContext` → `154` `MultiBoxSelectionController` + `NodeTypePopoverRegistry` → `155` `ComposerTargetStateMachine` → `156` `BoxChatIntentController` + `154` `PostSendChangeHighlighter`; and route `156` intents over IPC to `071`, `087`, `102`, `108`, `129`, and `158`.

**Dependencies:** `F-009`, `F-029`, `F-039`, `F-044`, `F-045`, `F-050`, `F-053`, `F-063`, `F-067`.

**Verification:** `pnpm --filter @ef-harness/renderer test -- canvas-graph canvas-popovers composer canvas-intents canvas-tabs`

**Integration priority:** Canvas, Popovers, Composer & Intents integration tasks (Wave M5 Renderer).

---

### [F-069] `packages/dictation` (`157`–`158`) Empty Barrel, Uncopied `gpt2.tiktoken` Build Asset Crash (`ENOENT` in `dist/`), Disconnected `stt`↔`vocabulary` Pipeline & Upstream `118`/`132`/`040` Signature Mismatches

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** BUILD

**Affected units:** `Task 014` (`GlobalBrokerDb`), `Task 040` (`WindowsJobObjectManager`), `Task 118` (`GpuWhisperPriorityArbiter`), `Task 132` (`SignedComponentDownloader`), `Task 155` (`SingleComposerView`), `Task 157` (`packages/dictation/src/stt`), `Task 158` (`packages/dictation/src/vocabulary`).

**Files and symbols:** `packages/dictation/src/index.ts:1-9`, `packages/dictation/src/vocabulary/whisper-bpe.ts:23-27` (`loadModel`), `packages/dictation/src/vocabulary/frozen-schema-adapter.ts:165-188` (`MemoryGlobalDbVocabularyDriver`), `packages/dictation/src/stt/whisper-engine.ts:186-210` (`LocalWhisperSttEngine.start`).

**Actual implementation:**
1. **`gpt2.tiktoken` build asset crash (`whisper-bpe.ts:23-27`) & empty barrel:** `loadModel()` reads `path.join(path.dirname(fileURLToPath(import.meta.url)), "gpt2.tiktoken")` via `fs.readFileSync`. While Vitest executes `src/vocabulary/whisper-bpe.ts` directly, `pnpm --filter @ef-harness/dictation build` runs `tsc` without copying `src/vocabulary/gpt2.tiktoken` into `dist/vocabulary/gpt2.tiktoken`, crashing at runtime with `ENOENT` whenever imported from `dist/`! Meanwhile `packages/dictation/src/index.ts` remains the empty `packageIdentity()` stub across both `157` and `158`.
2. **Disconnected `157` ↔ `158` & upstream `014`/`040`/`118`/`132` port mismatches:** `157` and `158` share zero imports (`LocalWhisperSttEngine` never queries `WhisperInitialPromptBuilder`, `TwoOccurrenceCorrectionLearner`, or `ProjectVerifiedSpokenIdNormalizer`). `157` (`whisper-engine.ts:187-205`) checks TitleCase `calibration.pressure === "Red"` (`118` emits `"RED"` — `F-055`), calls `gpu.acquireInteractive()` (`118` `GpuWhisperPriorityArbiter` exposes `activateDictation`/`deactivateDictation`), and calls nonexistent `components.resolveWhisperComponent(modelId)` (`132`) and `jobs.superviseWhisper(...)` (`040`), while `158` defaults to volatile `MemoryGlobalDbVocabularyDriver` instead of `GlobalBrokerDb` (`014` `global.db.vocabulary` + `settings`).

**Required architecture:** `interactive-architecture.md` (`Voice Dictation` & `Project Vocabulary and Spoken IDs`), `app-shell-and-governor.md`, and `schema/global.sql` require `@ef-harness/dictation` to package `gpt2.tiktoken` cleanly in `dist/`, bind `158`'s 224-token prompt builder, 2-occurrence learner, and spoken-ID normalizer into `157`'s `LocalWhisperSttEngine`, persist `global.db.vocabulary` via `GlobalBrokerDb` (`014`), and coordinate with `WindowsJobObjectManager` (`040`), `GpuWhisperPriorityArbiter` (`118`), `SignedComponentDownloader` (`132`), and `SingleComposerView` (`155`).

**Evidence:** `packages/dictation/src/index.ts:1-9`; `packages/dictation/src/vocabulary/whisper-bpe.ts:23-27`; `packages/dictation/src/vocabulary/frozen-schema-adapter.ts:165-188`; `packages/dictation/src/stt/whisper-engine.ts:186-210`.

**Why this is a defect:** Compiled `@ef-harness/dictation` crashes on first BPE tokenization with `ENOENT: dist/vocabulary/gpt2.tiktoken`, loses learned vocabulary on restart, fails to coordinate GPU priority or Whisper downloads with `118`/`132`, and exports nothing from its package barrel.

**Required correction:** Copy `src/vocabulary/gpt2.tiktoken` to `dist/vocabulary/gpt2.tiktoken` in `packages/dictation/package.json` `build` script, export `stt` (`157`) and `vocabulary` (`158`) from `packages/dictation/src/index.ts`, wire `158` (`FrozenGlobalVocabularyStore` → `014` `GlobalBrokerDb`, `WhisperInitialPromptBuilder`, `TwoOccurrenceCorrectionLearner`, `ProjectVerifiedSpokenIdNormalizer`) directly into `157` `LocalWhisperSttEngine`, and adapt `157`'s ports to `040` `WindowsJobObjectManager`, `118` `GpuWhisperPriorityArbiter` + normalized pressure casing (`F-055`), `132` `SignedComponentDownloader`, and `155` `SingleComposerView` over daemon IPC.

**Dependencies:** `F-012`, `F-018`, `F-055`, `F-066`, `F-068`.

**Verification:** `pnpm --filter @ef-harness/dictation build && node -e "import('./packages/dictation/dist/index.js')" && pnpm --filter @ef-harness/dictation test`

**Integration priority:** Voice Dictation & Vocabulary integration tasks (Wave M5 Dictation & Composer).

---

### [F-070] Live App Preview (`160`) & Point-to-Fix (`161`) All-Mock `createLivePreviewDaemonRunner` (In-Memory `commits` Map & Fake `killOnJobClose`), Renderer `node:path` Import, Regex-Only `VisualSteerRouter` & Unwired `P0.8`/`174` Baselines

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** RUNTIME_WIRING

**Affected units:** `Task 009` (`VisualSteerOutputSchema`), `Task 014` (`GlobalBrokerDb` `port_leases`), `Task 028` (`CasBlobStore`), `Task 038` (`WorktreeSlotPool`), `Task 040` (`WindowsJobObjectManager`), `Task 050`–`Task 052` (`test-env`), `Task 057` (`UiPlaywrightContractVerifier`), `Task 093` (`Phase0ExecutionController` `P0.8`), `Task 111` (`ProjectMergeQueue`), `Task 120` (`RuntimeOnlyEnvInjector`), `Task 155` (`SingleComposerView`), `Task 160` (`preview`), `Task 161` (`jsx-source-plugin` & `point-to-fix`), `Task 167` (`code-index.db`), `Task 174` (`UiConsistencyPipeline`).

**Files and symbols:** `apps/daemon/src/preview/create-runner.ts:31-69` (`createLivePreviewDaemonRunner`), `apps/daemon/src/preview/local-job-supervisor.ts:34-79,98-120` (`LocalWindowsJobSupervisor`), `apps/renderer/src/preview/point-to-fix/source-path.ts:1,40-58` (`validateEfSourceInWorkspace`), `apps/renderer/src/preview/point-to-fix/visual-steer-router.ts:10-13,47-97` (`VisualSteerRouter`), `packages/planner/src/jsx-source-plugin/vite-plugin.ts:10-36` (`DevOnlyJsxSourceTagPlugin`).

**Actual implementation:**
1. **`createLivePreviewDaemonRunner` (`160`) wires 100% local mock ports & fake `killOnJobClose`:** `create-runner.ts:31-69` instantiates `LocalLiveKeyTestRefusalGuard`, `LocalTestEnvOrchestrator`, `LocalTemplateDbSeeder`, `LocalPortLeaseRepo`, `LocalWorktreeSlotPool` (which writes synthetic `options.commits: Record<string, Record<string, string>>` in-memory strings to disk instead of checking out `wt/<project>/integration` via `Task 038`!), `LocalRuntimeOnlyEnvInjector`, and `LocalWindowsJobSupervisor` (`local-job-supervisor.ts:98-120`, which stamps `readonly killOnJobClose = true as const` without ever creating a Windows Job Object!).
2. **`Point-to-Fix` (`161`) renderer `node:path` import, regex-only `VisualSteerRouter`, and unwired `P0.8`/`174`:** `apps/renderer/src/preview/point-to-fix/source-path.ts:1` imports `"node:path"` inside `apps/renderer` (forbidden Node built-in in sandboxed renderer). `VisualSteerRouter.route` (`visual-steer-router.ts:10-13,47-97`) never invokes the `visual-steer@1` LLM contract or `Task 009` `VisualSteerOutputSchema` — it matches 3 hardcoded regexes, checks only 2 hardcoded paths (`src/components/ui/button.tsx`, `design/tokens.json`), hardcodes `"This changes shared Button across 8 screens..."`, and falls back to `"src/unknown/Unknown.tsx"` instead of querying `Task 167` `code-index.db`. Moreover, `DevOnlyJsxSourceTagPlugin` (`packages/planner/src/jsx-source-plugin`) is unexported from `@ef-harness/planner` and unwired from `093` Phase 0 `P0.8`, and `BeforeAfterBaselineApprover` is unwired from `028` `CasBlobStore`, `057` `UiPlaywrightContractVerifier`, and `174` `UiConsistencyPipeline`.

**Required architecture:** `ui-design-system.md` (`Live App Preview` & `Point-to-Fix`) and `prompt-contracts.md` (`visual-steer@1`) require `LivePreviewDaemonRunner` (`160`) to run real `wt/<project>/integration` Git checkouts (`038`) under `WindowsJobObjectManager` (`040`), `GlobalBrokerDb` `port_leases` (`014`), `TestEnvOrchestrator` (`050`), `TemplateDbManager` (`052`), `ProjectMergeQueue` (`111`), and `RuntimeOnlyEnvInjector` (`120`); `DevOnlyJsxSourceTagPlugin` (`161`) to install during `093` `P0.8`; and `VisualSteerRouter` (`161`) to run daemon-side over IPC backed by `visual-steer@1` (`009`), `code-index.db` (`167`), `CasBlobStore` (`028`), `UiPlaywrightContractVerifier` (`057`), and `UiConsistencyPipeline` (`174`).

**Evidence:** `apps/daemon/src/preview/create-runner.ts:31-69`; `apps/daemon/src/preview/local-job-supervisor.ts:34-79,98-120`; `apps/renderer/src/preview/point-to-fix/source-path.ts:1,40-58`; `apps/renderer/src/preview/point-to-fix/visual-steer-router.ts:10-13,47-97`.

**Why this is a defect:** `LivePreviewDaemonRunner` cannot boot a real Git worktree or clean up orphaned dev-server grandchildren on daemon crash; `apps/renderer` fails browser bundling on `import path from "node:path"`; and Point-to-Fix misroutes brownfield/non-button components while never updating `Task 174` visual baselines.

**Required correction:** Wire `LivePreviewDaemonRunner` (`160`) in `apps/daemon` (`066`) to real `@ef-harness/{db,git-engine,sandbox,test-env,integrator,governor}` (`014, 038, 040, 050, 052, 111, 120`); export `DevOnlyJsxSourceTagPlugin` from `@ef-harness/planner` and wire into `093` `P0.8`; replace `"node:path"` in `apps/renderer/src/preview/point-to-fix/source-path.ts` with pure POSIX path normalization while moving workspace `realpath` + `visual-steer@1` (`009`) + `code-index.db` (`167`) routing and `028`/`057`/`174` baseline approval to `apps/daemon` over IPC, bound to `155` `SingleComposerView` and `160` `IsolatedPreviewWebviewHost`.

**Dependencies:** `F-005`, `F-011`, `F-012`, `F-017`, `F-018`, `F-022`, `F-025`, `F-042`, `F-050`, `F-052`, `F-055`, `F-068`.

**Verification:** `pnpm --filter @ef-harness/planner test -- jsx-source-plugin && pnpm --filter @ef-harness/daemon test -- preview && pnpm --filter @ef-harness/renderer test -- preview-host preview-point-to-fix`

**Integration priority:** Live App Preview & Point-to-Fix integration tasks (Wave M5 Preview & UI).

---

### F-071 — Office 2D Renderer (`Task 162`) Undeclared `"pixi.js"` Dependency, Forbidden Renderer `node:fs`/`node:path`/`node:url` Imports, Hardcoded `800×600` Viewport Size, Unmounted `world` Scene Graph & Empty Duplicate Branch `task/162-office-pixijs-floorplan-sprites`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** build-packaging

**Affected units:** `Task 117` (`apps/desktop` sandboxed `BrowserWindow`), `Task 122` (`apps/renderer` shell), `Task 162` (`task/162-office-pixijs-floor-sprites` @ `73d1bd4` and superseded empty branch `task/162-office-pixijs-floorplan-sprites` @ `6497730`), `Task 196` (NSIS bundled Office art check).

**Files and symbols:** `apps/renderer/package.json:20-22`, `apps/renderer/src/office/renderer/office-pixi-viewport.ts:1,17-20,43,50-56,74-111` (`OfficePixiViewport`), `apps/renderer/src/office/renderer/asset-paths.ts:1-25`, `apps/renderer/src/office/renderer/tiled-floor-plan-loader.ts:1,48-50` (`TiledFloorPlanLoader.loadFromPath`), `apps/renderer/src/office/renderer/cozy-pixel-sprite-atlas-engine.ts:1,60-65` (`CozyPixelSpriteAtlasEngine.loadFromDisk`).

**Actual implementation:**
1. **Missing `"pixi.js"` in `apps/renderer/package.json`:** `office-pixi-viewport.ts:1` imports `{ Application, Container } from "pixi.js"`, yet `apps/renderer/package.json:20-22` lists only `"@ef-harness/shared-contracts": "workspace:*"` in `dependencies`.
2. **Forbidden Node built-in imports in sandboxed renderer:** `asset-paths.ts:1-4`, `tiled-floor-plan-loader.ts:1,49`, and `cozy-pixel-sprite-atlas-engine.ts:1,61,64` import `"node:fs"`, `"node:path"`, and `"node:url"` (`fs.readFileSync`, `fs.statSync`, `fileURLToPath`) inside `apps/renderer`, and `apps/renderer`'s `tsc` build does not copy/bundle `apps/renderer/assets/office/*` (`floorplan-v1.tmj`, `cozy-office-atlas.{json,png}`, `office-tiles.png`).
3. **Ignored `options.width`/`options.height` & empty `this.world` container:** `OfficePixiViewport.bootstrap` (`office-pixi-viewport.ts:17-20,77-88,97-100`) ignores `options.width` and `options.height`, hardcoding `800` and `600`, and adds an empty `this.world = new Container()` to `app.stage` without ever instantiating tilemap or character `Sprite` display objects.
4. **Empty duplicate branch:** `task/162-office-pixijs-floorplan-sprites` sits at `main` (`6497730`) with `0` committed product/test files (only untracked `.agent-handoffs/task-162.md`), superseded by `task/162-office-pixijs-floor-sprites` (`73d1bd4`).

**Required architecture:** `office-view.md`, `open-design-questions.md`, and `security-and-governance.md` (`BrowserWindow` `sandbox: true, nodeIntegration: false`) require `apps/renderer` to declare `"pixi.js"` explicitly in `package.json`, load bundled static Office assets (`floorplan-v1.tmj`, `cozy-office-atlas.{json,png}`, `office-tiles.png`) via browser-safe static imports/`fetch` without `node:fs`/`node:path`/`node:url`, initialize `OfficePixiViewport` at the actual `options.width × options.height` pane dimensions, and render layered tilemap/cast sprites onto `this.world`.

**Evidence:** `apps/renderer/package.json:20-22`; `apps/renderer/src/office/renderer/office-pixi-viewport.ts:1,17-20,43,74-111`; `apps/renderer/src/office/renderer/asset-paths.ts:1-25`; `apps/renderer/src/office/renderer/tiled-floor-plan-loader.ts:1,48-50`; `apps/renderer/src/office/renderer/cozy-pixel-sprite-atlas-engine.ts:1,60-65`.

**Why this is a defect:** `OfficePixiViewport` fails strict pnpm dependency resolution without `"pixi.js"`, crashes immediately in Electron's sandboxed renderer on `import fs from "node:fs"`, mis-frames narrow panes at `800×600`, and draws a blank tinted canvas with zero tiles/sprites.

**Required correction:** Land `task/162-office-pixijs-floor-sprites` (`73d1bd4`) and exclude empty `task/162-office-pixijs-floorplan-sprites` (`6497730`); add `"pixi.js"` to `apps/renderer/package.json`; replace `node:fs`/`node:path`/`node:url` in `TiledFloorPlanLoader` and `CozyPixelSpriteAtlasEngine` with browser-safe static JSON imports / `fetch` URL asset loading (retaining optional file-buffer injection for Node Vitest) and copy `assets/office/**` into `dist/assets/office/**`; wire `options.width`/`options.height` in `OfficePixiViewport.bootstrap`; and mount layered tile/prop/character/icon/label PixiJS display objects onto `this.world`.

**Dependencies:** `F-054`, `F-063`, `F-067`.

**Verification:** `pnpm --filter @ef-harness/renderer build && pnpm --filter @ef-harness/renderer test -- office-renderer`

**Integration priority:** Cozy Office View integration task (Wave M5 Office).

---

### F-072 — Four-Way Office Submodule Isolation (`Tasks 162–165`): 3 Incompatible `OfficeRoomId` Vocabularies (`"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"`), `OfficeCastProjector`/`WalkableGridPort` Clashes, Uncapped `ORANGE` Override Motion, Missing `118`/`122–127` Wiring & Empty Branch `task/164-office-animation-director-astar`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 106` (`VersionedModelRoster`), `Task 116` (`Decision` cards), `Task 118` (`PressureHysteresisStateMachine`), `Task 119` (`Pool 2` slots), `Task 122`–`Task 127` (App Shell, Presets, Board, Health, Inspector, Inbox), `Task 162` (`office/renderer`), `Task 163` (`office/cast`), `Task 164` (`task/164-office-animation-director-v2` @ `0272a00` and superseded empty `task/164-office-animation-director-astar` @ `6497730`), `Task 165` (`office/a11y`).

**Files and symbols:** `apps/renderer/src/office/renderer/room-ids.ts:2-16` (`ROOM_IDS`), `apps/renderer/src/office/cast/rooms.ts:4-16,32-69` (`ROOM_ORIGIN`, `deskAnchor`, `roomForWorker`), `apps/renderer/src/office/cast/office-cast-projector.ts:57-148` (`OfficeCastProjector.project`), `apps/renderer/src/office/director/constants.ts:2-16` (`OFFICE_ROOM_IDS`), `apps/renderer/src/office/director/types.ts:23-47` (`WalkableGridPort`, `OfficeCastProjectorPort`), `apps/renderer/src/office/director/synthetic-walkable-grid.ts:9-60` (`createSyntheticOfficeWalkableGrid`), `apps/renderer/src/office/a11y/types.ts:1-21,62-72` (`OFFICE_LOGICAL_TAB_ROOMS`, `PressureMachinePort`), `apps/renderer/src/office/a11y/orange-pressure-auto-board-fallback.ts:56-63` (`OrangePressureAutoBoardFallback.setUserOverride`).

**Actual implementation:**
1. **3-way `OfficeRoomId` mismatch:** `162` (`room-ids.ts:2-14`) and `164` (`director/constants.ts:2-14`) define `"qa-verification-lab"` and `"integration-merge-bay"`; `163` (`cast/rooms.ts:12,59`, `office-cast-projector.ts:104,136-139`) uses `"qa-lab"` and hardcoded `ROOM_ORIGIN` pixel offsets instead of `162`'s `TiledFloorPlanLoader` `deskAnchors`; `165` (`a11y/types.ts:1-9`) uses snake_case `"ceo_office"`, `"engineering_bullpen"`, `"qa_lab"`, `"merge_bay"`, `"shipping_dock"`, `"break_room"` (omitting `front-desk`, `discovery-lounge`, `research-library`, `architecture-studio`, and `planning-war-room` from `OfficeSemanticMirrorTree`!).
2. **`163` ↔ `164` & `162` ↔ `164` port mismatches:** `163` `OfficeCastProjector` exposes `project(snapshot: OfficeCanonicalSnapshot, view?: OfficeViewState): OfficeCastScene`, whereas `164` `TruthfulAnimationDirector` expects `OfficeCastProjectorPort { project(agentId: string): CastProjection | null; listActiveAgentIds(): readonly string[] }`. `162` `LoadedFloorPlan` returns a flat `walkable: ReadonlyArray<number>` without `roomDoorways`, whereas `164` expects `WalkableGridSnapshot` (`walkable: ReadonlySet<string>` `"col,row"`, `roomDoorways`, `roomDesks`) and defaults to `createSyntheticOfficeWalkableGrid()` (`synthetic-walkable-grid.ts:9-60` with a hardcoded deleted tile at `30,20`).
3. **Uncapped motion on `ORANGE` user override & `118`/`122–127` disconnection:** `OrangePressureAutoBoardFallback.setUserOverride(true)` (`orange-pressure-auto-board-fallback.ts:56-63`) calls `this.pixi.start()` under `ORANGE`/`RED` pressure without capping `TruthfulAnimationDirector` to static reduced-motion mode (`setMotionEnabled(false)`). `165` `PressureMachinePort` expects `.pressure` + `.subscribe(...)` (missing on `118` `PressureHysteresisStateMachine` — `F-055`), and none of `162–165` is wired to `apps/renderer/src/index.ts` (`122`) or `123–127`.
4. **Empty duplicate branch:** `task/164-office-animation-director-astar` sits at `main` (`6497730`) with `0` committed product/test files, superseded by `task/164-office-animation-director-v2` (`0272a00`).

**Required architecture:** `office-view.md` and `cockpit-and-office.mmd` require all 4 Office submodules (`renderer`, `cast`, `director`, `a11y`) to share `Task 162`'s 11 canonical `ROOM_IDS` (`"qa-verification-lab"`, `"integration-merge-bay"`, etc.) and `floorplan-v1.tmj` walkable grid/desk anchors, expose all 11 rooms in `OfficeSemanticMirrorTree` logical Tab order, force static seated mode when the user overrides `ORANGE` Board fallback, and integrate cleanly with `118` Governor IPC and `122–127` Cockpit views/inspectors.

**Evidence:** `apps/renderer/src/office/renderer/room-ids.ts:2-16`; `apps/renderer/src/office/cast/rooms.ts:4-16,59`; `apps/renderer/src/office/director/types.ts:23-47`; `apps/renderer/src/office/a11y/types.ts:1-21,69-72`; `apps/renderer/src/office/a11y/orange-pressure-auto-board-fallback.ts:56-63`.

**Why this is a defect:** `162–165` cannot compile or run together without unifying `OfficeRoomId`, adapting `LoadedFloorPlan` → `WalkableGridPort` + `deskAnchors` and `OfficeCastScene` → `TruthfulAnimationDirector`, covering all 11 rooms in `OfficeSemanticMirrorTree`, enforcing reduced motion on `ORANGE` override, and wiring `118`/`122–127`.

**Required correction:** Land `task/163-office-seated-cast-tags-flows` (`e70dc27`), `task/164-office-animation-director-v2` (`0272a00` — excluding empty `task/164-office-animation-director-astar` `6497730`), and `task/165-office-accessibility-auto-fallback` (`c3401c3`); standardize `OfficeRoomId` across `162–165` on `Task 162`'s 11 canonical kebab-case `ROOM_IDS` (mapping all 11 rooms + flagged priority group in `OfficeSemanticMirrorTree`); build adapters from `LoadedFloorPlan` (`162`) to `deskAnchor` (`163`) and `WalkableGridPort` (`164`, deriving doorway tiles per room from `floorplan-v1.tmj`) and from `OfficeCastProjector` (`163`) to `OfficeCastProjectorPort` (`164`); force `director.setMotionEnabled(false)` when `userOverrodeOrangeFallback` is active during `ORANGE`/`RED` pressure; and mount the unified `OfficeView` into `apps/renderer/src/index.ts` (`122`) wired to `118` IPC pressure stream and `123–127` Cockpit stores/panels.

**Dependencies:** `F-055`, `F-063`, `F-064`, `F-065`, `F-071`.

**Verification:** `pnpm --filter @ef-harness/renderer test -- office-renderer office-cast office-director office-a11y`

**Integration priority:** Cozy Office View integration task (Wave M5 Office).

---

### F-073 — Brownfield L1/L2 (`Tasks 167–168`) Undeclared & Uncalled `web-tree-sitter` WASM, Synchronous Event-Loop Blocking, Lowercase Governor `"orange"`/`"red"` Check, Fake Linear Edges in `renderPersonalizedMap` & Missing `code-index.db.module_cards` Persistence

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** local-defect

**Affected units:** `Task 009` (`ModuleCardWriterV1Schema`), `Task 011` (`PacketSecurityRedactor`), `Task 014` (`CodeIndexDb` / `schema/code-index.sql`), `Task 118` (`PressureHysteresisStateMachine`), `Task 129` (`CrossFeatureUsageGraphChecker`), `Task 167` (`l1-codemap`), `Task 168` (`l2-cards`), `Task 185` (`sweeps`).

**Files and symbols:** `packages/brownfield/package.json:20-22`, `packages/brownfield/src/l1-codemap/web-tree-sitter-loader.ts:5-18`, `packages/brownfield/src/l1-codemap/wasm-tree-sitter-indexer.ts:52-54,61-136` (`WasmTreeSitterIndexer.index`), `packages/brownfield/src/l1-codemap/compact-code-map-query-service.ts:68-105` (`CompactCodeMapQueryService.renderPersonalizedMap`), `schema/code-index.sql:1-44`, `packages/brownfield/src/l2-cards/in-memory.ts:15-37,97-129`.

**Actual implementation:**
1. **`web-tree-sitter` undeclared, unbundled & never called:** `web-tree-sitter-loader.ts:10` calls `require("web-tree-sitter")` (missing from `packages/brownfield/package.json`), swallows the error returning `false`, ships zero `.wasm` language grammars, and `wasm-tree-sitter-indexer.ts:111` calls regex `parseStructurally(rel, content)` unconditionally without ever invoking Tree-Sitter.
2. **Synchronous blocking loop & lowercase Governor check:** `WasmTreeSitterIndexer.index` (`wasm-tree-sitter-indexer.ts:61-130`) runs synchronously (`fs.statSync`, `fs.readFileSync`) without async event-loop yields every 25 files, and line 90 checks `signal.level === "orange" || signal.level === "red"` (lowercase) against `Task 118`'s uppercase `"ORANGE" | "RED"`.
3. **Fake linear graph in `renderPersonalizedMap`:** `compact-code-map-query-service.ts:84-88` builds synthetic edges `global[i] -> global[i+1]` instead of loading real `import:<path>` / `refs` reference edges from `code-index.db`.
4. **No SQLite `module_cards` persistence in `code-index.db`:** `schema/code-index.sql` lacks a `module_cards` table, and `Task 168` only implements volatile `InMemoryModuleCardStore` / `InMemoryObservedModuleGraph` / `InMemoryRepoCloudEgressLedger` (`in-memory.ts`) plus a duplicate local `packet-security-redactor.ts`.

**Required architecture:** `brownfield-discovery.md` (`Layer 1` & `Layer 2`), `database-design.md`, and `prompt-contracts.md` (`module-card-writer@1`) require `WasmTreeSitterIndexer` to parse supported languages via bundled `web-tree-sitter` WASM asynchronously in 25-file batches yielding to uppercase `"ORANGE" | "RED"` Governor pressure, `renderPersonalizedMap` to run personalized PageRank over real `code-index.db` reference/import edges, and `ModuleCardCacheEngine` (`168`) to persist `(file_path, file_content_sha256, prompt_version)` cards in `code-index.db` using `Task 009` `ModuleCardWriterV1Schema` and `Task 011` `PacketSecurityRedactor`.

**Evidence:** `packages/brownfield/package.json:20-22`; `packages/brownfield/src/l1-codemap/web-tree-sitter-loader.ts:5-18`; `packages/brownfield/src/l1-codemap/wasm-tree-sitter-indexer.ts:61-136`; `packages/brownfield/src/l1-codemap/compact-code-map-query-service.ts:84-88`; `schema/code-index.sql:1-44`; `packages/brownfield/src/l2-cards/in-memory.ts:15-37,97-129`.

**Why this is a defect:** Large brownfield repos freeze the daemon/UI thread during synchronous indexing, never pause under `ORANGE` RAM pressure, compute bogus personalized repo maps over rank-order chains rather than caller/callee edges, and lose all L2 module cards on restart.

**Required correction:** Add `"web-tree-sitter"` + grammar `.wasm` copy rules to `packages/brownfield/package.json` and wire real WASM AST extraction (with `parseStructurally` fallback for unsupported extensions) plus async 25-file batch yielding on `"ORANGE" | "RED"`; load real `import:`/`refs` edges in `CompactCodeMapQueryService.renderPersonalizedMap`; add `CREATE TABLE IF NOT EXISTS module_cards` to `CodeIndexDb` (`014`/`167`) and implement `SqliteModuleCardStore` in `168` backed by `@ef-harness/shared-contracts` (`009`) and `@ef-harness/shared-observability` (`011`).

**Dependencies:** `F-003`, `F-005`, `F-012`, `F-055`.

**Verification:** `pnpm --filter @ef-harness/brownfield test -- l1-codemap l2-cards`

**Integration priority:** Brownfield repository indexing & summaries integration task (Wave M5 Brownfield).

---

### F-074 — `packages/brownfield` (`Tasks 166–170`) 5-Way Internal Silo Isolation, Empty Barrel, Ambient `PATH` `"git"`, Volatile In-Memory `work_items`/`quarantined_tests` & Upstream Port Mismatches (`017, 035, 038, 048, 069, 088, 153`)

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 017` (`KnowledgeGraphRepo`), `Task 035`–`Task 036` (`MinGit` & `SafetyScanner`), `Task 038` (`WorktreeSlotPool`), `Task 048` (`HarnessRunEngine`), `Task 050` (`TestEnvOrchestrator`), `Task 069` (`DiscoverySessionCoordinator`), `Task 088` (`ContextSlicerEngine`), `Task 093` (`Phase0ExecutionController`), `Task 153` (`ArchitectureCanvas`), `Task 166`–`Task 170` (`packages/brownfield`).

**Files and symbols:** `packages/brownfield/src/index.ts:1-9`, `packages/brownfield/src/l0-scan/git-exec.ts:19-35` (`createNodeGitRunner`), `packages/brownfield/src/l0-scan/observed-repo-facts-persister.ts:52-81` (`ObservedRepoFactsPersister`), `packages/brownfield/src/opening/brownfield-opening-controller.ts:70-160` (`BrownfieldOpeningController.open`), `packages/brownfield/src/opening/work-item-store.ts:4-29` (`InMemoryWorkItemStore`), `packages/brownfield/src/test-health/baseline-test-health-runner.ts:65-147` (`BaselineTestHealthRunner.run`).

**Actual implementation:**
1. **Empty barrel & zero internal cross-imports:** `packages/brownfield/src/index.ts` exports only `packageIdentity()` on all 5 branches (`166–170`), and `l0-scan`, `l1-codemap`, `l2-cards`, `opening`, and `test-health` define incompatible private port interfaces for each other (`169` calls `l0.scanSummary` and `codeMap.listModulesForPaths`, `170` calls `l0Scanner.detectScripts` — none of which exist on `166` `BrownfieldL0RepoScanner` or `167` `CompactCodeMapQueryService`!).
2. **Ambient `PATH` `"git"` & custom KB node kinds:** `166` `git-exec.ts:22` runs `spawnSync("git", ...)` from ambient `PATH` instead of `035` Hermetic `MinGit` (`F-017`), and `166`/`168` invent `upsertObservedNode`/`upsertBrownfieldModule` (`type = 'brownfield_module'` missing from `schema/state.sql` `node_kinds`!).
3. **Volatile `work_items` & `quarantined_tests` + upstream port mismatches:** `169` persists `work_items` only in `InMemoryWorkItemStore` and calls nonexistent `discovery.preSettleObservedCriteria(...)` on `069`; `170` calls nonexistent `worktrees.checkoutIsolated` (`038` uses `acquire`) and `harness.runInSandbox` (`048` uses `execute`), storing baseline health and `quarantined_tests` only in `in-memory.ts` instead of `state.db` (`schema/state.sql` `work_items`, `quarantined_tests`, `kv`).

**Required architecture:** `brownfield-discovery.md`, `workspace-and-git.md`, and `schema/state.sql` (`work_items`, `quarantined_tests`, `nodes`, `kv`) require `packages/brownfield` to execute Git exclusively through `035` Hermetic `MinGit`, persist L0/L2 `observed` nodes (`kind = 'research_fact'` / `'component'` with `basis = 'observed'`), `work_items`, and `quarantined_tests` in `state.db` via `@ef-harness/db` single-writer repos, pre-settle `069` discovery criteria, inject `<= 600`-token repo conventions into `088` `ContextSlicerEngine`, and run `170` baseline health inside `038` `WorktreeSlotPool` + `048` `HarnessRunEngine`.

**Evidence:** `packages/brownfield/src/index.ts:1-9`; `packages/brownfield/src/l0-scan/git-exec.ts:19-35`; `packages/brownfield/src/opening/brownfield-opening-controller.ts:70-160`; `packages/brownfield/src/opening/work-item-store.ts:4-29`; `packages/brownfield/src/test-health/baseline-test-health-runner.ts:65-147`.

**Why this is a defect:** None of `166–170` is importable from `@ef-harness/brownfield`, `169`/`170` cannot call `166`/`167` or `038`/`048`/`069`, and all brownfield `work_items` and `quarantined_tests` vanish on process restart.

**Required correction:** Export `l0-scan`, `l1-codemap`, `l2-cards`, `opening`, and `test-health` from `packages/brownfield/src/index.ts`; wire `166` to `035` `MinGit` and `017` `KnowledgeGraphRepo` + `state.db.kv`; align `169` and `170` adapters to real `166` `BrownfieldL0RepoScanner`, `167` `CompactCodeMapQueryService`, `168` `ModuleCardCacheEngine`/`StaleDocsDetector`, `038` `WorktreeSlotPool`, `048` `HarnessRunEngine`, `069` `DiscoverySessionCoordinator`, `088` `ContextSlicerEngine`, and `153` `ArchitectureCanvas`, persisting `work_items` and `quarantined_tests` in `state.db`.

**Dependencies:** `F-012`, `F-017`, `F-018`, `F-029`, `F-039`, `F-068`, `F-073`.

**Verification:** `pnpm --filter @ef-harness/brownfield build && pnpm --filter @ef-harness/brownfield test`

**Integration priority:** Brownfield Opening & Baseline Test-Health integration task (Wave M5 Brownfield).

---

### F-075 — `Task 175` M5 Exit Gate Self-Contained Toy Re-Implementations (Zero Workspace Imports, Non-SQLite `CodeIndexDatabase` Stub, `.git/HEAD`-Only Live Mode) & `.ts` Extension Imports

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** test-gap

**Affected units:** `Task 153`–`Task 174` (entire Milestone 5 stack), `Task 175` (`m5-exit-gate`), `Task 189` (`meta-lab` benchmark registry), `Task 200` (v1 Release Certification).

**Files and symbols:** `tests/e2e/m5-exit-gate/run-m5-suite.ts:1-16`, `tests/e2e/m5-exit-gate/runner.ts:3-38` (`runM5Certification`, `runLiveCertification`), `tests/e2e/m5-exit-gate/brownfield.ts:13-16,62-180`, `tests/e2e/m5-exit-gate/office.ts:14-118`, `tests/e2e/m5-exit-gate/ux.ts:18-120`.

**Actual implementation:**
1. **Relative `.ts` imports across all `m5-exit-gate` source files:** `run-m5-suite.ts`, `runner.ts`, `brownfield.ts`, `office.ts`, and `ux.ts` import `./runner.ts`, `./constants.ts`, `./manifest.ts`, `./types.ts`, etc. with `.ts` extensions, failing standard `tsc` emit (`TS5097`) unless rewritten to `.js`.
2. **100% fake local toy classes with zero workspace imports:** `tests/e2e/m5-exit-gate/{brownfield.ts,office.ts,ux.ts}` never import `@ef-harness/brownfield`, `@ef-harness/dictation`, `@ef-harness/renderer`, `@ef-harness/integrator`, or `@ef-harness/daemon`. Instead, they define miniature toy classes (`BrownfieldL0RepoScanner`, `WasmTreeSitterIndexer`, `CodeIndexDatabase` which checks `schema.includes("CREATE TABLE symbols")` via `fs.readFileSync` without opening SQLite, `OfficeCastProjector`, `TruthfulAnimationDirector`, `SavedNodePositionStore`, etc.), and `runLiveCertification` (`runner.ts:30-38`) merely checks `fs.existsSync(path.join(root, ".git", "HEAD"))`.

**Required architecture:** `roadmap.md` (Milestone 5 Exit Gate) and `resume-changer-benchmark.json` require `Task 175` to exercise the real integrated M5 packages (`@ef-harness/brownfield` `166–170`, `@ef-harness/integrator` `171–174`, `@ef-harness/dictation` `157–158`, `@ef-harness/daemon` `160`, `@ef-harness/renderer` `153–156, 159, 161–165`) against the `resume-changer@497831ec` benchmark fixture and real SQLite `state.db` / `code-index.db`.

**Evidence:** `tests/e2e/m5-exit-gate/run-m5-suite.ts:1-16`; `tests/e2e/m5-exit-gate/runner.ts:3-38`; `tests/e2e/m5-exit-gate/brownfield.ts:62-180`; `tests/e2e/m5-exit-gate/office.ts:24-118`; `tests/e2e/m5-exit-gate/ux.ts:46-120`.

**Why this is a defect:** `m5-exit-gate.test.ts` reports green even when every real M5 package (`brownfield`, `dictation`, `renderer` Canvas/Office/Preview, `integrator` coexistence/landing/UI consistency) is unmerged, broken, or missing dependencies.

**Required correction:** Convert `.ts` specifiers in `tests/e2e/m5-exit-gate/**` to `.js`, add `@ef-harness/{brownfield,dictation,renderer,integrator,daemon,db}` dependencies to `tests/e2e/package.json`, and replace the toy classes in `brownfield.ts`, `office.ts`, `ux.ts`, and `runLiveCertification` with calls into the real integrated M5 implementations backed by real SQLite `state.db` + `code-index.db` and real Git worktrees.

**Dependencies:** `F-049`–`F-052`, `F-067`–`F-074`.

**Verification:** `pnpm --filter @ef-harness/e2e typecheck && pnpm --filter @ef-harness/e2e test -- m5-exit-gate`

**Integration priority:** Milestone 5 Exit Gate certification task (end of Wave M5).

---

### F-076 — `ship-deploy` (`Tasks 176, 178, 180`) Disconnected `project_runtime` Fencing Table, Rogue `MigrationStateStore` `DatabaseSync` Overwriting `effects.payload_hash`, and Nested-Path Stripping in `LinuxCaseSensitivityAutoRepair`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** schema-conflict

**Affected units:** `Task 010`/`Task 015` (`SqliteConnection` + `ef_search_text`), `Task 029` (`EffectsRepo`), `Task 114` (`StopCoordinator`), `Task 176` (`effects`), `Task 178` (`ci-loop`), `Task 180` (`live-migrations`), `Task 187` (`writer_epoch`), `Task 200` (M6 Linux case-repair certification).

**Files and symbols:** `packages/ship-deploy/src/effects/store.ts:19-25,136-160` (`EFFECTS_SCHEMA`, `SqliteEffectStore.atomicDispatchTransition`), `packages/ship-deploy/src/live-migrations/state-store.ts:54-72,285-317` (`MigrationStateStore.open`, `MigrationStateStore.record`), `packages/ship-deploy/src/ci-loop/linux-case-sensitivity-auto-repair.ts:21-47,65-70` (`findTrackedCaseMatch`, `rewriteImportLine`, `LinuxCaseSensitivityAutoRepair.planRepairs`).

**Actual implementation:**
1. **Non-canonical `project_runtime` table defeats `STOP` & `writer_epoch` fencing (`176`):** `SqliteEffectStore` (`effects/store.ts:19-25,140-145`) creates a private `project_runtime (singleton, writer_epoch, state)` table absent from `schema/state.sql` and seeds `(1, 1, 'RUNNING')`. Neither `Task 114` `StopCoordinator` nor `Task 187` `writer_epoch` updates `project_runtime`, so real `STOP` events and cross-device lease takeovers never block `atomicDispatchTransition`.
2. **Rogue `DatabaseSync` writer & `idempotency_key` `payload_hash` clobber (`180`):** `MigrationStateStore.open` (`live-migrations/state-store.ts:61-72`) opens a separate `new DatabaseSync(file)` writer on `state.db` without `CoordinatorWriteQueue` or the `ef_search_text` UDF, and `MigrationStateStore.record` (`lines 285-311`) implements a competing `ExternalEffectLedger` with `ON CONFLICT(idempotency_key) DO UPDATE SET ... payload_hash = excluded.payload_hash` and `lease_epoch = NULL` — silently overwriting mismatched payload hashes instead of raising `PayloadHashMismatchError`.
3. **Nested relative import directory stripping (`178`):** `rewriteImportLine` (`linux-case-sensitivity-auto-repair.ts:36-47,69`) sets `desired = "./" + basenameWithoutExt(resolvedPath)` and matches `tracked` files by basename alone — turning `'./Components/Header'` or `'../utils/DateFormat'` into `'./header'` or `'./dateFormat'` and breaking every nested relative import!

**Required architecture:** `ship-and-deploy.md`, `database-design.md`, and `schema/state.sql` (`effects`, `ship_runs`, `meta`/`kv`) require all external effects to flow through a single `ExternalEffectLedger` (`176`) on the canonical `@ef-harness/db` single-writer connection (`015`–`016`, `029`), fencing against canonical `StopCoordinator` (`114`) and `lease.yaml`/`meta` `writer_epoch` (`187`), hard-rejecting `idempotency_key` reuse with altered `payload_hash`, and preserving relative directory prefixes (`path.posix.relative(path.posix.dirname(importerFile), trackedPath)`) during Linux case-sensitivity auto-repair.

**Evidence:** `packages/ship-deploy/src/effects/store.ts:19-25,136-160`; `packages/ship-deploy/src/live-migrations/state-store.ts:61-72,285-317`; `packages/ship-deploy/src/ci-loop/linux-case-sensitivity-auto-repair.ts:21-47,65-70`; `schema/state.sql:547-560,734-750`.

**Why this is a defect:** Stale laptops and `STOPPED` projects can still dispatch production deploys/pushes; `180` bypasses `176`'s idempotency hash guard and causes `SQLITE_BUSY` / missing-UDF crashes; and `178` corrupts nested relative imports during Linux CI case-mismatch repair.

**Required correction:** Route `SqliteEffectStore` (`176`) and `MigrationStateStore` (`180`) through `@ef-harness/db` single-writer `SqliteConnection`/`CoordinatorWriteQueue` (`015`–`016`, `029`), reading live `STOP` state from `114` `StopCoordinator`/`kv` and `writer_epoch` from `meta`/`187` instead of private `project_runtime`; delete `MigrationStateStore.record` in favor of `176` `ExternalEffectLedger`; and fix `LinuxCaseSensitivityAutoRepair` (`178`) to resolve importer-relative paths accurately (`./Components/header`, `../utils/dateFormat`) before rewriting.

**Dependencies:** `F-010`, `F-012`, `F-053`, `F-065`.

**Verification:** `pnpm --filter @ef-harness/ship-deploy test -- effects ci-loop live-migrations`

**Integration priority:** Ship & Deploy core ledger and CI-repair integration task (Wave M6 Ship).

---

### F-077 — `packages/ship-deploy` (`Tasks 176–181`) 6-Way Internal Silo Isolation, Empty Barrel, Volatile In-Memory `ship_runs`/Rate-Queue/CAS Stores, Unbound `commitSha` Approval Hash & Unwired Upstream Ports

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 007` (`canonicalJson`), `Task 009` (`CiTriageV1Schema`), `Task 011` (`PacketSecurityRedactor`), `Task 014` (`GlobalBrokerDb`), `Task 028` (`CasBlobStore`), `Task 029` (`EffectsRepo`), `Task 035`–`Task 036` (`MinGit` & `SafetyScanner`), `Task 055` (`CleanVerifierRunner`), `Task 101` (`LandingSummaryGenerator`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 127` (`ApprovalCard`), `Task 176`–`Task 181` (`packages/ship-deploy`).

**Files and symbols:** `packages/ship-deploy/src/index.ts:1-9`, `packages/ship-deploy/src/github/rate-queue.ts:51-58,159` (`GitHubRateAwareQueue`, `sharedQueues`), `packages/ship-deploy/src/ci-loop/ship-run-store.ts:4-22` (`InMemoryShipRunStore`), `packages/ship-deploy/src/deploy-adapters/docker-ssh-adapter.ts:75-81` (`DockerOverSshDeployAdapter.planDeploy`), `packages/ship-deploy/src/post-deploy/store.ts:37-68` (`InMemoryCasBlobStore`, `InMemoryPostDeployStore`).

**Actual implementation:**
1. **Empty barrel & zero cross-submodule imports:** `packages/ship-deploy/src/index.ts` exports only `packageIdentity()` on all 6 branches (`176–181`), and `effects`, `github`, `ci-loop`, `deploy-adapters`, `live-migrations`, and `post-deploy` never import one another.
2. **Volatile RAM-only `ship_runs`, rate limits & post-deploy receipts:** `178` (`InMemoryShipRunStore`) and `181` (`InMemoryPostDeployStore`, `InMemoryCasBlobStore`) keep `ship_runs`, webhook/DNS registration receipts, and Playwright smoke artifacts only in memory instead of `state.db.ship_runs` (`schema/state.sql:734-750`) and `028` `CasBlobStore`, while `177` `GitHubRateAwareQueue` (`rate-queue.ts:159`) keeps per-account counters in a process-local `Map` instead of `global.db` (`014`).
3. **Unbound `commitSha` approval hash & duplicated utilities:** `DockerOverSshDeployAdapter.planDeploy` (`docker-ssh-adapter.ts:79`) passes `canonicalPayloadHash: commitSha` instead of RFC 8785 hashing `{ targetEnv, commitSha, envDiff }` via `007` `canonicalJson`, allowing `envDiff` changes without invalidating approval; `176`, `178`, and `181` duplicate `canonical-hash.ts` and `redactor.ts` instead of using `007`/`011`; and `177`/`179` are unwired from `120` `WindowsDpapiSecretsVault` and `127` `ApprovalCard`.

**Required architecture:** `ship-and-deploy.md` and `schema/state.sql` require `@ef-harness/ship-deploy` to export a unified pipeline wiring `177–181` through `176` `ExternalEffectLedger`, persisting `ship_runs` in `state.db` for crash-resumable `CI_WATCHING`/deployments, sharing per-GitHub-account rate budgets in `global.db` (`014`), storing tokens/SSH keys/env secrets in `120` `WindowsDpapiSecretsVault`, storing smoke artifacts in `028` `CasBlobStore`, and binding `ApprovalCard` (`127`) hashes to full RFC 8785 `{ targetEnv, commitSha, migrationSqlHash, envDiff }` payloads (`007`).

**Evidence:** `packages/ship-deploy/src/index.ts:1-9`; `packages/ship-deploy/src/github/rate-queue.ts:159`; `packages/ship-deploy/src/ci-loop/ship-run-store.ts:4-22`; `packages/ship-deploy/src/deploy-adapters/docker-ssh-adapter.ts:75-81`; `packages/ship-deploy/src/post-deploy/store.ts:37-68`.

**Why this is a defect:** Closing EF Harness during CI loses all `ship_runs` state, multi-process/restarted daemons lose GitHub secondary rate-limit state, env-only changes do not invalidate `DockerOverSshDeployAdapter` approval hashes, and `apps/daemon` cannot import any `@ef-harness/ship-deploy` API.

**Required correction:** Export all 6 submodules from `packages/ship-deploy/src/index.ts`; implement SQLite `SqliteShipRunStore` (`state.db.ship_runs`) shared by `178, 180, 181` and `GlobalDbGitHubRateStore` (`global.db`) for `177`; wire `007` `canonicalJson` (including `{ targetEnv, commitSha, envDiff }` in `179`), `009` `CiTriageV1Schema`, `011` `PacketSecurityRedactor`, `028` `CasBlobStore`, `035`–`036` `MinGit`/`SafetyScanner`, `055` `CleanVerifierRunner`, `101` `LandingSummaryGenerator`, `120` `WindowsDpapiSecretsVault`, and `127` `ApprovalCard` into `apps/daemon` (`066`) Ship RPC handlers.

**Dependencies:** `F-003`, `F-005`, `F-011`, `F-012`, `F-017`, `F-025`, `F-044`, `F-056`, `F-065`, `F-076`.

**Verification:** `pnpm --filter @ef-harness/ship-deploy build && pnpm --filter @ef-harness/ship-deploy test`

**Integration priority:** Ship & Deploy adapters and post-deploy verification integration task (Wave M6 Ship).

---

### F-078 — `investigations` (`Tasks 182–184`) Broken `FlakeSafeGitBisector` `125` Skip (`low = mid + 1` Discards Earlier Culprits) & Missing `finally` Reset, Unsandboxed Codemods Missing `ts-morph`/`@ast-grep` Deps, `jscodeshift` Dry-Run Disk Mutation & Unmigrated `investigations` Table

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** local-defect

**Affected units:** `Task 015` (`SqliteConnection` / `MigrationRunner`), `Task 035` (`MinGit`), `Task 045`–`Task 048` (`sandbox`), `Task 182` (`pipeline`), `Task 183` (`localization`), `Task 184` (`sweeps`).

**Files and symbols:** `packages/investigations/package.json:20-22`, `packages/investigations/src/pipeline/investigation-store.ts:18-36,61-69` (`SqliteInvestigationStore`), `packages/investigations/src/localization/flake-safe-git-bisector.ts:30-52,143-203` (`FlakeSafeGitBisector.run`), `packages/investigations/src/sweeps/deterministic-codemod-runner.ts:30-96` (`DeterministicCodemodRunner.runStep`, `withSandbox`).

**Actual implementation:**
1. **`FlakeSafeGitBisector` broken `125` skip & missing `finally` reset (`183`):** When `commits[mid]` fails to compile (`exitCode === GIT_BISECT_SKIP_EXIT` `125`), `flake-safe-git-bisector.ts:153-157` sets `low = mid + 1; continue;` — discarding the entire `[low .. mid-1]` range and missing any culprit introduced before `mid`. It also calls `execFileSync("git", ...)` from `PATH` (`lines 32, 44, 104`) without a `try/finally` restoring `badRef` on error.
2. **Missing codemod dependencies, unsandboxed `ts-morph`/`ast-grep` & mutating `jscodeshift` dry-run (`184`):** `packages/investigations/package.json` omits `ts-morph`, `@ast-grep/napi`, and `jscodeshift` (moving `ts-morph-backend.ts` into `tests/sweeps/`). `withSandbox` (`lines 79-96`) executes `ts-morph` and `ast-grep` in-process without OS sandboxing under a non-preemptive `setTimeout` boolean, while `jscodeshift` (`lines 52-72`) invokes `node [script]` even when `step.dryRun === true` and hardcodes `filesChanged: 0`.
3. **Unmigrated `:memory:` default `investigations` table (`182`):** `SqliteInvestigationStore` (`investigation-store.ts:18-36,66`) defaults to `:memory:` and creates an ad-hoc `investigations` table absent from `schema/state.sql`.

**Required architecture:** `investigations-and-sweeps.md` and `security-and-governance.md` require `FlakeSafeGitBisector` to probe unskipped neighbors around `125` commits (or invoke hermetic `MinGit` `git bisect run`) with unconditional `finally` reset, `DeterministicCodemodRunner` to ship production `ts-morph` + `@ast-grep/napi` backends executed inside `045`/`048` OS sandboxes with true non-mutating `--dry` previews, and `SqliteInvestigationStore` to persist through `@ef-harness/db` single-writer `MigrationRunner`.

**Evidence:** `packages/investigations/package.json:20-22`; `packages/investigations/src/localization/flake-safe-git-bisector.ts:30-52,143-190`; `packages/investigations/src/sweeps/deterministic-codemod-runner.ts:30-96`; `packages/investigations/src/pipeline/investigation-store.ts:18-36,66`.

**Why this is a defect:** `FlakeSafeGitBisector` blames the wrong commit whenever a broken build occurs after the true regression, `DeterministicCodemodRunner` lacks production codemod engines and mutates files during `jscodeshift` dry-runs without sandboxing, and investigations vanish in `:memory:`.

**Required correction:** Fix `FlakeSafeGitBisector` to probe around `125`-skipped commits (`mid - 1`, `mid + 1`, ...) without discarding `[low .. mid-1]`, use `035` Hermetic `MinGit`, and restore `badRef` inside `finally`; promote `ts-morph` + `@ast-grep/napi` backends into `packages/investigations/src/sweeps/`, declare dependencies in `package.json`, execute codemod workers inside `048` `HarnessRunEngine` honoring `dryRun`, and register the `investigations` + `sweep_symbol_maps` migration in `@ef-harness/db` `MigrationRunner`.

**Dependencies:** `F-009`, `F-012`, `F-017`, `F-018`.

**Verification:** `pnpm --filter @ef-harness/investigations test -- pipeline localization sweeps`

**Integration priority:** Mystery-Bug Investigation & Sweeps integration task (Wave M6 Investigations).

---

### F-079 — `packages/investigations` (`Tasks 182–185`) 4-Way Internal Silos, Empty Barrel, `"queued"`/`"paused"` vs `'READY'`/`'BLOCKED'` Mismatch in `PostSweepBriefSymbolUpdater` & `path_leases` (`'granted'` vs `'exclusive'`) Seam

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 009` (`InvestigatorV1Schema`, `SweepPlannerV1Schema`, `SweepWorkerV1Schema`), `Task 017`/`Task 019` (`KnowledgeGraphRepo`, `NameRegistryRepo`), `Task 020` (`TaskClaimLeasesRepo` / `path_leases`), `Task 028` (`CasBlobStore`), `Task 038`–`Task 039` (`WorktreeSlotPool`, `RefLeaseManager`), `Task 050`/`Task 055`/`Task 057` (`test-env`, `verifier`), `Task 088` (`ContextSlicerEngine`), `Task 100` (`BugIntakePipeline`), `Task 111` (`ProjectMergeQueue`), `Task 167`/`Task 170` (`brownfield`), `Task 182`–`Task 185` (`packages/investigations`).

**Files and symbols:** `packages/investigations/src/index.ts:1-9`, `packages/investigations/src/pipeline/pipeline.ts:101-117`, `packages/investigations/src/sweeps/sweep-lease-coordinator.ts:28-53`, `packages/investigations/src/sweep-guards/post-sweep-brief-symbol-updater.ts:18-27,49-70` (`PostSweepBriefSymbolUpdater.updateQueuedTasks`).

**Actual implementation:**
1. **Empty barrel & zero cross-imports across `182–185`:** `packages/investigations/src/index.ts` exports only `packageIdentity()` across all 4 branches; `182` (`pipeline`) never invokes `183` (`localization`), and `184` (`sweeps`) never invokes `185` (`sweep-guards`).
2. **Task-status casing mismatch & RAM-only `sweep_symbol_map` (`185`):** `PostSweepBriefSymbolUpdater.updateQueuedTasks` (`post-sweep-brief-symbol-updater.ts:19-23,56`) keeps `symbolMaps` in a volatile `Map` and skips every task where `task.status !== "queued" && task.status !== "paused"`, whereas `schema/state.sql` `task_states` uses uppercase `'READY'`, `'BLOCKED'`, etc. (matching `0` real queued/held tasks!).
3. **Upstream port mismatches (`020, 100, 167`):** `182` calls nonexistent `codeMap.queryAroundRoutes` (`167`) and `symptomCards.load` (`100`); `184` `SweepLeaseCoordinator` uses `mode: "intent" | "granted"` via nonexistent `openSweepIntent`/`grantSweepLease` methods instead of `schema/state.sql` `path_leases` (`mode CHECK (mode IN ('write','intent','exclusive'))` on `020` `TaskClaimLeasesRepo`).

**Required architecture:** `investigations-and-sweeps.md`, `knowledge-slicing.md`, and `schema/state.sql` (`path_leases`, `tasks`, `task_holds`) require `@ef-harness/investigations` to wire `183` into `182` Stages 3/5 and `185` into `184` `SweepOrchestrator`, map two-phase sweep leases onto `path_leases(mode = 'intent' → 'exclusive')` (`020`), persist `sweep_symbol_map` in `state.db`, and update `write_scope` + `[RECENT SWEEP SYMBOL MAP]` briefs on `'READY'`/`'BLOCKED'` tasks via `088` `ContextSlicerEngine`.

**Evidence:** `packages/investigations/src/index.ts:1-9`; `packages/investigations/src/pipeline/pipeline.ts:115`; `packages/investigations/src/sweeps/sweep-lease-coordinator.ts:28-53`; `packages/investigations/src/sweep-guards/post-sweep-brief-symbol-updater.ts:19-23,55-58`; `schema/state.sql` (`path_leases`, `task_states`).

**Why this is a defect:** Sweeps cannot acquire `state.db.path_leases` (`'granted'` fails SQLite `CHECK`), `0` pending Wave-2 tasks receive updated file/symbol scopes after a rename sweep, and `182–185` are unreachable from `@ef-harness/investigations`.

**Required correction:** Export `pipeline`, `localization`, `sweeps`, and `sweep-guards` from `packages/investigations/src/index.ts`; wire `183` into `182` and `185` into `184`; map `SweepLeaseCoordinator` onto `020` `TaskClaimLeasesRepo` `path_leases` (`'intent' → 'exclusive'`); persist `sweep_symbol_map` in `state.db` and update `'READY'`/`'BLOCKED'` tasks + `088` `ContextSlicerEngine`; and connect `182`/`184` to `009, 028, 038, 039, 050, 055, 057, 100, 111, 167, 170`.

**Dependencies:** `F-005`, `F-011`, `F-012`, `F-017`, `F-022`, `F-025`, `F-039`, `F-046`, `F-050`, `F-073`, `F-074`, `F-078`.

**Verification:** `pnpm --filter @ef-harness/investigations build && pnpm --filter @ef-harness/investigations test`

**Integration priority:** Mystery-Bug Investigation & Sweeps integration task (Wave M6 Investigations).

---

### F-080 — `portability` (`Tasks 186–188`) Undeclared `"age-encryption"` & Packaged-App `createRequire` Crash, Dropped 2nd+ Sealed Checks Per Feature, Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` & Permanent 1-Slot `setGovernorOrange(false)` Lock

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** schema-conflict

**Affected units:** `Task 010`/`Task 015` (`SqliteConnection` + `ef_search_text`), `Task 091` (`HiddenCheckPoolStore`), `Task 118` (`PressureHysteresisStateMachine`), `Task 186` (`exporter`), `Task 187` (`rehydration`), `Task 188` (`broker`).

**Files and symbols:** `packages/portability/package.json:20-22`, `packages/portability/src/exporter/age-sealed-checks-encryptor.ts:17-20`, `packages/portability/src/exporter/orphan-branch-portability-exporter.ts:126-134` (`OrphanBranchPortabilityExporter.runExport`), `packages/portability/src/rehydration/age-sealed-checks-decryptor.ts:14`, `packages/portability/src/rehydration/rehydration-schema.ts:6-143` (`rebuildStateDatabase`), `packages/portability/src/broker/machine-wide-slot-coordinator.ts:50-56` (`MachineWideSlotCoordinator.setGovernorOrange`).

**Actual implementation:**
1. **Undeclared `"age-encryption"` + monorepo `createRequire` hack + dropped sealed checks (`186` & `187`):** `packages/portability/package.json` omits `"age-encryption"`. `186` (`age-sealed-checks-encryptor.ts:17-20`) resolves `age-encryption` from `path.join(repositoryRoot(), "package.json")` (`../../../../package.json`), crashing in packaged Electron builds; `187` (`age-sealed-checks-decryptor.ts:14`) calls `await import("age-encryption")`, failing strict pnpm module resolution. Moreover, `orphan-branch-portability-exporter.ts:126-134` skips any check after the first per `featureId` (`if (seenFeatureFiles.has(path)) continue;`), dropping 2nd+ sealed checks for the same feature!
2. **Toy `:memory:` `rebuildStateDatabase` diverges from `schema/state.sql` (`187`):** `rehydration-schema.ts:6-143` opens `new DatabaseSync(":memory:")` instead of an on-disk `state.db` and executes a custom 6-table `BOOTSTRAP_SQL` using wrong table names (`name_registry` vs `names`, `feature_rollups` vs `rollups`), non-contentless `kb_words` without `ef_search_text`, `edge` entities stored inside `nodes` (`kind = 'arch_node'`) instead of `edges`, and non-hex `` `sha256:${id}:${rev}` `` `content_hash` strings while omitting `tasks`, `decisions`, `work_items`, and `checks`.
3. **One-way slot lock on `setGovernorOrange` (`188`):** `machine-wide-slot-coordinator.ts:50-56` overwrites `this.limits.pool2WarmSlots = 1` when `singleSlot === true` without storing baseline limits, so `setGovernorOrange(false)` evaluates `this.limits.pool2WarmSlots` (`=== 1`) and leaves the machine permanently capped at 1 slot after `GREEN` recovery!

**Required architecture:** `projects-portability-and-sync.md`, `database-design.md`, and `schema/state.sql` require `packages/portability` to declare `"age-encryption"` directly, bundle all sealed checks per feature into `checks-sealed/<featureId>.age` without loss, rehydrate into a real on-disk `state.db` initialized from `schema/state.sql` (`SqliteConnection` + `ef_search_text` + `MigrationRunner` + real `edges`/`names`/`rollups`/`tasks`), and restore baseline `MachineCapacityLimits` cleanly when `Governor` recovers from `ORANGE` to `GREEN`.

**Evidence:** `packages/portability/package.json:20-22`; `packages/portability/src/exporter/age-sealed-checks-encryptor.ts:17-20`; `packages/portability/src/exporter/orphan-branch-portability-exporter.ts:126-134`; `packages/portability/src/rehydration/rehydration-schema.ts:6-143`; `packages/portability/src/broker/machine-wide-slot-coordinator.ts:50-56`.

**Why this is a defect:** Packaged apps fail `age-encryption` loading, multi-check features lose hidden acceptance checks across laptops, rehydrated `state.db` databases are in-memory toys unusable by `@ef-harness/db` repos, and a single transient `ORANGE` pressure spike permanently halves machine concurrency.

**Required correction:** Declare `"age-encryption"` in `packages/portability/package.json` and import it directly; serialize the full array of sealed checks per `featureId` into `checks-sealed/<featureId>.age`; rewrite `rebuildStateDatabase` (`187`) to populate a real on-disk `@ef-harness/db` `StateDb` (`schema/state.sql` `nodes`, `edges`, `names`, `rollups`, `tasks`, `checks`, contentless `kb_words` via `ef_search_text` and canonical SHA-256 digests); and preserve `readonly baselineLimits` in `MachineWideSlotCoordinator` so `setGovernorOrange(false)` restores full slot counts.

**Dependencies:** `F-007`, `F-010`, `F-012`, `F-041`, `F-055`.

**Verification:** `pnpm --filter @ef-harness/portability test -- exporter rehydration broker`

**Integration priority:** Project Portability & Global Broker integration task (Wave M6 Portability).

---

### F-081 — `packages/portability` (`Tasks 186–188`) 3-Way Internal Silos, Empty Barrel, Duplicate `age`/YAML/Redactor Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` Bypassing `global.db` (`014` & `024`)

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 007` (`canonicalJson`), `Task 011` (`PacketSecurityRedactor`), `Task 014` (`GlobalBrokerDb`), `Task 017` (`KnowledgeGraphRepo`), `Task 024` (`BrokerGrantIssuer`), `Task 035` (`MinGit`), `Task 091` (`HiddenCheckPoolStore`), `Task 118`–`Task 119` (`governor`), `Task 120` (`WindowsDpapiSecretsVault`), `Task 130` (`InterruptedRunDetector`), `Task 140` (`AllowancePacingController`), `Task 176`–`Task 177` (`ship-deploy`), `Task 186`–`Task 188` (`packages/portability`).

**Files and symbols:** `packages/portability/src/index.ts:1-9`, `packages/portability/src/exporter/in-memory-knowledge-graph.ts`, `packages/portability/src/rehydration/age-sealed-checks-encryptor.ts`, `packages/portability/src/broker/in-memory-global-grant-store.ts:7-79`, `packages/portability/src/broker/machine-wide-slot-coordinator.ts:43,69-99`.

**Actual implementation:**
1. **Empty barrel & duplicated sibling implementations:** `packages/portability/src/index.ts` exports only `packageIdentity()` on all 3 branches (`186–188`); `186` and `187` have zero cross-imports (`187` duplicates `age-sealed-checks-encryptor.ts`, `repository-root.ts`, `secret-patterns.ts`, and `yaml-format.ts` instead of sharing `186`'s serializer/encryptor).
2. **Volatile RAM-only `GlobalGrantStore` & `portLeases` (`188`) + unwired upstream ports:** `GlobalMultiProjectBroker` (`188`) ships only `InMemoryGlobalGrantStore` and a RAM `Map<number, PortLeaseRow>` instead of `@ef-harness/db` `GlobalBrokerDb` (`014` `global.db.grants` & `global.db.port_leases`) and `024` `BrokerGrantIssuer`, and is unwired from `118`, `119`, and `140`. Similarly, `186`/`187` are unwired from `007, 011, 017, 035, 091, 120, 130, 176, 177`.

**Required architecture:** `projects-portability-and-sync.md` and `schema/global.sql` require `@ef-harness/portability` to share one canonical YAML/`age` format between `exporter` (`186`) and `rehydration` (`187`), fence `176` `ExternalEffectLedger` and `130` cold-open recovery via `CrossDeviceLeaseManager` (`lease.yaml`), and back `GlobalMultiProjectBroker` (`188`) with `014` `GlobalBrokerDb` + `024` `BrokerGrantIssuer` + `118`/`119` Governor + `140` `AllowancePacingController`.

**Evidence:** `packages/portability/src/index.ts:1-9`; `packages/portability/src/broker/in-memory-global-grant-store.ts:7-79`; `packages/portability/src/broker/machine-wide-slot-coordinator.ts:43,69-99`.

**Why this is a defect:** Multi-project budget grants and `41000–48999` port leases vanish on daemon restart and are invisible to `014`/`022`/`160` port consumers, while `186` and `187` risk YAML/encryption drift.

**Required correction:** Export `exporter`, `rehydration`, and `broker` from `packages/portability/src/index.ts`; deduplicate `187`'s YAML/`age`/redactor helpers onto `186` + `007`/`011`; implement `SqliteGlobalGrantStore` & `GlobalPortLeaseAdapter` over `014` `GlobalBrokerDb` + `024` `BrokerGrantIssuer`; and wire `186–188` into `apps/daemon` (`066`) alongside `017, 035, 091, 118, 119, 120, 130, 140, 176, 177`.

**Dependencies:** `F-003`, `F-005`, `F-012`, `F-017`, `F-041`, `F-054`, `F-055`, `F-057`, `F-076`, `F-080`.

**Verification:** `pnpm --filter @ef-harness/portability build && pnpm --filter @ef-harness/portability test`

**Integration priority:** Project Portability & Global Broker integration task (Wave M6 Portability).

---

### F-082 — `packages/meta-lab` (`Tasks 189–193`) 5-Way Internal Silos, Empty Barrel, Hardcoded `ThreeLevelEvalRunner`, Toy `REAL`-Float `SimulatedDaemonStack` & Mock-Sink `RedTeamSecuritySuiteRunner`

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** seam-mismatch

**Affected units:** `Task 007` (`canonicalJson`), `Task 009` (`PromptContractRegistry`), `Task 034` (`sim`), `Task 045`–`Task 048` (`sandbox`), `Task 054` (`completeness-gate`), `Task 078` (`skill-vetting`), `Task 082` (`research-engine`), `Task 097`/`Task 100` (`intake`), `Task 118`/`Task 120` (`governor`), `Task 130` (`steering`), `Task 142`/`Task 150` (`runtime-adapters`), `Task 176` (`ship-deploy`), `Task 189`–`Task 193` (`packages/meta-lab`).

**Files and symbols:** `packages/meta-lab/src/index.ts:1-9`, `packages/meta-lab/src/evals/runner.ts:12-67,81-119` (`ThreeLevelEvalRunner`), `packages/meta-lab/src/fault-sim/daemon-stack.ts:10-45,53-142` (`SimulatedDaemonStack`), `packages/meta-lab/src/red-team/attacks.ts:50-119`, `packages/meta-lab/src/red-team/lab-session.ts:33-40,79-92`.

**Actual implementation:**
1. **Empty barrel & zero cross-imports across `189–193`:** `packages/meta-lab/src/index.ts` exports only `packageIdentity()` on all 5 branches (`189–193`), and `benchmarks`, `sim-dev`, `evals`, `fault-sim`, and `red-team` never import one another.
2. **Hardcoded `ThreeLevelEvalRunner` (`191`):** `evals/runner.ts:12-67,81-119` hardcodes `LEVEL_1_CASES`, triggers futility only when `candidateId.endsWith("-futility")`, sets `tokenCostBaseline: base.durationMs`, keys its mock cache by `${caseId}:${candidateId}` instead of `190` `ExactInputModelResponseCache`, hardcodes `paperworkPct: 0.12`, and never invokes `189`, `190`, or `193` `runRedTeamGate()`.
3. **Toy `REAL`-float `SimulatedDaemonStack` (`192`) & placeholder Red-Team sinks (`193`):** `daemon-stack.ts:10-45` defines a miniature 5-table `STATE_DDL` + 1-table `GLOBAL_DDL` with `REAL` floating-point `spent`/`units` columns instead of testing `schema/state.sql` + `schema/global.sql` and real recovery engines (`034, 118, 130, 150, 176`); `red-team/attacks.ts:50-119` writes `"SQLite format 3\x00[redacted]"` into dummy sink files and tests local regex helpers instead of real `@ef-harness/{sandbox,verifier,corpus,research-engine,intake,governor,runtime-adapters,portability}` defenses.

**Required architecture:** `meta-lab.md` and `sandbox-and-security.md` require `@ef-harness/meta-lab` to export a unified evaluation, chaos, and red-team harness where `191` drives `189` + `190` + `193` (`runRedTeamGate`), `192` injects faults across the real `harnessd` SQLite/Git/Governor/Effect-Ledger stack, and `193` attacks the real sandbox, proxy, installer, skill-vetter, intake scrubber, and DPAPI vault implementations.

**Evidence:** `packages/meta-lab/src/index.ts:1-9`; `packages/meta-lab/src/evals/runner.ts:12-67,81-119`; `packages/meta-lab/src/fault-sim/daemon-stack.ts:10-45`; `packages/meta-lab/src/red-team/attacks.ts:50-119`.

**Why this is a defect:** `packages/meta-lab` cannot import its own submodules, Level 1–3 evals run against fabricated metrics without red-team vetoes, chaos tests ignore real SQLite schemas/recovery paths, and red-team suites pass against mock string helpers even if real sandboxes are bypassed.

**Required correction:** Export `benchmarks`, `sim-dev`, `evals`, `fault-sim`, and `red-team` from `packages/meta-lab/src/index.ts`; wire `191` `ThreeLevelEvalRunner` to `189` `MetaLabBenchmarkRegistry`/`PromptContaminationScanner`, `190` `SimDevDriver`/`ExactInputModelResponseCache`, `193` `runRedTeamGate`, `009`, and `078`; replace `SimulatedDaemonStack`'s toy `REAL` DDL with real `@ef-harness/{db,sim,governor,steering,runtime-adapters,ship-deploy}` (`034, 118, 130, 150, 176`); and wire `193` attacks to real `045, 046, 048, 054, 078, 082, 097, 100, 120, 142, 149, 186`.

**Dependencies:** `F-005`, `F-012`, `F-016`, `F-018`–`F-020`, `F-024`, `F-033`, `F-036`, `F-046`, `F-054`–`F-056`, `F-059`, `F-061`, `F-076`, `F-080`.

**Verification:** `pnpm --filter @ef-harness/meta-lab build && pnpm --filter @ef-harness/meta-lab test`

**Integration priority:** Meta-Lab evaluation, chaos, and red-team integration task (Wave M6 Meta-Lab).

---

### F-083 — `Task 194` `ArchitectureReviewTrialsSuite` Self-Contained Inline Toy Functions (Zero Workspace Imports Across Areas A–J & Trials 1–6) Masking Real Production Regressions

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** test-gap

**Affected units:** `Task 002`–`Task 193` (all production packages governed by Areas A–J and Verification Trials 1–6), `Task 194` (`tests/e2e/review-trials`), `Task 200` (v1 Release Certification).

**Files and symbols:** `tests/e2e/review-trials/lib/suite.ts:19-42`, `tests/e2e/review-trials/lib/sqlite.ts:17-95` (`PolicyDatabase`), `tests/e2e/review-trials/lib/area-a.ts:22-33`, `tests/e2e/review-trials/lib/area-h.ts:22-56` (`connectionRegistry`, `aimd`, `grantFromWindow`, `routeCall`, `chatGptWire`, `conformance`).

**Actual implementation:** `tests/e2e/review-trials/lib/{sqlite.ts,area-a.ts..area-j.ts,trials.ts}` imports zero `@ef-harness/*` workspace packages. Instead, it defines a local `PolicyDatabase` wrapper (`sqlite.ts:17-95`), registers a non-canonical identity `ef_search_text` (`area-a.ts:26` — `F-010`), and tests inline 5-line toy functions (`area-h.ts:22-56`) — reporting `16/16 PASS` even while real `Task 141` `apps/renderer/src/connections/compliance.ts` (`F-058`) accepts `sk-ant-oat*` tokens and real `Task 144` (`F-060`) defaults proxy to `127.0.0.1:9`!

**Required architecture:** `architecture-review-decisions.md`, `architecture-audit-response.md`, `architecture-deep-review.md`, and `verification-and-isolation.md` require `ArchitectureReviewTrialsSuite` (`194`) to execute live assertions directly against the real integrated `@ef-harness/*` packages across all 10 Review Areas (`A`–`J`) and all 6 Verification Trials (`1`–`6`).

**Evidence:** `tests/e2e/review-trials/lib/sqlite.ts:17-95`; `tests/e2e/review-trials/lib/area-a.ts:22-33`; `tests/e2e/review-trials/lib/area-h.ts:22-56`.

**Why this is a defect:** `review-trials` gives a green `16/16` certification scorecard without importing or executing a single line of production package code.

**Required correction:** Wire `tests/e2e/review-trials/lib/{area-a.ts..area-j.ts,trials.ts}` to import and exercise the real `@ef-harness/{db,discovery,spec-expansion,planner,verifier,integrator,steering,governor,providers,runtime-adapters,renderer,brownfield,ship-deploy,investigations,portability}` modules.

**Dependencies:** `F-010`, `F-012`, `F-025`, `F-029`, `F-035`, `F-039`, `F-049`, `F-053`–`F-061`, `F-076`, `F-080`.

**Verification:** `pnpm --filter @ef-harness/e2e test -- review-trials`

**Integration priority:** Pre-release certification trials integration task (Wave M6 Certification).

---

### F-084 — `Task 196` Windows NSIS Packaging Pipeline Ships Stub `MZEFHARNESS` Executables, Empty `module.exports = {}` `app.asar`, Fixture Placeholders & Undeclared `electron` / `electron-builder`

**Status:** CONFIRMED

**Severity:** CRITICAL

**Category:** build-packaging

**Affected units:** `Task 035` (`MinGit`), `Task 036` (`gitleaks`), `Task 066` (`apps/daemon`), `Task 067`/`Task 117`/`Task 131` (`apps/desktop`), `Task 078`/`Task 104` (`corpus` skills), `Task 081` (`Z3` WASM), `Task 122`/`Task 162` (`apps/renderer` & Office assets), `Task 132` (`ParkFirstAutoUpdater`), `Task 135` (`provider-policy`), `Task 167` (`web-tree-sitter` WASM), `Task 196` (`packaging`), `Task 200` (v1 Release Gate).

**Files and symbols:** `apps/desktop/package.json`, `apps/desktop/build/electron-builder.yml:20-29`, `scripts/packaging/build-win-nsis.mjs:26-64`, `scripts/packaging/lib/staging.mjs:20-160` (`materializeBundledResources`, `copyCorpusAndSkills`, `copyPolicyAndOffice`, `createProductionAsar`, `writeLaunchStub`, `simulateNsisInstaller`).

**Actual implementation:** `scripts/packaging/lib/staging.mjs:89-160` writes stub `main.cjs` (`module.exports = {}`) and `preload.cjs` into `app.asar` instead of built `apps/desktop/dist`, `apps/renderer/dist`, and `apps/daemon/dist`; writes literal `"MZEFHARNESS\r\n"` to `EF Harness.exe` (`line 129`); copies dummy fixture files from `apps/desktop/build/fixtures/**` (`harnessd.exe`, `gitleaks.exe`, `office/atlas.json`, stub skill Markdown) instead of real `035/036/078/104/162/167` artifacts; and emits `.nsis-stub.zip` (`line 159`) instead of running `electron-builder` (undeclared alongside `electron` in `apps/desktop/package.json`).

**Required architecture:** `desktop-app.md` (`Packaging and Distribution`) and `app-shell-and-governor.md` require `apps/desktop` to package real compiled `apps/desktop/dist` + `apps/renderer/dist` inside `app.asar` and bundle real detached `harnessd`, portable `MinGit` (`035`), `gitleaks` (`036`), `web-tree-sitter` & `z3` WASM (`081`/`167`), `@ef-harness/corpus` (`corpus/`, `075–078, 103–104`), Ed25519 provider policy (`135`), and `apps/renderer/assets/office/*` (`162`) inside `resources/` via `electron-builder` NSIS (`< 180 MB`).

**Evidence:** `apps/desktop/build/electron-builder.yml:20-29`; `scripts/packaging/lib/staging.mjs:20-160`.

**Why this is a defect:** Running `build-win-nsis.mjs` produces a non-executable `MZEFHARNESS` text file and an empty `module.exports = {}` `app.asar` rather than a working Windows desktop application.

**Required correction:** Declare `"electron"` and `"electron-builder"` in `apps/desktop/package.json`, update `electron-builder.yml` and `scripts/packaging/lib/staging.mjs` to stage real compiled `apps/{desktop,renderer,daemon}/dist`, real `corpus/{packs,elaborations,rules-seams,policies,skills}/**`, real `apps/renderer/assets/office/**`, real WASM grammars, and real `MinGit`/`gitleaks` binaries, and invoke `electron-builder --config apps/desktop/build/electron-builder.yml`.

**Dependencies:** `F-027`, `F-032`, `F-033`, `F-054`, `F-063`, `F-066`, `F-071`, `F-073`.

**Verification:** `node scripts/packaging/build-win-nsis.mjs --unsigned-dev && node scripts/packaging/audit-asar.mjs && pnpm --filter @ef-harness/e2e test -- packaging`

**Integration priority:** Windows NSIS Packaging integration task (Wave M6 Packaging).

---

### F-085 — `Task 197` `scripts/verify-docs-diagrams.mjs` Checks Nonexistent `packages/kernel`, `packages/contracts` & `corpus/skills/m2` Paths (Vacuous Pass) and Mutates `ef-harness-complete.mmd` In Place

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** local-defect

**Affected units:** `Task 009`–`Task 010` (`packages/shared-contracts`), `Task 013`–`Task 015` (`packages/db`), `Task 078`/`Task 104` (`packages/corpus`), `Task 197` (`docs-diagram-consistency`), `Task 200` (v1 Release Gate).

**Files and symbols:** `scripts/verify-docs-diagrams.mjs:50-77` (`verifyDiagramSync`), `scripts/verify-docs-diagrams.mjs:257-288` (`verifySchemaParity`), `scripts/verify-docs-diagrams.mjs:323-366,409-438` (`verifyContractParity`).

**Actual implementation:**
1. **Nonexistent directory paths cause silent vacuous passes:** `verifySchemaParity` (`line 257`) checks `packages/kernel/src/migrations` (real package is `packages/db`), and `verifyContractParity` (`lines 323, 409, 426`) checks `packages/contracts/src/prompts/*.json`, `packages/contracts/src/vocab/touches.json` (real package is `packages/shared-contracts` using TypeScript `.ts` modules), and `corpus/skills/m2/infer-or-ask/SKILL.md` inside an optional `if (fs.existsSync(...))` block. When nonexistent `packages/kernel` / `packages/contracts` paths fail `fs.existsSync`, those schema and contract parity checks skip silently with `ok: true, issues: []`!
2. **In-place mutation of tracked `ef-harness-complete.mmd`:** `verifyDiagramSync` (`lines 53-72`) runs `node tools/merge-diagrams.js` directly in `root`, overwriting `ef-harness-complete.mmd` on disk and restoring `mergedBefore` afterward.

**Required architecture:** `IMPLEMENTATION_TASKS.md` (`Task 197`) and `v1-knowledge-corpus.md` / `prompt-contracts.md` require `verify-docs-diagrams.mjs` to verify real runtime migrations in `packages/db`, real 32 `@1` prompt schemas and 28 `touches` tags in `packages/shared-contracts`, and real bundled `corpus/skills/m2/infer-or-ask/SKILL.md` in `@ef-harness/corpus` (`corpus/`) without mutating tracked working-tree files.

**Evidence:** `scripts/verify-docs-diagrams.mjs:53-72,257-288,323-366,409-438`.

**Why this is a defect:** Schema-to-migration drift, missing runtime prompt schemas, vocabulary mismatches, and `infer-or-ask` skill drift go completely undetected (`0` issues reported).

**Required correction:** Point `scripts/verify-docs-diagrams.mjs` (`verifySchemaParity` & `verifyContractParity`) at real `packages/db/src/migrations`, `packages/shared-contracts/src/{prompts,vocab,packets}`, and `corpus/skills/m2/infer-or-ask/SKILL.md` (failing closed if those directories are missing!), and verify `merge-diagrams.js` output against `ef-harness-complete.mmd` in a temp directory without touching the tracked file.

**Dependencies:** `F-005`, `F-009`, `F-033`.

**Verification:** `node scripts/verify-docs-diagrams.mjs && pnpm --filter @ef-harness/e2e test -- docs-parity`

**Integration priority:** Docs, Diagram & Schema Parity Gate integration task (Wave M6 Certification).

---

### F-086 — `Tasks 195, 198, 199, 200` Final E2E, Perf, Security & v1.0 Release Certification Suites Use Self-Contained Local Port Stubs (`productExecuted: false`), Non-SQLite `"state.db"` Text Files & `.ts` Extension Imports

**Status:** CONFIRMED

**Severity:** HIGH

**Category:** test-gap

**Affected units:** `Task 002`–`Task 194` (entire 28-package EF Harness system), `Task 195` (`full-lifecycle`), `Task 198` (`perf-scale`), `Task 199` (`security-audit`), `Task 200` (`m6-release` / `m6-exit-gate`).

**Files and symbols:** `tests/e2e/full-lifecycle/lib/suite.ts:100-128`, `tests/e2e/full-lifecycle/lib/journey-greenfield.ts:38-95`, `tests/e2e/perf-scale/certifier.ts:4-10,33-124`, `tests/e2e/security-audit/runner.ts:4-22,24-83`, `benchmarks/m6-release/src/runner.ts:4-16,47-125`, `benchmarks/m6-release/src/gates.ts:66-85,106-150`.

**Actual implementation:**
1. **Relative `.ts` extension imports fail standard `tsc` emit (`198, 199, 200`):** `tests/e2e/perf-scale/**`, `tests/e2e/security-audit/**`, and `benchmarks/m6-release/**` use `.ts` import specifiers (`./scorecard.ts`, `./ports/dpapi-vault.ts`, `./gates.ts`), failing `tsc` without `allowImportingTsExtensions` (`TS5097`).
2. **Zero `@ef-harness/*` workspace imports (`productExecuted: false`):**
   - `195` (`journey-greenfield.ts:38-95`) writes 15 string labels into a 1-table `journey_stage` SQLite file and an in-memory `NamedPipeIpcSimulator` array without calling a single workspace package.
   - `198` (`perf-scale/ports/*.ts`) benchmarks self-contained local loops instead of real `015, 025, 085, 117, 124, 153, 164, 186`.
   - `199` (`security-audit/runner.ts:36-61` + `ports/*.ts`) writes plain UTF-8 text `"create table t(c text); insert into ..."` into a file named `"state.db"` and runs local `ports/secret-purge.ts` / `ports/dpapi-vault.ts` instead of real SQLite WAL + `030` `SecretPurgeEngine` + `120` `WindowsDpapiSecretsVault` + `141` `compliance.ts`.
   - `200` (`benchmarks/m6-release/src/gates.ts:78,111-150`) sets `productExecuted: true` NOWHERE — stamping `productExecuted: false` across all 7 frozen benchmark suites (`suite:kitchen-web` through `suite:red-team-security`), evaluating static numbers in `replay-matrix.ts`.

**Required architecture:** `roadmap.md` (Milestone 6 & v1 Release Exit Gate), `meta-lab.md`, and `sandbox-and-security.md` require `Tasks 195, 198, 199, 200` on the final `harness/integration` line to import and execute the real integrated 28 workspace packages over real Windows named-pipe IPC, real SQLite WAL databases, real MinGit worktrees, real DPAPI/sandbox/purge engines, and real packaged NSIS artifacts (`productExecuted: true`).

**Evidence:** `tests/e2e/full-lifecycle/lib/journey-greenfield.ts:38-95`; `tests/e2e/perf-scale/certifier.ts:4-10`; `tests/e2e/security-audit/runner.ts:4-65`; `benchmarks/m6-release/src/gates.ts:66-150`.

**Why this is a defect:** Without replacing the local `ports/*.ts` and `replay-matrix.ts` stand-ins in the final certification tasks, `pnpm test` reports green on `195, 198, 199, 200` without ever running the integrated product (`productExecuted: false`).

**Required correction:** Convert `.ts` specifiers across `tests/e2e/{perf-scale,security-audit,m6-exit-gate}/**` and `benchmarks/m6-release/**` to `.js`; wire `195` (`FullLifecycleMultiProjectE2eSuite`), `198` (`PerformanceAndScaleCertifier`), `199` (`FinalSecurityPrivacyAuditSuite`), and `200` (`V1ReleaseCertificationRunner`) to import and execute the real integrated `@ef-harness/*` packages and `apps/{daemon,desktop,renderer}` (`productExecuted: true`), flipping `V1_RELEASE_SCORECARD` live gates only when real M0–M6 suites pass.

**Dependencies:** `F-001`–`F-085`.

**Verification:** `pnpm build && pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @ef-harness/e2e test`

**Integration priority:** Final v1.0 Release Certification task (final task of `combination_task.md`).

---

## Investigation Checkpoint

**Last updated:** 2026-11-26T23:42:00+01:00 (`COMPLETE`: `combination_task.md` generated & programmatically verified — **`C01`–`C79`, `201/201` branches, `16/16` dirty worktrees, `86/86` findings `F-001`–`F-086`**)

**Overall status:** COMPLETE

**Architecture documents read:**
- Completed documents: ALL 52 root `.md` files, `CONTRIBUTING_AGENTS.md`, ALL 31 `.mmd` diagrams + `ef-harness-complete.mmd`, ALL 5 SQL files + `schema/schema-test.js`, `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`, `stack-manifest.json`, `package.json`, `pnpm-workspace.yaml`, `eslint.config.mjs`, `scripts/*`, ALL 30 `research/*.md` documents, and 100% of `IMPLEMENTATION_TASKS.md` (`Tasks 001–200`, 12,797 lines).
- Remaining documents: None (0).

**Implementation units discovered:**
- Total discovered: 201 `task/*` branches + `harness/integration` (`30f2e9c`) + `main` (`6497730`) across 202 worktrees in `C:/Users/Ayush/Desktop/ef-wt`.
- Total fully audited & mapped in `combination_task.md`: **200 / 200 tasks (`199` active implementation branches `002–200` mapped 1-to-1 across `C01`–`C79` including all 16 uncommitted worktree deltas + `001` on `main` + `2` excluded empty `6497730` branches `task/162-office-pixijs-floorplan-sprites` & `task/164-office-animation-director-astar` = 201/201 `task/*` branches 100% accounted for)**.
- Remaining units: None (0).

**Subagent status:**
- Completed assignments: None (0/6 prior errored subagents harvested; remaining audit and generation completed sequentially without spawning new subagents).
- Running assignments: None.
- Failed assignments: 6 prior session quota errors (`18643fe6`, `fb62aead`, `69411c87`, `dcc5eb3d`, `665e6a95`, `984b7720` — all work recovered cleanly).
- Unassigned work: 0 remaining (100% completed across 31 reports in `audit_reports/pass-01..06/` and `combination_task.md`).

**Files inspected:**
- Completed paths: 100% of `Tasks 001–200` across all 28 workspace packages, `corpus/`, `apps/{daemon,desktop,renderer}`, `scripts/*`, `benchmarks/*`, and `tests/e2e/*`.
- Remaining paths: None (0).

**Findings summary:**
- Confirmed: 86 (`F-001` through `F-086`) — all 86 mapped to resolving `Cxx` tasks in `combination_task.md`
- Unverified: 0
- Blocked: 0
- Duplicate or rejected: 0

**Next exact action:**
None — Integration Audit COMPLETE. Hand `combination_task.md` (`C01`–`C79`) to execution workers operating sequentially on `C:/Users/Ayush/Desktop/ef-wt/integration` (`harness/integration`).

**Last successfully completed operation:**
Generated `c:/Users/Ayush/Desktop/ef harness/combination_task.md` (`C01`–`C79`, `40..41` non-blank lines per task, `0` forbidden phrases) and passed 100% of checks in `verify-deliverables.mjs`.

---

## Part 2 — Audit Progress & Architecture Contracts

# EF Harness Integration Audit — Progress & Checkpoint (`audit_progress.md`)

**Last updated:** 2026-11-26T23:42:00+01:00
**Overall audit status:** `COMPLETE` (Passes 01–06 `100% COMPLETE` — `200 / 200` units, `31 / 31` chunk reports, `86` CONFIRMED findings `F-001`..`F-086`, and `combination_task.md` `C01`–`C79` verified `ALL CHECKS PASSED`)
**Continuation & Handoff Runbook:** See [`audit_reports/AUDITOR_CONTINUATION_GUIDE.md`](audit_reports/AUDITOR_CONTINUATION_GUIDE.md) for the complete step-by-step methodology, exact commands, 13-field `audit_findings.md` template, 12-section chunk report template, and `combination_task.md` specification + programmatic validator rules so anyone can continue seamlessly if quota/context runs out.

---

## 1. Current Checkpoint State

- **Current pass:** `Task Generation & Programmatic Verification` (`combination_task.md`)
- **Current chunk:** `ALL 31 INVESTIGATION CHUNKS COMPLETE` (`pass-01`..`pass-06`)
- **Completed passes:**
  - `Pass 01` (`COMPLETE` — `Tasks 001–034`: `pass-01/chunk-001..003`)
  - `Pass 02` (`COMPLETE` — `Tasks 035–068`: `pass-02/chunk-001..003`)
  - `Pass 03` (`COMPLETE` — `Tasks 069–108`: `pass-03/chunk-001..007`)
  - `Pass 04` (`COMPLETE` — `Tasks 109–121, 129–130, 134–152, 171–174`: `pass-04/chunk-001..007`)
  - `Pass 05` (`COMPLETE` — `Tasks 122–128, 131–133, 153–170, 175`: `pass-05/chunk-001..006`)
  - `Pass 06` (`COMPLETE` — `Tasks 176–200`: `pass-06/chunk-001..005`)
- **Completed chunks (31 / 31 — 100%):**
  - `audit_reports/pass-01/chunk-001..003.md` (`Tasks 001–034`)
  - `audit_reports/pass-02/chunk-001..003.md` (`Tasks 035–068`)
  - `audit_reports/pass-03/chunk-001..007.md` (`Tasks 069–108`)
  - `audit_reports/pass-04/chunk-001..007.md` (`Tasks 109–121, 129–130, 134–152, 171–174`)
  - `audit_reports/pass-05/chunk-001..006.md` (`Tasks 122–128, 131–133, 153–170, 175`)
  - `audit_reports/pass-06/chunk-001..005.md` (`Tasks 176–200`)
- **Remaining chunks:** `0` (All 31 investigation chunks complete!)
- **Completed units:** `200 / 200` (`Tasks 001–200` + 2 excluded duplicate branches = `201 / 201` `task/*` branches **100% complete!**)
- **Remaining units:** `0 / 200`
- **Findings discovered (`audit_findings.md`):** `86` CONFIRMED (`F-001` through `F-086`), `0` UNVERIFIED, `0` BLOCKED
- **Subagent assignments and statuses:** `0` active (`0` units remaining; all 31 investigation chunks & `combination_task.md` completed sequentially).
- **Latest detailed report path:** `audit_reports/pass-06/chunk-005.md`
- **Final deliverable path:** [`combination_task.md`](combination_task.md) (`79` sequential tasks `C01`–`C79`, `40..41` non-blank lines per task, `201/201` `task/*` branches mapped, `16/16` dirty worktree deltas harvested, `86/86` findings resolved).
- **Exact next action:** Audit complete (`0` remaining audit steps). Execute `combination_task.md` (`C01`–`C79`) sequentially on `C:/Users/Ayush/Desktop/ef-wt/integration` (`harness/integration`).

---

## 2. Compact Working Summary (Active Context Navigation)

### Established Architecture Contracts
1. **Single-Writer SQLite (`database-design.md`, `schema/state.sql`):** One writer connection (`SqliteConnection` + `CoordinatorWriteQueue`) per `state.db`, WAL + `ReaderPool`, `user_version` migrations (`MigrationRunner`), contentless `kb_words` FTS5 via `splitSearchText` (`ef_search_text` UDF), `"sha256:<64-hex>"` canonical content/blob digests, `outbox` + `outbox_deliveries` paired atomically, `leases` table for task/path/ref leases, `edge_types` lookup table, `fields.names` trigger for `names` registry, `task_holds.reason` (`user_pause | requirement_change | budget | ccr | governor`).
2. **IPC & Framing (`kernel-schema-and-protocol.md`):** 5-byte binary framing (`[channel:u8, length:u32be]`), canonical RPC methods in `shared-contracts/src/packets/rpc.ts` (`op_id` on mutating methods only, `cursor` resync, `stream.credit` backpressure), multi-window Electron utility-process `MessagePortBridge`.
3. **Sandbox & Execution (`security-and-governance.md`, `verification-and-runtime.md`):** Tier A/B/C/D Windows Job Object + Restricted Token/ACL/WFP isolation; `AttemptMcpServer` + `KbPullToolHandlers` read-only `kb.*` pull tools + `harness.run`; `CleanVerifierRunner` runs on clean detached checkout with blind red-before-green checks and `CompletenessGateRunner` static audit.
4. **Root Cause Topology Across All Units:** Every `task/*` branch forked from `main` (`6497730`) where all 28 package barrels were empty stubs; `harness/integration` (`30f2e9c`) merged only `002–089` mechanically without wiring cross-package dependencies and without 16 uncommitted worktree bugfixes (`008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079`).

### Confirmed Defects (`F-001`..`F-039`)
- **Workspace / Contracts (`F-001`..`F-007`):** `layers.mjs` intra-tier ban (`F-001`), `spikes` `.mjs` test skip (`F-002`), `shared-observability` stub + uncommitted `task-011` `StreamingRedactor` (`F-003`), uncommitted `task-008` vacuous pass (`F-004`), `zod`/`zod/v4` + locator split (`F-005`), `packets/rpc.ts` vs `ipc/schemas.ts` (`F-006`), `sha256:` vs bare hex (`F-007`).
- **DB / IPC / Sim (`F-008`..`F-016`):** Uncommitted `task-022` lifecycle fixes (`F-008`), `user_version === 1` hardcode bypassing `MigrationRunner` (`F-009`), divergent `ef_search_text` UDFs (`F-010`), 3 `CasBlobStore` contracts (`F-011`), disconnected `packages/db` `Connection` ports (`F-012`), `ipc->db` async port mismatches (`F-013`), `FrameCodec` mismatch (`F-014`), `stream.credit` mismatch (`F-015`), mock-only `packages/sim` (`F-016`).
- **Git / Sandbox / Worker / Verifier / M1 (`F-017`..`F-028`):** `git-engine` `PATH` fallback + 5 `GitRunner` ports + rogue `ref_leases` table (`F-017`), unsandboxed `HarnessRunEngine` default + slot leak (`F-018`), `SecureDocFetcher` vs `AllowlistProxyServer` (`F-019`), `KernelPackageInstaller` broken lockfile splice (`F-020`), `mcp-server` uncommitted diff + unwired ports (`F-021`), `test-env` rogue `DatabaseSync` writers + 3 `ServiceProvider` ports (`F-022`), `worker-loop` 3 uncommitted diffs + internal silos (`F-023`), `completeness-gate` 2 uncommitted diffs + stub wiring (`F-024`), `verifier` 5 uncommitted diffs + 4 `SurfaceVerifierAdapter` ports + unwired acceptance (`F-025`), `daemon` missing `outbox_deliveries`/pragmas/lock (`F-026`), `desktop` `pipe-client.ts` byte corruption + single-port overwrite (`F-027`), mock-only M1 E2E (`F-028`).
- **Discovery / Corpus / Spec Expansion / Research / Planner M2 (`F-029`..`F-039`):** 6 disconnected `discovery` silos + `DecisionFields` crash/strip + sync/async mismatch (`F-029`), `sqlite`-only delegation `VALUE_LIMIT_TAGS` (`F-030`), `pnpm-workspace.yaml` filesystem walk in `discovery/prompts` + 3 more `ef_search_text` UDFs (`F-031`), `CorpusPackLoader` (`075`) crashes on `076`/`077`/`104` YAML schemas/anchors/manifests + `core-data-auth.yaml` dangling IDs (`F-032`), `skill-vetting` (`078`) non-`TOUCHES_TAGS` + split `104` Wave 2 skill manifest (`F-033`), missing `edge_types` (`expands`, `contradicts`, `informs`) FK crashes (`F-034`), uncommitted `task-079` fixes + missing `listCells`/`listMaterializedRequirements`/`selectedOptionId` + unwired `z3-solver` WASM (`F-035`), RAM-only `ResearchFactCache.bodies` + devDep `"typescript"` + `fetchDocs` mismatch (`F-036`), broken `views-export` (`085`) ↔ `views-import` (`086`) `.manifest.json` & `ef:node` round-trip (`F-037`), duplicate `SkeletonLockEnforcer` + unpersisted sync `feature-arch` (`083`/`084`) + `registeredNames` vs `fields.names` (`F-038`), 3-way `kb.*` MCP tool names + band casing + `revision_in_flight` hold reason (`F-039`).

### Audit Completion Summary
All 200 tasks (`201` `task/*` branches + `Task 001` baseline), all `31` chunk reports (`audit_reports/pass-01..06/`), all `86` confirmed findings (`F-001`–`F-086` in `audit_findings.md`), and the 8-wave, 79-task sequential repair pipeline (`combination_task.md` `C01`–`C79`) are complete and programmatically verified with zero modified tracked product files on `main` or `harness/integration`.

---

## Part 3 — All 31 Chunk Investigation Reports (`pass-01`–`pass-06`)

### Report: `pass-01/chunk-001.md`

# Pass 01 — Chunk 001: Workspace Layering, Spikes, and Shared Contracts (`Tasks 001–011`)

## 1. Chunk identification and scope
- **Pass number:** Pass 01
- **Chunk ID:** `pass-01/chunk-001`
- **Unit IDs:** `Task 001` (base `main`), `Tasks 002–006` (M0 spikes), `Tasks 007–011` (`shared-contracts` & `shared-observability`)
- **Branches and commits:**
  - `main` (`6497730`) — workspace scaffold & `eslint.config.mjs` / `scripts/layers.mjs`
  - `task/002-spike-node-sqlite-electron` (`c117ff2`)
  - `task/003-spike-windows-sandbox` (`2938e90`)
  - `task/004-spike-execution-capacity` (`a1d3a28`)
  - `task/005-spike-test-services-windows` (`7c3a952`)
  - `task/006-spike-foreign-runtimes` (`ed8b0b2`)
  - `task/007-canonical-hashing-ids` (`baed849`)
  - `task/008-core-packet-schemas` (`9853d46`, dirty worktree diff present)
  - `task/009-prompt-contract-schemas` (`3d7784d`, dirty worktree diff present)
  - `task/010-closed-vocabularies` (`d45eb68`)
  - `task/011-logger-tracer-redactor` (`f754213`, dirty worktree diff present)
- **Worktree paths:** `c:/Users/Ayush/Desktop/ef harness`, `C:/Users/Ayush/Desktop/ef-wt/integration`, `C:/Users/Ayush/Desktop/ef-wt/task-002-*` through `C:/Users/Ayush/Desktop/ef-wt/task-011-*`
- **Governing architecture documents:** `architecture-deep-review.md`, `kernel-schema-and-protocol.md`, `database-design.md`, `security-and-governance.md`, `prompt-contracts.md`, `schema/state.sql`, `schema/telemetry.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 001–011`).

## 2. Units inspected
- `Task 001` (`main` `6497730`), `Task 002` (`c117ff2`), `Task 003` (`2938e90`), `Task 004` (`a1d3a28`), `Task 005` (`7c3a952`), `Task 006` (`ed8b0b2`), `Task 007` (`baed849`), `Task 008` (`9853d46` + uncommitted delta), `Task 009` (`3d7784d` + uncommitted delta), `Task 010` (`d45eb68`), `Task 011` (`f754213` + uncommitted delta).

## 3. Files inspected
- `eslint.config.mjs`, `scripts/layers.mjs`, `scripts/run-tests.mjs`, `package.json`, `pnpm-workspace.yaml`
- `spikes/vitest.config.ts`, `spikes/node-sqlite-electron/REPORT.md`, `spikes/windows-sandbox/REPORT.md`, `spikes/execution-capacity/calibrated-defaults.json`, `spikes/test-services-windows/REDIS_DECISION.md`, `spikes/foreign-runtimes/REPORT.md`
- `packages/shared-observability/src/index.ts`
- `packages/shared-contracts/src/index.ts`
- `packages/shared-contracts/src/canonical/{canonicalize.ts,hash.ts,entity-id.ts,search-text.ts,failure.ts}`
- `packages/shared-contracts/src/packets/{bounds.ts,catalog.ts,checkpoint.ts,intents.ts,locators.ts,receipt.ts,rpc.ts}` (+ `task-008` uncommitted diff)
- `packages/shared-contracts/src/prompts/{common.ts,envelope.ts,extract-json.ts,format-repair.ts,index.ts}` (+ `task-009` uncommitted diff)
- `packages/shared-contracts/src/vocabularies/{basis-status.ts,closed-enum.ts,currency.ts,invariants.ts,lifecycle.ts,touches.ts}`
- `packages/shared-contracts/src/telemetry/{create.ts,hmac.ts,logger.ts,patterns.ts,redactor.ts,streaming-redactor.ts,tracer.ts}` (+ `task-011` uncommitted diff)

## 4. Architecture documents consulted
- `architecture-deep-review.md` (§1–§6, canonical hashing, JCS RFC 8785, redaction, layer boundaries)
- `kernel-schema-and-protocol.md` (RPC catalog, idempotency `op_id`, `Sha256HexSchema`, stream epochs, locators)
- `prompt-contracts.md` (`PromptEnvelope`, `LocatorSchema`, strict JSON extraction, format repair)
- `security-and-governance.md` (streaming secret redaction across chunk boundaries, HMAC correlation)

## 5. Contracts and signatures discovered
- `canonicalizeJson(value: unknown): string` (RFC 8785 JCS)
- `sha256Prefixed(bytes: Uint8Array | string): \`sha256:\${string}\`` and `sha256RawHex(bytes: Uint8Array | string): string`
- `computeNodeContentHash(node: { kind: string; fields: Record<string, unknown>; text?: string }): string`
- `splitSearchText(input: string): string` (splits camelCase, snake_case, and `([A-Z]+)([A-Z][a-z])` acronyms)
- `AttemptReceiptSchema`, `CheckOutcomeSchema`, `EvidenceLocatorSchema` (`packets/locators.ts`), `RpcRequestSchema` / `RpcMethodSchemas` (`packets/rpc.ts`)
- `PromptEnvelopeSchema`, `LocatorSchema` (`prompts/common.ts`), `extractStrictJson`, `buildFormatRepairPrompt`
- `TOUCHES_TAGS`, `RequirementBasis`, `TaskLifecycleState`, `FeatureLifecycleState`, `MicroUsd`
- `Redactor`, `StreamingRedactor` (`push(chunk: string | Uint8Array): string`, `flush(): string`), `StructuredLogger`, `SpanTracer`

## 6. Confirmed findings
- **F-001** — `scripts/layers.mjs` + `eslint.config.mjs` (`ef/layer-boundary` `to >= from`) blocks intra-tier architectural imports (`ipc->db`, `mcp-server->db/sandbox/test-env`, `verifier->completeness-gate`, `spec-expansion->discovery`, `integrator/steering->planner`, `runtime-adapters->providers/governor`).
- **F-002** — `spikes/vitest.config.ts` omits `.mjs` tests (`spikes/windows-sandbox/windows-sandbox.test.mjs`).
- **F-003** — `packages/shared-observability` retains broken prefix-only `redactSecrets` stub while `Task 011` implemented `telemetry` in `shared-contracts` and left `StreamingRedactor` split-key + UTF-8 `StringDecoder` bugfixes uncommitted in `task-011`.
- **F-004** — `CheckOutcomeSchema` (`packets/receipt.ts`) allows vacuous `status: "pass"` with `collected_count: 0` on `harness/integration` (fixed in uncommitted `task-008`).
- **F-005** — Mixed `zod` vs `zod/v4` imports + divergent `EvidenceLocatorSchema` (`packets/locators.ts`) vs `LocatorSchema` (`prompts/common.ts` + uncommitted `task-009`).
- **F-006** — Canonical `packets/rpc.ts` disagrees with `packages/ipc/src/protocol/schemas.ts` on `op_id` placement, `project` vs `project_id`, `questionId` vs `question_id`, `SnapshotGetParamsSchema.cursor`, `EventsSubscribeParamsSchema.stream_epoch` (`number` vs `string`), and read-only `artifact.open`.
- **F-007** — Hash format split: `"sha256:<64-hex>"` in `shared-contracts` vs bare `<64-hex>` in `CasBlobStore` / `artifacts.hash`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 007` (`canonicalizeJson`, `splitSearchText`, `sha256Prefixed`) → consumed by `packages/db` (`017, 018, 028, 030`), `spec-expansion` (`079`), `verifier` (`060–066`), `intake` (`097`).
- `Task 008` (`AttemptReceiptSchema`, `RpcMethodSchemas`) → consumed by `packages/ipc` (`032–033`), `verifier` (`060, 066`), `daemon` (`067`), `renderer` (`122+`).
- `Task 011` (`StreamingRedactor`, `StructuredLogger`) → consumed by `packages/db` (`029`), `sandbox` (`047`), `worker-loop` (`057`), `daemon` (`067`), `shared-observability` consumers.

## 9. Defects and missing integrations
- Uncommitted bugfixes in `task-008`, `task-009`, and `task-011` worktrees are absent from their branch tips and from `harness/integration`.
- `packages/shared-observability` does not re-export `Task 011`'s telemetry implementation.
- `scripts/layers.mjs` encodes coarse 6-tier ranks instead of the package DAG.

## 10. Tests and verification performed
- Executed `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" typecheck` → exit `0`.
- Inspected uncommitted `git diff` in `task-008`, `task-009`, and `task-011` worktrees and verified their unit test additions.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/intake` locator emissions (`Tasks 097–098`) against `F-005` (`EvidenceLocatorSchema`) — scheduled in `pass-03`.
- Renderer/daemon RPC calls (`Tasks 122–133, 153–165`) against `F-006` — scheduled in `pass-05`.

---

### Report: `pass-01/chunk-002.md`

# Pass 01 — Chunk 002: SQLite Kernel, Repositories, Lifecycles, CAS, and Secret Purge (`Tasks 012–030`)

## 1. Chunk identification and scope
- **Pass number:** Pass 01
- **Chunk ID:** `pass-01/chunk-002`
- **Unit IDs:** `Tasks 012–030` (`packages/db`)
- **Branches and commits:**
  - `task/012-sqlite-driver-wrapper` (`51c90de`), `task/013-state-db-bootstrap-safemode` (`7baa1b6`), `task/014-global-telemetry-codeindex-dbs` (`e4c80c0`), `task/015-db-migration-engine` (`0ddc371`), `task/016-backups-corruption-recovery` (`b674e4a`), `task/017-knowledge-graph-repo` (`a6ef07d`), `task/018-fts5-knowledge-search` (`baee148`), `task/019-name-registry-hygiene` (`cea291d`), `task/020-task-claiming-leases-sleep-guard` (`336e7e5`), `task/021-holds-submissions-fencing` (`4f5c3f6`), `task/022-feature-project-lifecycles` (`a3c8977`, dirty worktree diff), `task/023-budget-reservation-ledger` (`96649df`), `task/024-cross-db-grant-protocol` (`e16d754`), `task/025-idempotency-group-commit` (`b0a731a`), `task/026-transactional-outbox` (`ce1ab76`), `task/027-read-models-rollups-drift` (`a95c149`), `task/028-cas-artifact-store-gc` (`49ff155`), `task/029-seekable-logs-retention-archive` (`e289bb9`), `task/030-secret-purge-engine` (`71bacaa`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/db` and `C:/Users/Ayush/Desktop/ef-wt/task-022-feature-project-lifecycles`
- **Governing architecture documents:** `schema/{state,global,telemetry,code-index,queries}.sql`, `schema/schema-test.js`, `database-design.md`, `kernel-schema-and-protocol.md`, `architecture-deep-review.md`, `IMPLEMENTATION_TASKS.md` (`Tasks 012–030`).

## 2. Units inspected
- All 19 units `Task 012` through `Task 030`, plus the uncommitted worktree diff in `task-022-feature-project-lifecycles`.

## 3. Files inspected
- `schema/{state,global,telemetry,code-index,queries}.sql` & `schema/schema-test.js`
- `packages/db/package.json`, `packages/db/src/index.ts`
- `packages/db/src/driver/{backend.ts,connection.ts,query-catalog.ts,reader-pool.ts}`
- `packages/db/src/state-db/{bootstrap.ts,state-db.ts}`, `packages/db/src/auxiliary-dbs/{global-broker-db.ts,telemetry-db.ts,code-index-db.ts,broker-lock.ts}`
- `packages/db/src/migrations/migration-runner.ts`, `packages/db/src/recovery/{backup-scheduler.ts,corruption-recovery.ts}`
- `packages/db/src/knowledge/knowledge-graph-repo.ts`, `packages/db/src/search/fts5-search-repo.ts`, `packages/db/src/registry/name-registry-repo.ts`
- `packages/db/src/leases/task-lease-manager.ts`, `packages/db/src/holds/holds-submissions-repo.ts`
- `packages/db/src/lifecycles/{feature-lifecycle.ts,project-lifecycle.ts}` (+ `task-022` uncommitted diff)
- `packages/db/src/ledger/budget-ledger-repo.ts`, `packages/db/src/grants/broker-grant-issuer.ts`, `packages/db/src/write-queue/coordinator-write-queue.ts`, `packages/db/src/outbox/outbox-repo.ts`, `packages/db/src/read-models/{board.ts,rollups.ts,drift.ts}`
- `packages/db/src/cas/cas-blob-store.ts`, `packages/db/src/artifacts/{artifact-logger.ts,retention.ts}`, `packages/db/src/secret-purge/secret-purge-engine.ts`

## 4. Architecture documents consulted
- `database-design.md` (single writer per SQLite file, WAL + reader pool, `user_version` migrations, contentless `kb_words` FTS5, CAS layout, secret purge)
- `kernel-schema-and-protocol.md` (7-condition feature DONE gate, project lifecycle gates, transactional outbox, `op_id` group commit)
- `schema/state.sql` & `schema/queries.sql` (authoritative DDL, triggers, invariants, named SQL queries)

## 5. Contracts and signatures discovered
- `SqliteConnection` (`driver/connection.ts`), `ReaderPool`, `QueryCatalog`
- `ProjectStateDb.open(options)` (currently wraps a private `StateConnection`), `GlobalBrokerDb`, `TelemetryDb`, `CodeIndexDb`
- `MigrationRunner.migrate(db, migrations)` (`015`)
- `KnowledgeGraphRepo`, `Fts5SearchRepo`, `NameRegistryRepo`, `TaskLeaseManager.claimTask(...)`, `HoldsSubmissionsRepo`
- `verifyFeatureDoneConditions` & `ProjectLifecycleManager` (`022`)
- `BudgetLedgerRepo`, `BrokerGrantIssuer`, `CoordinatorWriteQueue`, `OutboxRepo`, `BoardReadModelRepo` (`getFeatureProgress(featureId: string)`)
- `CasBlobStore` (`028`: async `put(bytes, opts)` returning bare 64-hex hash, `zstd|raw`), `ArtifactLogWriter` (`029`: expects sync `CasBlobStore` with `zstd-seekable`), `SecretPurgeEngine` (`030`: defines `RawFileCasBlobStore`)

## 6. Confirmed findings
- **F-007** — `CasBlobStore` (`028`) and `artifacts.hash` store bare `<64-hex>` while `shared-contracts` `Sha256HexSchema` and receipts require `"sha256:<64-hex>"`.
- **F-008** — `harness/integration` lacks `task-022`'s uncommitted fixes: inverted `coversScope` prefix check (`audited.startsWith(scopePrefix)` instead of `taskPath.startsWith(auditedScope)`), missing `contractsCurrent` brief-version pin, `BLOCKED` resume state loss, and `meta`-persisted exit approvals.
- **F-009** — `ProjectStateDb` (`013`) and `GlobalBrokerDb` (`014`) hardcode `PRAGMA user_version === 1` and reject migrated databases instead of invoking `MigrationRunner` (`015`).
- **F-010** — Four divergent `ef_search_text` SQLite UDF implementations (`013`, `015`, `030`, `067`) omit `([A-Z]+)([A-Z][a-z])` acronym splitting from `shared-contracts` `splitSearchText` (`007`/`018`), corrupting contentless `kb_words` FTS5 deletes and rebuilds.
- **F-011** — Three incompatible `CasBlobStore` contracts across `028` (async `zstd|raw`), `029` (sync pre-framed `zstd-seekable`), and `030` (`RawFileCasBlobStore`).
- **F-012** — `ProjectStateDb` hides a private `StateConnection` and 9 `packages/db` submodules define incompatible `Connection` interfaces + duplicate `queries.sql` loaders, preventing composition into one single-writer `ProjectDbBundle`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `packages/db` (`012–030`) is the authoritative persistence producer for `packages/ipc` (`032–033`), `packages/sim` (`034`), `mcp-server` (`048`), `verifier` (`066`), `daemon` (`067`), `discovery`/`spec-expansion`/`planner`/`integrator`/`ship-deploy`/`portability`.

## 9. Defects and missing integrations
- No unified `ProjectDbBundle` factory exists yet in `packages/db` to bind all repositories onto the single `SqliteConnection` writer + `ReaderPool` + shared `QueryCatalog`.

## 10. Tests and verification performed
- Executed `node schema/schema-test.js` → **PASS (`67/67 passed · SQLite 3.53.0`)**.
- Verified `task-022` uncommitted diff against `kernel-schema-and-protocol.md` feature/project state machine rules.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- Cross-check `CodeIndexDb` (`014`) against `packages/brownfield` (`166–170`) in `pass-05`, and `GlobalBrokerDb` / `BrokerGrantIssuer` (`014, 024`) against `packages/portability` (`188`) and `packages/providers` (`140`) in `pass-04`/`pass-06`.

---

### Report: `pass-01/chunk-003.md`

# Pass 01 — Chunk 003: Named-Pipe IPC, Event/Artifact Streaming, and M0 Simulation (`Tasks 031–034`)

## 1. Chunk identification and scope
- **Pass number:** Pass 01
- **Chunk ID:** `pass-01/chunk-003`
- **Unit IDs:** `Tasks 031–033` (`packages/ipc`), `Task 034` (`packages/sim`)
- **Branches and commits:**
  - `task/031-named-pipe-ipc-transport` (`e23f4fe`)
  - `task/032-ipc-event-stream-resync` (`2117d11`)
  - `task/033-binary-artifact-streaming` (`6dfa32b`)
  - `task/034-m0-deterministic-sim-exit-gate` (`15c4663`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/ipc`, `C:/Users/Ayush/Desktop/ef-wt/integration/packages/sim`
- **Governing architecture documents:** `kernel-schema-and-protocol.md`, `database-design.md`, `roadmap.md` (M0 exit gate), `IMPLEMENTATION_TASKS.md` (`Tasks 031–034`).

## 2. Units inspected
- `Task 031` (`e23f4fe`), `Task 032` (`2117d11`), `Task 033` (`6dfa32b`), `Task 034` (`15c4663`).

## 3. Files inspected
- `packages/ipc/package.json`, `packages/ipc/src/index.ts`
- `packages/ipc/src/transport/{constants.ts,frame-codec.ts,message-port-bridge.ts,named-pipe-client.ts,named-pipe-server.ts}`
- `packages/ipc/src/protocol/{dispatcher.ts,event-stream.ts,ports.ts,resync.ts,schemas.ts}`
- `packages/ipc/src/streams/{artifact-stream-client.ts,artifact-stream-server.ts,credit-flow.ts,seekable-zstd.ts}`
- `packages/sim/package.json`, `packages/sim/src/index.ts`, `packages/sim/src/m0/{cas-store.ts,harness.ts,ipc-sim.ts,outbox-sim.ts,runner.ts}`

## 4. Architecture documents consulted
- `kernel-schema-and-protocol.md` (5-byte binary frame header `[channel:u8, length:u32be]`, credit-based artifact backpressure `stream.credit`, `events.subscribe` / `snapshot.get` cursor resync, `op_id` idempotency)
- `roadmap.md` (M0 deterministic simulation exit gate invariants)

## 5. Contracts and signatures discovered
- `FrameCodec` (`031`: instance `encode(channel, payload)` / `push(chunk)`, max frame cap)
- `NamedPipeServer`, `NamedPipeClient`, `MessagePortBridge` (`031`)
- `RpcDispatcher`, `EventStreamBroadcaster`, `SnapshotResyncService`, `StateSnapshotPort`, `WriteQueuePort`, `OutboxPort` (`032`)
- `ArtifactStreamServer`, `ArtifactStreamClient` (`033`: expects `FrameCodecPort` and `stream.credit` routing)
- `runM0DeterministicSim` (`034`)

## 6. Confirmed findings
- **F-006** — `packages/ipc/src/protocol/schemas.ts` conflicts with `packages/shared-contracts/src/packets/rpc.ts` on `op_id` nesting, `project` vs `project_id`, `questionId` vs `question_id`, `stream_epoch` type (`string` vs `number`), and `artifact.open` requiring `op_id`.
- **F-013** — `packages/ipc` (`032–033`) has zero dependency on `@ef-harness/db` and defines async `StateSnapshotPort.getFeatureProgress()` (0-arg), async `WriteQueuePort.execute`, and stateful `OutboxPort` that do not match synchronous `BoardReadModelRepo.getFeatureProgress(featureId)`, `CoordinatorWriteQueue.enqueue`, and stateless `OutboxRepo` in `packages/db`.
- **F-014** — Intra-`packages/ipc` seam between `031` (`FrameCodec` instance methods) and `033` (`ArtifactStreamServer` expecting static/divergent `FrameCodecPort.encodeFrame`).
- **F-015** — `stream.credit` routing & schema mismatch between `032` (`RpcDispatcher` / `schemas.ts`: `{ stream_id, credits }`) and `033` (`ArtifactStreamServer` / `ArtifactStreamClient`: `{ streamId, chunks }`).
- **F-016** — `packages/sim` (`034`) implements private in-memory mocks (`m0/cas-store.ts`, `ipc-sim.ts`, `outbox-sim.ts`) with zero imports from `@ef-harness/db` or `@ef-harness/ipc`, failing to verify the real M0 kernel!

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `packages/db` (`012–030`) → `packages/ipc` (`031–033`) → `apps/daemon` & `apps/desktop` (`067, 123, 131–133`) & `packages/sim` (`034`).

## 9. Defects and missing integrations
- `packages/ipc` needs `@ef-harness/db` adapter wiring, unified `rpc.ts` validation (`F-006`), unified `FrameCodec` (`F-014`), and unified `stream.credit` dispatch (`F-015`).
- `packages/sim` must run its seeded fault-injection scenarios against real `@ef-harness/db` + `@ef-harness/ipc` (`F-016`).

## 10. Tests and verification performed
- Cross-checked `packages/ipc/src/protocol/schemas.ts`, `packages/ipc/src/streams/*`, and `packages/shared-contracts/src/packets/rpc.ts` line-by-line.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `apps/daemon` and `apps/desktop` IPC usage (`067` in `pass-02`, `122–133` in `pass-05`), plus `packages/meta-lab` fault sim (`192` in `pass-06`).

---

### Report: `pass-02/chunk-001.md`

# Pass 02 — Chunk 001: Git Engine, Windows Sandbox, Loopback Proxy, Installer, and Harness Run (`Tasks 035–047`)

## 1. Chunk identification and scope
- **Pass number:** Pass 02
- **Chunk ID:** `pass-02/chunk-001`
- **Unit IDs:** `Tasks 035–039` (`packages/git-engine`), `Tasks 040–047` (`packages/sandbox`)
- **Branches and commits:**
  - `task/035-mingit-wrapper-folder-states` (`33895fd`), `task/036-git-safety-scanner` (`5872b0a`), `task/037-temp-index-snapshots` (`fe092d2`), `task/038-worktree-slot-manager` (`04aa278`), `task/039-branch-ref-leases-cas` (`68c4d3f`)
  - `task/040-windows-job-objects` (`ddcffc7`), `task/041-sandbox-tier-a-mxc` (`bca08dd`), `task/042-sandbox-tier-b-users` (`1b8a413`), `task/043-sandbox-tier-c-d-selector` (`4337b83`), `task/044-loopback-allowlist-proxy` (`d534d12`), `task/045-secure-doc-fetcher` (`d26eee9`), `task/046-supply-chain-installer` (`b27a210`), `task/047-harness-run-engine` (`c559222`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/git-engine`, `C:/Users/Ayush/Desktop/ef-wt/integration/packages/sandbox`
- **Governing architecture documents:** `git-and-workspace-isolation.md`, `security-and-governance.md`, `verification-and-runtime.md`, `architecture-deep-review.md`, `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 035–047`).

## 2. Units inspected
- All 13 units `Task 035` through `Task 047`.

## 3. Files inspected
- `packages/git-engine/package.json`, `packages/git-engine/src/index.ts`
- `packages/git-engine/src/runner/{git-runner.ts,resolve-git.ts}`, `packages/git-engine/src/safety-scan/safety-scanner.ts`, `packages/git-engine/src/snapshots/temp-index-snapshotter.ts`, `packages/git-engine/src/worktrees/worktree-slot-manager.ts`, `packages/git-engine/src/refs/ref-lease-manager.ts`
- `packages/sandbox/package.json`, `packages/sandbox/src/index.ts`
- `packages/sandbox/src/job-objects/windows-job-manager.ts`, `packages/sandbox/src/tier-a-mxc/tier-a-launcher.ts`, `packages/sandbox/src/tier-b-users/tier-b-launcher.ts`, `packages/sandbox/src/tier-c-d-selector/tier-selector.ts`
- `packages/sandbox/src/proxy/allowlist-proxy-server.ts`, `packages/sandbox/src/doc-fetcher/secure-doc-fetcher.ts`, `packages/sandbox/src/installer/kernel-package-installer.ts`, `packages/sandbox/src/harness-run/{engine.ts,warm-pool.ts,ports.ts}`

## 4. Architecture documents consulted
- `git-and-workspace-isolation.md` (bundled MinGit with dev PATH fallback, temp-index candidate snapshots, worktree slots, CAS ref leases via `leases` table in `state.db`)
- `security-and-governance.md` (Windows Job Objects, Tier A MXC, Tier B restricted worker accounts, Tier C Restricted Token + WFP/ACL, Tier D explicit approval, loopback allowlist proxy, supply-chain `--frozen-lockfile --ignore-scripts`)

## 5. Contracts and signatures discovered
- `MinGitRunner.run(args, options)` (`035`), `GitSafetyScanner` (`036`), `TempIndexSnapshotter` (`037`), `WorktreeSlotManager` (`038`), `RefLeaseManager` (`039`)
- `WindowsJobManager` (`040`), `TierAMxcSandbox` (`041`), `TierBUserSandbox` (`042`), `SandboxTierSelector` (`043`)
- `AllowlistProxyServer` (`044`: starts HTTP CONNECT/GET proxy on `127.0.0.1:<port>`), `SecureDocFetcher` (`045`: expects `proxy.fetch(req)`), `KernelPackageInstaller.install(...)` (`046`), `HarnessRunEngine.run(...)` (`047`)

## 6. Confirmed findings
- **F-017** — `packages/git-engine` `resolveGitBinary` (`035`) lacks system `git` `PATH` fallback on developer workstations without bundled `resources/mingit`, 5 submodules (`035–039`) define incompatible `GitRunner` interfaces, and `RefLeaseManager` (`039`) executes rogue `CREATE TABLE IF NOT EXISTS ref_leases` instead of using `leases` in `schema/state.sql`.
- **F-018** (**CRITICAL**) — `HarnessRunEngine` (`047`) defaults to unsandboxed `NestedCommandJobManager` + `WarmExecutionPool` (`child_process.spawn` directly as the logged-in user with ambient network) while reporting `tier: "C"`, leaks `WarmExecutionPool` slots when `jobManager` throws before `try/finally`, and defines incompatible `WindowsJobManager` / `SandboxTierSelector` ports vs `040–043`.
- **F-019** — `SecureDocFetcher` (`045`) expects `AllowlistProxyPort.fetch(request)` whereas `AllowlistProxyServer` (`044`) is a real loopback HTTP proxy (`127.0.0.1:<port>`) without a `.fetch()` method.
- **F-020** — `KernelPackageInstaller` (`046`) text-splices a partial `importers:` stub onto `pnpm-lock.yaml` and immediately runs `pnpm install --frozen-lockfile`, guaranteeing `--frozen-lockfile` failure whenever a package is added.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `git-engine` (`035–039`) → consumed by `mcp-server` (`048`), `verifier` (`060, 066`), `integrator` (`096, 110, 111, 129, 172`), `portability` (`186–187`).
- `sandbox` (`040–047`) → consumed by `mcp-server` (`048`), `verifier` (`060`), `research-engine` (`082`), `planner` (`093`), `intake` (`097`), `runtime-adapters` (`142–149`).

## 9. Defects and missing integrations
- Intra-package port disconnects inside `git-engine` (`035–039`) and `sandbox` (`040–047`).
- Unsandboxed default execution path in `HarnessRunEngine` (`047`).

## 10. Tests and verification performed
- Inspected `engine.ts`, `warm-pool.ts`, `ports.ts` (`047`), `secure-doc-fetcher.ts` (`045`), `allowlist-proxy-server.ts` (`044`), and `kernel-package-installer.ts` (`046`) line-by-line.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `research-engine` (`082`) consumption of `SecureDocFetcher` (`045`), `planner/phase0` (`093`) consumption of `KernelPackageInstaller` (`046`), `intake` (`097`) sandbox runner, and `runtime-adapters` (`142+`) sandbox launching.

---

### Report: `pass-02/chunk-002.md`

# Pass 02 — Chunk 002: Attempt MCP Server, Test-Env, Worker Loop, and Completeness Gate (`Tasks 048–059`)

## 1. Chunk identification and scope
- **Pass number:** Pass 02
- **Chunk ID:** `pass-02/chunk-002`
- **Unit IDs:** `Task 048` (`packages/mcp-server`), `Tasks 049–052` (`packages/test-env`), `Tasks 053–057` (`packages/worker-loop`), `Tasks 058–059` (`packages/completeness-gate`)
- **Branches and commits:**
  - `task/048-attempt-mcp-server` (`954622c`, dirty worktree diff)
  - `task/049-test-env-orchestrator-core` (`cc26926`), `task/050-native-backing-services` (`57eca20`), `task/051-oauth-stripe-mocks-port-fallback` (`9c562b8`), `task/052-template-db-synthetic-data` (`1c3bb83`)
  - `task/053-worker-loop-provider-protocols` (`445b340`, dirty worktree diff), `task/054-worker-loop-context-compaction` (`f62475b`), `task/055-worker-loop-tool-shrinker` (`460527d`), `task/056-worker-loop-edit-applier` (`42aafc7`, dirty worktree diff), `task/057-worker-loop-executor-checkpoints` (`a3e3d60`, dirty worktree diff)
  - `task/058-static-audit-scanners-p1` (`71ea882`, dirty worktree diff), `task/059-static-audit-scanners-p2` (`b6e79b2`, dirty worktree diff)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/{mcp-server,test-env,worker-loop,completeness-gate}` and dirty worktrees `task-048`, `task-053`, `task-056`, `task-057`, `task-058`, `task-059`
- **Governing architecture documents:** `verification-and-runtime.md`, `completeness-and-quality.md`, `prompt-contracts.md`, `database-design.md`, `IMPLEMENTATION_TASKS.md` (`Tasks 048–059`).

## 2. Units inspected
- All 12 units `Task 048` through `Task 059`, plus all 6 dirty worktree diffs (`048, 053, 056, 057, 058, 059`).

## 3. Files inspected
- `packages/mcp-server/{package.json,src/index.ts,src/server.ts,src/ports.ts}` (+ `task-048` diff)
- `packages/test-env/{package.json,src/index.ts}`, `src/orchestrator/*`, `src/services/*`, `src/auth-payment-mocks/*`, `src/synthetic-data/*`
- `packages/worker-loop/{package.json,src/index.ts}`, `src/protocols/*` (+ `task-053` diff), `src/context/*`, `src/read-tools/*`, `src/edits/*` (+ `task-056` diff), `src/executor/*` (+ `task-057` diff)
- `packages/completeness-gate/{package.json,src/index.ts}`, `src/ast-scanners/*` (+ `task-058` diff), `src/gate/*` (+ `task-059` diff)

## 4. Architecture documents consulted
- `verification-and-runtime.md` (`AttemptMcpServer` 4 worker tools `kb.get_fact`, `kb.contract`, `kb.code`, `harness.run`; native Windows test-env Postgres/Valkey/MinIO/Mailpit + OAuth/Stripe mocks + template DB cloning; native worker loop checkpoints & 4-tier edit applier)
- `completeness-and-quality.md` (AST-grep + TypeScript completeness gate scanners, zero stub/dead-control/scope-escape/test-tampering tolerance)

## 5. Contracts and signatures discovered
- `AttemptMcpServer` (`048`), `TestEnvOrchestrator` (`049`), `NativeBackingServicesManager` (`050`), `AuthPaymentMockSuite` (`051`), `TemplateDbManager` (`052`)
- `AnthropicMessagesClient` / `OpenAiResponsesClient` / `GeminiGenerateContentClient` (`053`), `ContextCompactor` (`054`), `ToolOutputShrinker` (`055`), `FourTierEditApplier` (`056`), `NativeWorkerLoop` (`057`)
- `StaticAuditEngine` (`058`) and `CompletenessGateRunner` (`059`)

## 6. Confirmed findings
- **F-021** — `packages/mcp-server` (`048`) has uncommitted path-traversal/candidate-snapshot fixes in `task-048` missing on `harness/integration`, and zero real wiring to `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, or `@ef-harness/test-env`.
- **F-022** — `packages/test-env` (`049–052`) opens rogue second `DatabaseSync` writer connections directly on `state.db` (violating single-writer discipline) and defines 3 incompatible `ServiceProvider` interfaces across `049`, `050`, and `051`.
- **F-023** — `packages/worker-loop` (`053–057`) is missing 3 critical uncommitted worktree diffs (`task-053` SSE stream framing/tool-call accumulator fixes, `task-056` CRLF & path-escape edit fixes, `task-057` checkpoint/abort/MCP tool dispatch fixes) and disconnects `057` `NativeWorkerLoop` from `053–056` and `048` `AttemptMcpServer`.
- **F-024** — `packages/completeness-gate` (`058–059`) is missing uncommitted `task-058` and `task-059` scanner accuracy/scope-bypass fixes on `harness/integration` and leaves `059` `CompletenessGateRunner` calling a local stub instead of `058`'s `StaticAuditEngine`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `db` + `git-engine` + `sandbox` + `test-env` → `mcp-server` (`048`) → `worker-loop` (`057`) and `runtime-adapters` (`142–150`).
- `completeness-gate` (`058–059`) → `verifier` (`060, 066`), `planner` (`095, 102`), `integrator` (`096, 101`).

## 9. Defects and missing integrations
- 6 dirty worktree diffs (`048, 053, 056, 057, 058, 059`) unmerged on `harness/integration`.
- Intra-package local port silos in `test-env`, `worker-loop`, and `completeness-gate`.

## 10. Tests and verification performed
- Inspected full `git diff` in `task-048`, `task-053`, `task-056`, `task-057`, `task-058`, and `task-059` worktrees.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/providers` (`135–140`) vs `worker-loop/src/protocols` (`053`), and `packages/runtime-adapters` (`142–150`) vs `AttemptMcpServer` (`048`) in `pass-04`.

---

### Report: `pass-02/chunk-003.md`

# Pass 02 — Chunk 003: Clean Verifier, Multi-Surface Oracles, M1 Daemon/Viewer, and M1 Exit Gate (`Tasks 060–068`)

## 1. Chunk identification and scope
- **Pass number:** Pass 02
- **Chunk ID:** `pass-02/chunk-003`
- **Unit IDs:** `Tasks 060–066` (`packages/verifier`), `Task 067` (`apps/daemon`, `apps/desktop`, `apps/renderer`), `Task 068` (`tests/e2e`, `benchmarks/m1-kitchen-leaves`)
- **Branches and commits:**
  - `task/060-clean-verifier-harness` (`a06d371`), `task/061-red-before-green-blind-binder` (`cc176e3`, dirty worktree diff), `task/062-ui-interaction-contract-verifier` (`fe62a40`, dirty worktree diff), `task/063-multi-surface-verifiers` (`9b455fd`, dirty worktree diff), `task/064-ai-eval-property-mutation-probes` (`3a84cad`, dirty worktree diff), `task/065-hint-ladder-dispute-routing` (`9f0c374`), `task/066-candidate-acceptance-tx` (`f68afb3`, dirty worktree diff)
  - `task/067-m1-daemon-minimal-viewer` (`d1109c7`)
  - `task/068-m1-kitchen-exit-gate` (`76f8a9c`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/{packages/verifier,apps/daemon,apps/desktop,apps/renderer,tests/e2e}` and dirty worktrees `task-061`, `task-062`, `task-063`, `task-064`, `task-066`
- **Governing architecture documents:** `verification-and-runtime.md`, `completeness-and-quality.md`, `kernel-schema-and-protocol.md`, `desktop-and-ux.md`, `roadmap.md` (M1 exit gate), `IMPLEMENTATION_TASKS.md` (`Tasks 060–068`).

## 2. Units inspected
- All 9 units `Task 060` through `Task 068`, plus all 5 dirty worktree diffs (`061, 062, 063, 064, 066`).

## 3. Files inspected
- `packages/verifier/{package.json,src/index.ts}`, `src/runner/*`, `src/binder/*` (+ `task-061` diff), `src/ui-contract/*` (+ `task-062` diff), `src/surfaces/*` (+ `task-063` diff), `src/advanced/*` (+ `task-064` diff), `src/hint-ladder/*`, `src/acceptance/*` (+ `task-066` diff)
- `apps/daemon/{package.json,src/index.ts,src/bootstrap/*}`, `apps/desktop/{package.json,src/index.ts,src/bootstrap/pipe-client.ts}`, `apps/renderer/{package.json,src/index.ts,src/m1-viewer/*}`
- `tests/e2e/{package.json,m1-exit-gate/pipeline.ts,tests/m1-exit-gate.test.ts}`

## 4. Architecture documents consulted
- `verification-and-runtime.md` (clean-checkout verifier, blind red-before-green binder, Playwright UI interaction contract, 6 surface verifiers, AI cassette/mutation probes, 3-step hint ladder + dispute routing, atomic candidate acceptance transaction)
- `kernel-schema-and-protocol.md` (daemon bootstrap, outbox deliveries, Electron utility-process `MessagePort` bridge)
- `roadmap.md` (M1 20-task Kitchen-Prep end-to-end exit gate)

## 5. Contracts and signatures discovered
- `CleanVerifierRunner` (`060`), `BlindOracleBinder` (`061`), `UiInteractionContractVerifier` (`062`), `MultiSurfaceVerifierSuite` (`063`), `AdvancedProbeRunner` (`064`), `HintLadderController` (`065`), `CandidateAcceptanceCoordinator` (`066`)
- `HarnessDaemon` (`067`), `DesktopPipeBridge` (`067`), `M1MinimalViewer` (`067`)
- `runM1KitchenExitGate` (`068`)

## 6. Confirmed findings
- **F-025** — `packages/verifier` (`060–066`) is missing 5 uncommitted worktree bugfixes (`task-061`, `task-062`, `task-063`, `task-064`, `task-066`) on `harness/integration`, defines 4 incompatible `SurfaceVerifierAdapter` interfaces across `060, 062, 063, 064`, and leaves `CandidateAcceptanceCoordinator` (`066`) disconnected from `@ef-harness/db`, `@ef-harness/git-engine`, and `@ef-harness/completeness-gate`.
- **F-026** — `apps/daemon` (`067`) bypasses `@ef-harness/db` and `@ef-harness/ipc`, omits `user_version` / WAL pragmas, uses PID-only lockfile checks (vulnerable to Windows PID reuse), and writes `outbox` rows without `outbox_deliveries` (violating `outbox_without_deliveries` invariant in `schema/queries.sql`).
- **F-027** — `apps/desktop/src/bootstrap/pipe-client.ts` (`067`) corrupts/duplicates framed bytes via `localCodec.takePending()` + raw `forward(chunk)` after `session.hello` and overwrites a single global `renderer` `MessagePort` when multiple windows connect.
- **F-028** — `tests/e2e/m1-exit-gate/pipeline.ts` (`068`) implements a 1,359-line standalone mock pipeline with zero imports from `@ef-harness/db`, `git-engine`, `sandbox`, `test-env`, `mcp-server`, `worker-loop`, `completeness-gate`, or `verifier`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `verifier` (`060–066`) consumes `sandbox` (`047`), `test-env` (`049`), `completeness-gate` (`059`), `db` (`017, 020, 026, 028`), `git-engine` (`037, 039`), and produces verified receipts/acceptance for `planner` (`095`), `integrator` (`096`), and `tests/e2e` (`068, 105, 134, 152, 175, 195`).
- `apps/daemon` & `apps/desktop` (`067`) are extended by `Tasks 122–133, 160, 196`.

## 9. Defects and missing integrations
- 5 uncommitted worktree diffs (`061–064, 066`) unmerged on `harness/integration`.
- Daemon/desktop (`067`) and M1 E2E (`068`) re-implement kernel primitives instead of importing M0/M1 packages.

## 10. Tests and verification performed
- Inspected uncommitted `git diff` in `task-061`, `task-062`, `task-063`, `task-064`, and `task-066`, plus `apps/daemon/src/bootstrap/*`, `apps/desktop/src/bootstrap/pipe-client.ts`, and `tests/e2e/m1-exit-gate/pipeline.ts`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `Tasks 105, 134, 152, 175, 194, 195, 198, 199` shared `tests/e2e/package.json` conflicts with `Task 068`.
- `Tasks 122–133, 160` shared `apps/daemon`, `apps/desktop`, and `apps/renderer` seams with `Task 067`.

---

### Report: `pass-03/chunk-001.md`

# Pass 03 — Chunk 001: Discovery Engine Core, Prompts, Entailment, Selector, Depth & Readiness (`Tasks 069–074`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-001`
- **Unit IDs:** `Task 069`, `Task 070`, `Task 071`, `Task 072`, `Task 073`, `Task 074`
- **Branches and commits:**
  - `task/069-discovery-core-opening-rubrics` (`0df0a18`, merged into `harness/integration`)
  - `task/070-discovery-prompts-quote-verifier` (`326728d`, merged into `harness/integration`)
  - `task/071-entailment-derivations-reopening` (`2c91b46`, merged into `harness/integration`)
  - `task/072-adaptive-question-selector` (`7f8f233`, merged into `harness/integration`)
  - `task/073-discovery-depth-controls` (`47801e2`, merged into `harness/integration`)
  - `task/074-honest-readiness-calculator` (`27758b5`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/discovery` (clean across `task-069`..`task-074`)
- **Governing architecture documents:** `project-discovery.md`, `opening-prompts.md`, `discovery-depth-and-catalog.md`, `prompt-contracts.md`, `skills/infer-or-ask/SKILL.md`, `database-design.md`, `architecture-deep-review.md`, `schema/state.sql`, `schema/queries.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 069–074`).

## 2. Units inspected
- `Task 069` (`0df0a18`), `Task 070` (`326728d`), `Task 071` (`2c91b46`), `Task 072` (`7f8f233`), `Task 073` (`47801e2`), `Task 074` (`27758b5`).

## 3. Files inspected
- `IMPLEMENTATION_TASKS.md` (`lines 4241–4586`)
- `packages/discovery/package.json`
- `packages/discovery/src/index.ts`
- `packages/discovery/src/core/{decision-fields.ts,discovery-db-repo.ts,session-manager.ts,sqlite-state.ts}`
- `packages/discovery/src/prompts/{discovery-prompt-orchestrator.ts,ports.ts}`
- `packages/discovery/src/entailment/{semantic-entailment-gate.ts,derivation-chain-validator.ts}`
- `packages/discovery/src/selector/engine.ts`
- `packages/discovery/src/depth/{stage-depth-controller.ts,sqlite-state.ts}`
- `packages/discovery/src/readiness/{readiness-calculator.ts,ready-for-handoff-gate.ts,sql.ts,graph.ts}`

## 4. Architecture documents consulted
- `project-discovery.md` & `opening-prompts.md` (5 opening prompts, `opening-rubric-map@1`, explicit-submit-only turns, exact quote verification, independent `entailment-checker@1`)
- `discovery-depth-and-catalog.md` (stage presets, `ask_value`, fixed must-ask floor, `Chosen for you` ledger, honest exact-count readiness, bounded deferrals)
- `prompt-contracts.md` & `skills/infer-or-ask/SKILL.md` (`opening-review@1`, `batch-resolve@1`, `clarify@1`, `entailment-checker@1`, `question-drafter@1`)
- `database-design.md`, `schema/state.sql`, `schema/queries.sql` (`work_items`, `discovery_scopes`, `scope_criteria`, `discovery_batches`, `turns`, `nodes` decision `fields`)

## 5. Contracts and signatures discovered
- `DiscoverySessionManager` (`core/session-manager.ts`): synchronous `send(input: { workItemId, text, target, opId }): SendResult`, `selectDelegatedValue(...)`, `placeBatch(...)`, `reviseScope(...)`
- `DiscoveryDbRepo` (`core/discovery-db-repo.ts`): wraps `core/knowledge-graph-port.ts` `KnowledgeGraphRepo`
- `DiscoveryPromptOrchestrator` (`prompts/discovery-prompt-orchestrator.ts`): async `runOpeningReview(req): Promise<OpeningReviewResult>`, `runBatchResolve(req): Promise<BatchResolveResult>`, `runClarify(req): Promise<ClarifyResult>`
- `ExactQuoteEvidenceVerifier` (`prompts/exact-quote-evidence-verifier.ts`): `validateSpan(span): QuoteValidationResult`, `validateClaim(spans, ctx): QuoteValidationResult`
- `SemanticEntailmentGate` (`entailment/semantic-entailment-gate.ts`): synchronous `checkAll(claims): EntailmentBatchResult`, `DerivationChainValidator`, `LongTurnRetractionReconciler`, `PremiseSupersessionReopener`
- `selectNextBatch` / `GreedyQuestionSelector` / `ProjectLocalQuestionDrafter` (`selector/engine.ts`)
- `StageDepthController` / `AskValueInterrogationGuard` / `MustAskPolicyFloor` / `AutopilotDelegationEngine` / `ChosenForYouLedger` (`depth/`)
- `ReadinessCalculator` / `ReadyForHandoffGate` / `DenominatorDeltaExplainer` / `BoundedDeferralPolicy` (`readiness/`)

## 6. Confirmed findings
- **F-029** — `packages/discovery` (`Tasks 069–074`) has 6 disconnected intra-package silos, 4 incompatible `KnowledgeGraph`/SQLite interfaces, sync-vs-async model/session mismatches (`DiscoverySessionManager.send` + `SemanticEntailmentGate.complete` sync vs `DiscoveryPromptOrchestrator` + `ModelProtocolAdapter` async), and destructive/crashing `decision` `fields` JSON schema mismatches (`core` `parseDecisionFields` throws `BasisStatusSeparationError` on non-opening `evidence` lacking `rubricId` and strips `must_ask`/`scopeId`/`deferred_reason`/`revisit_wave`/`delegated_at`/`rationale`/`rule`/`premises`, while `entailment` writes `mustAsk`/`feature` camelCase vs `readiness/sql.ts` reading `$.must_ask`/`$.scopeId`/`$.workItem`).
- **F-030** — `packages/discovery/src/core/decision-fields.ts` `valueSatisfiesLimits` hardcodes ONLY `{ sqlite: ["free", "local"] }`, throwing `DelegationBoundsError` for every other delegated technology/option in the system.
- **F-031** — `packages/discovery/src/prompts/ports.ts` (`repositoryRoot`, `loadDiscoveryPromptText`, `loadInferOrAskSkillDigest`) walks parent directories looking for `pnpm-workspace.yaml` and `opening-prompts.md` on disk (failing in packaged Electron builds), duplicates `Task 009` prompt schemas/envelopes, and `core/sqlite-state.ts`, `depth/sqlite-state.ts`, `readiness/sql.ts` add 3 more divergent `ef_search_text` UDFs + standalone `DatabaseSync` openers (cross-referencing `F-010`, `F-012`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 009` (`shared-contracts/prompts`) + `Task 017` (`db/knowledge`) + `Task 053` (`worker-loop/protocols`) → consumed by `packages/discovery` (`069–074`).
- `Task 069` (`core`) ↔ `Task 070` (`prompts`) ↔ `Task 071` (`entailment`) ↔ `Task 072` (`selector`) ↔ `Task 073` (`depth`) ↔ `Task 074` (`readiness`).
- `packages/discovery` (`069–074`) → consumed by `spec-expansion` (`079–081`), `research-engine` (`082`), `intake` (`098`), `planner/plan-preview` (`108`), `renderer` (`123, 153, 155`), `brownfield` (`169`), `meta-lab` (`190, 191, 194`).

## 9. Defects and missing integrations
- Zero dependency on `@ef-harness/db` or `@ef-harness/worker-loop` in `packages/discovery/package.json`.
- All 6 discovery submodules operate on incompatible local ports and conflicting `nodes.fields` JSON shapes for `kind = 'decision'`.
- Hardcoded `{ sqlite: ["free", "local"] }` delegation table in `core/decision-fields.ts`.
- Monorepo-only `pnpm-workspace.yaml` filesystem walk in `prompts/ports.ts`.

## 10. Tests and verification performed
- Inspected actual TypeScript implementations across all 6 `packages/discovery` submodules (`069–074`) and verified against `schema/state.sql`, `schema/queries.sql`, and `IMPLEMENTATION_TASKS.md`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/discovery/src/corpus-loader/**` (`075`), `packages/discovery/src/skills/**` (`078`), and `corpus/**` (`075–078` + unmerged `103–104`) — next in `pass-03/chunk-002`.

---

### Report: `pass-03/chunk-002.md`

# Pass 03 — Chunk 002: Corpus Loader, Cross-Cutting Tag Detector, Skill Vetter & Corpus Waves (`Tasks 075–078, 103–104`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-002`
- **Unit IDs:** `Task 075`, `Task 076`, `Task 077`, `Task 078`, `Task 103`, `Task 104`
- **Branches and commits:**
  - `task/075-corpus-loader-core-data-auth` (`db21117`, merged into `harness/integration`)
  - `task/076-corpus-web-api-cli-elaborations` (`8764a25`, merged into `harness/integration`)
  - `task/077-cross-cutting-rules-seams-tags` (`b73f44c`, merged into `harness/integration`)
  - `task/078-skill-vetting-quarantine-catalog` (`404d945`, merged into `harness/integration`)
  - `task/103-corpus-wave1-expanded-packs` (`1637274`, unmerged)
  - `task/104-corpus-wave2-packs-14-skills` (`c02800d`, unmerged)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration`, `C:/Users/Ayush/Desktop/ef-wt/task-103-corpus-wave1-expanded-packs`, `C:/Users/Ayush/Desktop/ef-wt/task-104-corpus-wave2-packs-14-skills`
- **Governing architecture documents:** `discovery-depth-and-catalog.md`, `completeness-and-quality.md`, `security-and-governance.md`, `research/question-catalog-and-depth.md`, `skills/infer-or-ask/SKILL.md`, `IMPLEMENTATION_TASKS.md` (`Tasks 075–078, 103–104`).

## 2. Units inspected
- `Task 075` (`db21117`), `Task 076` (`8764a25`), `Task 077` (`b73f44c`), `Task 078` (`404d945`), `Task 103` (`1637274`), `Task 104` (`c02800d`).

## 3. Files inspected
- `packages/discovery/src/corpus-loader/{load.ts,interpret.ts,validate.ts,yaml.ts}`
- `corpus/packs/core-data-auth/core.yaml` (`Task 075`)
- `corpus/packs/web-api-cli/{manifest.yaml,web.yaml}`, `corpus/elaborations/{web.yaml,core-data-auth.yaml}`, `corpus/policies/universal-policies.yaml` (`Task 076`)
- `corpus/rules-seams/{cross-cutting-rules.yaml,seam-templates.yaml}`, `packages/planner/src/tag-detector/catalog.ts` (`Task 077`)
- `corpus/skills/manifest.json`, `packages/meta-lab/src/skill-vetting/{catalog.ts,registry.ts}` (`Task 078`)
- `corpus/packs/wave1-expanded/payments.yaml`, `corpus/elaborations/wave1/payments.yaml` (`Task 103`)
- `corpus/packs/wave2-expanded/{manifest.yaml,desktop.yaml}`, `corpus/skills/wave2/manifest.json` (`Task 104`)

## 4. Architecture documents consulted
- `discovery-depth-and-catalog.md` (corpus pack schema, `Q-*` question IDs, option elaborations, universal policies `UP-01..UP-08`, cross-cutting rules `X-01..X-12`, seam templates `S-01..S-10`)
- `security-and-governance.md` (quarantine skill vetting, pinned `manifest.json`, closed 28-tag `TOUCHES_TAGS`)

## 5. Contracts and signatures discovered
- `CorpusPackLoader` / `loadCorpusPacks(corpusRoot, options): CorpusBundle` (`packages/discovery/src/corpus-loader/load.ts`)
- `CorpusQualityValidator.validate(bundle: CorpusBundle): void` (`validate.ts`)
- `parseStrictYaml(source, filePath, options)` (`yaml.ts`)
- `RulesSeamsCatalogLoader.load(): RulesSeamsCatalog` (`packages/planner/src/tag-detector/catalog.ts`)
- `SkillManifestRegistry` (`packages/meta-lab/src/skill-vetting/registry.ts`): `manifestFile()`, `skillDirectory(skillId)`, `loadForMount(skillId)`

## 6. Confirmed findings
- **F-032** (**CRITICAL**) — `loadCorpusPacks(repositoryCorpusRoot())` (`Task 075`) crashes immediately on `harness/integration` and when landing `Task 104`:
  1. `yaml.ts` rejects YAML anchors/aliases (`&a1` / `*a1`) and multi-line folded plain scalars used throughout `Task 076` (`web-api-cli/*.yaml`, `elaborations/*.yaml`) and `Task 104` (`wave2-expanded/*.yaml`, `elaborations/wave2/*.yaml`).
  2. `collectCorpusFiles` walks `manifest.yaml` (`076`, `104`) and `activation-table.yaml` (`104`) inside `corpus/packs/**` and treats them as `question_pack` documents, throwing `CorpusShapeError`.
  3. `075` + `103` use canonical Format A (`kind: question_pack`, `Q-CORE-01` IDs, `positive_examples`/`negative_examples`, `consequences`, `cells`), whereas `076` + `104` use incompatible Format B (`pack`/`pack_version`, dotted `id: ui.responsive_targets` + `code: Q-WEB-01`, `examples: { positive, negative }`, `clauses`, object `bounds`), `076` `universal-policies.yaml` omits `kind`/`id`/`cell`/`value`, and `077` `cross-cutting-rules.yaml` & `seam-templates.yaml` use rich schemas (`requirement`, `verification_check`, `left`/`right`/`contract_shape`) rejected by `075` `readRulePack`/`readSeamPack`.
  4. `076` `corpus/elaborations/core-data-auth.yaml` targets nonexistent dotted question IDs and option IDs (`product.purpose` / `internal_workflow`, `product.audience` / `office_staff`) from its private test fixture `port/task-075-questions.json` instead of `Task 075`'s real `Q-CORE-01..18`, `Q-DATA-01..06`, `Q-AUTH-01..05` questions and options!
- **F-033** (**HIGH**) — `packages/meta-lab/src/skill-vetting` (`Task 078`) and `Task 104` (`corpus/skills/wave2`) have a split skill manifest/directory layout and invalid `allowedTouches` vocabulary:
  1. `M2_CATALOG_META` and `corpus/skills/manifest.json` (`078`) use 10 non-canonical `allowedTouches` strings (`"requirements"`, `"decisions"`, `"debugging"`, `"regression"`, `"tests"`, `"verification"`, `"accessibility"`, `"schema"`, `"migrations"`, `"validation"`) outside `Task 010`'s closed 28-tag `TOUCHES_TAGS`.
  2. `SkillManifestRegistry` (`078`) hardcodes `corpus/skills/manifest.json` (6 skills) and `corpus/skills/m2/<skillId>`, while `Task 104` puts 14 skills in `corpus/skills/wave2/<skillId>` with a separate `corpus/skills/wave2/manifest.json` (containing extra `wave`, `tokenizer`, `quarantineReceipt` fields) and duplicates M2 skills under `packages/discovery/tests/corpus-wave2/port/m2-skills/`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `corpus/**` (`075, 076, 077, 103, 104`) → consumed by `CorpusPackLoader` (`075`), `RulesSeamsCatalogLoader` (`077`), `SpecMatrixGenerator` & `OptionElaborationCompiler` (`079–080`), `RuleMatchingEngine` (`089`), `GreedyQuestionSelector` (`072`), and `StageDepthController` (`073`).
- `corpus/skills/**` + `SkillManifestRegistry` (`078, 104`) → consumed by `KnowledgePacketSlicer` (`088`) and `MetaLabBenchmarkRegistry` (`189`).

## 9. Defects and missing integrations
- Unified corpus YAML schema + loader breaks across `075` ↔ `076` ↔ `077` ↔ `103` ↔ `104`.
- `core-data-auth.yaml` elaborations (`076`) do not match `core-data-auth/*.yaml` question/option IDs (`075`).
- Unified 20-skill manifest and `TOUCHES_TAGS` compliance broken between `078` and `104`.

## 10. Tests and verification performed
- Directly compared `load.ts`, `interpret.ts`, `validate.ts`, and `yaml.ts` (`075`) against actual YAML documents in `075`, `076`, `077`, `103`, and `104`, and compared `skill-vetting/{catalog.ts,registry.ts}` (`078`) against `corpus/skills/manifest.json` (`078`) and `corpus/skills/wave2/manifest.json` (`104`).

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- How `packages/spec-expansion` (`079–081` + dirty `task-079`) consumes `CorpusBundle` (`elaborations`, `policies`, `rules`) and writes `nodes`/`edges` into `state.db`, plus `packages/research-engine` (`082`) — next in `pass-03/chunk-003`.

---

### Report: `pass-03/chunk-003.md`

# Pass 03 — Chunk 003: Spec Expansion Matrices, Cell Filler, 5-Layer Contradictions & Research Engine (`Tasks 079–082`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-003`
- **Unit IDs:** `Task 079`, `Task 080`, `Task 081` (`packages/spec-expansion`), `Task 082` (`packages/research-engine`)
- **Branches and commits:**
  - `task/079-spec-matrix-generators` (`f19582e`, merged into `harness/integration`, **dirty worktree diff present**)
  - `task/080-spec-cell-filler-proposed-review` (`0f5e3d9`, merged into `harness/integration`)
  - `task/081-five-layer-contradiction-checker` (`24fe966`, merged into `harness/integration`)
  - `task/082-research-engine-api-verifier` (`a6d8908`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/{spec-expansion,research-engine}` and `C:/Users/Ayush/Desktop/ef-wt/task-079-spec-matrix-generators`
- **Governing architecture documents:** `spec-expansion.md`, `knowledge-database.md`, `build-pipeline.md`, `security-and-governance.md`, `prompt-contracts.md`, `schema/state.sql`, `schema/global.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 079–082`).

## 2. Units inspected
- `Task 079` (`f19582e` + uncommitted worktree diff in `task-079-spec-matrix-generators`), `Task 080` (`0f5e3d9`), `Task 081` (`24fe966`), `Task 082` (`a6d8908`).

## 3. Files inspected
- `schema/state.sql` (`lines 1–160`)
- `IMPLEMENTATION_TASKS.md` (`lines 4829–5074`)
- `packages/spec-expansion/package.json`
- `packages/spec-expansion/src/generators/{persistence.ts,collapse.ts}` (both on `harness/integration` and in `task-079-spec-matrix-generators`)
- `packages/spec-expansion/src/filler/{pipeline.ts,state-graph.ts}`
- `packages/spec-expansion/src/contradictions/{engine.ts,z3-solver.ts}`
- `packages/research-engine/package.json`
- `packages/research-engine/src/{feature-research-orchestrator.ts,installed-type-api-verifier.ts,research-fact-cache.ts}`

## 4. Architecture documents consulted
- `spec-expansion.md` (12 coverage matrices, scoped-rule collapse, 3-pass cell filling, EARS + `oracle_sketch`, 5-layer contradiction engine with Z3 WASM minimal UNSAT core)
- `schema/state.sql` (`node_kinds`, `edge_types` extensible lookup table, `requirements` view)
- `schema/global.sql` (`research_cache` table + CAS-backed `artifact_hash`)
- `build-pipeline.md` & `security-and-governance.md` (`SecureDocFetcher`, HTML/Unicode quarantine, `.d.ts` installed-type supremacy)

## 5. Contracts and signatures discovered
- `MatrixGeneratorRegistry`, `ScopedRuleCollapser.collapse(run): CollapsedMatrices`, `MatrixCellPersistenceRepo.persist(graph, run, collapsed): PersistStats` (`079`)
- `OrderedCellFillerPipeline.run(input: FillerRunInput): FillerRunResult`, `ProposedRequirementReviewQueue`, `EarsOracleValidator` (`080`)
- `FiveLayerContradictionEngine.check(req): ContradictionReport`, `Z3UnsatCoreSolver.solve(problem): Z3SolveResult` (`081`)
- `FeatureResearchOrchestrator.research(req): Promise<ResearchRunResult>`, `RiskTriggeredTopicGenerator`, `TokenBasedQuoteMatcher`, `InstalledTypeApiVerifier`, `ResearchFactCache` (`082`)

## 6. Confirmed findings
- **F-034** (**CRITICAL**) — Foreign-key crashes on `edges.type REFERENCES edge_types(type)` in `state.db`: `Task 079` writes `type = 'expands'`, `Task 081` writes `type = 'contradicts'`, and `Task 082` writes `type = 'informs'`, none of which are seeded in `schema/state.sql` `edge_types` (`state.sql:64-67`); against real `ProjectStateDb` with `PRAGMA foreign_keys = ON`, all three throw `SQLITE_CONSTRAINT_FOREIGNKEY`.
- **F-035** (**CRITICAL**) — `packages/spec-expansion` (`Tasks 079–081`) is missing `task-079`'s uncommitted bugfixes on `harness/integration` (`ScopedRuleCollapser` `< 47` cap + first-cell anchor bug; `MatrixCellPersistenceRepo` inserting `matrix_manifest`/`matrix_group`/unfilled `matrix_cell` as active `rule`/`spec_item` rows that pollute the `requirements` SQL view; stringified `fields` in `contentHash`), disconnects `079` ↔ `080` ↔ `081` (`081` calls nonexistent `matrices.listCells()` and `filler.listMaterializedRequirements()` and reads nonexistent `fields.selectedOptionId`/`fields.groupId` instead of `discovery`'s `fields.value`/`fields.criterion`), runs synchronous model ports in `080` and `081`, and leaves `Z3UnsatCoreSolver` (`081`) on a hand-rolled exponential DPLL fallback instead of the installed `"z3-solver": "^5.4.1"` WASM package.
- **F-036** (**HIGH**) — `packages/research-engine` (`Task 082`) stores `CachedResearchRecord` payloads (`facts`, `sourceExcerpt`) ONLY in an in-memory `Map` (`this.bodies` in `research-fact-cache.ts:57,101,122`), losing 100% of cached research facts across daemon restarts despite writing metadata to `global.db.research_cache`, imports `"typescript"` at runtime while declaring it only in `devDependencies`, and defines `SecureDocFetcherPort.fetchDocs(url, { role })` incompatible with `Task 045` `SecureDocFetcher`.

## 7. Unverified findings
- None (`0` unverified; all 16/16 dirty worktrees across the entire repo have now been inspected and accounted for!).

## 8. Producer-consumer relationships
- `packages/discovery` (`069–075`) + `corpus` (`076–077`) → `packages/spec-expansion` (`079–081`) → `packages/research-engine` (`082`) & `packages/planner` (`083–095`).
- `packages/sandbox` (`045` `SecureDocFetcher`) + `packages/db` (`014` `GlobalBrokerDb`, `017` `KnowledgeGraphRepo`, `028` `CasBlobStore`) → `packages/research-engine` (`082`).

## 9. Defects and missing integrations
- Uncommitted `task-079` fixes absent on `harness/integration` and `task/079` branch tip.
- Missing `edge_types` rows (`expands`, `contradicts`, `informs`) in `state.db` bootstrap/migrations.
- Broken intra-package calls (`listCells`, `listMaterializedRequirements`, `selectedOptionId`/`groupId`) across `079`, `080`, `081` and `discovery`.
- Volatile RAM-only `this.bodies` map in `ResearchFactCache` (`082`).

## 10. Tests and verification performed
- Diffed `integration` vs `task-079-spec-matrix-generators` on `persistence.ts` and `collapse.ts`; inspected `pipeline.ts`, `state-graph.ts`, `engine.ts`, `z3-solver.ts`, `feature-research-orchestrator.ts`, `installed-type-api-verifier.ts`, and `research-fact-cache.ts` against `schema/state.sql` and `schema/global.sql`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `packages/planner` merged M2 submodules (`Tasks 083–089`: `system-arch`, `feature-arch`, `views-export`, `views-import`, `revisions`, `slicer`, `rule-matching`) — next in `pass-03/chunk-004`.

---

### Report: `pass-03/chunk-004.md`

# Pass 03 — Chunk 004: Planner M2 Architecture, Views Export/Import, Revisions, Slicer & Rule Matching (`Tasks 083–089`)

## 1. Chunk identification and scope
- **Pass number:** Pass 03
- **Chunk ID:** `pass-03/chunk-004`
- **Unit IDs:** `Task 083`, `Task 084`, `Task 085`, `Task 086`, `Task 087`, `Task 088`, `Task 089` (`packages/planner` merged M2 half)
- **Branches and commits:**
  - `task/083-system-architecture-synthesizer` (`e753d6f`, merged into `harness/integration`)
  - `task/084-feature-architecture-wireframes` (`8ce7ede`, merged into `harness/integration`)
  - `task/085-knowledge-views-exporter` (`b104c7b`, merged into `harness/integration`)
  - `task/086-markdown-direct-edit-importer` (`8adf0a5`, merged into `harness/integration`)
  - `task/087-hybrid-revision-impact-engine` (`a1e4945`, merged into `harness/integration`)
  - `task/088-knowledge-packet-slicer` (`c8cf1f8`, merged into `harness/integration`)
  - `task/089-rule-matching-pull-to-push` (`cde3a46`, merged into `harness/integration`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/planner`
- **Governing architecture documents:** `build-pipeline.md`, `knowledge-database.md`, `planning-and-crew.md`, `verification-and-runtime.md`, `prompt-contracts.md`, `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 083–089`).

## 2. Units inspected
- `Task 083` (`e753d6f`), `Task 084` (`8ce7ede`), `Task 085` (`b104c7b`), `Task 086` (`8adf0a5`), `Task 087` (`a1e4945`), `Task 088` (`c8cf1f8`), `Task 089` (`cde3a46`).

## 3. Files inspected
- `packages/planner/package.json`
- `packages/planner/src/system-arch/{synthesizer.ts,skeleton-lock.ts}` (`083`)
- `packages/planner/src/feature-arch/{synthesizer.ts,skeleton-lock.ts}` (`084`)
- `packages/planner/src/views-export/{ef-node-marker.ts,exporter.ts}` (`085`)
- `packages/planner/src/views-import/{markers.ts,manifest.ts,importer.ts}` (`086`)
- `packages/planner/src/revisions/engine.ts` (`087`)
- `packages/planner/src/slicer/{slicer.ts,skills.ts,types.ts}` (`088`)
- `packages/planner/src/rule-matching/{kb-pull-tool-handlers.ts,pull-to-push-feedback-analyzer.ts}` (`089`)
- `schema/state.sql` (`lines 250–360`)

## 4. Architecture documents consulted
- `knowledge-database.md` (`.harness/views/` Markdown export/import round-trip, `<!-- ef:node -->` markers, `ef-fields` YAML, `.manifest.json`, `Must`/`Should`/`Could` brief slicing, `kb.*` pull tools, pull-to-push promotion, hybrid revision impact walk)
- `build-pipeline.md` (`system-architect@1`, upfront skeleton lock, `feature-architect@1` JIT wave synthesis)
- `schema/state.sql` (`names` trigger from `fields.names`, `task_holds.reason`)

## 5. Contracts and signatures discovered
- `SystemArchitectureSynthesizer.synthesize(input): Promise<SynthesisResult>` & `SkeletonLockEnforcer` (`083`)
- `JitFeatureArchitectureSynthesizer.synthesize(request): SynthesisResult` & `SkeletonLockEnforcer` (`084`)
- `KnowledgeViewExporter.exportAll() / exportIncremental(): Promise<ExportResult>` & `EfNodeMarkerFormatter` (`085`)
- `MarkdownDirectEditImporter.reconcile(): ImportSession` (`086`)
- `HybridRevisionEngine.commitBatch(input): RevisionBatchRecord` (`087`)
- `KnowledgePacketSlicer.compile(graph, request): CompiledBrief` (`088`)
- `KbPullToolHandlers.register(server)` & `PullToPushFeedbackAnalyzer.run(input, hook)` (`089`)

## 6. Confirmed findings
- **F-037** (**CRITICAL**) — `views-export` (`Task 085`) and `views-import` (`Task 086`) are completely incompatible on `.manifest.json` (`{ revision, records }` vs `{ files, nodes }`), `<!-- ef:node -->` opener `base_hash` (`sha256:<64-hex>` vs `/^[0-9a-f]{64}$/`), `<a id="..."></a>` anchor injection (polluting `localProse` in `086`), marker escaping (`\<!--` vs `<!-- ef:escaped`), `ef-fields` YAML serialization, `ExportPauseLock` method names (`pause`/`isPaused` vs `acquire`/`release`), and synchronous `DocImportModel.complete` in `086`.
- **F-038** (**HIGH**) — `system-arch` (`Task 083`) and `feature-arch` (`Task 084`) define duplicate conflicting `SkeletonLockEnforcer` and `DeterministicArchConsistencyGate` classes (`arch_role` vs `role`, `ArchitectureStore` vs `SkeletonSnapshot`), `084` `JitFeatureArchitectureSynthesizer.synthesize` is synchronous without calling `feature-architect@1` or persisting to `state.db` (`persisted: true` is returned on in-memory arrays, and `registeredNames` uses `fields.registeredNames` instead of `schema/state.sql`'s trigger-watched `fields.names`), while `083` `seed()` re-inserts existing `decision`/`spec_item`/`rule` IDs.
- **F-039** (**HIGH**) — Three-way MCP `kb.*` tool-name and band/hold mismatch across `AttemptMcpServer` (`048`), `KnowledgePacketSlicer` (`088` `KB_PULL_TOOL_IDS`: `kb.get`, `kb.contract`, `kb.neighbors`, `kb.why`, lowercase `"must"|"should"|"could"`, `WORKER_LEVELS = ["junior", "senior"]` only), `KbPullToolHandlers` & `PullToPushFeedbackAnalyzer` (`089`: `kb.get_node`, `kb.get_contract`, `kb.list_rules_for_tags`, uppercase `"MUST"|"SHOULD"|"COULD"`, unwired `SlicerPromotionHook`), and `HybridRevisionEngine` (`087`: `task_holds.reason = "revision_in_flight"` instead of `schema/state.sql` & `Task 021`/`107` `"requirement_change"`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `083` (`system-arch`) → `084` (`feature-arch`) → `090–092` (`master-plan`, `feature-plan`, `graph-compiler`).
- `085` (`views-export`) ↔ `086` (`views-import`) → `087` (`revisions`) → `107–108` (`scheduler`, `plan-preview`).
- `078/104` (`skill-vetting`) + `077` (`tag-detector`) → `088` (`slicer`) ↔ `089` (`rule-matching`) ↔ `048` (`mcp-server`).

## 9. Defects and missing integrations
- `packages/planner/package.json` depends only on `@ef-harness/shared-contracts`, `yaml`, and `@parcel/watcher` — missing `@ef-harness/db`, `@ef-harness/discovery`, `@ef-harness/spec-expansion`, `@ef-harness/research-engine`, `@ef-harness/mcp-server`, `@ef-harness/meta-lab`, and `@ef-harness/worker-loop`.
- Broken `.harness/views/` export↔import round-trip (`085` ↔ `086`).
- Broken `kb.*` MCP tool names and band casing (`048` ↔ `088` ↔ `089`).

## 10. Tests and verification performed
- Line-by-line comparison of `views-export/{ef-node-marker.ts,exporter.ts}` vs `views-import/{markers.ts,manifest.ts,importer.ts}`, `system-arch` vs `feature-arch`, `revisions/engine.ts` vs `schema/state.sql`, and `slicer` vs `rule-matching` vs `mcp-server`.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- Unmerged `packages/planner` execution submodules (`Tasks 090–095`: `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, `sequential-runner`) — next in `pass-03/chunk-005`.

---

### Report: `pass-03/chunk-005.md`

# Audit Report — `pass-03/chunk-005` (`Tasks 090–095`: Unmerged `packages/planner` Execution Half)

## 1. Chunk identification and scope
- **Pass:** `Pass 03` (Discovery, Corpus, Spec Expansion, Research Engine, Planner, Intake, M2 Gate)
- **Chunk ID:** `pass-03/chunk-005`
- **Scope:** Unmerged M2 execution & compilation half of `packages/planner`: `master-plan` (`090`), `feature-plan` (`091`), `graph-compiler` (`092`), `phase0` (`093`), `design-system` (`094`), and `sequential-runner` (`095`).
- **Isolation state:** None of `Tasks 090–095` are merged into `harness/integration` (`30f2e9c`). All 6 worktrees are clean (`dirty: 0`) and branched directly off `main` (`6497730`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 090` | `task/090-master-planner-wave-budgets` | `b6b1e95` | `C:/Users/Ayush/Desktop/ef-wt/task-090-master-planner-wave-budgets` | 0 |
| `Task 091` | `task/091-feature-planner-sealed-oracles` | `c779647` | `C:/Users/Ayush/Desktop/ef-wt/task-091-feature-planner-sealed-oracles` | 0 |
| `Task 092` | `task/092-deterministic-graph-compiler` | `95d6eb5` | `C:/Users/Ayush/Desktop/ef-wt/task-092-deterministic-graph-compiler` | 0 |
| `Task 093` | `task/093-phase0-controller-gate0` | `1d460bd` | `C:/Users/Ayush/Desktop/ef-wt/task-093-phase0-controller-gate0` | 0 |
| `Task 094` | `task/094-ui-design-system-pipeline` | `0e553ab` | `C:/Users/Ayush/Desktop/ef-wt/task-094-ui-design-system-pipeline` | 0 |
| `Task 095` | `task/095-sequential-task-dispatcher` | `769e91a` | `C:/Users/Ayush/Desktop/ef-wt/task-095-sequential-task-dispatcher` | 0 |

## 3. Files inspected
- `Task 090`: `packages/planner/src/master-plan/{index.ts,types.ts,ports.ts,master-plan-orchestrator.ts,phase0-recipe-generator.ts,wave-dag-builder.ts,paperwork-budget-envelope-allocator.ts,state-db.ts}`
- `Task 091`: `packages/planner/src/feature-plan/{index.ts,types.ts,ports.ts,jit-feature-planner.ts,independent-oracle-author-sealer.ts,hidden-check-pool-store.ts,relations-to-edges-normalizer.ts,state-db.ts}`
- `Task 092`: `packages/planner/src/graph-compiler/{index.ts,types.ts,ports.ts,compiler.ts,traceability-sql-gate.ts,write-scope-checker.ts,waiver-guard.ts,windows-glob.ts}`
- `Task 093`: `packages/planner/src/phase0/{index.ts,types.ts,ports.ts,controller.ts,verifier.ts,command-runner.ts,installer.ts,state-store.ts}`
- `Task 094`: `packages/planner/src/design-system/{index.ts,types.ts,tokens.ts,contrast.ts,scaffold.ts,styleguide.ts,lint.ts,brownfield.ts}`
- `Task 095`: `packages/planner/src/sequential-runner/{index.ts,types.ts,ports.ts,runner.ts,ready-queue.ts,brief.ts,smoke.ts,state-db.ts}`

## 4. Architecture documents consulted
- `build-pipeline.md` (Step 3a Master Plan, Step 3b Feature Plan & Sealed Oracles, Step 3c Graph Compile, Phase 0 & Gate 0, Step 4 Execute Tasks)
- `planning-and-crew.md`, `ui-design-system.md`, `verification-for-real-apps.md`, `verification-and-isolation.md`
- `database-design.md`, `schema/state.sql`, `schema/queries.sql`
- `prompt-contracts.md` (`master-planner@1`, `feature-planner@1`, `oracle-author@1`)
- `IMPLEMENTATION_TASKS.md` (`lines 5503–5882`)

## 5. Contracts and signatures discovered
- `Task 090` (`master-plan`): `MasterPlanOrchestrator.plan(input: MasterPlanInput): MasterPlan` (sync; expects `features` or `modelOutput` pre-supplied), `Phase0RecipeGenerator.generate(input)`, `WaveDagBuilder.build(features, options)`, `PaperworkBudgetEnvelopeAllocator.allocate(input)`, `MasterPlanStore.open(path)` (`DatabaseSync` with 6 custom tables). `ProjectKind = "web_saas" | "headless_cli" | "api" | "brownfield"`, `TaskLevel = "junior" | "mid" | "senior" | "manager"`.
- `Task 091` (`feature-plan`): `JitFeaturePlanner.plan(input)` (sync `PlannerOracleModel.complete`), `IndependentOracleAuthorSealer.author(input)` (sync `PlannerOracleModel.complete`), `HiddenCheckPoolStore`, `RelationsToEdgesNormalizer`, `FeaturePlanDatabase.memory()` (`:memory:`-only `DatabaseSync` with incompatible `nodes`/`edges`/`hidden_checks`/`cas_blobs`). `CrewLevel = "Junior" | "Mid" | "Senior"`.
- `Task 092` (`graph-compiler`): `DeterministicGraphCompiler.compile(input)` (sync 9-pass compiler), `WriteScopeDisjointnessChecker`, `TraceabilitySqlGate.check(input)` (creates throwaway `:memory:` `DatabaseSync` with 11 custom tables), `CompilationWaiverGuard`.
- `Task 093` (`phase0`): `Phase0ExecutionController.run(options): Promise<Phase0RunResult>`, `FoundationGate0Verifier.verify(options): Promise<Gate0Receipt>`, `Phase0StateStore.open(file)` (raw `DatabaseSync` creating 8 `phase0_*` tables), `NodeCommandRunner` (unsandboxed `child_process.spawn`), `LocalKernelPackageInstaller.install(req): InstallResult` (sync fake lockfile string builder).
- `Task 094` (`design-system`): `LookAndFeelInterviewFlow`, `W3cDesignTokenGenerator`, `DesignSystemScaffoldBuilder` (`ProjectKind = "web" | "cli" | "api" | "headless"`, `HEADLESS = new Set(["cli", "api", "headless"])`), `StyleguideRouteVerifier.verify(input)` (defaults to `OfflineUiPlaywrightContractVerifier` + `MemoryCasBlobStore`), `DesignTokenLintRuleset`.
- `Task 095` (`sequential-runner`): `SequentialBuildRunner.runUntilIdle()`, `ExplicitFirstReadyQueue`, `AttemptBriefMaterializer`, `PostMergeSmokeChecker` (`BarrelTypecheck` + `FastUnitSmoke`), `StateDb.open(filename)` (raw `DatabaseSync` + `splitWords` UDF + `sequential_attempt_receipts`).

## 6. Confirmed findings
- **`F-040` (`HIGH` / `CONTRACT_MISMATCH`):** Unexported `packages/planner` submodules (`090–095, 102, 106–108`), conflicting `ProjectKind` enums (`090`/`093` `"web_saas" | "headless_cli"` vs `094` `"web" | "cli" | "headless"` causing `headless_cli` to scaffold React UI!), conflicting `CrewLevel` casing/values across 6 planner units, and synchronous `PlannerOracleModel` vs async `ModelProtocolAdapter` (`053`).
- **`F-041` (`CRITICAL` / `SCHEMA_MISMATCH`):** Five private SQLite schemas inside `packages/planner` (`090`, `091`, `092`, `093`, `095`) bypass `@ef-harness/db` single-writer `SqliteConnection`, collide with `schema/state.sql` (`091`'s `nodes`/`edges` DDL crashes on real `state.db`, `090`'s `budgets` rows violate `Task 023` hierarchy, `091`'s `hidden_checks` bypasses `nodes(kind='oracle')` + `CasBlobStore` `028` + `BlindCheckBinder` `056`), and `092` calls nonexistent methods on `081`, `088`, and `091`.
- **`F-042` (`CRITICAL` / `SECURITY`):** `Phase0ExecutionController` (`093`) executes unsandboxed `child_process.spawn` (`NodeCommandRunner`) with single-PID `process.kill` instead of Windows Job Object + Tier C sandbox (`040`/`047`), uses a non-installing synchronous `LocalKernelPackageInstaller` instead of `Task 046`, and `StyleguideRouteVerifier` (`094`) uses regex + solid-color PNG `OfflineUiPlaywrightContractVerifier` + bare-hex `MemoryCasBlobStore` instead of `Task 057` Playwright + `Task 028` CAS.
- **`F-043` (`CRITICAL` / `RUNTIME_WIRING`):** `SequentialBuildRunner` (`095`) defaults to regex toy `LocalStaticAudit`/`LocalCleanVerifier`/`LocalFeatureIntegrator` (`journeyPassed: journeys === 0` fails every feature with a journey!) and non-executing `PostMergeSmokeChecker` (`BarrelTypecheck` regex-checks `src/index.ts` only; `FastUnitSmoke` checks `smoke/cases.json` only), plus bare-hex `content_hash` and `splitWords` UDF in `sequential-runner/state-db.ts`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 083` (`SystemArchitectureSynthesizer`) → `Task 090` (`MasterPlanOrchestrator`) → `Task 093` (`Phase0ExecutionController`) + `Task 094` (`DesignSystemScaffoldBuilder` / `StyleguideRouteVerifier`).
- `Task 084` (`JitFeatureArchitectureSynthesizer`) → `Task 091` (`JitFeaturePlanner` + `IndependentOracleAuthorSealer`) → `Task 092` (`DeterministicGraphCompiler`) → `Task 095` (`SequentialBuildRunner`) + `Task 055`/`056` (`CleanVerifierRunner` / `BlindCheckBinder`).
- `Task 020–023` (`db` runtime/holds/lifecycle/budgets) + `Task 038–039` (`git-engine`) + `Task 046–048` (`sandbox`/`mcp-server`) + `Task 053–060` (`worker-loop`/`completeness-gate`/`verifier`) → `Task 093` & `Task 095`.

## 9. Defects and missing integrations
- None of `Tasks 090–095` import `@ef-harness/db`, `@ef-harness/git-engine`, `@ef-harness/sandbox`, `@ef-harness/worker-loop`, `@ef-harness/completeness-gate`, `@ef-harness/verifier`, or `@ef-harness/integrator`; all cross-package boundaries are mocked behind incompatible sync/toy local ports (`F-040`..`F-043`).
- `packages/planner/src/index.ts` does not re-export `master-plan`, `feature-plan`, `graph-compiler`, `phase0`, `design-system`, or `sequential-runner` (`F-040`).

## 10. Tests and verification performed
- Inspected unit test suites across `packages/planner/tests/{master-plan,feature-plan,graph-compiler,phase0,design-system,sequential-runner}/**`: tests exercise isolated local stores (`MasterPlanStore`, `FeaturePlanDatabase.memory()`, `:memory:` `TraceabilitySqlGate`, `Phase0StateStore`, `OfflineUiPlaywrightContractVerifier`, `SequentialBuildRunner` `StateDb`) rather than shared `ProjectStateDb` (`014`), `CleanVerifierRunner` (`055`), or `NativeWorkerLoop` (`053`).

## 11. Unresolved questions
- None for `Tasks 090–095`; remaining `packages/planner` units (`102, 106–108`) and `packages/intake` + `096, 101, 105` are scheduled next in `pass-03/chunk-006` and `pass-03/chunk-007`.

## 12. Explicit files and relationships still requiring inspection
- `pass-03/chunk-006`: `Tasks 102, 106–108` (`packages/planner/src/{specialists,crew-levels,scheduler,plan-preview}/**` vs `088, 090–092, 095`).
- `pass-03/chunk-007`: `Tasks 097–100, 096, 101, 105` (`packages/intake/**`, `packages/integrator/src/{feature-integrator,final-audit}/**`, `tests/e2e/m2-exit-gate/**`).

---

### Report: `pass-03/chunk-006.md`

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

---

### Report: `pass-03/chunk-007.md`

# Audit Report — `pass-03/chunk-007` (`Tasks 096–101, 105`: `packages/intake`, M2 `packages/integrator` & M2 Kitchen Exit Gate)

## 1. Chunk identification and scope
- **Pass:** `Pass 03` (Final chunk `7 / 7` — completes Pass 03!)
- **Chunk ID:** `pass-03/chunk-007`
- **Scope:** All 4 `packages/intake` units (`097–100`), M2 `packages/integrator` units (`096` `feature-integrator`, `101` `final-audit`), and `Task 105` M2 Kitchen Exit Gate (`tests/e2e/m2-exit-gate/**`, `benchmarks/m2-kitchen-e2e/**`).
- **Isolation state:** All 7 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 096` | `task/096-feature-integrator-engine` | `f69c07d` | `C:/Users/Ayush/Desktop/ef-wt/task-096-feature-integrator-engine` | 0 |
| `Task 097` | `task/097-external-intake-converters` | `f41cfd0` | `C:/Users/Ayush/Desktop/ef-wt/task-097-external-intake-converters` | 0 |
| `Task 098` | `task/098-intake-chunker-openapi-importer` | `f266844` | `C:/Users/Ayush/Desktop/ef-wt/task-098-intake-chunker-openapi-importer` | 0 |
| `Task 099` | `task/099-brand-asset-sanitizer-registry` | `8c8e2f7` | `C:/Users/Ayush/Desktop/ef-wt/task-099-brand-asset-sanitizer-registry` | 0 |
| `Task 100` | `task/100-bug-har-scrubber-triage` | `74e4e4a` | `C:/Users/Ayush/Desktop/ef-wt/task-100-bug-har-scrubber-triage` | 0 |
| `Task 101` | `task/101-completion-wave-final-audit` | `8660af4` | `C:/Users/Ayush/Desktop/ef-wt/task-101-completion-wave-final-audit` | 0 |
| `Task 105` | `task/105-m2-kitchen-exit-gate` | `f8e06c0` | `C:/Users/Ayush/Desktop/ef-wt/task-105-m2-kitchen-exit-gate` | 0 |

## 3. Files inspected
- `Task 097`: `packages/intake/src/{index.ts,converters/sandboxed-document-converter.ts,converters/types.ts,converters/ports/sandbox-runner.ts}`
- `Task 098`: `packages/intake/src/extraction/{pipeline.ts,types.ts}`
- `Task 099`: `packages/intake/src/assets/{brand-asset-registry.ts,sqlite-brand-state.ts}`
- `Task 100`: `packages/intake/src/bug-scrubber/triager.ts`
- `Task 096`: `packages/integrator/src/{index.ts,feature-integrator/engine.ts,feature-integrator/journey-gate.ts}`
- `Task 101`: `packages/integrator/src/final-audit/{completion-wave-controller.ts,state-db.ts}`
- `Task 105`: `tests/e2e/{package.json,tsconfig.json}`, `tests/e2e/m2-exit-gate/{pipeline.ts,runner.ts}`

## 4. Architecture documents consulted
- `external-intake.md`, `parallel-feature-integration.md`, `build-pipeline.md`, `completeness-gate.md`, `verification-for-real-apps.md`, `roadmap.md`, `opening-prompts.md`
- `prompt-contracts.md` (`feature-integrator@1`, `intake-extractor@1`, `issue-triage@1`, `final-project-auditor@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 5883–6248`, `6436–6503`)

## 5. Contracts and signatures discovered
- `Task 097`: `SandboxedDocumentConverter.convert(req): Promise<SandboxConversion>` emitting `NormalizedDocument` (`schema: "normalized-document@1"`, `fileName`, `mediaType`, `blocks[].locator: DocumentLocator`).
- `Task 098`: `StructuralDocumentChunker.chunk(doc)`, `IntakeExtractionPipeline.run(req)` (sync `ExtractorModel.complete`, expects incompatible `NormalizedDocument` with `sourceId`, `sourceName`, `mimeType`, `pageCount`, flat `block.{page,paragraph,line,level,section}`), `LiveSpeechPrecedenceReconciler`, `DeterministicSchemaContractImporter`.
- `Task 099`: `BrandAssetSanitizer`, `FontLicenseInspector`, `BrandAssetRegistry` (sync `CasBlobStorePort.{putBlob,getBlob,verifyBlobIntegrity}`, `SqliteBrandAssetState`), `Phase0BrandAssetsGenerator`, `DeterministicPlaceholderGenerator`.
- `Task 100`: `HarAndLogScrubber`, `SourceMapStackMapper`, `ToolLessIssueTriager.triage(input)` (sync `ToolLessModel.complete`), `SymptomCardStore`.
- `Task 096`: `FeatureIntegratorEngine.integrate(req): FeatureIntegrationResult` (sync; `passthroughBinder`, in-memory `CodeSnapshot` journey/viewport/audit evaluation), `MergeTreePreflightScanner`, `AggregatedWiringTaskBuilder`, `FeatureJourneyGate`.
- `Task 101`: `CompletionWaveController.run(req): Promise<CompletionWaveResult>` (`ProjectKind = "web" | "cli" | "openapi"`, `FinalAuditStore` custom SQLite tables, custom `BudgetLedgerPort`), `DeterministicRepoAuditor`, `LiveRouteCrawler`, `ShardedFinalProjectAuditor`, `LandingSummaryGenerator`.
- `Task 105`: `runCertifiedReplay(root): Promise<M2ExitGateReport>`, `executePipeline(harnessRoot, projectDir)` (static fixture copy, `.ts` relative imports).

## 6. Confirmed findings
- **`F-046` (`CRITICAL` / `CONTRACT_MISMATCH`):** `packages/intake` (`097–100`) stub barrel (`packages/intake/src/index.ts`), `NormalizedDocument` & locator structural mismatch between `097` (`converters`) and `098` (`extraction`), unsandboxed/duplicate `NodeSandboxRunner` (`097`), sync `CasBlobStorePort` + rogue `SqliteBrandAssetState` + missing `suggestBrandColors` (`099`), and sync `ExtractorModel`/`ToolLessModel` (`098`/`100`) vs async `ModelProtocolAdapter` (`053`).
- **`F-047` (`CRITICAL` / `RUNTIME_WIRING`):** `packages/integrator` (`096, 101`) stub barrel (`packages/integrator/src/index.ts`), synchronous `FeatureIntegratorEngine` (`096`) running in-memory `CodeSnapshot` callbacks + `passthroughBinder` instead of async `CleanVerifierRunner` (`055`), `BlindCheckBinder` (`056`), `UiPlaywrightContractVerifier` (`057`), `CompletenessGateRunner` (`054`), `RuntimeLifecycleRepo` (`022`), and `GitRefCasUpdater` (`039`); and `CompletionWaveController` (`101`) using private `FinalAuditStore` SQLite tables, incompatible `ProjectKind = "web" | "cli" | "openapi"`, and nonexistent `BudgetLedger` methods (`ensureCompletionScopes`, `reserveAcrossScopes`, `getBudgetRemaining`).
- **`F-048` (`CRITICAL` / `TEST_GAP`):** `Task 105` M2 Kitchen Exit Gate (`tests/e2e/m2-exit-gate/pipeline.ts`) imports **zero** `@ef-harness/*` M2 packages — it copies pre-baked static HTML/JS from `benchmarks/m2-kitchen-e2e/fixture/`, reads hardcoded `sequential-baseline.json` metrics, uses an identity `ef_search_text` UDF + bare-hex `content_hash`, sits outside `tests/e2e/tsconfig.json`'s `"include": ["src/**/*.ts"]` with illegal `.ts` import extensions under `NodeNext`, and lacks root `test:m2-exit-gate:{replay,live}` scripts.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 040`/`045` (`sandbox`) + `Task 028` (`CasBlobStore`) → `Task 097` (`converters`) → `Task 098` (`extraction`) → `Task 069` (`discovery`) / `Task 083` (`system-arch`) / `Task 087` (`revisions`).
- `Task 099` (`assets`) → `Task 093` (`phase0`) + `Task 094` (`design-system`) + `Task 174` (`ui-checks`).
- `Task 100` (`bug-scrubber`) → `Task 169` (`brownfield`) + `Task 182` (`investigations`).
- `Task 095` (`sequential-runner`) → `Task 096` (`feature-integrator`) → `Task 111` (`merge-queue`) / `Task 101` (`final-audit`) → `Task 105` (`m2-exit-gate`) / `Task 172` (`landing`).

## 9. Defects and missing integrations
- `097` output cannot be consumed by `098` without a canonical `NormalizedDocument` adapter/unification (`F-046`).
- `096` and `101` bypass real sandboxed test/Playwright/verifier infrastructure (`F-047`), and `095` (`SequentialBuildRunner`) never calls real `096` or `101` (`F-043`).
- `105` certifies a hand-written static fixture app rather than an app generated by the M2 harness pipeline (`F-048`).

## 10. Tests and verification performed
- Reviewed test suites across `packages/intake/tests/**`, `packages/integrator/tests/{feature-integrator,final-audit}/**`, and `tests/e2e/tests/m2-exit-gate.test.ts`; inspected `tests/e2e/tsconfig.json` and `tests/e2e/package.json`.

## 11. Unresolved questions
- Interaction of `096` and `101` with M3/M5 `packages/integrator` siblings (`109–112, 129, 171–174`) — scheduled immediately next in `pass-04/chunk-001` and `pass-04/chunk-002`.

## 12. Explicit files and relationships still requiring inspection
- **Pass 03 is now 100% COMPLETE (`Tasks 069–108`).**
- Next: `pass-04/chunk-001` (`Tasks 109–112, 129` — `packages/integrator` handoffs, feature-branches, merge-queue, CCR, undo).

---

### Report: `pass-04/chunk-001.md`

# Audit Report — `pass-04/chunk-001` (`Tasks 109–112, 129`: `packages/integrator` Handoffs, Feature Branches, Merge Queue, CCR & Feature Undo)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-001`
- **Scope:** M3 `packages/integrator` submodules: `handoffs` (`109`), `feature-branches` (`110`), `merge-queue` (`111`), `ccr` (`112`), and `undo` (`129`), cross-checked against M2 `integrator` (`096, 101`), `packages/db` (`014–023, 028`), `packages/git-engine` (`038, 039`), `packages/mcp-server` (`048`), and `packages/planner` (`083, 087, 088, 108`).
- **Isolation state:** All 5 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 109` | `task/109-artifact-handoff-mailbox-engine` | `989041d` | `C:/Users/Ayush/Desktop/ef-wt/task-109-artifact-handoff-mailbox-engine` | 0 |
| `Task 110` | `task/110-parallel-feature-branches-migrations` | `08a8f36` | `C:/Users/Ayush/Desktop/ef-wt/task-110-parallel-feature-branches-migrations` | 0 |
| `Task 111` | `task/111-project-merge-queue-integrator` | `72b37e6` | `C:/Users/Ayush/Desktop/ef-wt/task-111-project-merge-queue-integrator` | 0 |
| `Task 112` | `task/112-contract-change-request-pipeline` | `5ed8f81` | `C:/Users/Ayush/Desktop/ef-wt/task-112-contract-change-request-pipeline` | 0 |
| `Task 129` | `task/129-planned-feature-undo-engine` | `94ca48c` | `C:/Users/Ayush/Desktop/ef-wt/task-129-planned-feature-undo-engine` | 0 |

## 3. Files inspected
- `Task 109`: `packages/integrator/src/handoffs/{ddl.ts,mcp-surface.ts,index.ts}`
- `Task 110`: `packages/integrator/src/feature-branches/{ddl.ts,branch-manager.ts,state-db.ts,index.ts}`
- `Task 111`: `packages/integrator/src/merge-queue/{engine.ts,queue.ts,gate.ts,state-db.ts,index.ts}`
- `Task 112`: `packages/integrator/src/ccr/{engine.ts,ledger.ts,index.ts}`
- `Task 129`: `packages/integrator/src/undo/{engine.ts,state-db.ts,gate.ts,index.ts}`

## 4. Architecture documents consulted
- `agent-handoffs.md`, `agent-graph-routing.md`, `parallel-feature-integration.md`, `linked-architecture-revisions.md`, `stops-undo-and-reentry.md`, `workspace-and-git.md`
- `prompt-contracts.md` (`project-integrator@1`, `ccr@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 6691–6936`, `7967–8033`)

## 5. Contracts and signatures discovered
- `Task 109`: `ArtifactHandoffStore`, `ReadResultToolHandler`, `HandoffMcpSurface.dispatch(tool, caller, args)` (rejects any tool !== `harness.read_result`), `DurableRoleMailbox`, `WaitGraphCycleDetector`, `OwnerResolutionCoordinator`, `HANDOFF_DDL` (14 private SQLite tables).
- `Task 110`: `ParallelFeatureBranchManager`, `DependencyIntentAggregator`, `MigrationIntentAndConflictLinter`, `SmartBranchFreshnessSync`, `openFeatureBranchStateDb` (6 private SQLite tables including `ref_leases`, `feature_branch_runtime`).
- `Task 111`: `ProjectMergeQueue.{enqueue,drain,recover}`, `ProjectIntegratorEngine.resolve` (sync `ProjectIntegratorModel`), `CombinedRegressionGate.run`, `MergeBatchBisector`, `openMergeQueueStateDb` (5 private SQLite tables including `ref_leases`, `feature_queue_runtime`).
- `Task 112`: `ContractChangeRequestEngine.{submit,submitMany,approve,reject,landQueued}`, `DeterministicSchemaDiffClassifier`, `AdditiveOwnerFastPath`, `BreakingCcrRevisionReopener`, `CcrLedger` (5 private SQLite tables + 12 `Local*` default stand-in ports).
- `Task 129`: `FeatureUndoEngine.{execute,revive}`, `FeatureUndoInventoryAnalyzer`, `CrossFeatureUsageGraphChecker`, `SharedOwnershipTransferPlanner`, `UndoDataRetentionDialog`, `FeatureUndoExecutor`, `KnowledgeGraphPort.open` (6 private `undo_*`/`ref_leases` SQLite tables).

## 6. Confirmed findings
- **`F-049` (`CRITICAL` / `SCHEMA_MISMATCH`):** Five isolated private SQLite schemas (`36` custom tables!) across `packages/integrator` (`109` `HANDOFF_DDL`, `110` `feature_branch_runtime`/`ref_leases`, `111` `merge_queue_items`/`feature_queue_runtime`/`ref_leases`, `112` `CCR_DDL`, `129` `undo_nodes`/`ref_leases`) bypass `@ef-harness/db` single-writer `SqliteConnection`, duplicate `feature_runtime`, `leases`, `edges`, `read_sets`, and `CasBlobStore` (`028`), leave `112` wired to 12 `Local*` mocks instead of `109`/`110`/`111`/`083`/`087`/`108`, leave `109`'s `harness.read_result` unwired in `AttemptMcpServer` (`048`), and store `'undone'` in shadow `undo_nodes` instead of canonical `state.db`.
- **`F-050` (`CRITICAL` / `RUNTIME_WIRING` & `SECURITY`):** `CombinedRegressionGate` (`111`, `merge-queue/gate.ts:90-218`) and `FeatureUndoEngine` (`129`, `undo/gate.ts:13-57`) execute unsandboxed `child_process` commands against hardcoded toy conventions (`node --check *.js` skipping all `.ts`/`.tsx` files, `node build.mjs`, `template/app.sqlite`, `features/*/manifest.json`, `features/**/*.test.js`), while `ProjectIntegratorEngine` (`111`, `merge-queue/engine.ts:82-177`) uses a synchronous `defaultModel` rewriting `features/<id>/manifest.json` instead of async `ModelProtocolAdapter` (`053`) + `CleanVerifierRunner` (`055`) + `HarnessRunEngine` (`047`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 109` (`handoffs`) → `Task 048` (`AttemptMcpServer` `harness.read_result`), `Task 112` (`CCR`), `Task 116` (`QuestionArbiter`), `Task 126` (`WorkerInspector`).
- `Task 096` (`FeatureIntegratorEngine`) + `Task 110` (`feature-branches`) → `Task 111` (`ProjectMergeQueue`) → `Task 129` (`FeatureUndoEngine`) + `Task 160` (`LiveAppPreview`).
- `Task 083` (`SkeletonLockEnforcer`) + `Task 087` (`HybridRevisionEngine`) + `Task 108` (`RevisionAutoStartPolicy`) + `Task 109`–`111` → `Task 112` (`CCR`).

## 9. Defects and missing integrations
- Even within `packages/integrator`, `096`, `101`, `109`, `110`, `111`, `112`, and `129` do not import one another or share a common database schema (`F-047`, `F-049`, `F-050`).
- `packages/integrator/src/index.ts` exports none of these modules (`F-047`, `F-049`).

## 10. Tests and verification performed
- Reviewed unit tests across `packages/integrator/tests/{handoffs,feature-branches,merge-queue,ccr,undo}/**`: tests rely on temp repos structured around `build.mjs` and `features/<id>/manifest.json` + local SQLite files.

## 11. Unresolved questions
- Interaction with the remaining 4 `packages/integrator` M5 modules (`171–174`: coexistence-watcher, landing, human-fix, ui-checks) — inspected next in `pass-04/chunk-002`.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-002`: `Tasks 171–174` (`packages/integrator/src/{coexistence,landing,human-fix,ui-checks}/**`).

---

### Report: `pass-04/chunk-002.md`

# Audit Report — `pass-04/chunk-002` (`Tasks 171–174`: `packages/integrator` M5 Coexistence Watcher, Safe Landing, Human Fix & UI Consistency)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-002`
- **Scope:** Remaining 4 M5 `packages/integrator` submodules (`171` `coexistence-watcher`, `172` `landing`, `173` `human-fix`, `174` `ui-checks`), completing 100% of `packages/integrator` (`11 / 11` units).
- **Isolation state:** All 4 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`). (Note: branch names in `ef-wt` are `task/171-editor-coexistence-watcher`, `task/172-safe-landing-engine`, `task/173-human-fixed-it-myself`, `task/174-ui-consistency-pipeline`.)

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 171` | `task/171-editor-coexistence-watcher` | `84fc19a` | `C:/Users/Ayush/Desktop/ef-wt/task-171-editor-coexistence-watcher` | 0 |
| `Task 172` | `task/172-safe-landing-engine` | `7d47942` | `C:/Users/Ayush/Desktop/ef-wt/task-172-safe-landing-engine` | 0 |
| `Task 173` | `task/173-human-fixed-it-myself` | `0583866` | `C:/Users/Ayush/Desktop/ef-wt/task-173-human-fixed-it-myself` | 0 |
| `Task 174` | `task/174-ui-consistency-pipeline` | `a885fb8` | `C:/Users/Ayush/Desktop/ef-wt/task-174-ui-consistency-pipeline` | 0 |

## 3. Files inspected
- `Task 171`: `packages/integrator/package.json`, `packages/integrator/src/coexistence-watcher/{editor-coexistence-watcher.ts,watch-backend.ts,active-scope-overlap-detector.ts}`
- `Task 172`: `packages/integrator/src/landing/{zero-stash-executor.ts,receipt-store.ts}`
- `Task 173`: `packages/integrator/src/human-fix/{flow-engine.ts,state-db.ts}`
- `Task 174`: `packages/integrator/src/ui-checks/{ui-consistency-pipeline.ts,local-ports.ts}`
- Root: `package.json`, `schema/state.sql` (`lines 320–345`)

## 4. Architecture documents consulted
- `editor-coexistence.md`, `stops-undo-and-reentry.md`, `ui-design-system.md`, `verification-for-real-apps.md`, `workspace-and-git.md`
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 10733–11004`)

## 5. Contracts and signatures discovered
- `Task 171`: `EditorCoexistenceWatcher.{start,stop,flushPath}`, `ActiveScopeOverlapDetector.{detectOverlaps,resolveOverlap}` (calls `holds.placeHold(taskId, 'editor_overlap', source) -> { holdId }` and `holds.releaseHold(holdId)`), `ManualLockfileIncludeHandler`, `BaseSyncIntegrationMerger`.
- `Task 172`: `SafeLandingPreFlightAnalyzer.analyze`, `ZeroStashLandingExecutor.execute` (`persistLandingReceipt` in module-global `Map`), `DirtyOverlapFourOptionDialog`, `LandingRollbackSafetyPoint`.
- `Task 173`: `HumanFixFlowEngine.{finishToMerge,handBackToAi,receipt}`, `HumanFixStateDb.open(filePath)` (3 custom `hf_*` tables), `HumanFixTakeoverController`, `HumanEditWorkspacePicker`, `HumanFixCleanVerifier`, `HumanScopeAndContractReconciler`, `HumanVerificationOverridePolicy`.
- `Task 174`: `UiConsistencyPipeline.run(input)` (`input.projectKind === "ui"`, pre-computed `routeAudits`/`axeViolations`/`rhythmMetrics`/`screenshots`, `InMemoryCasStore`), `DuplicateComponentDetector`, `ThreeWidthLayoutAndTapTargetChecker`, `CrossScreenRhythmAuditor`, `ApprovedScreenshotRegressionRunner`.

## 6. Confirmed findings
- **`F-051` (`HIGH` / `CONTRACT_MISMATCH` & `SCHEMA_MISMATCH`):** `EditorCoexistenceWatcher` (`171`), `ZeroStashLandingExecutor` (`172`), and `HumanFixFlowEngine` (`173`) seam & safety defects: `171` omits `@parcel/watcher` from `packages/integrator/package.json` `dependencies` (walking monorepo `node_modules` devDependencies) and calls `holds.placeHold(taskId, 'editor_overlap', ...)` / `holds.releaseHold(holdId)` mismatching `Task 021` `HoldsSubmissionsRepo` (composite `(task, reason, source)` PK, no `holdId`, closed `HoldReason` union); `172` stores landing receipts only in a volatile module-global `Map` (`receipt-store.ts:4-18` instead of `state.db`), runs `git checkout <targetBranch>` directly in the developer's checkout (`zero-stash-executor.ts:136,149`), updates `harness/integration` without CAS/lease (`line 195`), and deletes **all** `refs/heads/harness/f/*` branches indiscriminately (`lines 198-212`); `173` opens a 7th private SQLite schema (`HumanFixStateDb` `hf_tasks`/`hf_contracts`/`hf_active_workers`) instead of `@ef-harness/db`.
- **`F-052` (`HIGH` / `RUNTIME_WIRING`):** `UiConsistencyPipeline` (`174`) introduces a 5th incompatible `ProjectKind` string (`"ui"`, `ui-consistency-pipeline.ts:28`), never invokes `UiPlaywrightContractVerifier` (`057`) to capture 3-width bounding boxes, `axe-core` results, rhythm metrics, or screenshots (expecting pre-computed arrays on `input`), writes a placeholder 1×1 red pixel into `InMemoryCasStore` (`lines 120-126`) instead of `CasBlobStore` (`028`), and defaults all 5 ports (`StaticAuditGate`, `DesignTokenLint`, `BrandAssetRegistry`, `BeforeAfterBaseline`, `TasteReviewer`) to disconnected stubs (`local-ports.ts:55-61`).

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 021` (`HoldsSubmissionsRepo`) + `Task 035`/`039` (`git-engine`) + `Task 110`/`111` → `Task 171` (`coexistence-watcher`) → `Task 172` (`landing`) + `Task 173` (`human-fix`).
- `Task 172` (`landing` receipts) → `Task 130` (`ReEntryReconciler`) + `Task 178` (`ship-deploy`).
- `Task 054` + `Task 057` + `Task 094` + `Task 099` + `Task 102` + `Task 161` → `Task 174` (`ui-checks`) → `Task 095`/`096`/`101`/`111`.

## 9. Defects and missing integrations
- All 11 `packages/integrator` units (`096, 101, 109–112, 129, 171–174`) are now audited; none are exported from `packages/integrator/src/index.ts`, and 7 of them open private SQLite databases (`101, 109, 110, 111, 112, 129, 173`) while `172` and `174` keep state/CAS in volatile RAM (`F-047`, `F-049`..`F-052`).

## 10. Tests and verification performed
- Reviewed test suites across `packages/integrator/tests/{coexistence-watcher,landing,human-fix,ui-checks}/**`.

## 11. Unresolved questions
- How `Task 130` (`welcome-back` reconciliation) consumes `171`–`173` — scheduled immediately next in `pass-04/chunk-003`.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-003`: `Tasks 113–116, 130` (`packages/steering` router, dispatcher, holds, question-arbiter + re-entry reconciliation).

---

### Report: `pass-04/chunk-003.md`

# Audit Report — `pass-04/chunk-003` (`Tasks 113–116, 130`: `packages/steering` & Re-Entry Reconciliation)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-003`
- **Scope:** All 5 `packages/steering` units (`113` `router`, `114` `dispatcher`, `115` `holds`, `116` `question-arbiter`, `130` `reentry` + `apps/renderer/src/cockpit/welcome-back`), completing 100% of `packages/steering`.
- **Isolation state:** All 5 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 113` | `task/113-message-sequencing-intent-router` | `4c86c46` | `C:/Users/Ayush/Desktop/ef-wt/task-113-message-sequencing-intent-router` | 0 |
| `Task 114` | `task/114-four-route-steering-dispatcher` | `05609eb` | `C:/Users/Ayush/Desktop/ef-wt/task-114-four-route-steering-dispatcher` | 0 |
| `Task 115` | `task/115-multi-interpretation-hold-engine` | `2c95cd8` | `C:/Users/Ayush/Desktop/ef-wt/task-115-multi-interpretation-hold-engine` | 0 |
| `Task 116` | `task/116-shared-question-queue-arbiter` | `2370d7a` | `C:/Users/Ayush/Desktop/ef-wt/task-116-shared-question-queue-arbiter` | 0 |
| `Task 130` | `task/130-reentry-reconciliation-welcome-back` | `a92052c` | `C:/Users/Ayush/Desktop/ef-wt/task-130-reentry-reconciliation-welcome-back` | 0 |

## 3. Files inspected
- `Task 113`: `packages/steering/src/{index.ts,router/ddl.ts,router/runtime.ts}`
- `Task 114`: `packages/steering/src/dispatcher/{dispatcher.ts,kernel-stop.ts,types.ts}`
- `Task 115`: `packages/steering/src/holds/{engine.ts,database.ts}`
- `Task 116`: `packages/steering/src/question-arbiter/ddl.ts`
- `Task 130`: `packages/steering/src/reentry/{cold-open-reconciler.ts,state-store.ts}`, `apps/renderer/src/cockpit/welcome-back/welcome-back-screen.ts`

## 4. Architecture documents consulted
- `routing-design.md`, `agent-graph-routing.md`, `stops-undo-and-reentry.md`, `build-cockpit.md`, `editor-coexistence.md`
- `prompt-contracts.md` (`router@1`)
- `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 6937–7199`, `8034–8100`)

## 5. Contracts and signatures discovered
- `Task 113`: `SteeringMessageRouter.{beginInput,observeUi,accept,submit,resume}`, `UnifiedMessageSequencer`, `InputStartFocusSnapshotter`, `RouterShortlistRetriever`, `OrderedMultiClauseExecutor`, `ROUTER_DDL` (6 tables).
- `Task 114`: `FourRouteSteeringDispatcher.{dispatchClauses,dispatchReadOnlyQuery,dispatchExistingFeatureChange,dispatchNewFeatureAddition,dispatchExecutionControl}`, `ImmediateKernelStopController`, `NewFeatureDedupSpawner`, `MidBuildRouteReceipt`.
- `Task 115`: `MultiInterpretationHoldEngine.{holdAmbiguousMessage,noteVerificationFinished,mergeDecision}`, `HoldModeClassifier`, `HoldReasonStackCoordinator`, `AdditiveVsContradictoryResumer`, `HOLD_SCHEMA_SQL` (10 tables).
- `Task 116`: `SharedQuestionArbiter`, `OwnerFirstQuestionFilter`, `QuestionDedupSubscriberStore`, `StaleReplyReconciler`, `QUESTION_ARBITER_DDL` (`qa_*` shadow tables + `TELEMETRY_DDL`).
- `Task 130`: `ColdOpenReconciler.reconcile(input): ColdOpenReport`, `CommitAnsweredQuestionDetector`, `NoRunUntilResumeGate`, `InMemoryReentryStore`, `WelcomeBackScreen.render(model): WelcomeBackView`.

## 6. Confirmed findings
- **`F-053` (`CRITICAL` / `SCHEMA_MISMATCH`):** `packages/steering` (`113–116, 130`) stub barrel (`packages/steering/src/index.ts`), 3 conflicting private SQLite schemas (`113` `ROUTER_DDL` duplicating `outbox`/`outbox_deliveries` + `router_catalog`; `115` `HOLD_SCHEMA_SQL` running `CREATE TABLE task_runtime` / `task_holds` without `IF NOT EXISTS` and crashing on real `state.db`; `116` `QUESTION_ARBITER_DDL` creating `qa_inbox_items`/`qa_inbox_subscribers`/`qa_holds`/`qa_settled_fts` alongside `inbox_items`/`inbox_subscribers` where `inbox_items.status` lacks `'retired'`, plus `TELEMETRY_DDL` inside `state.db`), RAM-only `SteeringRuntime`/`RouteTelemetry` (`114`), and RAM-only `InMemoryReentryStore` (`130` writing invalid `attempts.state = 'CHECKPOINTED'` instead of `'parked'`/`'crashed'`).
- **`F-054` (`CRITICAL` / `CONTRACT_MISMATCH`):** `SteeringMessageRouter.route` (`113`, `router/runtime.ts:203-214`) invokes synchronous `router@1` in `gateModel(...)` and **discards the validated LLM output completely**, substituting regex heuristic `planMessage(...)`; `FourRouteSteeringDispatcher.dispatchReadOnlyQuery` (`114`, `dispatcher/dispatcher.ts:145-150`) throws `SteeringError("READ_ONLY_LLM")` whenever `answer.llmCalls !== 0`, colliding directly with `Task 102` `AskOwnerResponderEngine.answerQuestion` (which invokes `askModel` and omits `llmCalls`); `114` `pauseFeature` (`dispatcher/types.ts:11`, `kernel-stop.ts:164`) writes `USER_PAUSED_REASON = "user_paused"` instead of canonical `"user_pause"`; and `113`–`116`, `130` are completely unwired from each other and from `daemon`/`renderer`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 017`/`018`/`026` (`db`) → `Task 113` (`router`) → `Task 114` (`dispatcher`) + `Task 115` (`holds`) → `Task 116` (`question-arbiter`).
- `Task 087` (`revisions`) + `Task 102` (`ask-owner`) + `Task 108` (`plan-preview`) + `Task 040` (`JobObject`) + `Task 053`/`142` (`workers`) → `Task 114` (`dispatcher`).
- `Task 035`/`038` + `Task 085` + `Task 116` + `Task 121` + `Task 171`/`173` → `Task 130` (`reentry` + `welcome-back`).

## 9. Defects and missing integrations
- None of `113–116, 130` import each other or `@ef-harness/db`; `113` discards `router@1` output; `114` crashes on `102`'s `OwnerAnswer`; `114` writes invalid `"user_paused"` hold reason; `115` crashes on real `state.db` (`table task_runtime already exists`); `130` has no SQLite store and `WelcomeBackScreen` is a plain-text presenter not mounted in `apps/renderer`.

## 10. Tests and verification performed
- Reviewed unit test suites across `packages/steering/tests/{router,dispatcher,holds,question-arbiter,reentry}/**` and `apps/renderer/tests/welcome-back/**`.

## 11. Unresolved questions
- Interaction of `130` with `Task 121` (`HumanStepProbeRegistry` in `packages/governor`) and `Task 122`/`128`/`131` (`apps/renderer` / `apps/desktop`) — inspected next in `pass-04/chunk-004` and Pass 05.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-004`: `Tasks 117–121, 134` (`packages/governor` telemetry, admission, capacity-pools, vault, human-steps + `Task 134` M3 Exit Gate).

---

### Report: `pass-04/chunk-004.md`

# Audit Report — `pass-04/chunk-004` (`Tasks 117–121, 134`: `packages/governor` & M3 Parallel Exit Gate)

## 1. Chunk identification and scope
- **Pass:** `Pass 04` (Integrator, Steering, Governor, Providers, Runtime Adapters, M3/M4 Gates)
- **Chunk ID:** `pass-04/chunk-004`
- **Scope:** All 5 `packages/governor` units (`117` `telemetry`, `118` `admission`, `119` `capacity-pools`, `120` `vault`, `121` `human-steps`) plus `Task 134` M3 Parallel Exit Gate (`tests/e2e/m3-exit-gate/**`, `benchmarks/m3-parallel/**`).
- **Isolation state:** All 6 branches forked from `main` (`6497730`), clean (`dirty: 0`), unmerged on `harness/integration` (`30f2e9c`).

## 2. Units inspected
| Unit | Branch | Commit | Worktree | Dirty |
| --- | --- | --- | --- | --- |
| `Task 117` | `task/117-governor-windows-telemetry` | `dcee682` | `C:/Users/Ayush/Desktop/ef-wt/task-117-governor-windows-telemetry` | 0 |
| `Task 118` | `task/118-governor-hysteresis-footprints` | `865cae2` | `C:/Users/Ayush/Desktop/ef-wt/task-118-governor-hysteresis-footprints` | 0 |
| `Task 119` | `task/119-three-pool-capacity-scheduler` | `b9a1b25` | `C:/Users/Ayush/Desktop/ef-wt/task-119-three-pool-capacity-scheduler` | 0 |
| `Task 120` | `task/120-dpapi-secrets-vault-env-injection` | `f1fad0a` | `C:/Users/Ayush/Desktop/ef-wt/task-120-dpapi-secrets-vault-env-injection` | 0 |
| `Task 121` | `task/121-human-step-probing-verification` | `f8fb5d0` | `C:/Users/Ayush/Desktop/ef-wt/task-121-human-step-probing-verification` | 0 |
| `Task 134` | `task/134-m3-parallel-exit-gate` | `7f37eee` | `C:/Users/Ayush/Desktop/ef-wt/task-134-m3-parallel-exit-gate` | 0 |

## 3. Files inspected
- `Task 117`: `packages/governor/src/{index.ts,telemetry/collector.ts}`
- `Task 118`: `packages/governor/src/admission/{learned-footprint-store.ts,types.ts}`
- `Task 119`: `packages/governor/src/capacity-pools/scheduler.ts`
- `Task 120`: `packages/governor/src/vault/metadata-store.ts`
- `Task 121`: `packages/governor/src/human-steps/{store.ts,types.ts}`
- `Task 134`: `tests/e2e/m3-exit-gate/runner.ts`
- Root: `schema/global.sql` (`lines 1–80`)

## 4. Architecture documents consulted
- `app-shell-and-governor.md`, `execution-capacity.md`, `sandbox-and-security.md`, `provider-connections.md`, `build-cockpit.md`, `roadmap.md`
- `schema/global.sql`, `schema/telemetry.sql`, `schema/state.sql`
- `IMPLEMENTATION_TASKS.md` (`lines 7200–7507`, `8296–8361`)

## 5. Contracts and signatures discovered
- `Task 117`: `WindowsResourceTelemetryCollector.{start,stop,sampleOnce,suspend,resume}`, `openWindowsResourceTelemetryCollector`, `UiLatencyHeartbeatMonitor`, `MemoryNotificationWatcher`.
- `Task 118`: `MachineCalibrationRunner`, `LearnedFootprintStore` (`FootprintRecord`), `PressureHysteresisStateMachine` (`PressureLevel = "GREEN" | "YELLOW" | "ORANGE" | "RED"`), `HeavyLaneSemaphore`, `GpuWhisperPriorityArbiter`, `DiskHeadroomGuard`.
- `Task 119`: `ThreePoolCapacityScheduler.create(opts)` (`GovernorPressure = "Green" | "Yellow" | "Orange" | "Red"`), `ThinkingPoolCoordinator`, `WarmExecutionSlotPool`, `SessionProcessCapGuard`, `SingleDiskWriteLane`, `TierERemoteExecutionInterface`.
- `Task 120`: `WindowsDpapiSecretsVault`, `SqliteVaultMetadataStore(globalDbPath, stateDbPath)`, `RuntimeOnlyEnvInjector`, `LiveKeyTestRefusalGuard`, `ProviderSecretProber`, `GitignoredLocalEnvWriter`.
- `Task 121`: `HumanStepProbeRegistry`, `ConsentedTerminalInstaller`, `HumanStepStateStore` (`WAITING_ON_HUMAN_STEP_REASON = "waiting_on_human_step"`), `AttestedVsVerifiedBadgePolicy`.
- `Task 134`: `M3ParallelBenchmarkRunner.run(opts)` (imports local fake `HeftCriticalPathScheduler`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner` from `./*.ts`).

## 6. Confirmed findings
- **`F-055` (`CRITICAL` / `CONTRACT_MISMATCH` & `SCHEMA_MISMATCH`):** `packages/governor` (`117–121`) stub barrel (`packages/governor/src/index.ts`), `PressureLevel` casing crash between `118` (`"GREEN"|"YELLOW"|"ORANGE"|"RED"`) and `119`/`107` (`"Green"|"Yellow"|"Orange"|"Red"` — `ThreePoolCapacityScheduler.setPressure` throws `CapacityError: Unknown governor pressure` when fed `118`'s output!), `LearnedFootprintStore` (`118`) vs `schema/global.sql` `footprints` schema/port mismatch, `SqliteVaultMetadataStore` (`120`) opening raw dual `DatabaseSync` writers on both `global.db` and `state.db` + duplicating `PacketSecurityRedactor`, `HumanStepStateStore` (`121`) emitting invalid `task_holds.reason = "waiting_on_human_step"` + unmigrated `human_steps` table, and `Win32HelperClient` (`117`) falling back silently to `PosixFallbackTelemetryProvider` unless `win32-helper.cs` is compiled and packaged.
- **`F-056` (`CRITICAL` / `TEST_GAP` & `BUILD_CONFIG`):** `Task 134` M3 Parallel Exit Gate (`tests/e2e/m3-exit-gate/runner.ts`) imports **zero** `@ef-harness/*` packages — it defines local mock stand-in classes (`HeftCriticalPathScheduler`, `ProjectMergeQueue`, `WindowsDpapiSecretsVault`, `M2KitchenE2eBenchmarkRunner`, `KitchenHiddenAcceptanceSuite`) inside `./schedule.ts`, `./merge-queue.ts`, and `./kitchen.ts`, evaluates 4 hardcoded 1-line strings instead of building/booting the Kitchen App, and uses untypechecked `.ts` import specifiers outside `tests/e2e/tsconfig.json`.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `Task 014` (`GlobalBrokerDb` / `TelemetryDb`) + `Task 040` (`WindowsJobObjectManager`) → `Task 117` (`telemetry`) → `Task 118` (`admission`) → `Task 119` (`capacity-pools`) → `Task 047`/`048` (`HarnessRunEngine`/`AttemptMcpServer`), `Task 107` (`HeftCriticalPathScheduler`), `Task 124` (`BoardCockpitView`), `Task 150` (`checkpoint-resume`), `Task 165` (`Office` fallback), `Task 188` (`broker`).
- `Task 120` (`vault`) → `Task 121` (`human-steps`), `Task 136`–`139` (`providers`), `Task 160` (`preview`), `Task 179` (`ship-deploy`).
- `Tasks 105–133` → `Task 134` (`M3ExitGate`).

## 9. Defects and missing integrations
- `117`, `118`, `119`, `120`, and `121` are completely disconnected from each other (`118` output crashes `119` on case mismatch!) and unexported from `@ef-harness/governor` (`F-055`).
- `134` certifies local fake classes rather than the M3 parallel stack (`F-056`).

## 10. Tests and verification performed
- Reviewed unit tests across `packages/governor/tests/{telemetry,admission,capacity-pools,vault,human-steps}/**` and `tests/e2e/tests/m3-exit-gate.test.ts`.

## 11. Unresolved questions
- Interaction of `120` (`WindowsDpapiSecretsVault`) and `119` (`ThreePoolCapacityScheduler`) with `packages/providers` (`135–141`) and `packages/runtime-adapters` (`142–152`) — inspected next in `pass-04/chunk-005..007`.

## 12. Explicit files and relationships still requiring inspection
- `pass-04/chunk-005`: `Tasks 135–141` (`packages/providers` policy, api-keys, siwc, openrouter-local, copilot-cursor-auth, pacing + `141` connections UI).

---

### Report: `pass-04/chunk-005.md`

# Pass 04 — Chunk 005 Audit Report (`packages/providers` Policy, Auth, Local Models, AIMD Pacing & `Task 141` Connections UI)

## 1. Chunk Identification and Scope
- **Pass:** `pass-04`
- **Chunk:** `chunk-005`
- **Units Audited (7):**
  - `Task 135` (`task/135-signed-provider-policy-engine` @ `e6934db`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-135-signed-provider-policy-engine`, unmerged, clean)
  - `Task 136` (`task/136-api-key-onboarding-pricing` @ `80e6ae8`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-136-api-key-onboarding-pricing`, unmerged, clean)
  - `Task 137` (`task/137-sign-in-with-chatgpt-oauth` @ `8ffeebd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-137-sign-in-with-chatgpt-oauth`, unmerged, clean)
  - `Task 138` (`task/138-openrouter-oauth-local-models` @ `01daab9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-138-openrouter-oauth-local-models`, unmerged, clean)
  - `Task 139` (`task/139-copilot-cursor-subscription-auth` @ `ec5b8fd` / `task-139-copilot-cursor-subscription-auth`, unmerged, clean)
  - `Task 140` (`task/140-broker-allowance-pacing-aimd` @ `ab3b334`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-140-broker-allowance-pacing-aimd`, unmerged, clean)
  - `Task 141` (`task/141-no-silent-fallback-connections-ui` @ `7067800`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-141-no-silent-fallback-connections-ui`, unmerged, clean)
- **Governing Architecture Documents:** `provider-connections.md`, `open-design-questions.md`, `security-and-governance.md`, `app-shell-and-governor.md`, `kernel-schema-and-protocol.md`, `schema/global.sql`, `schema/telemetry.sql`, `onboarding-providers-and-runtimes.mmd`, `research/provider-subscriptions.md`.

## 2. Files Directly Inspected
- `schema/global.sql` (`1–140`)
- `packages/providers/src/index.ts` (`task-135` & `task-141`)
- `packages/providers/src/policy/{global-db-policy-port.ts,signed-provider-policy-engine.ts,versioned-model-roster-port.ts,compliance-policy-locks.ts}` (`Task 135`)
- `packages/providers/src/api-keys/{local-global-db-connections.ts,local-dpapi-vault.ts,sibling-ports.ts,zero-token-api-key-validator.ts}` (`Task 136`)
- `packages/providers/src/siwc/{store.ts,wire.ts,ports.ts}` (`Task 137`)
- `packages/providers/src/openrouter-local/{ports.ts,memory-ports.ts}` (`Task 138`)
- `packages/providers/src/copilot-cursor-auth/{index.ts,types.ts,local-ports.ts}` + `tests/copilot-cursor-auth/fakes.ts` (`Task 139`)
- `packages/providers/src/pacing/{global-connection-window-repo.ts,model-allowance-weight-learner.ts}` (`Task 140`)
- `packages/providers/src/fallback-guard/guard.ts` + `apps/renderer/src/connections/{ports.ts,screen.ts,secrets.ts,analytics.ts,key-detect.ts,receipts.ts}` (`Task 141`)

## 3. Verified Local Strengths
- `SignedProviderPolicyEngine` (`135`) verifies Ed25519 signatures, monotonic `policyVersion` anti-rollback, `< 5 ms` synchronous offline startup load, `route_revoked` parking, and kernel `CompliancePolicyLocks` (`sk-ant-oat*` / `setup-token` / `~/.claude` / `~/.gemini` / `antigravity` rejection, `gemini --acp` opt-in gate, and SIWC preview constraints).
- `ZeroTokenApiKeyValidator` (`136`) restricts key checks strictly to `GET` model-list endpoints, uses `x-goog-api-key` headers (never `?key=`), rejects `sk-ant-oat*` before network I/O, and computes exact BigInt/integer `micro-USD` rates across input, output, cached read, cache write, and reasoning tokens.
- `SignInWithChatGptAuthFlow`, `SiwcDirectRequestAdapter`, `SiwcTokenRefresher`, and `SiwcStreamCutoffGuard` (`137`) enforce PKCE `S256` + OIDC `nonce`, `chatgpt.tokens.use.direct` scope, single-flight token refresh coalescing, `store: false` + `stream: true` + stripped `max_output_tokens`/`temperature`/`previous_response_id`, and `AbortController` stream-cutoff protection.
- `OpenRouterPkceOAuthFlow`, `LocalModelAutoDiscoverer`, `LocalModelCapabilityProber`, and `LocalVramSlotManager` (`138`) enforce loopback-only Ollama/LM Studio discovery, `>= 16k` context + tool/JSON capability gating, explicit `num_ctx`, VRAM slot capping, and `GpuWhisperPriorityArbiter` yielding.
- `GitHubCopilotDeviceAuthFlow` + `CopilotQuotaReader` + `CursorBrowserAuthFlow` + `CursorKeyExpiryReminderScheduler` (`139`) implement RFC 8628 `+5 s` `slow_down` polling, Copilot paid-overage consent stop, and 90-day Cursor key 7-day reminder scheduling.
- `AimdConcurrencyRegulator` + `BurnRateWindowTracker` + `ModelAllowanceWeightLearner` + `RateLimitVsUsageLimitClassifier` (`140`) implement conservative `cwnd = 2` / `+1` / `÷2` AIMD, `429` vs hard usage-limit classification (`cwnd = 0` without retry storms), `ppm` personal reserve protection, and bounded RLS+EMA `k[model]` learning.
- `NoSilentPaidFallbackGuard` (`141`) and `UsageReceiptsCsvExporter` (`141`) block unapproved `local → paid`, `subscription → paid`, `subscription → overage`, and `cheap → expensive` escalations and neutralize RFC 4180 CSV formula-injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`).

## 4. Local Implementation Defects Discovered
1. **Renderer Compliance Bypass Accepting `sk-ant-oat*` Tokens (`Task 141` `apps/renderer/src/connections/key-detect.ts:7,11-14` & `screen.ts:173-210` — `F-058`):** `detectPastedKeyProvider` checks `trimmed.startsWith("sk-ant-")`, matching forbidden `sk-ant-oat*` Claude consumer subscription OAuth tokens as `"anthropic_console"` (`"Anthropic Console"`), and `savePaste()` persists them directly to `SecretVault` as `"Healthy"` without calling `CompliancePolicyLocks` (`135`) or `ApiKeyPrefixDetector` (`136`).
2. **Renderer `node:sqlite` Import + Out-of-Schema Tables (`Task 141` `apps/renderer/src/connections/receipts.ts:1,201-265` — `F-058`):** Directly imports `node:sqlite` (`DatabaseSync`) inside `apps/renderer` (forbidden in isolated Electron renderer) and creates unapproved `usage_receipt_fact` and `usage_api_summary` tables absent from `schema/telemetry.sql`.
3. **Destructive `CHECK` Constraints on `connections` (`Task 136` `local-global-db-connections.ts:69-79` — `F-057`):** Defines `CREATE TABLE IF NOT EXISTS connections` with `CHECK (route = 'api_key')`, `CHECK (currency = 'usd')`, and `CHECK (provider IN ('anthropic','openai','openrouter','gemini','custom'))`, breaking all subscription and local routes if executed on `global.db`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Six Divergent `global.db` Stores & Unpersisted `k[model]` Weights (`Tasks 135–140` vs `Task 014` `GlobalBrokerDb` & `schema/global.sql` — `F-057`):**
   - `135` opens its own `DatabaseSync` creating out-of-schema `policy_history`; `136` opens its own `DatabaseSync` creating `api_key_connection_meta` + narrowed `connections`; `137` opens a third `DatabaseSync` storing profiles in `meta`; `138`, `139`, and `140` run purely in-memory (`InMemoryGlobalConnections`, `LocalGlobalDbConnections`, `InMemoryGlobalConnectionWindowRepo`, and volatile `ModelAllowanceWeightLearner.models` `Map` that loses learned `k[model]` weights across restarts).
   - `schema/global.sql` `connections` (`lines 29-39`) has no JSON metadata or `policy_history` / `model_weights` columns, so canonical connection metadata, policy history, and `k[model]` weights must be persisted through `GlobalBrokerDb` (`014`) via `settings` JSON keys or additive `MigrationRunner` v2 migration on `global.db` under the single-writer broker lock (`024`).
2. **Six Incompatible `WindowsDpapiSecretsVault` (`Task 120`) Ports (`Tasks 120, 136, 137, 138, 139, 141` — `F-057`):**
   - `120` uses async `storeSecret`/`readPlaintextForKernel`/`deleteSecret`; `136` uses sync `put`/`getPlaintext` with ephemeral-key `dpapi-vault.json`; `137` uses `put(name, value): Promise<void>`/`get(name)`; `138` uses `put({ projectId, envScope, name, value })`/`readSecret`; `139` uses sync `writeSecret`/`readSecret` with XOR `^ 0x5a`; `141` uses sync `put(secret): string` in the renderer.
3. **Disconnected Intra-Package `SignedProviderPolicyEngine` (`135`), `VersionedModelRoster` (`106`), and `FallbackGuardPort` (`141`) Ports (`F-057`, `F-058`):**
   - `packages/providers/src/index.ts` is still an empty stub on all 7 branches.
   - `136` calls `policy.currentPriceTable()`, `137` calls `policy.readSiwcPolicy()`, and `139` calls `policy.copilotPremiumMultipliers()` — none of which exist on `135` `SignedProviderPolicyEngine`.
   - `141` `ConnectionsManagementScreen` calls `FallbackGuardPort.evaluate({ activeId, candidateId, ... })` (`apps/renderer/src/connections/ports.ts:27-43`), which does not match `141`'s own `NoSilentPaidFallbackGuard.evaluate({ active: GuardConnection, candidate: GuardConnection, policy, ... })` (`packages/providers/src/fallback-guard/guard.ts:143`).

## 6. Shared-File & Ownership Conflicts
- `packages/providers/src/index.ts` and `packages/providers/package.json` must be unified to export `policy`, `api-keys`, `siwc`, `openrouter-local`, `copilot-cursor-auth`, `pacing`, and `fallback-guard`.
- `Task 141` spans both `packages/providers/src/fallback-guard/**` and `apps/renderer/src/connections/**` and must integrate into `apps/renderer/src/index.ts` (`Task 122` `SingleAppShell`) via typed IPC (`Task 009`/`031`/`067`).

## 7. Runtime Wiring Gaps
- Wire `135`–`140` into `GlobalBrokerDb` (`014`), `BrokerGrantIssuer` (`024`), `BudgetLedger` (`023`), `VersionedModelRoster` (`106`), `WindowsResourceTelemetryCollector` (`117`), `GpuWhisperPriorityArbiter` (`118`), `WindowsDpapiSecretsVault` (`120`), and `BudgetWindDownController` (`128`) inside `apps/daemon`, exposing connection management and usage analytics RPCs to `apps/renderer` (`141`) over IPC (`031`/`067`) with zero `node:sqlite` or vault access in the renderer.

## 8. Architecture & Security Violations
- `F-058`: Renderer acceptance of `sk-ant-oat*` tokens (`key-detect.ts:7,13`) violates the immutable Anthropic Console-only lock; renderer import of `node:sqlite` (`receipts.ts:1`) violates Electron process sandboxing; `LocalDpapiSecretsVault` (`136`) ephemeral random key loses secrets on restart and `LocalWindowsDpapiSecretsVault` (`139`) XOR-masks secrets in memory.

## 9. Test Coverage & Verification Gaps
- Unit tests in `135`–`141` run against isolated `Local*` / `InMemory*` fakes; there is no cross-module test verifying `136` + `137` + `138` + `139` + `140` sharing one real `GlobalBrokerDb` (`014`) + `WindowsDpapiSecretsVault` (`120`), nor a renderer test asserting `sk-ant-oat01-...` is rejected in `ConnectionsManagementScreen.beginPaste`/`savePaste`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-057` (`CRITICAL`):** `packages/providers` (`135`–`140`) Empty Barrel, Six Divergent `global.db` Schemas (Including Destructive `route = 'api_key'` `CHECK` in `136`), Six Incompatible `WindowsDpapiSecretsVault` (`120`) Ports, Unpersisted `k[model]` Weights, and Unwired `SignedProviderPolicyEngine` (`135`) / `VersionedModelRoster` (`106`) Methods.
- **`F-058` (`CRITICAL`):** `Task 141` `apps/renderer/src/connections` Compliance Bypass Accepting `sk-ant-oat*` Subscription OAuth Tokens as `"Anthropic Console"`, Illegal Renderer `node:sqlite` Import & Out-of-Schema `usage_receipt_fact` Tables, and Internal `FallbackGuardPort` Signature Mismatch.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`135, 136, 137, 138, 139, 140, 141`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/global.sql`.
- [x] Intra-package and upstream (`014, 023, 024, 106, 117, 118, 120, 135`) contracts cross-checked.
- [x] Findings recorded immediately in `audit_findings.md` (`F-057`–`F-058`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-04/chunk-006`: `Tasks 142–146` (`packages/runtime-adapters` core supervision, generic ACP, Codex app-server, GitHub Copilot CLI, Cursor CLI — verify integration with `135` `CompliancePolicyLocks`/`CliMinVersionGate`, `137`/`139` auth tokens, `141` `NoSilentPaidFallbackGuard`, and `040`/`045`/`048` sandbox).
- `pass-04/chunk-007`: `Tasks 147–152` (`packages/runtime-adapters` Claude Code, Gemini CLI, OpenCode, checkpoint/resume, conformance harness + `Task 152` M4 Exit Gate).

---

### Report: `pass-04/chunk-006.md`

# Pass 04 — Chunk 006 Audit Report (`packages/runtime-adapters` Part 1: Core Supervision, Generic ACP, Codex, Copilot & Cursor — `Tasks 142–146`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-04`
- **Chunk:** `chunk-006`
- **Units Audited (5):**
  - `Task 142` (`task/142-runtime-adapter-core-supervision` @ `e50d00a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-142-runtime-adapter-core-supervision`, unmerged, clean)
  - `Task 143` (`task/143-generic-acp-adapter` @ `4ff2425`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-143-generic-acp-adapter`, unmerged, clean)
  - `Task 144` (`task/144-codex-runtime-adapter` @ `2a84057`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-144-codex-runtime-adapter`, unmerged, clean)
  - `Task 145` (`task/145-copilot-runtime-adapter` @ `5f2d8c7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-145-copilot-runtime-adapter`, unmerged, clean)
  - `Task 146` (`task/146-cursor-runtime-adapter` @ `b6c107e`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-146-cursor-runtime-adapter`, unmerged, clean)
- **Governing Architecture Documents:** `agent-runtime-adapters.md`, `sandbox-and-security.md`, `provider-connections.md`, `task-and-skill-architecture.md`, `onboarding-providers-and-runtimes.mmd`, `research/agent-control-protocols.md`, `research/windows-sandboxing.md`.

## 2. Files Directly Inspected
- `packages/runtime-adapters/{package.json,src/index.ts}` (`task-142`)
- `packages/runtime-adapters/src/core/{interface.ts,windows-job.ts}` (`Task 142`)
- `packages/runtime-adapters/src/acp/{adapter.ts,job.ts}` (`Task 143`)
- `packages/runtime-adapters/src/codex/{adapter.ts,process.ts}` (`Task 144`)
- `packages/runtime-adapters/src/copilot/runtime-adapter.ts` (`Task 145`)
- `packages/runtime-adapters/src/cursor/{adapter.ts,local-ports.ts}` (`Task 146`)

## 3. Verified Local Strengths
- `DeterministicSupervisionPolicyEngine` (`142`) enforces canonical `realpath` + case-folded `write_scope[]` checks, blocks `.git/`, lockfiles, sealed test paths, `~/.ssh`/`~/.claude`/`~/.gemini`/`~/.codex`, `git push`, `pnpm add`, and unproxied web tools in `< 2 ms`, and scrubs host environment secrets before child spawn.
- `GenericAcpAdapter` (`143`) implements newline-delimited JSON-RPC 2.0 stdio transport (`initialize`, `session/new`, `session/prompt`, `session/update`, `session/request_permission`, `session/cancel`), host-served `fs/*` & `terminal/*` bridges, and `.git/info/exclude` ephemeral skill mounting + cleanup.
- `CodexRuntimeAdapter` (`144`) implements `codex app-server` JSON-RPC (`thread/start`, `turn/start`, `turn/interrupt`, `thread/resume`, `account/rateLimits/read`), isolated ephemeral `CODEX_HOME`, `danger-full-access`/`--yolo` rejection, and `exp - 180 s` token-refresh restart + `thread/resume`.
- `CopilotRuntimeAdapter` (`145`) and `CursorRuntimeAdapter` (`146`) enforce `wrapped`/`stripped` mode switching, `onPermissionRequest` / `preToolUse` + `beforeShellExecution` deterministic hooks, paid-overage consent stops (`remaining === 0 && overageEnabled` / `onDemandEnabled`), BYOK billing separation, and 90-day Cursor key expiry parking.

## 4. Local Implementation Defects Discovered
1. **`core/windows-job.ts` Missing `KILL_ON_JOB_CLOSE` + Main-Thread `Atomics.wait` Freeze (`Task 142` `packages/runtime-adapters/src/core/windows-job.ts:11-56,141,154` — `F-060`):**
   - Spawns `powershell.exe -ExecutionPolicy Bypass` with `Add-Type` C# P/Invoke calling `CreateJobObject` + `AssignProcessToJobObject` **without calling `SetInformationJobObject(..., JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)`**, so daemon crashes leave orphaned foreign CLI trees alive.
   - Blocks the main Node.js event loop via `Atomics.wait(view, ..., 20_000)` for up to 20 seconds during cold `csc.exe` C# compilation and on every `ASSIGN`/`KILL` call.
2. **Non-Job-Object Process Tracking & Dummy Default Proxy (`Tasks 143–146` — `F-060`):**
   - `143` (`acp/job.ts:20-78`) and `144` (`codex/process.ts:145-160`) track PIDs in a JS `Set` and call `taskkill /PID <pid> /T /F` (missing detached breakaway grandchildren), `144` (`codex/adapter.ts:132,188`) defaults `loopbackProxy` to dead port `http://127.0.0.1:9`, and `145`/`146` (`cursor/local-ports.ts:70-101,115-129,184-200`) default to pure in-memory mocks (`InMemoryJobSupervisor`, `LocalLoopbackProxy` `http://127.0.0.1/proxy/...`, `InMemoryCursorSdk`) with zero `@github/copilot-sdk` or `@cursor/sdk` runtime dependencies in `packages/runtime-adapters/package.json`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Five Incompatible `AgentRuntimeAdapter` Contracts Across `142`–`146` (`F-059`):**
   - `packages/runtime-adapters/src/index.ts` is an empty `packageIdentity()` stub on all 5 branches.
   - None of `143` (`GenericAcpAdapter`), `144` (`CodexRuntimeAdapter`), `145` (`CopilotRuntimeAdapter`), or `146` (`CursorRuntimeAdapter`) imports `../core/index.js` (`142`), and **none defines `readonly runtime: ForeignRuntimeId`**, causing `142`'s `assertAgentRuntimeAdapter` (`core/interface.ts:139`) to throw `SupervisionError("adapter_contract", "Adapter must name its runtime")` on all four!
   - Method signatures diverge on 5 of the 10 methods:
     - `probe()`: `142`/`144` return `status: "ready" | ...`, `143` returns `"ok" | "missing"`.
     - `authStatus()`: `142`/`143` take `0` args returning `Promise<AuthStatus>`, `144` returns sync `CodexAuthStatus`, `145` requires `(connectionId: string): Promise<CopilotAuthStatus>`.
     - `startSession(spec)`: `142` passes `SessionStartSpec`, whereas `143` requires `AcpSessionSpec` (`attemptId`, `taskId`), `144` requires `CodexSessionSpec` (`connection`, `modelId`, `attemptId`), `145` requires `CopilotSessionSpec`, and `146` requires `CursorSessionSpec`.
     - `resume(sessionId, checkpointRef)`: `142`/`143`/`144` pass `checkpointRef: string`; `145` passes `CopilotCheckpointRef` (`{ attemptId }`); `146` passes `CursorCheckpointRef`.
     - `respondPermission` & `usage`: synchronous in `142` (`PermissionReply`, `NormalizedUsage`), async `Promise<...>` in `145` and `146`.
   - `144`, `145`, and `146` each invent their own `GenericAcpAdapterPort` / mini ACP fallback instead of delegating to `143`'s `GenericAcpAdapter`, and each duplicates `LocalSupervisionPolicy`, `LocalEventBus`, and `LocalRedactor` instead of sharing `142` (`core`) and `011` (`shared-observability`).

## 6. Shared-File & Ownership Conflicts
- `packages/runtime-adapters/src/index.ts` and `packages/runtime-adapters/package.json` must be unified across `142`–`151` to add workspace dependencies (`@ef-harness/{sandbox,mcp-server,corpus,providers,governor,shared-observability}`) and export all adapter modules.

## 7. Runtime Wiring Gaps
- Wire all adapters (`143`–`146`) through `142` `AdapterRegistry` + `DeterministicSupervisionPolicyEngine` + `NormalizedRuntimeEventBus`, backed by real `@ef-harness/sandbox` (`WindowsJobObjectManager` `040`, `SandboxTierSelector` `045`, `AllowlistProxyServer` `046`, `HarnessRunEngine` `047`), `@ef-harness/mcp-server` (`AttemptMcpServer` `048`), `@ef-harness/corpus` (`SkillVettingPipeline` `078`), `@ef-harness/governor` (`WarmExecutionPool` `119`, `WindowsDpapiSecretsVault` `120`), and `@ef-harness/providers` (`135, 136, 137, 139, 140, 141`).

## 8. Architecture & Security Violations
- `F-060`: Missing `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` in `core/windows-job.ts` and PID-set `taskkill` / `InMemoryJobSupervisor` in `143`–`146` violate the mandatory Windows Job Object zero-orphan defense-in-depth invariant (`sandbox-and-security.md`, `agent-runtime-adapters.md`).

## 9. Test Coverage & Verification Gaps
- Each adapter (`142`–`146`) only tests against its own local `AgentRuntimeAdapter` type and `Local*` mocks; there is zero shared contract test passing `GenericAcpAdapter`, `CodexRuntimeAdapter`, `CopilotRuntimeAdapter`, and `CursorRuntimeAdapter` into `142` `assertAgentRuntimeAdapter` / `AdapterRegistry`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-059` (`CRITICAL`):** `packages/runtime-adapters` (`142`–`146`) Empty Barrel, Missing `runtime` Property Failing `assertAgentRuntimeAdapter`, Five Divergent 10-Method `AgentRuntimeAdapter` Signatures, and Disconnected `core`/`acp` Silos.
- **`F-060` (`CRITICAL`):** `packages/runtime-adapters` (`142`–`146`) Broken PowerShell Job Object Helper (Missing `KILL_ON_JOB_CLOSE` + 20s Main-Thread `Atomics.wait` Freeze), Non-Job `taskkill`/`InMemoryJobSupervisor` Fallbacks, Dead `127.0.0.1:9` Proxy Default, and Unwired Sandbox/SDK Dependencies.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`142, 143, 144, 145, 146`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `agent-runtime-adapters.md`.
- [x] Intra-package (`142` ↔ `143` ↔ `144`–`146`) and upstream (`011, 040–049, 078, 119, 120, 135–141`) contracts cross-checked.
- [x] Findings recorded immediately in `audit_findings.md` (`F-059`–`F-060`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-04/chunk-007`: `Tasks 147–152` (`packages/runtime-adapters` Claude Code `147`, Gemini CLI `148`, OpenCode `149`, checkpoint/resume `150`, conformance harness `151`, and `Task 152` M4 Exit Gate — check if `147`–`151` have the same `AgentRuntimeAdapter` mismatch and whether `152` uses `.ts` imports / local mocks like `105` & `134`).

---

### Report: `pass-04/chunk-007.md`

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

---

### Report: `pass-05/chunk-001.md`

# Pass 05 — Chunk 001 Audit Report (`apps/renderer` Shell, Phase Presets, `apps/desktop` Pop-Out Windows, 7-Lane Board Cockpit & Health Signals — `Tasks 122–125`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-001`
- **Units Audited (4):**
  - `Task 122` (`task/122-single-app-shell-framework` @ `2c6aeff`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-122-single-app-shell-framework`, unmerged, clean)
  - `Task 123` (`task/123-phase-presets-popout-windows` @ `7a522a6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-123-phase-presets-popout-windows`, unmerged, clean)
  - `Task 124` (`task/124-board-cockpit-seven-lanes` @ `3bb233b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-124-board-cockpit-seven-lanes`, unmerged, clean)
  - `Task 125` (`task/125-board-health-signals-explainer` @ `20d6ff1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-125-board-health-signals-explainer`, unmerged, clean)
- **Governing Architecture Documents:** `app-shell-and-governor.md`, `desktop-app.md`, `build-cockpit.md`, `execution-capacity.md`, `prompt-contracts.md`, `kernel-schema-and-protocol.md`, `schema/state.sql`, `schema/telemetry.sql`, `desktop-app.mmd`, `cockpit-and-office.mmd`.

## 2. Files Directly Inspected
- `schema/state.sql` (`195–320`)
- `apps/renderer/{package.json,src/index.ts}` (`task-122`)
- `apps/renderer/src/shell/{shell.ts,ports.ts,daemon-store.ts}` (`Task 122`)
- `apps/renderer/src/presets/phase-workspace-controller.ts` + `apps/desktop/src/windows/{pop-out-window-coordinator.ts,shared-harnessd-stream.ts,electron-ports.ts}` (`Task 123`)
- `apps/renderer/src/cockpit/board/{map-task-to-board-lane.ts,state-db-adapter.ts,daemon-store-port.ts}` (`Task 124`)
- `apps/renderer/src/cockpit/health/{explainer.ts,board-slot.ts,telemetry-log.ts}` (`Task 125`)

## 3. Verified Local Strengths
- `SingleAppShell` (`122`) enforces the 4-zone spatial layout (48px fixed Top Bar with permanent `Stop` control, resizable Left Rail & Right Inspector clamped so Center Workspace stays `>= 420 px`, `16 ms` rAF event batching, `stream_epoch` snapshot resync, WCAG AA light/dark tokens, and `UiLatencyHeartbeatMonitor` skipping hidden documents).
- `PhaseLayoutPresetManager`, `NonDisruptivePhaseSwitchBanner`, `PopOutWindowCoordinator`, and `DisconnectedMonitorBoundsGuard` (`123`) enforce non-focus-stealing phase banners, `<= 3` singleton pop-out windows with automatic close re-docking, and `>= 120 × 80 px` connected `workArea` intersection recovery across monitor unplug and DPI changes.
- `BoardCockpitView`, `mapTaskToBoardLane`, `DeterministicStatusLineFormatter`, `FeatureSwimlaneGrouper`, and `VirtualizedLaneColumn` (`124`) map canonical `schema/state.sql` `task_states` to the exact 7 lanes (`Queued`, `Working`, `Waiting on You`, `Held`, `Verifying`, `Integrating`, `Done`), render zero-LLM status lines, and virtualize 500 tasks in `< 10 ms`.
- `BoardHealthSignalEngine` and `OnDemandCockpitExplainer` (`125`) detect all 5 health signals (`5-min` stuck clock, `3×` loop, `429` countdown, allowance reset, escalation/retry), suppress false stuck alarms during Pool-2/Inbox/hold/backoff waits, cache explanations by `(taskId, lastEventSeq)`, and fall back deterministically when offline.

## 4. Local Implementation Defects Discovered
1. **Undeclared `react` & `react-dom` Dependencies in `apps/renderer/package.json` (`Task 122` `shell.ts:1-2` vs `apps/renderer/package.json:20-28` — `F-063`):** `shell.ts` imports `"react"` and `"react-dom/server"`, which are completely absent from `apps/renderer/package.json` (`dependencies` lists only `@ef-harness/shared-contracts`).
2. **`SharedHarnessdStream.publish` Throws on Daemon Restart / Epoch Reset (`Task 123` `apps/desktop/src/windows/shared-harnessd-stream.ts:18-23` — `F-063`):** `if (event.seq <= last) throw new Error(...)` has no `streamEpoch` tracking and stores an unbounded `events[]` array in memory, crashing multi-window routing whenever `harnessd` restarts with a new `stream_epoch` (`seq = 1`).

## 5. Cross-Unit Contract & Seam Mismatches
1. **Renderer/Desktop IPC & Governor Casing Mismatches (`122` & `123` vs `009`, `032`, `067`, `118` — `F-063`):**
   - `122` (`shell/ports.ts:10-36`) invents `BridgePayload` (`kind: "events.subscribe" | "snapshot.get" | "rpc"` with `method: "build.stop" | "build.pause" | "build.resume"`, no `op_id`) and expects a `NamedPipeClient` inside `apps/renderer`, whereas `009`/`032`/`067` use `MessagePort` preload bridges carrying `run.stop` / `run.pause` / `run.resume` (with `op_id`), `project.open`, and `stream.credit`.
   - `122` (`shell/daemon-store.ts:56-64`) checks lowercase `"green" | "yellow" | "orange" | "red"`, silently dropping uppercase `"GREEN" | "YELLOW" | "ORANGE" | "RED"` emitted by `118` `PressureHysteresisStateMachine` (`F-055`).
   - `123` `PhaseWorkspaceController` (`presets/phase-workspace-controller.ts:57,153`) calls `shell.applyPreset(...)`, which does not exist on `122` `ShellLayoutContext`, and `123` `PopOutWindowCoordinator` is unwired from `067` `apps/desktop` (`F-027` single-port bug).
2. **`122` `DaemonStore` ↔ `124` `BoardCockpitView` ↔ `125` `BoardHealthSignalEngine` & `009` `CockpitExplainerOutputSchema` (`F-064`):**
   - `122` `DaemonStore` stores `WorkerView[]` (`{ id, status, detail, updatedSeq }`), while `124` `BoardCockpitView` requires `DaemonStoreSnapshot = { revision, tasks: BoardTaskRecord[], capacity: ThreePoolCapacitySnapshot }` (`StateDbBoardRow`, never emitted by `apps/daemon` `066`).
   - `125` defines a local class `CockpitExplainerV1Schema` instead of `@ef-harness/shared-contracts` `CockpitExplainerOutputSchema` (`009`), leaves `attachHealthSlots` unwired from `124` `BoardCockpitView`, and logs health metrics only to `InMemoryTelemetryLog` instead of forwarding to `harnessd` `telemetry.db`.

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/src/index.ts`, `apps/renderer/package.json`, `apps/desktop/src/index.ts`, and `apps/desktop/src/main.ts` (`067`) must be unified across `122`–`128`, `131`–`133`, `141`, and `153`–`165`.

## 7. Runtime Wiring Gaps
- Add `react`, `react-dom`, `@types/react`, `@types/react-dom` to `apps/renderer/package.json`; wire `067` `apps/desktop` multi-window `MessagePort` fan-out (`F-027`) + `123` `PopOutWindowCoordinator` + `DisconnectedMonitorBoundsGuard`; add `StateDbBoardRow` + `ThreePoolCapacitySnapshot` projection to `apps/daemon` (`066`) and `122` `DaemonStore`; and mount `123` presets, `124` Board, and `125` Health Signals inside `122` `SingleAppShell`.

## 8. Architecture & Security Violations
- None (`122`–`125` cleanly respect Electron renderer `contextIsolation` with zero `node:sqlite` or raw Node FS imports, unlike `141` `F-058`).

## 9. Test Coverage & Verification Gaps
- Unit tests in `122`–`125` test against `MemoryNamedPipeClient`, `InMemoryWindowFactory`, `InMemoryDaemonStore`, and `FakeModelAdapter` without exercising `067` preload IPC or `122`→`124`→`125` composition.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-063` (`HIGH`):** `SingleAppShell` (`122`) & `PopOutWindowCoordinator` (`123`) Undeclared `react`/`react-dom` Dependencies, Incompatible `BridgePayload` vs `009`/`032`/`067` IPC Protocol, Governor Casing Drop, `SharedHarnessdStream` Epoch-Reset Crash & `applyPreset` Mismatch.
- **`F-064` (`HIGH`):** `BoardCockpitView` (`124`) & `BoardHealthSignalEngine` (`125`) Disconnected `DaemonStore` Snapshot Shapes, Missing `StateDbBoardRow` Daemon Projection, Duplicate `CockpitExplainerV1Schema` & In-Memory Telemetry Sink.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`122, 123, 124, 125`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `009`, `032`, `066`, `067`, `114`, `118`, `119`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-063`–`F-064`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-002`: `Tasks 126–128, 131–133` (`apps/renderer` Worker Inspector `126`, Calm Inbox `127`, Budget Wind-Down & Stop Card `128`, plus `apps/desktop` & `apps/daemon` lifecycle/tray/power `131`, component downloader/updater `132`, diagnostics & redacted bundle exporter `133`).

---

### Report: `pass-05/chunk-002.md`

# Pass 05 — Chunk 002 Audit Report (Worker Inspector, Calm Inbox, Budget Wind-Down & Stop Card, Desktop Lifecycle, Component Downloader/Updater & Diagnostics — `Tasks 126–128, 131–133`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-002`
- **Units Audited (6):**
  - `Task 126` (`task/126-worker-inspector-panel` @ `3dce5cd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-126-worker-inspector-panel`, unmerged, clean)
  - `Task 127` (`task/127-calm-notification-inbox-ui` @ `5b91291`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-127-calm-notification-inbox-ui`, unmerged, clean)
  - `Task 128` (`task/128-budget-winddown-stop-card-wip` @ `a8ca2fd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-128-budget-winddown-stop-card-wip`, unmerged, clean)
  - `Task 131` (`task/131-electron-desktop-lifecycle` @ `304c4e7`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-131-electron-desktop-lifecycle`, unmerged, clean)
  - `Task 132` (`task/132-component-downloader-park-updater` @ `f89dbc1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-132-component-downloader-park-updater`, unmerged, clean)
  - `Task 133` (`task/133-diagnostics-health-bundle-exporter` @ `ab4387b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-133-diagnostics-health-bundle-exporter`, unmerged, clean)
- **Governing Architecture Documents:** `build-cockpit.md`, `stops-undo-and-reentry.md`, `desktop-app.md`, `app-shell-and-governor.md`, `database-design.md`, `kernel-schema-and-protocol.md`, `schema/state.sql`, `schema/telemetry.sql`, `desktop-app.mmd`, `stops-undo-and-reentry.mmd`.

## 2. Files Directly Inspected
- `apps/renderer/src/cockpit/inspector/{ports.ts,credit-stream.ts}` (`Task 126`)
- `apps/renderer/src/cockpit/inbox/{ports.ts,cards.ts}` (`Task 127`)
- `packages/steering/src/budget-stops/{controller.ts,ledger.ts,stop-events.ts,exporter.ts}` (`Task 128`)
- `apps/daemon/src/lifecycle/sqlite-wal.ts` + `apps/desktop/src/lifecycle/electron-binding.ts` (`Task 131`)
- `apps/daemon/src/components/signed-component-downloader.ts` + `apps/desktop/src/updater/park-first-auto-updater.ts` (`Task 132`)
- `apps/daemon/src/diagnostics/{telemetry-db.ts,bundle-exporter.ts}` (`Task 133`)

## 3. Verified Local Strengths
- `WorkerInspectorPanel` (`126`) implements 5 tabs (`Timeline`, lazy 64 KB `Diff`, `Checks` without leaking active sealed-check source, historical `sliceSha256` `Brief`, and opt-in `Raw Stream` with auto-scroll pause on scroll-up) plus `AbortController` cancellation on rapid worker switching.
- `CalmInboxPanel` (`127`) implements the 3-tier cadence (`Interrupt-Now`, `10-min` batch with critical-path/`>= 2` subscriber early flush, `FYI Digest` excluded from actionable badge count), Focus Mode suppression, and all 6 canonical card types (`Decision`, `Secret` with zero chat/SQLite leak, `Tool`, `Account`, `Approval`, grouped `Review`).
- `BudgetWindDownController` & `WipBranchHandoffExporter` (`128`) enforce `50% / 80% / 90% / 100%` wind-down across `micro-USD` and `ppm`, atomic pre-reservation ceiling guards, all 6 Stop Card recovery actions, and non-destructive `wip/<slug>-<date>` Git worktree + `HANDOFF.md` export without moving `main` or `harness/integration`.
- `DesktopLifecycleCoordinator` & `DaemonShutdownCoordinator` (`131`) implement the 3-choice Quit-While-Building dialog, dialog-free idle quit, `powerMonitor` suspend/resume/shutdown hooks, opt-in `powerSaveBlocker` auto-release, single-instance lock, and renderer crash survival.
- `SignedComponentDownloader` & `ParkFirstAutoUpdater` (`132`) verify pinned Ed25519 manifest signatures before HTTP `Range` download, check `freeBytes - 2 * size >= 5 GB`, verify SHA-256 before atomic staging swap, detect AV quarantine deletions, and enforce park-first checkpoint + WAL flush + backup before `quitAndInstall`.
- `RedactedDiagnosticsBundleExporter` (`133`) enforces a strict 6-file allowlist (excluding source code, prompts, diffs, and secrets), scrubs tokens + `C:\Users\<Name>` paths, guarantees byte-for-byte Preview-equals-Zip parity, and enforces `<= 10` / `<= 50 MB` local-only crash-dump retention.

## 4. Local Implementation Defects Discovered
1. **`CreditLimitedStream` Throws Instead of Queuing at Credit Limit (`Task 126` `apps/renderer/src/cockpit/inspector/credit-stream.ts:44-48` — `F-065`):** When `this.outstanding >= INITIAL_STREAM_CREDITS`, `run()` immediately throws `RangeLimitError("stream credits exhausted")` instead of queuing pending range fetches until an in-flight chunk completes and replenishes a credit.
2. **`rebuildTelemetryDatabase` Unlinks Open SQLite WAL Files Without Closing Daemon Handle (`Task 133` `apps/daemon/src/diagnostics/telemetry-db.ts:47-56` — `F-066`):** Calls `rmSync` directly on `telemetry.db`, `-wal`, and `-shm` without coordinating with `Task 014` `TelemetryDb`'s active writer handle, causing Windows `EBUSY`/`EPERM` file-lock errors or WAL handle corruption.

## 5. Cross-Unit Contract & Seam Mismatches
1. **`Task 128` (`budget-stops`) Disconnected from `023` `BudgetLedgerRepo`, `036`/`039` `git-engine`, `140` `AllowancePacingController`, and `schema/state.sql` (`F-065`):**
   - `StopEventStore` (`stop-events.ts:29-36`) opens a standalone `DatabaseSync` and creates an out-of-schema `stop_events` table instead of using `@ef-harness/db` `CoordinatorWriteQueue` + `MigrationRunner` v2 migration.
   - `AtomicBudgetReservationLedger` (`ledger.ts:27-39`) is a volatile in-memory map disconnected from `Task 023` `BudgetLedgerRepo` (`state.db.budget_ledger`) and `Task 140` `GlobalConnectionWindowRepo` (`global.db.connection_windows`).
   - `WipBranchHandoffExporter` (`exporter.ts:4,37-61`) spawns host `git` directly via `git-repo.ts` instead of `Task 036` pinned `MinGit` + `Task 039` `GitRefCasUpdater`.
2. **`126` (`Inspector`) & `127` (`Inbox`) Method/IPC Mismatches Against `029`, `033`, `088`, `109`, `116`, `120`, `121` (`F-065`):**
   - `126` expects RPC methods `locateLineWindow` (`029` `SeekableZstdLogReader` has no `locateLineWindow`), `pinnedManifest`/`previewManifest` (`088` `ContextSlicerEngine` has `sliceForTask`), and `readsForAttempt` (`109` `ArtifactHandoffStore` has `readResult`), none of which are registered on `apps/daemon` IPC (`031`/`033`/`066`).
   - `127` calls `StaleReplyReconciler.receive(card, reply)` (`116` exposes `reconcile(...)` on daemon side), `HumanStepProbePort.checkAgain(stepId)` (`121` exposes `verify`/`runProbe`), and `PreloadSecretIpc.put({ projectId, envScope, name, value })` (`120` uses `secretName`/`plaintext`).
3. **`131`, `132`, `133` Unwired from `apps/daemon` (`066`) & `apps/desktop` (`067`) + Missing `electron-updater` & `reconcileAfterWake` (`F-066`):**
   - Neither `apps/daemon/src/index.ts` nor `apps/desktop/src/main.ts` wires `131` (`lifecycle`), `132` (`components`/`updater`), or `133` (`diagnostics`).
   - `131` uses an HTTP-like `/lifecycle/shutdown` router instead of `NamedPipeServer` (`031`) RPCs and calls nonexistent `reconcileAfterWake()` on `Task 130` `ColdOpenReconciler` (`reconcile()`).
   - `132` omits `electron-updater` from `apps/desktop/package.json` and leaves `CheckpointSchemaUpcasterRegistry` unwired from `015` `MigrationRunner` and `053`/`150` checkpoint loaders.

## 6. Shared-File & Ownership Conflicts
- `packages/steering/src/index.ts` must export `budget-stops` (`128`) alongside `113`–`116` and `130`.
- `apps/daemon/src/index.ts` (`066`), `apps/desktop/src/main.ts` (`067`), and `apps/renderer/src/index.ts` (`122`) must mount `126`, `127`, `128`, `131`, `132`, and `133`.

## 7. Runtime Wiring Gaps
- Register daemon IPC handlers for Inspector range queries (`126` → `029`/`033`/`088`/`109`), Inbox actions (`127` → `116`/`120`/`121`/`176`), Stop Card recovery actions (`128` → `023`/`039`/`114`/`140`), Desktop lifecycle/sleep/shutdown (`131` → `020`/`066`/`067`/`118`/`125`/`130`), Component downloads & Park-First updates (`132` → `015`/`016`/`118`/`131`), and Diagnostics self-checks & `.zip` bundle export (`133` → `011`/`014`/`028`/`117`).

## 8. Architecture & Security Violations
- `F-065`: `StopEventStore` (`128`) opens a rogue `DatabaseSync` writer on `state.db`, and `WipBranchHandoffExporter` (`128`) spawns host `PATH` `git` instead of pinned `MinGit` (`036`).
- `F-066`: `telemetry-db.ts` (`133`) unlinks live SQLite WAL files outside `@ef-harness/db` `TelemetryDb` (`014`).

## 9. Test Coverage & Verification Gaps
- Unit tests in `126`–`128` and `131`–`133` use in-memory/mock ports (`MemoryPorts`, `RecordingSqlite`, mock `ElectronUpdaterPort`); there are no integration tests wiring `131`+`132` into `067` `apps/desktop` or `126`+`127`+`128` into `122` `SingleAppShell`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-065` (`HIGH`):** `WorkerInspectorPanel` (`126`), `CalmInboxPanel` (`127`) & `BudgetWindDownController` (`128`) Credit-Exhaustion Throw Bug, Rogue `stop_events` SQLite Writer, Volatile `AtomicBudgetReservationLedger`, Host `git` Spawn & Upstream RPC/Method Mismatches.
- **`F-066` (`HIGH`):** Desktop Lifecycle (`131`), Component Downloader & Auto-Updater (`132`) & Diagnostics (`133`) Unwired from `apps/daemon`/`apps/desktop`, Missing `electron-updater`, Nonexistent `reconcileAfterWake`, and Live `telemetry.db` WAL Unlink Race.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`126, 127, 128, 131, 132, 133`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] Cross-checked against `011, 014–016, 020, 023, 028, 029, 031, 033, 036, 039, 066, 067, 088, 109, 114, 116–122, 130, 140`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-065`–`F-066`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-003`: `Tasks 153–156, 159` (`apps/renderer` Canvas React Flow + ELK.js `153`, popovers/multi-select `154`, Single Composer `155`, Canvas box-chat & structural edits `156`, Spec Browser & Plan Tree `159`).

---

### Report: `pass-05/chunk-003.md`

# Pass 05 — Chunk 003 Audit Report (Interactive Architecture Canvas, 14-Type Popovers, Single Composer, Box-Chat Intents & Spec/Plan/Matrix Tabs — `Tasks 153–156, 159`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-003`
- **Units Audited (5):**
  - `Task 153` (`task/153-interactive-architecture-canvas` @ `f38da6d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-153-interactive-architecture-canvas`, unmerged, clean)
  - `Task 154` (`task/154-canvas-popovers-multiselection` @ `cb0b77d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-154-canvas-popovers-multiselection`, unmerged, clean)
  - `Task 155` (`task/155-single-composer-state-machine` @ `8405651`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-155-single-composer-state-machine`, unmerged, clean)
  - `Task 156` (`task/156-canvas-box-chat-intents` @ `2c03735`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-156-canvas-box-chat-intents`, unmerged, clean)
  - `Task 159` (`task/159-spec-browser-plan-tree-tabs` @ `cd7bfd6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-159-spec-browser-plan-tree-tabs`, unmerged, clean)
- **Governing Architecture Documents:** `interactive-architecture.md`, `linked-graphs-design.md`, `linked-architecture-revisions.md`, `routing-design.md`, `spec-expansion.md`, `planning-and-crew.md`, `security-and-governance.md`, `schema/state.sql`, `schema/queries.sql`, `dictation-and-canvas.mmd`.

## 2. Files Directly Inspected
- `schema/state.sql` (`700–796`)
- `apps/renderer/package.json` (`task-153`)
- `apps/renderer/src/canvas/graph/{saved-node-position-store.ts,react-flow-canvas-view.ts,local-ports.ts}` (`Task 153`)
- `apps/renderer/src/canvas/popovers/registry.ts` (`Task 154`)
- `apps/renderer/src/composer/composer-target-state-machine.ts` (`Task 155`)
- `apps/renderer/src/canvas/intents/{sql.ts,graph.ts,controller.ts}` (`Task 156`)
- `apps/renderer/src/canvas/tabs/state-db.ts` (`Task 159`)

## 3. Verified Local Strengths
- `InteractiveArchitectureCanvas` (`153`) implements 4-level semantic zoom (`System` → `Features & Contracts` → `Rules & Requirements` → `Tasks & Runtime`), conflict bubbling across zoom levels, Web Worker `ELK.js` layout preserving `pinnedByUser` positions, viewport culling, and `Today`/`Change`/`Both` brownfield layer filters.
- `NodeTypePopoverRegistry`, `MultiBoxSelectionController`, and `PostSendChangeHighlighter` (`154`) cover all 14 canonical node types without leaking sealed-oracle test source during active builds, clamp popovers inside viewport bounds, and respect `prefers-reduced-motion`.
- `ComposerTargetStateMachine` (`155`) enforces the 4-target state machine (`Question`, `Box`, `Element`, `General`), per-target draft preservation, non-answering Canvas selection, `InputStartFocusSnapshot` lock on first keystroke, bare-number `TargetTypeMismatchGuard`, auto-return toast, and multi-box clause splitting.
- `BoxChatIntentController` (`156`) distinguishes `Correct (misheard)` vs `Change`, enforces zero-side-effect `Cancel` on `ZeroTokenImpactPreviewModal`, deduplicates multi-box impact unions, and catches `baseRevision !== currentDbRevision` via `RevisionDriftConflictPrompt`.
- `SpecBrowserTab`, `MatrixCoverageExplorer`, `MediumRiskProposalReviewPanel`, `PlanTreeAndPreviewTab`, and `RuntimeTasksTableTab` (`159`) separate `Planned Now` vs `Projected Later`, collapse universal matrix rules, block `Start Build` on active conflicts, and virtualize 500-row task tables.

## 4. Local Implementation Defects Discovered
1. **Illegal `node:sqlite`, `node:fs`, and `node:crypto` Imports Inside `apps/renderer` + Fabricated `INTENT_GRAPH_SCHEMA_SQL` (`Tasks 156 & 159` — `F-067`):**
   - `156` (`apps/renderer/src/canvas/intents/graph.ts:1`, `sql.ts:32-115`) imports `{ DatabaseSync } from "node:sqlite"` inside the Chromium renderer bundle and instantiates a fabricated 20-column `nodes` table (`value`, `lifecycle`, `built`, `landed`, `provenance_quote`, `amber`, `dictation_badge`, etc.) plus out-of-schema `vocabulary_corrections`.
   - `159` (`apps/renderer/src/canvas/tabs/state-db.ts:1-4,52-58,93-122`) imports `"node:crypto"`, `"node:fs"`, and `{ DatabaseSync } from "node:sqlite"` inside `apps/renderer`, reads `state.sql` from disk via `fs.readFileSync`, registers an **8th divergent `ef_search_text` UDF** (`F-010`), and executes direct SQLite writes inside the renderer process!
2. **Undeclared `@xyflow/react` & `elkjs` Dependencies in `apps/renderer/package.json` (`Task 153` `react-flow-canvas-view.ts:8` vs `apps/renderer/package.json:20-28` — `F-067`):** `react-flow-canvas-view.ts` imports `@xyflow/react` (and `elk-incremental-layout-engine.ts` uses ELK) without declaring `@xyflow/react` or `elkjs` in `apps/renderer/package.json`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Missing `canvas_layout` Persistence & Disconnected Intra-Canvas/Composer/Daemon Ports (`Tasks 153–156, 159` vs `017, 071, 073, 079, 080, 084, 087, 102, 108, 113, 122, 129, 158` — `F-068`):**
   - `schema/state.sql` has no `canvas_layout` table; `153` defaults to volatile `MemoryCanvasLayoutPersistence` and calls `shell.readCanvas()`/`writeCanvas()` absent on `122`'s `ShellLayoutContext`.
   - Zero imports exist across `153` (`canvas/graph`), `154` (`canvas/popovers`), `155` (`composer`), `156` (`canvas/intents`), and `159` (`canvas/tabs`).
   - `156` `BoxChatIntentController` keeps its own duplicate `draft`/`cursor`/`locks` state instead of consuming `155` `ComposerTargetStateMachine` + `113` `InputStartFocusSnapshot`, and calls 9 `Local*` stand-ins (`LocalAskOwnerResponder`, `LocalReverseImpactWalker`, `LocalChangeClassifier`, `LocalEarlyCutoffReverifier`, `LocalReverifyBeforeReworkGate`, `LocalRevisionAutoStartPolicy`, `LocalPremiseSupersessionReopener`, `LocalDictationVocabulary`, `LocalPostSendChangeHighlighter`) instead of routing over IPC to `harnessd` (`071, 087, 102, 108, 129, 158`) and `154` (`PostSendChangeHighlighter`).

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/package.json` and `apps/renderer/src/index.ts` must add `@xyflow/react`, `elkjs`, `react`, `react-dom` (`F-063`, `F-067`) and mount `153`, `154`, `155`, `156`, and `159` into `122` `SingleAppShell`.

## 7. Runtime Wiring Gaps
- Move `156` (`IntentGraph`) and `159` (`CanonicalStateDb`) SQLite queries/mutations onto `apps/daemon` (`066`) backed by `@ef-harness/{db,discovery,spec-expansion,planner,integrator,steering,dictation}` over typed IPC (`009`/`031`/`067`); add `canvas_layout` to `@ef-harness/db` `state.db` v2 migration (`015`); and wire `153` ↔ `154` ↔ `155` ↔ `156` ↔ `159` inside `122` `SingleAppShell`.

## 8. Architecture & Security Violations
- `F-067`: Importing `node:sqlite`, `node:fs`, and `node:crypto` inside `apps/renderer` (`156`, `159` — matching `141` `F-058`) violates Electron renderer `contextIsolation` / `nodeIntegration: false` sandboxing (`security-and-governance.md`, `desktop-app.md`) and breaks browser/renderer bundling.

## 9. Test Coverage & Verification Gaps
- Unit tests in `153`–`156` and `159` run under Node Vitest (where `node:sqlite` and `node:fs` accidentally work!) rather than a browser/Chromium renderer environment, masking the illegal Node built-in imports.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-067` (`CRITICAL`):** `apps/renderer/src/canvas/{intents,tabs}` (`156`, `159`) Illegal Renderer `node:sqlite`/`node:fs`/`node:crypto` Imports, Fabricated 20-Column `nodes` Schema, 8th `ef_search_text` UDF & Undeclared `@xyflow/react`/`elkjs` Dependencies (`153`).
- **`F-068` (`HIGH`):** Canvas & Composer Silos (`153`–`156`, `159`) Missing `canvas_layout` SQLite Table, Missing `ShellLayoutContext.readCanvas`/`writeCanvas`, Duplicate Composer State in `156`, and Nine `Local*` Stand-Ins Disconnected from `harnessd` IPC.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`153, 154, 155, 156, 159`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `010, 015, 017, 071, 073, 079, 080, 084, 087, 102, 108, 113, 122, 129, 158`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-067`–`F-068`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-004`: `Tasks 157–158, 160–161` (`packages/dictation` Whisper STT `157` & vocabulary `158`, `apps/daemon` Live App Preview runner `160`, `apps/renderer` JSX `data-ef-source` tagger & Point-to-Fix `161`).

---

### Report: `pass-05/chunk-004.md`

# Pass 05 — Chunk 004 Audit Report (`packages/dictation` Whisper STT & Vocabulary, `apps/daemon` Live App Preview Runner & `Task 161` JSX Source Plugin + Point-to-Fix — `Tasks 157–158, 160–161`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-004`
- **Units Audited (4):**
  - `Task 157` (`task/157-local-whisper-dictation-engine` @ `6ebcdcd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-157-local-whisper-dictation-engine`, unmerged, clean)
  - `Task 158` (`task/158-dictation-vocabulary-normalizer` @ `1dd0dda`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-158-dictation-vocabulary-normalizer`, unmerged, clean)
  - `Task 160` (`task/160-live-app-preview-runner` @ `82213b1`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-160-live-app-preview-runner`, unmerged, clean)
  - `Task 161` (`task/161-jsx-source-plugin-point-to-fix` @ `58a5508`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-161-jsx-source-plugin-point-to-fix`, unmerged, clean)
- **Governing Architecture Documents:** `interactive-architecture.md`, `ui-design-system.md`, `prompt-contracts.md` (`visual-steer@1`), `app-shell-and-governor.md`, `test-environments.md`, `workspace-and-git.md`, `schema/global.sql`, `dictation-and-canvas.mmd`, `ui-design-system.mmd`.

## 2. Files Directly Inspected
- `packages/dictation/src/index.ts` (`task-157`)
- `packages/dictation/src/stt/whisper-engine.ts` (`Task 157`)
- `packages/dictation/src/vocabulary/{frozen-schema-adapter.ts,whisper-bpe.ts}` (`Task 158`)
- `apps/daemon/src/preview/{live-preview-daemon-runner.ts,create-runner.ts,local-job-supervisor.ts}` (`Task 160`)
- `apps/renderer/src/preview/point-to-fix/{visual-steer-router.ts,source-path.ts}` + `packages/planner/src/jsx-source-plugin/vite-plugin.ts` (`Task 161`)

## 3. Verified Local Strengths
- `LocalWhisperSttEngine` & `EditableDictationDraftController` (`157`) enforce never-auto-send editable drafts, LocalAgreement-2 confirmed/tentative spans, exact `3 s` hint and `60 s` auto mic-off + GPU release, `p < 0.72` amber underlines strictly on numbers/times/negations/domain terms, OS fallback when Whisper is unavailable, and zero `.wav` disk writes.
- `WhisperInitialPromptBuilder`, `TwoOccurrenceCorrectionLearner`, and `ProjectVerifiedSpokenIdNormalizer` (`158`) enforce exact `<= 224` GPT-2 BPE token caps with lowest→highest weight tail ordering, `>= 2` occurrence promotion + permanent user suppression, and grammar-guarded (`"there are two"` safe) project-verified spoken-ID normalization.
- `LivePreviewDaemonRunner`, `PersistentDemoDbManager`, `LastGoodPreviewFallbackStore`, and `IsolatedPreviewWebviewHost` (`160`) enforce lazy on-demand startup, `15 min` hidden / `RED` pressure suspension, additive-migration Demo DB preservation, crash fallback to `lastGoodPreviewCommitSha`, and `persist:ef-preview-<projectId>` Electron session isolation with off-origin navigation blocking.
- `DevOnlyJsxSourceTagPlugin` (`161`) injects `data-ef-source` strictly in non-production builds (`0` bytes in `NODE_ENV=production`) and `PointToFixPickerOverlay` captures single-element and drag-box gap regions cleanly.

## 4. Local Implementation Defects Discovered
1. **`gpt2.tiktoken` Asset Omitted From `dist/` Build Output (`Task 158` `packages/dictation/src/vocabulary/whisper-bpe.ts:25-26` — `F-069`):** `loadModel()` reads `path.join(path.dirname(fileURLToPath(import.meta.url)), "gpt2.tiktoken")` via `fs.readFileSync`, but `packages/dictation`'s `tsc` build script does not copy `src/vocabulary/gpt2.tiktoken` to `dist/vocabulary/gpt2.tiktoken`, causing `ENOENT` at runtime when imported from `dist/`.
2. **`VisualSteerRouter` Never Calls `visual-steer@1`, Hardcodes `"8 screens"`, and Falls Back to `"src/unknown/Unknown.tsx"` (`Task 161` `apps/renderer/src/preview/point-to-fix/visual-steer-router.ts:10-13,47-97` + `source-path.ts:1` — `F-070`):**
   - `source-path.ts:1` imports `"node:path"` inside `apps/renderer` (forbidden Node built-in in sandboxed renderer).
   - `VisualSteerRouter.route` never invokes the `visual-steer@1` LLM contract or `@ef-harness/shared-contracts` `VisualSteerOutputSchema` (`009`), checks only 2 hardcoded paths (`src/components/ui/button.tsx`, `design/tokens.json`), emits a hardcoded string `"This changes shared Button across 8 screens..."`, and falls back to `"src/unknown/Unknown.tsx"` instead of querying `code-index.db` (`167`) when `data-ef-source` is absent.
3. **Fake `LocalWindowsJobSupervisor` Claiming `killOnJobClose = true` (`Task 160` `apps/daemon/src/preview/local-job-supervisor.ts:34-79,98-120` — `F-070`):** Declares `readonly killOnJobClose = true as const` without ever creating a Windows Job Object (`child.kill("SIGKILL")` + `taskkill.exe`), leaving preview grandchild processes alive if `harnessd` crashes.

## 5. Cross-Unit Contract & Seam Mismatches
1. **`packages/dictation` (`157` ↔ `158`) Empty Barrel & Upstream Port Mismatches Against `014`, `040`, `118`, `132`, `155` (`F-069`):**
   - `packages/dictation/src/index.ts` is an empty `packageIdentity()` stub on both branches, and `157` and `158` have zero cross-imports.
   - `157` calls `gpu.acquireInteractive()` (`118` `GpuWhisperPriorityArbiter` exposes `activateDictation`/`deactivateDictation`), checks `pressure === "Red"` (`118` emits `"RED"` — `F-055`), and calls nonexistent `components.resolveWhisperComponent(modelId)` (`132`) and `jobs.superviseWhisper(...)` (`040`).
   - `158` defaults to volatile `MemoryGlobalDbVocabularyDriver` instead of `@ef-harness/db` `GlobalBrokerDb` (`014` `global.db.vocabulary` + `settings`).
2. **`160` (`LivePreviewDaemonRunner`) & `161` (`Point-to-Fix` / `DevOnlyJsxSourceTagPlugin`) Unwired from `014, 028, 038, 040, 050, 052, 057, 093, 111, 120, 155, 174` (`F-070`):**
   - `createLivePreviewDaemonRunner` (`create-runner.ts:31-69`) instantiates `LocalLiveKeyTestRefusalGuard`, `LocalTestEnvOrchestrator`, `LocalTemplateDbSeeder`, `LocalPortLeaseRepo`, `LocalWorktreeSlotPool` (an in-memory `commits` object map rather than a real Git worktree!), `LocalWindowsJobSupervisor`, and `LocalRuntimeOnlyEnvInjector` instead of wiring `014, 038, 040, 050, 052, 111, 120`.
   - `DevOnlyJsxSourceTagPlugin` (`161`) is not exported from `@ef-harness/planner` or wired into `093` Phase 0 `P0.8`, and `BeforeAfterBaselineApprover` (`161`) is disconnected from `028` `CasBlobStore`, `057` `UiPlaywrightContractVerifier`, `155` `SingleComposerView`, `160` `IsolatedPreviewWebviewHost`, and `174` `UiConsistencyPipeline`.

## 6. Shared-File & Ownership Conflicts
- `packages/dictation/src/index.ts` and `packages/dictation/package.json` must export `stt` (`157`) and `vocabulary` (`158`) and copy `gpt2.tiktoken` into `dist/vocabulary/`.
- `packages/planner/src/index.ts` must export `jsx-source-plugin` (`161`).
- `apps/daemon/src/index.ts` (`066`) and `apps/renderer/src/index.ts` (`122`) must mount `160` and `161`.

## 7. Runtime Wiring Gaps
- Run `packages/dictation` (`157`+`158`) in `apps/daemon` (`066`) wired to `GlobalBrokerDb` (`014`), `KnowledgeGraphRepo`/`NameRegistryRepo` (`017`/`019`), `WindowsJobObjectManager` (`040`), `GpuWhisperPriorityArbiter` (`118`), and `SignedComponentDownloader` (`132`), streaming draft updates over IPC to `155` `SingleComposerView`.
- Wire `LivePreviewDaemonRunner` (`160`) to real `GlobalBrokerDb` `port_leases` (`014`), `WorktreeSlotPool` (`038`), `WindowsJobObjectManager` (`040`), `TestEnvOrchestrator` (`050`), `TemplateDbManager` (`052`), `ProjectMergeQueue` (`111`), and `RuntimeOnlyEnvInjector` (`120`).
- Move `VisualSteerRouter` (`161`) path validation + `visual-steer@1` execution to `apps/daemon` (`066`) validated by `Task 009` `VisualSteerOutputSchema` + `code-index.db` (`167`) + `CasBlobStore` (`028`) + `UiPlaywrightContractVerifier` (`057`) + `UiConsistencyPipeline` (`174`).

## 8. Architecture & Security Violations
- `F-070`: `apps/renderer/src/preview/point-to-fix/source-path.ts:1` imports `"node:path"` inside `apps/renderer`, and `apps/daemon/src/preview/local-job-supervisor.ts` fakes `killOnJobClose = true` without a Windows Job Object.

## 9. Test Coverage & Verification Gaps
- `158`'s BPE tests run against `src/` TypeScript source, missing the `dist/vocabulary/gpt2.tiktoken` `ENOENT` build packaging defect; `160`'s runner tests run against synthetic in-memory `commits` maps rather than a real `wt/<project>/integration` Git worktree.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-069` (`HIGH`):** `packages/dictation` (`157`–`158`) Empty Barrel, Uncopied `gpt2.tiktoken` Build Asset Crash (`ENOENT` in `dist/`), Disconnected `stt`↔`vocabulary` Pipeline, Volatile `MemoryGlobalDbVocabularyDriver` & Upstream `118`/`132`/`040` Signature Mismatches.
- **`F-070` (`HIGH`):** Live App Preview (`160`) & Point-to-Fix (`161`) All-Mock `createLivePreviewDaemonRunner` (In-Memory `commits` Map & Fake `killOnJobClose`), Renderer `node:path` Import, Regex-Only `VisualSteerRouter` Bypassing `visual-steer@1`, and Unwired `P0.8`/`174` Baselines.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`157, 158, 160, 161`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] Cross-checked against `009, 014, 017, 019, 028, 038, 040, 050, 052, 057, 093, 111, 118, 120, 132, 155, 167, 174`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-069`–`F-070`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-005`: `Tasks 162–165` (`apps/renderer` Cozy Office PixiJS v8 floor/sprites `73d1bd4`, seated agent cast `163`, A* animation director `0272a00`, a11y/reduced-motion/Orange fallback `165`, plus verify the 2 empty duplicate branches `162-office-pixijs-floorplan-sprites` & `164-office-animation-director-astar` at `6497730`).

---

### Report: `pass-05/chunk-005.md`

# Pass 05 — Chunk 005 Audit Report (`apps/renderer` Cozy 16-px Pixel-Art Office View, Seated Cast, Truthful A* Animation Director & Accessibility Auto-Fallback — `Tasks 162–165` + 2 Excluded Duplicate Branches)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05`
- **Chunk:** `chunk-005`
- **Active Units Audited (4):**
  - `Task 162` (`task/162-office-pixijs-floor-sprites` @ `73d1bd4`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floor-sprites`, unmerged, clean)
  - `Task 163` (`task/163-office-seated-cast-tags-flows` @ `e70dc27`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-163-office-seated-cast-tags-flows`, unmerged, clean)
  - `Task 164` (`task/164-office-animation-director-v2` @ `0272a00`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-v2`, unmerged, clean)
  - `Task 165` (`task/165-office-accessibility-auto-fallback` @ `c3401c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-165-office-accessibility-auto-fallback`, unmerged, clean)
- **Superseded Empty Duplicate Branches Verified for `Exclusions` (2):**
  - `task/162-office-pixijs-floorplan-sprites` @ `6497730` (`== main`, `0` committed product/test files; worktree `C:/Users/Ayush/Desktop/ef-wt/task-162-office-pixijs-floorplan-sprites` has only untracked `?? .agent-handoffs/task-162.md`) — superseded by `task/162-office-pixijs-floor-sprites` (`73d1bd4`).
  - `task/164-office-animation-director-astar` @ `6497730` (`== main`, `0` committed product/test files; worktree `C:/Users/Ayush/Desktop/ef-wt/task-164-office-animation-director-astar` has only untracked `?? .agent-handoffs/task-164.md`) — superseded by `task/164-office-animation-director-v2` (`0272a00`).
- **Governing Architecture Documents:** `office-view.md`, `open-design-questions.md`, `app-shell-and-governor.md`, `build-cockpit.md`, `cockpit-and-office.mmd`, `research/office-view-prior-art.md`.

## 2. Files Directly Inspected
- `apps/renderer/package.json` (`task-162`)
- `apps/renderer/src/office/renderer/{asset-paths.ts,office-pixi-viewport.ts,local-ports.ts,room-ids.ts,tiled-floor-plan-loader.ts,cozy-pixel-sprite-atlas-engine.ts}` (`Task 162`)
- `apps/renderer/src/office/cast/{office-cast-projector.ts,ports.ts,rooms.ts,format-agent-office-tag.ts}` (`Task 163`)
- `apps/renderer/src/office/director/{constants.ts,truthful-animation-director.ts,types.ts,synthetic-walkable-grid.ts}` (`Task 164`)
- `apps/renderer/src/office/a11y/{types.ts,orange-pressure-auto-board-fallback.ts,office-a11y-coordinator.ts,office-reduced-motion-adapter.ts}` (`Task 165`)

## 3. Verified Local Strengths
- `TiledFloorPlanLoader` & `CozyPixelSpriteAtlasEngine` (`162`) ship a real `floorplan-v1.tmj` containing all 11 canonical rooms with BFS-verified walkable connectivity, `< 24 MB` 16×16 nearest-neighbor pixel atlas integrity checks, `webglcontextlost`/`webglcontextrestored` hooks, WebGL-to-Canvas2D fallback, and `0`-frame hidden-tab ticker stop via `OfficeVisibilityController`.
- `OfficeCastProjector` (`163`) enforces 100% truthful `state.db` projection (`0` phantom NPCs when idle), `<= 22`-char `AgentID · short title` formatting (`A0014 · print page`), `Jr`/`Mid`/`Sr`/`Principal` rank outfits, color+shape colorblind-safe provider desk pins, strict `<= 3` helper sprites + `+N` pill, and CEO paper tray / Front Desk parcel counters.
- `TruthfulAnimationDirector` (`164`) enforces per-character `maxQueueLen = 2` queues, `400 ms` `BurstCollapseEventQueue`, `0 ms` Frame-0 `State-Beats-Motion` icon/health updates, `<= 2000 ms` lag-snap teleport, `1000 ms` minor dwell smoothing, `< 0.5 ms` A* pathfinding with snap fallback on blocked tiles, and virtual-clock testability.
- `OfficeA11yCoordinator` (`165`) provides `prefers-reduced-motion` static seated mode, `ORANGE`/`RED` automatic Board fallback with `GREEN` non-forced recovery offer, logical semantic DOM mirror with `1500 ms` debounced `aria-live="polite"`, `<= 28` Bullpen hot-desk overflow counter, and strictly OFF-by-default chimes with Focus Mode auto-mute.

## 4. Local Implementation Defects Discovered
1. **Missing `"pixi.js"` Dependency in `apps/renderer/package.json`, Forbidden Node `node:fs`/`node:path`/`node:url` Imports in Sandboxed Renderer, and Hardcoded `800×600` Bootstrap Size (`Task 162` — `F-071`):**
   - `office-pixi-viewport.ts:1` imports `{ Application, Container } from "pixi.js"`, but `apps/renderer/package.json:20-22` declares only `"@ef-harness/shared-contracts": "workspace:*"` in `dependencies` (omitting `"pixi.js"`).
   - `asset-paths.ts:1-4`, `tiled-floor-plan-loader.ts:1,49`, and `cozy-pixel-sprite-atlas-engine.ts:1,61,64` import `"node:fs"`, `"node:path"`, and `"node:url"` (`fs.readFileSync`, `fs.statSync`, `fileURLToPath`) inside `apps/renderer`, crashing Electron's sandboxed `BrowserWindow` (`sandbox: true, nodeIntegration: false`). Furthermore, `apps/renderer/package.json` `tsc` build does not bundle/copy `assets/office/*` for browser runtime consumption.
   - `OfficePixiViewport.bootstrap` (`office-pixi-viewport.ts:17-20,50-56,77-88,97-100`) accepts `options.width` and `options.height` in `OfficePixiViewportOptions`, never saves them, and hardcodes `800` and `600` (`viewportWidthPx: 800, viewportHeightPx: 600`, `app.init({ width: 800, height: 600 })`).
   - `OfficePixiViewport` initializes an empty `this.world = new Container()` (`office-pixi-viewport.ts:43,110`) without mounting tilemap sprites, cast sprites, labels, or focus rings onto the PixiJS scene graph.
2. **`OrangePressureAutoBoardFallback.setUserOverride(true)` Fails to Cap Office to Static Reduced-Motion Mode (`Task 165` `orange-pressure-auto-board-fallback.ts:56-63` — `F-072`):**
   - When the user manually overrides `ORANGE`/`RED` fallback back to Office View, `setUserOverride(true)` calls `this.pixi.start()` without forcing `OfficeReducedMotionAdapter` / `TruthfulAnimationDirector.setMotionEnabled(false)` (`seatAllAtDesks()`), violating the `Task 165` edge-case invariant requiring static reduced-motion mode while under `ORANGE` RAM pressure.

## 5. Cross-Unit Contract & Seam Mismatches
1. **3-Way `OfficeRoomId` Vocabulary Split Across `162`/`164` vs `163` vs `165` (`F-072`):**
   - `Task 162` (`room-ids.ts:2-14`) & `Task 164` (`director/constants.ts:2-14`): `"qa-verification-lab"` and `"integration-merge-bay"` (kebab-case).
   - `Task 163` (`cast/rooms.ts:4-16,59`, `office-cast-projector.ts:104,136-139`): `"qa-lab"` instead of `"qa-verification-lab"`, plus hardcoded `ROOM_ORIGIN` pixel coordinates instead of `TiledFloorPlanLoader` `deskAnchors`!
   - `Task 165` (`a11y/types.ts:1-9`): snake_case `"ceo_office"`, `"engineering_bullpen"`, `"qa_lab"`, `"merge_bay"`, `"shipping_dock"`, `"break_room"` plus virtual `"flagged"` — omitting 5 of the 11 canonical rooms (`front-desk`, `discovery-lounge`, `research-library`, `architecture-studio`, `planning-war-room`) from keyboard/screen-reader traversal!
2. **`163` ↔ `164` `OfficeCastProjector` & `162` ↔ `164` `WalkableGridPort` Contract Clashes (`F-072`):**
   - `163` `OfficeCastProjector.project(snapshot: OfficeCanonicalSnapshot, view?: OfficeViewState): OfficeCastScene` vs `164` `OfficeCastProjectorPort { project(agentId: string): CastProjection | null; listActiveAgentIds(): readonly string[] }`.
   - `162` `LoadedFloorPlan` (`walkable: ReadonlyArray<number>`, `rooms`, `deskAnchors`) vs `164` `WalkableGridSnapshot` (`walkable: ReadonlySet<string>` `"col,row"`, `roomDoorways`, `roomDesks`), causing `164` to run against `createSyntheticOfficeWalkableGrid()` (`synthetic-walkable-grid.ts:9-60`) instead of `floorplan-v1.tmj`.
3. **Upstream Cockpit & Governor Port Clashes (`162–165` vs `118, 122–127` — `F-072`):**
   - `165` `PressureMachinePort` (`a11y/types.ts:69-72`) expects `.pressure` and `.subscribe(...)`, whereas `Task 118` `PressureHysteresisStateMachine` exposes `currentLevel()` / `evaluate(sample)` without `.subscribe` (`F-055`).
   - None of `162–165` is exported from `apps/renderer/src/index.ts` (`122`) or wired to `122` `SingleAppShell`, `123` `PhaseLayoutPresetManager`, `124` `BoardCockpitView`, `125` `BoardHealthSignalEngine`, `126` `WorkerInspectorPanel`, or `127` `CalmInboxList`.

## 6. Shared-File & Ownership Conflicts
- `apps/renderer/package.json` (`122`, `153`, `162`) must add `"pixi.js"` alongside `"react"`, `"react-dom"`, `"@xyflow/react"`, and `"elkjs"`.
- `apps/renderer/src/index.ts` (`122`) must export and mount the unified `OfficeView` combining `162`, `163`, `164`, and `165`.
- Duplicate empty branches `task/162-office-pixijs-floorplan-sprites` (`6497730`) and `task/164-office-animation-director-astar` (`6497730`) must be listed in `combination_task.md` `Exclusions`.

## 7. Runtime Wiring Gaps
- Build a browser-safe asset loader for `floorplan-v1.tmj` + `cozy-office-atlas.{json,png}` + `office-tiles.png`, adapt `LoadedFloorPlan` (`162`) to `WalkableGridPort` (`164`) and `deskAnchors` (`163`), unify `OfficeRoomId` to `Task 162`'s 11 canonical `ROOM_IDS`, render cast/tile/label display objects onto `OfficePixiViewport.world`, and wire `OfficeA11yCoordinator` (`165`) to `118` `PressureHysteresisStateMachine` (over daemon IPC) and `122–127` Cockpit shell/panels.

## 8. Architecture & Security Violations
- `F-071`: `apps/renderer/src/office/renderer/{asset-paths.ts,tiled-floor-plan-loader.ts,cozy-pixel-sprite-atlas-engine.ts}` import Node's `node:fs`, `node:path`, and `node:url` inside the sandboxed Electron renderer.

## 9. Test Coverage & Verification Gaps
- Unit tests in `162–165` pass in Node Vitest using `fs.readFileSync` and mock `PixiApplicationLike` / `SIBLING_PORT_SWAPS` / `createSyntheticOfficeWalkableGrid`, never catching the missing `"pixi.js"` dependency, browser sandbox `node:fs` crash, or `"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"` room-ID mismatches.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-071` (`HIGH`):** Office 2D Renderer (`162`) Undeclared `"pixi.js"` Dependency, Forbidden Renderer `node:fs`/`node:path`/`node:url` Imports, Hardcoded `800×600` Viewport Size, Unmounted `world` Scene Graph & Empty Duplicate Branch `task/162-office-pixijs-floorplan-sprites`.
- **`F-072` (`HIGH`):** Four-Way Office Submodule Isolation (`162`–`165`): 3 Incompatible `OfficeRoomId` Vocabularies (`"qa-verification-lab"` vs `"qa-lab"` vs `"qa_lab"`), `OfficeCastProjector`/`WalkableGridPort` Clashes, Uncapped `ORANGE` User-Override Motion, Missing `118`/`122–127` Wiring & Empty Duplicate Branch `task/164-office-animation-director-astar`.

## 11. Chunk Completion Gate Verification
- [x] Every active unit in scope (`162, 163, 164, 165`) + both superseded `6497730` branches inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `office-view.md`.
- [x] Cross-checked against `106, 116, 118, 119, 122, 123, 124, 125, 126, 127`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-071`–`F-072`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-05/chunk-006`: `Tasks 166–170, 175` (`packages/brownfield` L0 scanner, L1 `web-tree-sitter` + PageRank `code-index.db`, L2 lazy module summaries, brownfield `Today`/`Change` opening flow, baseline test health & quarantine + `Task 175` M5 `resume-changer@497831ec` Exit Gate).

---

### Report: `pass-05/chunk-006.md`

# Pass 05 — Chunk 006 Audit Report (`packages/brownfield` L0–L2, Opening Flow, Baseline Test Health & `Task 175` M5 Exit Gate — `Tasks 166–170, 175`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-05` (Final chunk of Pass 05!)
- **Chunk:** `chunk-006`
- **Units Audited (6):**
  - `Task 166` (`task/166-brownfield-l0-repo-scanner` @ `01c9d1f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-repo-scanner`, unmerged, clean)
  - `Task 167` (`task/167-brownfield-l1-code-map` @ `49b2404`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-167-brownfield-l1-code-map`, unmerged, clean)
  - `Task 168` (`task/168-brownfield-l2-summaries` @ `a9d88c3`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-168-brownfield-l2-summaries`, unmerged, clean)
  - `Task 169` (`task/169-brownfield-opening-flow` @ `596121a`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-169-brownfield-opening-flow`, unmerged, clean)
  - `Task 170` (`task/170-brownfield-baseline-test-health` @ `555e097`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-170-brownfield-baseline-test-health`, unmerged, clean)
  - `Task 175` (`task/175-m5-exit-gate` @ `14d3964`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-175-m5-exit-gate`, unmerged, clean)
- **Governing Architecture Documents:** `brownfield-discovery.md`, `opening-prompts.md`, `database-design.md`, `schema/code-index.sql`, `schema/state.sql`, `prompt-contracts.md` (`module-card-writer@1`), `resume-changer-benchmark.json`, `roadmap.md` (Milestone 5), `workspace-git-and-brownfield.mmd`, `research/brownfield-repo-understanding.md`.

## 2. Files Directly Inspected
- `packages/brownfield/package.json` & `packages/brownfield/src/index.ts` (`task-167`)
- `packages/brownfield/src/l0-scan/{git-exec.ts,observed-repo-facts-persister.ts}` (`Task 166`)
- `schema/code-index.sql` & `packages/brownfield/src/l1-codemap/{code-index-db.ts,web-tree-sitter-loader.ts,wasm-tree-sitter-indexer.ts,compact-code-map-query-service.ts}` (`Task 167`)
- `packages/brownfield/src/l2-cards/{module-card-cache-engine.ts,in-memory.ts}` (`Task 168`)
- `packages/brownfield/src/opening/{brownfield-opening-controller.ts,work-item-store.ts}` (`Task 169`)
- `packages/brownfield/src/test-health/baseline-test-health-runner.ts` (`Task 170`)
- `tests/e2e/m5-exit-gate/{run-m5-suite.ts,runner.ts,brownfield.ts,office.ts,ux.ts}` (`Task 175`)

## 3. Verified Local Strengths
- `BrownfieldL0RepoScanner` (`166`) skips sensitive `.env*`/`*.pem` files without reading bytes, detects multi-language manifests/frameworks/scripts/CI/schemas, computes recent git churn & co-change pairs, and extracts monorepo package DAGs.
- `CodeIndexDatabase` & `GeneratedAndVendoredFilter` (`167`) detect corruption via `PRAGMA quick_check` with automatic rebuild, filter minified/`// @generated`/vendored files, and expand `tsconfig.json` `paths` aliases.
- `RequestDrivenFocusSelector`, `L2PreSpendEstimator`, `CodeEgressSecretMasker`, and `StaleDocsDetector` (`168`) cap focus at `<= 20` files, scrub legacy secrets before model calls, repair hallucinated symbol exports against `CodeMapQueryPort`, and verify doc paths/symbols/churn deterministically without falsely flagging stable ADRs.
- `BrownfieldOpeningController` (`169`) provides the 5 canonical brownfield quick-prompts, splits mixed bug/perf/feature prompts, enforces SQL `EXPLAIN ANALYZE` + numeric baselines on perf fixes, extracts `<= 600`-token repo conventions, and fences hostile `AGENTS.md` prompt injections.
- `BaselineTestHealthRunner` (`170`) implements broken-build preflight gating, `3×` isolated flake classification, known-failing quarantine, and zero-test characterization safety-net detection.

## 4. Local Implementation Defects Discovered
1. **`WasmTreeSitterIndexer` Never Uses Tree-Sitter WASM, Blocks Event Loop Synchronously, Checks Lowercase Governor `"orange"`/`"red"`, and Fabricates Linear Edges in `renderPersonalizedMap` (`Task 167` — `F-073`):**
   - `web-tree-sitter-loader.ts:10` calls `require("web-tree-sitter")`, which is undeclared in `packages/brownfield/package.json` (`dependencies` has only `@ef-harness/shared-contracts`), swallows the error returning `false`, bundles zero `.wasm` grammars, and `wasm-tree-sitter-indexer.ts:111` calls regex `parseStructurally(rel, content)` unconditionally without ever invoking a Tree-Sitter parser.
   - `WasmTreeSitterIndexer.index` (`wasm-tree-sitter-indexer.ts:61-130`) executes synchronously via `fs.statSync`/`fs.readFileSync` without async yielding every 25 files, and line 90 compares `signal.level === "orange" || signal.level === "red"` (lowercase) against `Task 118`'s uppercase `"ORANGE" | "RED"`.
   - `CompactCodeMapQueryService.renderPersonalizedMap` (`compact-code-map-query-service.ts:84-88`) constructs fake sequential edges `global[i] -> global[i+1]` instead of loading real `import:` / `refs` edges from `code-index.db`.
2. **Missing `module_cards` Table in `schema/code-index.sql` & Volatile In-Memory-Only `Task 168` Persistence (`F-073`):**
   - `schema/code-index.sql` defines `indexed_commits`, `commit_files`, `symbols`, `refs`, and `file_rank` — omitting `module_cards` required by `Task 168` (`code-index.db.module_cards`), leaving `Task 168` with only `InMemoryModuleCardStore` and `InMemoryObservedModuleGraph` (`in-memory.ts:15-37,97-117`) and a duplicate `packet-security-redactor.ts`.
3. **Self-Contained Toy Re-Implementations & `.ts` Extension Imports in `Task 175` M5 Exit Gate (`F-075`):**
   - `tests/e2e/m5-exit-gate/{run-m5-suite.ts,runner.ts,brownfield.ts,office.ts,ux.ts}` uses relative `.ts` imports and re-implements fake toy classes (`BrownfieldL0RepoScanner`, `WasmTreeSitterIndexer`, `CodeIndexDatabase` string-grepping `schema/code-index.sql` without SQLite, `OfficeCastProjector`, `TruthfulAnimationDirector`, `SavedNodePositionStore`, etc.) with zero workspace package imports, while `runLiveCertification` (`runner.ts:30-38`) only checks `.git/HEAD` existence.

## 5. Cross-Unit Contract & Seam Mismatches
1. **5-Way `packages/brownfield` Silo Isolation (`166`–`170`), Empty `src/index.ts` Barrel, and Upstream Port Clashes (`009, 011, 014, 017, 035, 036, 038, 048, 050, 069, 088, 093, 153` — `F-074`):**
   - `packages/brownfield/src/index.ts` is an empty `packageIdentity()` stub on all 5 branches, with zero cross-imports among `l0-scan` (`166`), `l1-codemap` (`167`), `l2-cards` (`168`), `opening` (`169`), and `test-health` (`170`).
   - `166` `git-exec.ts:22` spawns bare `"git"` from `PATH` instead of `Task 035`/`036` hermetic `MinGit`, and `ObservedRepoFactsPersister` (`166`) + `InMemoryObservedModuleGraph` (`168`) use custom `upsertObservedNode` / `upsertBrownfieldModule` ports instead of `Task 017` `KnowledgeGraphRepo` (`schema/state.sql` `node_kinds`).
   - `169` `BrownfieldOpeningController` calls `l0.scanSummary(repoRoot)` (`166` exposes `scan`), `codeMap.listModulesForPaths(...)` (absent on `167` `CompactCodeMapQueryService`), and `discovery.preSettleObservedCriteria(...)` (absent on `069` `DiscoverySessionCoordinator`), storing `work_items` only in `InMemoryWorkItemStore`.
   - `170` `BaselineTestHealthRunner` calls `worktrees.checkoutIsolated(sha)` (`038` uses `acquire`), `l0Scanner.detectScripts(path)` (absent on `166`), and `harness.runInSandbox(slot, argv)` (`048` uses `execute`), storing baseline health and `quarantined_tests` only in RAM (`in-memory.ts`) instead of `state.db` (`schema/state.sql` `quarantined_tests`).

## 6. Shared-File & Ownership Conflicts
- `packages/brownfield/src/index.ts` and `packages/brownfield/package.json` must export all 5 submodules (`l0-scan`, `l1-codemap`, `l2-cards`, `opening`, `test-health`) and declare `web-tree-sitter` + `@ef-harness/{db,git-engine,sandbox,shared-observability,discovery}`.
- `schema/code-index.sql` / `CodeIndexDb` (`014` + `167` + `168`) needs an additive `module_cards` table so `168` persists SHA-256 module cards across sessions.

## 7. Runtime Wiring Gaps
- Wire `166–170` into `apps/daemon` (`066`), `069` `DiscoverySessionCoordinator`, `088` `ContextSlicerEngine`, `093` Phase 0, `129` `CrossFeatureUsageGraphChecker`, `153` `ArchitectureCanvas` (`Today`/`Change`), and `161` `VisualSteerRouter`.
- Wire `Task 175` `tests/e2e/m5-exit-gate` to exercise the real `@ef-harness/{brownfield,dictation,renderer,integrator,daemon}` modules.

## 8. Architecture & Security Violations
- `F-074`: `166` `git-exec.ts:22` executes ambient `PATH` `"git"` instead of hermetic `MinGit` (`035`).
- `F-073`: `168` duplicates `packet-security-redactor.ts` instead of delegating to `@ef-harness/shared-observability` (`011`).

## 9. Test Coverage & Verification Gaps
- `Task 175` M5 Exit Gate passes 100% vacuously against self-contained mock classes inside `tests/e2e/m5-exit-gate/**`.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-073` (`HIGH`):** Brownfield L1/L2 (`167`–`168`) Undeclared & Uncalled `web-tree-sitter` WASM, Synchronous Event-Loop Blocking, Lowercase Governor `"orange"`/`"red"` Check, Fake Linear Edges in `renderPersonalizedMap` & Missing `code-index.db.module_cards` Persistence.
- **`F-074` (`HIGH`):** `packages/brownfield` (`166`–`170`) 5-Way Internal Silo Isolation, Empty Barrel, Ambient `PATH` `"git"`, Volatile In-Memory `work_items`/`quarantined_tests` & Upstream Port Mismatches (`017, 035, 038, 048, 069, 088, 153`).
- **`F-075` (`HIGH`):** `Task 175` M5 Exit Gate Self-Contained Toy Re-Implementations (Zero Workspace Imports, Non-SQLite `CodeIndexDatabase` Stub, `.git/HEAD`-Only Live Mode) & `.ts` Extension Imports.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`166, 167, 168, 169, 170, 175`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/code-index.sql`.
- [x] **Pass 05 100% COMPLETE (`175 / 200` units audited!).**
- [x] Findings recorded immediately in `audit_findings.md` (`F-073`–`F-075`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-001`: `Tasks 176–181` (`packages/ship-deploy` external `effects` ledger, GitHub rate-aware queue & pre-push guard, PR/CI repair loop, Vercel & Docker-SSH deploy adapters, 6-phase expand-contract prod migrations, post-deploy smoke & rollback).

---

### Report: `pass-06/chunk-001.md`

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

---

### Report: `pass-06/chunk-002.md`

# Pass 06 — Chunk 002 Audit Report (`packages/investigations` 6-Stage Mystery-Bug Pipeline, Localization Toolkit, Repo-Wide Sweep Engine & Sweep Safety Guards — `Tasks 182–185`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-002`
- **Units Audited (4):**
  - `Task 182` (`task/182-mystery-bug-investigation` @ `e61ea0c`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-182-mystery-bug-investigation`, unmerged, clean)
  - `Task 183` (`task/183-investigation-localization-toolkit` @ `1a6730f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-183-investigation-localization-toolkit`, unmerged, clean)
  - `Task 184` (`task/184-sweep-ownership-engine` @ `b2e1a1d`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-184-sweep-ownership-engine`, unmerged, clean)
  - `Task 185` (`task/185-sweep-safety-guards` @ `afa760f`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-185-sweep-safety-guards`, unmerged, clean)
- **Governing Architecture Documents:** `investigations-and-sweeps.md`, `prompt-contracts.md` (`investigator@1`, `sweep-planner@1`, `sweep-worker@1`), `schema/state.sql` (`path_leases`, `tasks`), `knowledge-slicing.md`, `investigations-and-sweeps.mmd`, `research/debugging-and-codemods.md`.

## 2. Files Directly Inspected
- `packages/investigations/package.json` & `packages/investigations/src/index.ts` (`task-184`)
- `packages/investigations/src/pipeline/{investigation-store.ts,pipeline.ts}` (`Task 182`)
- `packages/investigations/src/localization/flake-safe-git-bisector.ts` (`Task 183`)
- `packages/investigations/src/sweeps/{sweep-lease-coordinator.ts,deterministic-codemod-runner.ts}` (`Task 184`)
- `packages/investigations/src/sweep-guards/{persisted-name-boundary-gate.ts,post-sweep-brief-symbol-updater.ts}` (`Task 185`)

## 3. Verified Local Strengths
- `MysteryBugInvestigationPipeline` & `StageGateEnforcer` (`182`) enforce the 6-stage scientific sequence (`INTAKE → CLEAN_REPRO → QUARANTINED_LOCALIZE → PROVEN_MINIMAL_FLIP_ROOT_CAUSE → SCOPED_FIX → PERMANENT_REPRO_AND_MECHANISM_TESTS`), block `src/` edits during Stage 2, discard Stage 3 scratch worktrees before Stage 5, verify bidirectional `RED → GREEN → RED` minimal-flip proofs, and escalate unreproducible bugs without blind patches.
- `DeltaDebuggingInputShrinker`, `HypothesisLoopGuard`, and `SymptomPatchDetector` (`183`) enforce `<= 40`-run `ddmin` input shrinking, 3-miss narrow-subsystem tunnel-vision pivots, and detection of empty `catch` blocks, `setTimeout`/`sleep` race masks, and test weakening.
- `SweepLeaseCoordinator` & `MaintenanceWindowDrainer` (`184`) enforce single `repo_wide` sweep exclusion, sorted lexicographical path-prefix acquisition, and `<= 8`-file tail shards.
- `PersistedNameBoundaryGate`, `RiskyAstTransformDetector`, and `SweepLeftoverScanner` (`185`) expand naming variants (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`, `SCREAMING_SNAKE_CASE`), preserve Zone 2 persisted DB/API/env names and historical migrations by default, and flag variable-shadowing/ORM drift.

## 4. Local Implementation Defects Discovered
1. **Broken Binary-Search `125` Skip (`low = mid + 1`), Missing `finally` Cleanup & Ambient `PATH` `"git"` in `FlakeSafeGitBisector` (`Task 183` `flake-safe-git-bisector.ts:31-45,143-190` — `F-078`):**
   - When `commits[mid]` returns `GIT_BISECT_SKIP_EXIT` (`125` — broken intermediate build), lines `153–157` advance `low = mid + 1`, discarding the entire lower half `[low .. mid-1]` and misattributing any regression introduced prior to `mid`!
   - Uses `execFileSync("git", ...)` from `PATH` instead of `035` Hermetic `MinGit` and omits `try/finally` checkout cleanup if `BisectDepthExceededError` or `runRepro` throws mid-bisect.
2. **Missing Codemod Dependencies, Unsandboxed In-Process `ts-morph`/`ast-grep` Execution & `jscodeshift` Dry-Run Disk Mutation (`Task 184` `deterministic-codemod-runner.ts:30-96` + `package.json:20-22` — `F-078`):**
   - `packages/investigations/package.json` omits `ts-morph`, `@ast-grep/napi`, and `jscodeshift` (`ts-morph-backend.ts` exists only in `tests/sweeps/`).
   - `withSandbox` executes `ts-morph` and `ast-grep` callbacks in-process without `Task 045`/`048` sandboxing under a post-hoc `setTimeout` boolean that cannot interrupt synchronous hangs; `"jscodeshift"` (`lines 52-72`) runs `node [script]` even when `step.dryRun === true` (mutating files during dry-run) and hardcodes `preview: { filesChanged: 0, linesAdded: 0, linesRemoved: 0 }`.
3. **Private In-Memory Default `SqliteInvestigationStore` (`Task 182` `investigation-store.ts:18-36,66` — `F-078`):**
   - Defaults to `:memory:` and creates an unmigrated `investigations` table absent from `schema/state.sql`.

## 5. Cross-Unit Contract & Seam Mismatches
1. **4-Way `packages/investigations` Silo Isolation (`182`–`185`), Empty Barrel, `"queued"`/`"paused"` Task-Status Mismatch & `path_leases` Seam (`F-079`):**
   - `packages/investigations/src/index.ts` is an empty `packageIdentity()` stub across all 4 branches, with zero cross-imports (`182` never invokes `183`; `184` never invokes `185`).
   - `PostSweepBriefSymbolUpdater` (`post-sweep-brief-symbol-updater.ts:19-23,55-58`) stores `sweep_symbol_map` in a volatile `Map` and checks `task.status !== "queued" && task.status !== "paused"`, matching `0` real `state.db` tasks (`schema/state.sql` uses uppercase `'READY'`, `'BLOCKED'`, etc.).
   - `182` calls nonexistent `codeMap.queryAroundRoutes` (`167`) and `symptomCards.load` (`100`); `184` calls `openSweepIntent`/`grantSweepLease` (`mode: "intent" | "granted"`) instead of `schema/state.sql` `path_leases` (`mode IN ('write','intent','exclusive')` via `020` `TaskClaimLeasesRepo`).

## 6. Shared-File & Ownership Conflicts
- `packages/investigations/src/index.ts` and `packages/investigations/package.json` must export `pipeline`, `localization`, `sweeps`, and `sweep-guards` and declare `ts-morph`, `@ast-grep/napi`, and `@ef-harness/{db,git-engine,sandbox,verifier,brownfield,intake,planner,integrator}`.

## 7. Runtime Wiring Gaps
- Wire `183` into `182` Stages 3 & 5 and `185` into `184` `SweepOrchestrator`, persist `investigations` and `sweep_symbol_map` via `MigrationRunner` on `@ef-harness/db` single-writer `SqliteConnection`, adapt `SweepLeaseCoordinator` to `020` `path_leases` (`'intent' → 'exclusive'`), and feed `sweep_symbol_map` into `088` `ContextSlicerEngine`.

## 8. Architecture & Security Violations
- `F-078`: `184` `DeterministicCodemodRunner` executes `ts-morph`/`ast-grep` outside `045` OS sandboxing and mutates disk on `jscodeshift` `dryRun: true`; `183` executes ambient `PATH` `"git"`.

## 9. Test Coverage & Verification Gaps
- `183`'s bisect test placed the broken commit *before* the culprit (`#4` broken, `#6` culprit), accidentally masking the `low = mid + 1` bug whenever a broken commit sits *after* the true culprit!

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-078` (`HIGH`):** `investigations` (`182`–`184`) Broken `FlakeSafeGitBisector` `125` Skip (`low = mid + 1` Discards Earlier Culprits) & Missing `finally` Reset, Unsandboxed Codemods Missing `ts-morph`/`@ast-grep` Deps, `jscodeshift` Dry-Run Disk Mutation & Unmigrated `investigations` Table.
- **`F-079` (`HIGH`):** `packages/investigations` (`182`–`185`) 4-Way Internal Silos, Empty Barrel, `"queued"`/`"paused"` vs `'READY'`/`'BLOCKED'` Mismatch in `PostSweepBriefSymbolUpdater` & `path_leases` (`'granted'` vs `'exclusive'`) Seam.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`182, 183, 184, 185`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md` and `schema/state.sql`.
- [x] Cross-checked against `009, 017, 019, 020, 028, 035, 038, 039, 045, 048, 050, 055, 057, 088, 100, 111, 167, 170`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-078`–`F-079`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-003`: `Tasks 186–188` (`packages/portability` `harness-state` orphan-branch exporter, portable `.zip` archive & cross-device single-writer lease rehydrator, multi-project global WFQ resource broker).

---

### Report: `pass-06/chunk-003.md`

# Pass 06 — Chunk 003 Audit Report (`packages/portability` Orphan-Branch `harness-state` Exporter, Portable Zip/Rehydration/Lease & Multi-Project Global WFQ Resource Broker — `Tasks 186–188`)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06`
- **Chunk:** `chunk-003`
- **Units Audited (3):**
  - `Task 186` (`task/186-orphan-branch-portability` @ `1a42698`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-186-orphan-branch-portability`, unmerged, clean)
  - `Task 187` (`task/187-rehydrate-zip-lease` @ `2e76f37`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-187-rehydrate-zip-lease`, unmerged, clean)
  - `Task 188` (`task/188-global-resource-broker` @ `82f90b9`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-188-global-resource-broker`, unmerged, clean)
- **Governing Architecture Documents:** `projects-portability-and-sync.md`, `open-design-questions.md`, `execution-capacity.md`, `provider-connections.md`, `database-design.md`, `schema/state.sql`, `schema/global.sql`, `projects-portability-and-sync.mmd`, `research/portability-and-sync.md`.

## 2. Files Directly Inspected
- `packages/portability/package.json` & `packages/portability/src/index.ts` (`task-186`)
- `packages/portability/src/exporter/{repository-root.ts,age-sealed-checks-encryptor.ts,orphan-branch-portability-exporter.ts}` (`Task 186`)
- `packages/portability/src/rehydration/{orphan-branch-rehydrator.ts,age-sealed-checks-decryptor.ts,rehydration-schema.ts}` (`Task 187`)
- `packages/portability/src/broker/{global-multi-project-broker.ts,in-memory-global-grant-store.ts,machine-wide-slot-coordinator.ts}` (`Task 188`)

## 3. Verified Local Strengths
- `OrphanBranchPortabilityExporter` (`186`) exports via `git fast-import` onto `refs/heads/harness-state` without working-tree checkout, enforces `10 s` quiet debounce, skips no-op commits when `canonicalGraphSha256` is unchanged, blocks secrets before `git fast-import`, and enforces public-repo OFF-by-default push gating (`PublicRemotePushGuard`).
- `CrossDeviceLeaseManager`, `PortableZipArchiveManager`, and `LostKeyOracleRegenerator` (`187`) enforce default Read-Only Viewer mode on foreign active leases, non-FF `--force-with-lease` epoch takeover (`epoch + 1`), zip-slip path-traversal rejection, and graceful lost-`age`-key rehydration with oracle regeneration.
- `WeightedFairQueueArbiter`, `ReservedInteractiveLanePerConnection`, and `CrossProjectGrantLeaseManager` (`188`) enforce `8:4:2:1` WFQ fairness without starvation, reserved interactive fast-lane bypass, bounded partial budget grants without over-allocation, and 10-minute expired-grant reclamation.

## 4. Local Implementation Defects Discovered
1. **Undeclared `"age-encryption"` Dependency, Monorepo-Root `createRequire` Packaged-App Crash & Multi-Check Feature Drop (`Tasks 186–187` — `F-080`):**
   - `packages/portability/package.json:20-22` lists only `@ef-harness/shared-contracts` (omitting `"age-encryption"`). `186` (`age-sealed-checks-encryptor.ts:17-20`) resolves `age-encryption` via `createRequire(path.join(repositoryRoot(), "package.json"))` (`../../../../package.json`), which crashes in packaged Electron apps lacking the monorepo root; `187` (`age-sealed-checks-decryptor.ts:14`) calls `await import("age-encryption")`, failing strict pnpm resolution.
   - `OrphanBranchPortabilityExporter.runExport` (`orphan-branch-portability-exporter.ts:126-134`) tracks `seenFeatureFiles` by `checks-sealed/<featureId>.age` and `continue`s on subsequent checks for the same feature, silently dropping all sealed checks beyond the first per feature!
2. **Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` (`Task 187` `rehydration-schema.ts:6-143` — `F-080`):**
   - Opens `new DatabaseSync(":memory:")` instead of writing a durable `state.db` file and creates a custom 6-table schema that diverges from `schema/state.sql`: uses `name_registry` (instead of `names`), `feature_rollups` (instead of `rollups`), non-contentless `kb_words` without `ef_search_text`, inserts `edge` entities into `nodes` as `kind = 'arch_node'` (instead of `edges`), fabricates non-hex `` `sha256:${entity.id}:${entity.revision}` `` hashes, and omits `tasks`, `decisions`, `work_items`, and `checks`.
3. **Permanent 1-Slot Lock on `setGovernorOrange(false)` Recovery (`Task 188` `machine-wide-slot-coordinator.ts:50-56` — `F-080`):**
   - `setGovernorOrange(true)` mutates `this.limits.pool2WarmSlots = 1` without saving the baseline `initialLimits`; calling `setGovernorOrange(false)` on `GREEN` recovery evaluates `singleSlot ? 1 : this.limits.pool2WarmSlots` (`=== 1`), leaving `pool2WarmSlots` and `heavyLanePermits` stuck at `1` permanently!

## 5. Cross-Unit Contract & Seam Mismatches
1. **3-Way `packages/portability` Silo Isolation (`186`–`188`), Empty Barrel, Duplicated `age`/YAML/Secret Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` (`F-081`):**
   - `packages/portability/src/index.ts` is an empty `packageIdentity()` stub across all 3 branches, with zero cross-imports (`187` duplicates `age-sealed-checks-encryptor.ts`, `repository-root.ts`, `secret-patterns.ts`, and `yaml-format.ts`).
   - `186` uses `InMemoryKnowledgeGraph` and duplicates `canonical-hash.ts` and `packet-security-redactor.ts` instead of `007`, `011`, `017` `KnowledgeGraphRepo`, `035` `MinGit`, `091` `HiddenCheckPoolStore`, `120` `WindowsDpapiSecretsVault`, and `177` `GitHubAuthConnector`.
   - `187` `CrossDeviceLeaseManager` is unwired from `176` `LeaseEpochFencingGuard` and `130` `InterruptedRunDetector`.
   - `188` `GlobalMultiProjectBroker` ships only `InMemoryGlobalGrantStore` and an in-memory `portLeases` `Map` instead of `@ef-harness/db` `GlobalBrokerDb` (`014` `global.db.grants` & `port_leases`) and `024` `BrokerGrantIssuer`, and is unwired from `118`, `119`, and `140`.

## 6. Shared-File & Ownership Conflicts
- `packages/portability/src/index.ts` and `packages/portability/package.json` must export `exporter`, `rehydration`, and `broker` and declare `"age-encryption"`, `"yaml"`, and `@ef-harness/{db,git-engine,governor,providers,shared-observability,planner,ship-deploy}`.

## 7. Runtime Wiring Gaps
- Wire `186` + `187` to real `@ef-harness/db` `StateDb` (`schema/state.sql` + `SqliteConnection` + `ef_search_text` + `MigrationRunner`), `091` `HiddenCheckPoolStore`, `120` `WindowsDpapiSecretsVault`, `130` `InterruptedRunDetector`, and `176` `LeaseEpochFencingGuard`.
- Wire `188` `GlobalMultiProjectBroker` in `apps/daemon` (`066`) to `014` `GlobalBrokerDb`, `024` `BrokerGrantIssuer`, `118` `HeavyLaneSemaphore`/`PressureHysteresisStateMachine`, `119` `ThreePoolCapacityScheduler`, and `140` `AllowancePacingController`.

## 8. Architecture & Security Violations
- `F-080`: `186` drops 2nd+ sealed hidden checks per feature during `harness-state` export, weakening hidden oracle integrity on rehydrated devices.

## 9. Test Coverage & Verification Gaps
- `187`'s round-trip test verified against its own 6-table `:memory:` `BOOTSTRAP_SQL` rather than canonical `schema/state.sql`, and `188`'s governor test did not assert slot count restoration after `ORANGE → GREEN` recovery.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-080` (`HIGH`):** `portability` (`186`–`188`) Undeclared `"age-encryption"` & Packaged-App `createRequire` Crash, Dropped 2nd+ Sealed Checks Per Feature, Toy `:memory:` `rebuildStateDatabase` Incompatible With `schema/state.sql` & Permanent 1-Slot `setGovernorOrange(false)` Lock.
- **`F-081` (`HIGH`):** `packages/portability` (`186`–`188`) 3-Way Internal Silos, Empty Barrel, Duplicate `age`/YAML/Redactor Modules & Volatile In-Memory `GlobalGrantStore`/`portLeases` Bypassing `global.db` (`014` & `024`).

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`186, 187, 188`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`, `schema/state.sql`, and `schema/global.sql`.
- [x] Cross-checked against `007, 011, 014, 017, 024, 035, 091, 118, 119, 120, 130, 140, 176, 177`.
- [x] Findings recorded immediately in `audit_findings.md` (`F-080`–`F-081`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- `pass-06/chunk-004`: `Tasks 189–194` (`packages/meta-lab` benchmark registry, simulated developer harnesses, 3-level eval & McNemar/bootstrap promotion engine, chaos fault-injection simulator, red-team security suite, and `Task 194` external architecture review acceptance trials).

---

### Report: `pass-06/chunk-004.md`

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

---

### Report: `pass-06/chunk-005.md`

# Pass 06 — Chunk 005 Audit Report (`Tasks 195–200` Cross-Milestone Full Lifecycle E2E, Windows NSIS Packaging, Docs/Diagram/Schema Parity Gate, Performance & Scale Cert, Security/Privacy Audit & v1.0 Release Certification Gate)

## 1. Chunk Identification and Scope
- **Pass:** `pass-06` (**FINAL CHUNK OF AUDIT — 200 / 200 Tasks Complete!**)
- **Chunk:** `chunk-005`
- **Units Audited (6):**
  - `Task 195` (`task/195-e2e-cross-milestone-suite` @ `73526dc`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-195-e2e-cross-milestone-suite`, unmerged, clean)
  - `Task 196` (`task/196-windows-packaging-nsis` @ `d9af2d6`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-196-windows-packaging-nsis`, unmerged, clean)
  - `Task 197` (`task/197-docs-diagram-consistency` @ `5bf94b0`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-197-docs-diagram-consistency`, unmerged, clean)
  - `Task 198` (`task/198-performance-scale-cert` @ `dff302b`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-198-performance-scale-cert`, unmerged, clean)
  - `Task 199` (`task/199-security-privacy-audit` @ `f56f166`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-199-security-privacy-audit`, unmerged, clean)
  - `Task 200` (`task/200-release-certification-gate` @ `500e7bd`, worktree `C:/Users/Ayush/Desktop/ef-wt/task-200-release-certification-gate`, unmerged, clean)
- **Governing Architecture Documents:** `README.md`, `architecture.md`, `roadmap.md`, `desktop-app.md`, `app-shell-and-governor.md`, `database-design.md`, `sandbox-and-security.md`, `provider-connections.md`, `open-design-questions.md`, `meta-lab.md`, `ef-harness-complete.mmd`, `resume-changer-benchmark.json`, `schema/*.sql`.

## 2. Files Directly Inspected
- `tests/e2e/full-lifecycle/lib/{suite.ts,journey-greenfield.ts}` (`Task 195`)
- `apps/desktop/build/electron-builder.yml` & `scripts/packaging/{build-win-nsis.mjs,lib/paths.mjs,lib/staging.mjs}` (`Task 196`)
- `scripts/verify-docs-diagrams.mjs` (`Task 197`)
- `tests/e2e/perf-scale/certifier.ts` (`Task 198`)
- `tests/e2e/security-audit/runner.ts` (`Task 199`)
- `benchmarks/m6-release/src/{runner.ts,gates.ts}` (`Task 200`)

## 3. Verified Local Strengths
- `electron-builder.yml` (`196`) configures per-user non-UAC NSIS (`oneClick: false`, `perMachine: false`, `allowElevation: false`, `deleteAppDataOnUninstall: false`, `windowsToastId`), ASAR `.env`/`*.map`/`tests` exclusion rules, CycloneDX SBOM generation, Ed25519 integrity manifests, and `--release` fail-closed signing checks (`MissingCodeSigningCredentialsError`).
- `verify-docs-diagrams.mjs` (`197`) verifies all 31 `.mmd`/`.svg` pairs, internal Markdown relative links across root + `research/` + `skills/`, `node schema/schema-test.js` (67 checks), `X-01..X-14` + `UP-01..UP-08` counts, and `resume-changer-benchmark.json` parity.
- `V1ReleaseCertificationRunner` (`200`) honestly labels unintegrated local-port checks (`productExecuted: false`, `WITHHELD` under `full-release-certification` when signed installer/live runs are absent) rather than forging live release sign-off!

## 4. Local Implementation Defects Discovered
1. **Stub `MZEFHARNESS` Executables, Empty `module.exports = {}` `app.asar` & Fixture Placeholders in `Task 196` Windows NSIS Pipeline (`F-084`):**
   - `scripts/packaging/lib/staging.mjs:89-160` writes stub `main.cjs` (`module.exports = {}`) and `preload.cjs` into `app.asar` instead of built `apps/desktop/dist`, `apps/renderer/dist`, and `apps/daemon/dist`; writes literal `"MZEFHARNESS\r\n"` to `EF Harness.exe`; copies dummy `apps/desktop/build/fixtures/**` (`harnessd.exe`, `gitleaks.exe`, `office/atlas.json`, stub skill Markdown) instead of real `035/036/078/104/162/167` artifacts; and creates a `.nsis-stub.zip` instead of invoking `electron-builder` (which is undeclared alongside `electron` in `apps/desktop/package.json`).
2. **Wrong Workspace Package Paths (`packages/kernel`, `packages/contracts`, `corpus/skills/m2`) Causing Silent Vacuous Passes & In-Place `ef-harness-complete.mmd` Writes in `Task 197` (`scripts/verify-docs-diagrams.mjs` — `F-085`):**
   - `verifySchemaParity` (`line 257`) checks `packages/kernel/src/migrations` (real package is `packages/db`), and `verifyContractParity` (`lines 323, 409, 426`) checks `packages/contracts/src/prompts/*.json`, `packages/contracts/src/vocab/touches.json` (real package is `packages/shared-contracts` using `.ts` modules), and `corpus/skills/m2/infer-or-ask/SKILL.md` (real path is `packages/corpus/packs/skills/`). Guarded by `if (fs.existsSync(...))`, all 4 checks silently pass without inspecting a single runtime file!
   - `verifyDiagramSync` (`lines 53-72`) runs `tools/merge-diagrams.js` mutating tracked `ef-harness-complete.mmd` in place and writing `mergedBefore` back.

## 5. Cross-Unit Contract & Seam Mismatches
1. **Self-Contained Local Port Stubs (`productExecuted: false`), Plain-Text `"state.db"` Buffers & `.ts` Extension Imports Across `Tasks 195, 198, 199, 200` (`F-086`):**
   - `195` (`tests/e2e/full-lifecycle/lib/journey-greenfield.ts:38-90`) inserts 15 string stage names into a 1-table `journey_stage` DB and an in-memory `NamedPipeIpcSimulator` with zero `@ef-harness/*` workspace imports.
   - `198` (`tests/e2e/perf-scale/**`), `199` (`tests/e2e/security-audit/**`), and `200` (`benchmarks/m6-release/**`) use relative `.ts` extension imports (failing standard `tsc` emit) and invoke local `ports/*.ts` stand-ins (`199` Pillar 1 writes UTF-8 text `"create table t(c text)..."` into a file named `state.db` instead of real SQLite WAL + `030` `SecretPurgeEngine`; `200` `gates.ts:78,111-150` marks `productExecuted: false` across all 7 suites).

## 6. Shared-File & Ownership Conflicts
- `apps/desktop/package.json` (`067, 117, 131, 132, 196`) needs `"electron"` and `"electron-builder"`.
- `tests/e2e/package.json` (`068, 105, 134, 152, 175, 194, 195, 196, 197, 198, 199, 200`) must aggregate all E2E test suites and `@ef-harness/*` workspace dependencies with `.js` ESM specifiers.

## 7. Runtime Wiring Gaps
- Wire `196` `build-win-nsis.mjs` to bundle real `apps/{desktop,renderer,daemon}/dist`, real `MinGit`/`gitleaks`/WASM/`packages/corpus`/`apps/renderer/assets/office`, and real `electron-builder`.
- Point `197` `verify-docs-diagrams.mjs` at real `packages/db`, `packages/shared-contracts`, and `packages/corpus`, using a temp copy for `ef-harness-complete.mmd` comparison.
- Wire `195, 198, 199, 200` to execute the real integrated 28-package EF Harness stack (`productExecuted: true`).

## 8. Architecture & Security Violations
- `F-084` / `F-086`: Shipping stub packaging or local-port security/perf/release stand-ins without wiring real workspace packages would bypass real release verification.

## 9. Test Coverage & Verification Gaps
- All E2E certification suites (`105, 134, 152, 175, 194, 195, 198, 199, 200`) must be converted from isolated local-port harnesses to real cross-package integration suites in the final integration wave.

## 10. Findings Added / Updated in `audit_findings.md`
- **`F-084` (`CRITICAL`):** `Task 196` Windows NSIS Packaging Pipeline Ships Stub `MZEFHARNESS` Executables, Empty `module.exports = {}` `app.asar`, Fixture Placeholders & Undeclared `electron` / `electron-builder`.
- **`F-085` (`HIGH`):** `Task 197` `scripts/verify-docs-diagrams.mjs` Checks Nonexistent `packages/kernel`, `packages/contracts` & `corpus/skills/m2` Paths (Vacuous Pass) and Mutates `ef-harness-complete.mmd` In Place.
- **`F-086` (`HIGH`):** `Tasks 195, 198, 199, 200` Final E2E, Perf, Security & v1.0 Release Certification Suites Use Self-Contained Local Port Stubs (`productExecuted: false`), Non-SQLite `"state.db"` Text Files & `.ts` Extension Imports.

## 11. Chunk Completion Gate Verification
- [x] Every unit in scope (`195, 196, 197, 198, 199, 200`) inspected directly from worktree source files against `IMPLEMENTATION_TASKS.md`.
- [x] **ALL 6 PASSES & ALL 31 CHUNKS (`200 / 200` tasks, `201 / 201` `task/*` branches) 100% AUDITED AND PERSISTED!**
- [x] Findings recorded immediately in `audit_findings.md` (`F-084`–`F-086`).

## 12. Explicit Files and Relationships Still Requiring Inspection
- **NONE (`0` remaining!)** — Ready for global reconciliation and `combination_task.md` generation!

---

## Part 4 — Auditor Methodology & Continuation Runbook

# EF Harness Integration Audit — Complete Methodology, Runbook & Handoff Guide (`AUDITOR_CONTINUATION_GUIDE.md`)

**Purpose:** If the current auditor session hits a token, context, or quota limit at any point, **any human engineer or AI agent can resume seamlessly in under 2 minutes** using only the persistent files on disk in `c:/Users/Ayush/Desktop/ef harness/` — without needing prior conversation history and without re-auditing completed units.

---

## 1. Non-Negotiable Ground Rules (Read First!)

1. **Read-Only Auditor Mandate:**
   - **NEVER** implement, merge, rebase, `git checkout`, commit, stage, or edit any product code, Git branch, or worktree in `c:/Users/Ayush/Desktop/ef harness` or `C:/Users/Ayush/Desktop/ef-wt/*`.
   - You may ONLY write persistent audit files in `c:/Users/Ayush/Desktop/ef harness/`:
     - `audit_findings.md` (Master Bug Discovery Ledger — `F-001`, `F-002`, …)
     - `audit_progress.md` (Live Checkpoint & Recovery State)
     - `audit_reports/pass-NN/chunk-NNN.md` (Per-Chunk Detailed Audit Reports)
     - `audit_reports/AUDITOR_CONTINUATION_GUIDE.md` (This Runbook)
     - `combination_task.md` (Final Deliverable — written **ONLY AFTER** all 200 units are audited!)
2. **Do NOT Use Subagents:**
   - Standing user rule: **`DONT USE SUBAGENTS`**. Work sequentially in bounded chunks in the main agent loop so zero context or quota is lost to subagent failures.
3. **Never Rely on Conversation Memory Alone:**
   - Every chunk MUST follow the strict 6-step loop before moving to the next chunk:
     `CHUNK → INSPECT → ANALYZE → DOCUMENT (chunk-NNN.md) → UPDATE LEDGER (audit_findings.md) → CHECKPOINT (audit_progress.md)`

---

## 2. Repository & Worktree Topology (What Exists on Disk)

| Item | Path / Value | Notes |
|---|---|---|
| `REPO_ROOT` | `c:/Users/Ayush/Desktop/ef harness` | Checked out on `main` (`649773097c387ae534b686ea5825f449f843aa7c`). Contains all architecture `.md`/`.mmd`/`schema/*.sql`/`research/*.md` + `IMPLEMENTATION_TASKS.md` (12,797 lines, `Task 001`–`Task 200`). |
| `WORKTREE_ROOT` | `C:/Users/Ayush/Desktop/ef-wt` | Contains **202 worktree directories**: `integration` + 201 `task-NNN-*` directories corresponding to 201 `task/*` branches. |
| `INTEGRATION_BASE` | `harness/integration` (`30f2e9cb41169e3cea11f1a9946db74a5b32cfde`) | Located at `C:/Users/Ayush/Desktop/ef-wt/integration`. Previously merged `Tasks 002–089` mechanically without cross-package wiring and **missed 16 uncommitted worktree bugfix diffs** (`008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079`). `Tasks 090–200` are completely unmerged on `harness/integration`. |
| Duplicate / Superseded Branches | `task/162-office-pixijs-floorplan-sprites` (`6497730`), `task/164-office-animation-director-astar` (`6497730`) | Both sit at `main` (`6497730`) with `0` committed product/test files (only untracked `.agent-handoffs/task-162.md` / `task-164.md`), superseded by committed branches `task/162-office-pixijs-floor-sprites` (`73d1bd4`) and `task/164-office-animation-director-v2` (`0272a00`). Document both in `combination_task.md` `Exclusions`. |
| Verify Commands | `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:schema`, `pnpm verify:diagrams`, `pnpm verify:env`, `pnpm verify:harmony` | Run read-only checks from `REPO_ROOT` (`node schema/schema-test.js`, `node scripts/verify-diagrams.mjs`) or `C:/Users/Ayush/Desktop/ef-wt/integration`. |

---

## 3. Authority Hierarchy (How to Decide Which Contract Wins)

Whenever two isolated task branches or documents disagree, **neither worker branch wins by default** — resolve strictly in this order:

1. **`schema/*.sql` (`state.sql`, `global.sql`, `telemetry.sql`, `code-index.sql`, `queries.sql`) + `schema/schema-test.js` + `architecture-deep-review.md` (18 Nov 2026)** — Highest authority for SQL tables, columns, `CHECK` constraints, triggers, FTS5 (`ef_search_text`), and deep-review overrides.
2. **`database-design.md`, `kernel-schema-and-protocol.md`, `open-design-questions.md` (16–18 Nov 2026)** — Canonical SQLite single-writer rules, 5-byte IPC framing, RPC envelopes, and owner UX/product decisions (e.g., Office default Build view, `AgentID · short title`, never-auto-send dictation).
3. **`architecture-audit-response.md`, `architecture-review-decisions.md`** — Locked architectural resolutions.
4. **Domain `.md` & `.mmd` files** (`architecture.md`, `build-pipeline.md`, `security-and-governance.md`, `verification-and-runtime.md`, `app-shell-and-governor.md`, `build-cockpit.md`, `office-view.md`, `ui-design-system.md`, `brownfield-and-ship.md`, `investigations-and-sweeps.md`, `portability-and-scale.md`, `meta-harness-and-evals.md`, `prompt-contracts.md`, etc.).
5. **`research/*.md`, `skills/infer-or-ask/SKILL.md`, `resume-changer-benchmark.json`, `stack-manifest.json`**.
6. **`IMPLEMENTATION_TASKS.md`** — Authoritative ONLY for what each isolated worker was assigned to build and export.
7. **`.agent-handoffs/task-NNN.md`** — Treated strictly as **untrusted worker claims** (frequently contradicted by actual code!).
8. **Actual code in `C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`** — Ground truth of what exists today, **never** permission to keep a contract that violates #1–#5.

> **BLOCKER Rule:** Only emit a `BLOCKER` in `combination_task.md` if two #1–#5 source-of-truth files genuinely contradict each other and `AUTHORITY_ORDER` (later date beats earlier date) cannot settle it. Quote both files and paths verbatim.

---

## 4. Step-by-Step Recovery Procedure (How to Resume After Any Interruption)

### Step 1: Read Current State on Disk (Takes 30 Seconds)
1. Read `c:/Users/Ayush/Desktop/ef harness/audit_progress.md` (lines 1–65) — tells you:
   - Exact `Current pass` and `Current chunk`
   - Completed chunks (`audit_reports/pass-NN/chunk-NNN.md`)
   - Remaining chunks and units
   - Highest confirmed finding ID (`F-xxx`)
2. Read the last 70 lines of `c:/Users/Ayush/Desktop/ef harness/audit_findings.md` (`## Investigation Checkpoint` + latest `F-xxx` entry) to verify the exact last finding number and ensure no partial write occurred.
3. Verify `git -C "c:/Users/Ayush/Desktop/ef harness" status --short` shows ONLY untracked `audit_findings.md`, `audit_progress.md`, `audit_reports/` (and `combination_task.md` once generated).

### Step 2: Recreate / Use Fast Read-Only Helper Scripts (If Starting in a New Session)
If your new session does not have the previous session's `scratch/` folder, you can inspect any unit `NNN` directly with standard Git commands against `REPO_ROOT` (`c:/Users/Ayush/Desktop/ef harness`) or its worktree (`C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`):

```powershell
# 1. List all branches matching task numbers (e.g., 166..175) with SHA and worktree status:
git -C "c:/Users/Ayush/Desktop/ef harness" for-each-ref --format="%(refname:short) | %(objectname:short)" "refs/heads/task/16[6-9]*" "refs/heads/task/17[05]*"

# 2. List exact changed files on a task branch vs main (excluding .agent-handoffs):
git -C "c:/Users/Ayush/Desktop/ef harness" diff --name-status main..task/166-brownfield-l0-scanner

# 3. Check for uncommitted/dirty edits inside a task's worktree (CRITICAL — 16 earlier worktrees had uncommitted bugfixes!):
git -C "C:/Users/Ayush/Desktop/ef-wt/task-166-brownfield-l0-scanner" status --short

# 4. Find exact line numbers in IMPLEMENTATION_TASKS.md for a range of tasks:
Select-String -Path "c:/Users/Ayush/Desktop/ef harness/IMPLEMENTATION_TASKS.md" -Pattern "^### Task (166|167|168|169|170|175)\b"
```

---

## 5. Exact Per-Chunk Audit Execution Protocol (`CHUNK → INSPECT → ANALYZE → DOCUMENT → LEDGER → CHECKPOINT`)

Keep every chunk bounded to **4–6 closely related units (`~8–15` key source files read directly)** so context stays razor-sharp and never compacts mid-chunk.

### Step A — Scope the Chunk (`1 turn`)
1. Read the `IMPLEMENTATION_TASKS.md` spec blocks for the 4–6 tasks in the chunk (`Depends On`, `Owned Write Scope`, `Mandatory Reference Files`, `Shared Contracts Consumed / Produced`, `Invariants`).
2. List all files changed vs `main` for each task branch AND check `git status --short` in each worktree (`C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`) to catch any uncommitted worktree diffs or duplicate/abandoned branches.

### Step B — Read Actual Source Code Directly (`1–2 turns`, Never Rely on Handoffs!)
Read the real TypeScript/SQL/JSON files inside `C:/Users/Ayush/Desktop/ef-wt/task-NNN-*`:
- Always read `package.json`, `src/index.ts` (barrel exports!), `ports.ts` / `types.ts` / `contracts.ts`, the main engine/controller implementation files, and any factory (`create-*.ts` / `sqlite-*.ts` / `local-*.ts`).
- **High-Yield Defect Checklist (What We Repeatedly Catch Across EF Harness Workers):**
  1. **Empty Package Barrels (`src/index.ts`):** Because every branch forked from `main` (`6497730`), almost every task left `packages/<pkg>/src/index.ts` as `export function packageIdentity()` instead of exporting its modules!
  2. **Missing `package.json` Dependencies & Uncopied Non-TS Assets:** Check if code imports undeclared npm packages (`react`, `pixi.js`, `web-tree-sitter`, `electron-updater`, `@parcel/watcher`) or reads `.wasm`, `.tmj`, `.png`, `.tiktoken`, `.sql` via `fs.readFileSync(new URL(..., import.meta.url))` when `tsc` does NOT copy non-`.ts` assets to `dist/`!
  3. **Forbidden Node Built-Ins in `apps/renderer`:** Sandboxed Electron renderer (`sandbox: true, nodeIntegration: false`) CANNOT import `node:fs`, `node:path`, `node:sqlite`, `node:crypto`, or `node:child_process` (`F-058`, `F-067`, `F-070`).
  4. **Local Mock/In-Memory Stand-Ins Masquerading as Production Wiring:** Workers frequently wrote `Local*` or `InMemory*` stand-in adapters (`LocalWorktreeSlotPool`, `LocalWindowsJobSupervisor` with fake `killOnJobClose = true`, `MemoryGlobalDbVocabularyDriver`, synthetic E2E gates) instead of wiring `@ef-harness/db`, `@ef-harness/sandbox`, `@ef-harness/git-engine`, etc.
  5. **Rogue `new DatabaseSync(...)` Writers & Private DDL:** Any module opening `state.db` or `global.db` directly with `node:sqlite` `DatabaseSync` and running custom `CREATE TABLE IF NOT EXISTS` violates `database-design.md` single-writer `SqliteConnection` + `CoordinatorWriteQueue` (`015`–`016`) and often clashes with `schema/*.sql` column names, `NOT NULL` constraints, `CHECK` enums, or `ef_search_text` FTS5 triggers (`F-010`, `F-012`, `F-057`, `F-061`).
  6. **Cross-Unit Enum, Casing & Signature Mismatches:**
     - Governor pressure level casing: `118` emits `"GREEN" | "YELLOW" | "ORANGE" | "RED"` while downstream consumers (`119`, `122`, `157`, check `165`!) check `"Green"` or `"green"` (`F-055`).
     - Digest format: `"sha256:<64-hex>"` (`shared-contracts`) vs bare `<64-hex>` (`cas-blobs` `028`) (`F-007`, `F-011`).
     - Sync vs Async port methods (`CasBlobStore`, `ReaderPool`, `GitRunner`, `SecretsVault`, `RuntimeAdapter`).
     - `zod` vs `zod/v4` (`F-005`) and `layers.mjs` intra-tier workspace import ban (`F-001`).
  7. **Fake Exit Gates (`105`, `134`, `152`, check `175`, `194`, `195`, `200`!):** E2E gate tests often import relative `.ts` files or test self-contained dummy state machines inside `tests/e2e/**` without ever invoking real workspace packages!

### Step C — Write `audit_reports/pass-NN/chunk-NNN.md` (`Mandatory 12 Sections`)
Every chunk report in `c:/Users/Ayush/Desktop/ef harness/audit_reports/pass-NN/chunk-NNN.md` MUST contain these exact 12 numbered sections:
1. `## 1. Chunk Identification and Scope` (Pass, Chunk, Units with branch + short SHA + worktree path + merge/dirty status, Governing Architecture Documents)
2. `## 2. Files Directly Inspected`
3. `## 3. Verified Local Strengths` (What each unit genuinely implemented well — needed so `combination_task.md` preserves working logic!)
4. `## 4. Local Implementation Defects Discovered` (Bugs inside a single unit even before integration, with `file:line` + `F-xxx` ID)
5. `## 5. Cross-Unit Contract & Seam Mismatches` (Producer↔consumer disagreements across units, with exact signatures on both sides + `F-xxx` ID)
6. `## 6. Shared-File & Ownership Conflicts` (`package.json`, `src/index.ts`, SQL tables, config files touched by multiple branches)
7. `## 7. Runtime Wiring Gaps` (What must be connected in `apps/daemon`, `apps/desktop`, `apps/renderer`, or orchestrators)
8. `## 8. Architecture & Security Violations`
9. `## 9. Test Coverage & Verification Gaps`
10. `## 10. Findings Added / Updated in audit_findings.md`
11. `## 11. Chunk Completion Gate Verification`
12. `## 12. Explicit Files and Relationships Still Requiring Inspection`

### Step D — Immediately Append `F-xxx` Entries to `audit_findings.md` & Update Checkpoint
In `c:/Users/Ayush/Desktop/ef harness/audit_findings.md`, insert new `### F-071 — Title` entries right above `## Investigation Checkpoint` AND update `## Investigation Checkpoint` at the bottom in the same turn. Every `F-xxx` entry MUST include all **13 mandatory fields**:
- `**Status:** CONFIRMED`
- `**Severity:** CRITICAL | HIGH | MEDIUM | LOW`
- `**Category:** seam-mismatch | local-defect | missing-wiring | shared-file-conflict | schema-conflict | security-violation | build-packaging | test-gap`
- `**Affected units:**`
- `**Files and symbols:**` (with exact `path:line-range`)
- `**Actual implementation:**`
- `**Required architecture:**` (citing exact `.md` / `.sql` authority)
- `**Evidence:**`
- `**Why this is a defect:**`
- `**Required correction:**` (exact contract/wiring fix for `combination_task.md`)
- `**Dependencies:**` (`F-xxx` IDs)
- `**Verification:**` (exact `pnpm` / `node` command)
- `**Integration priority:**`

### Step E — Update `audit_progress.md` & Post a Findings Report in Chat
Update `Current chunk`, `Completed chunks`, `Remaining chunks`, `Completed units`, `Findings discovered`, and `Exact next action` in `audit_progress.md`, and share a concise structured findings summary in chat with clickable `[filename](file:///c:/Users/Ayush/...)` links.

---

## 6. Exact Roadmap of Remaining Audit Chunks (`35 / 200` Units Left as of `pass-05/chunk-004`)

1. **`pass-05/chunk-005` (`Tasks 162–165` + 2 Duplicate Branches):**
   - Active branches: `task/162-office-pixijs-floor-sprites` (`73d1bd4`), `task/163-office-seated-cast-tags-flows` (`e70dc27`), `task/164-office-animation-director-v2` (`0272a00`), `task/165-office-accessibility-auto-fallback` (`c3401c3`).
   - Excluded empty branches at `6497730`: `task/162-office-pixijs-floorplan-sprites`, `task/164-office-animation-director-astar`.
   - Check: `pixi.js` in `apps/renderer/package.json`, `.tmj`/sprite asset paths in `dist/` vs `assets/`, Node imports in `apps/renderer`, `162↔163↔164↔165` port types, Governor `"ORANGE"` vs `"Orange"` casing in `165`, `122/123/124/125/126/127` cockpit hooks.
2. **`pass-05/chunk-006` (`Tasks 166–170, 175` — Finishes Pass 05!):**
   - `packages/brownfield` (`166` L0 scanner, `167` L1 `web-tree-sitter` + PageRank `code-index.db`, `168` L2 lazy summaries, `169` brownfield opening flow `Today`/`Change`, `170` baseline test health & quarantine) + `Task 175` (M5 `resume-changer@497831ec` Exit Gate).
   - Check: `code-index.sql` schema vs `014` `CodeIndexDb`, WASM grammar loading in `167`, `088` `ContextSlicerEngine` seam, `175` real vs synthetic E2E gate.
3. **`pass-06/chunk-001` (`Tasks 176–181` — `packages/ship-deploy`):**
   - `176` external `effects` ledger (`029` `EffectsRepo` & `schema/state.sql` `effects`/`ship_runs`), `177` GitHub rate-aware queue & pre-push guard, `178` PR/CI repair loop, `179` Vercel & Docker-SSH deploy adapters (`120` DPAPI vault & `127` `ApprovalCard`), `180` 6-phase expand-contract prod migrations, `181` post-deploy smoke & rollback.
4. **`pass-06/chunk-002` (`Tasks 182–185` — `packages/investigations`):**
   - `182` 6-stage mystery-bug pipeline (`100` HAR scrubber & `055` verifier), `183` `git bisect` + `ddmin` fault localizer (`036`/`038`/`047`), `184` repo-wide sweep ownership (`020` `leases`/`lease_paths`), `185` `@ast-grep` codemod & sweep safety guards.
5. **`pass-06/chunk-003` (`Tasks 186–188` — `packages/portability`):**
   - `186` `harness-state` orphan Git branch exporter + `age-encryption` (`036`/`091`/`011`), `187` portable `.zip` bundle & rehydrator (`015`/`028`/`120`), `188` global WFQ multi-project resource broker (`014` `GlobalBrokerDb`, `024`, `118`/`119`, `140`).
6. **`pass-06/chunk-004` (`Tasks 189–194` — `packages/meta-lab` & Architecture Review Trials):**
   - `189` frozen benchmark registry, `190` simulated dev personas, `191` McNemar + paired bootstrap eval & promotion gate, `192` chaos fault-injection runner (`034`), `193` red-team suite (`045`/`097`/`100`/`120`/`149`), `194` architecture review trials.
7. **`pass-06/chunk-005` (`Tasks 195–200` — Release, Installer & v1.0 Certification):**
   - `195` cross-milestone E2E suite, `196` Windows NSIS installer + EV Authenticode signing (`117`/`131`/`132`), `197` docs/diagram/code consistency verifier, `198` 16 GB laptop perf certification, `199` security & privacy audit, `200` v1.0 Release Certification Gate.
   - Also run read-only `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint` and `node scripts/verify-diagrams.mjs`.

---

## 7. Exact Blueprint for Generating & Validating `combination_task.md` (Final Phase)

**ONLY begin generating `c:/Users/Ayush/Desktop/ef harness/combination_task.md` when:**
- All **31 chunk reports** (`pass-01..06`) exist on disk,
- All **200 tasks (`201` `task/*` branches)** are accounted for, and
- `audit_findings.md` has **`0` `UNVERIFIED`** findings.

### Required Section Order in `combination_task.md`
1. `# Goal` — What is true on `harness/integration` after the final `Cxx` task finishes.
2. `## Sources read` — Discovered `PROJECT:` block (`REPO_ROOT`, `SOURCE_OF_TRUTH`, `AUTHORITY_ORDER`, `IMPLEMENTATION_TASK_FILE`, `ISOLATION`, `WORKTREE_ROOT`, `BRANCH_PATTERN`, `INTEGRATION_BASE`, `OUTPUT_PATH`, `VERIFY_COMMANDS`, `ENTRY_JOURNEY`) + complete list of architecture/SQL/research files read.
3. `## Inventory` — Complete table of all **201 `task/*` branches** (`Task ID`, `Branch`, `Commit SHA`, `Worktree`, `Merged in harness/integration?`, `Uncommitted Worktree Diff?`, `Assigned Cxx Task or Excluded`) + `### Exclusions` subsection with exact technical reasons (`task/001-*` already in `main`; `task/162-office-pixijs-floorplan-sprites` & `task/164-office-animation-director-astar` at `6497730` superseded by `73d1bd4` & `0272a00`). Every branch MUST map to **exactly one** `Cxx` task or `Exclusions`. Remember to instruct landing tasks for `008, 009, 011, 022, 048, 053, 056, 057, 058, 059, 061, 062, 063, 064, 066, 079` to apply their uncommitted worktree bugfix diffs!
4. `## Contract atlas` — Frozen canonical TypeScript interfaces, Zod schemas, SQL tables/UDFs (`ef_search_text`), IPC envelopes, digest formats (`sha256:<64-hex>`), Governor enums (`"GREEN" | "YELLOW" | "ORANGE" | "RED"`), and runtime adapter contracts with exact source-of-truth citations.
5. `## Seam register` — Complete table mapping **every confirmed finding (`F-001`..`F-N`)** to its producer/consumer units, contract conflict, and the **earliest `Cxx` task** where those units meet and resolve it.
6. `## Wave plan` — Dependency-ordered waves (`Wave 0` workspace/lint/build plumbing → `Wave 1` contracts/observability/SQLite/IPC → `Wave 2` git/sandbox/MCP/test-env/worker/verifier/daemon/desktop M1 → `Wave 3` discovery/corpus/spec-expansion/research/planner/intake M2 → `Wave 4` integrator/steering/governor/providers/runtime-adapters M3–M4 → `Wave 5` cockpit/canvas/dictation/preview/office/brownfield M5 → `Wave 6` ship-deploy/investigations/portability/meta-lab/installer/v1.0 release M6), grouping **2–3 closely related units per `Cxx` task** (~75–90 sequential tasks total).
7. `## Blockers` — Include **ONLY** if an unresolvable contradiction exists between authoritative architecture docs (omit section if 0 blockers).
8. `## The tasks` — Sequential tasks `### C01 — ...` through `### Cnn — ...`.

### Strict Per-Task Format & Hard Line-Count Invariant (`35 <= nonBlankLines <= 55`, Target `40–50`)
Every `### Cxx` block MUST contain **40–50 non-blank lines** (hard programmatic check: `35..55` non-blank lines) and these exact subheadings in order:
- `### Cxx — <one sentence: what is true on the integration line when this task ends>`
- `Architecture.` (Exact `.md`/`.mmd`/`schema/*.sql` files & sections governing this task)
- `Land.` (Exact branches/commits — and worktree paths if harvesting uncommitted fixes — to bring onto `harness/integration`)
- `Freeze.` (Exact exported symbols, signatures, types, SQL columns, or IPC payloads locked by this task)
- `Seams.` (Exact `F-xxx` mismatches resolved in this task, naming both sides and the exact target signature/schema)
- `Local defects.` (Exact `F-xxx` single-unit bugs fixed in this task with `file:line` precision)
- `Shared files.` (Exact resolution rules for `package.json`, `src/index.ts`, `layers.mjs`, `tsconfig.json`, etc.)
- `Do not.` (Explicit guardrails so the executor model does not invent stand-ins, touch downstream packages prematurely, or weaken sandboxes/schemas)
- `Done when.` (**Self-contained!** Repeat exact `pnpm ...` verify commands, exact observable test/build output, AND the full signatures/contracts next tasks rely on — **NEVER** write `"as defined above"` or `"see the atlas"`!)
- `Stop.` (Leave `harness/integration` clean, green, and committed before `C(xx+1)` starts)

### Forbidden Vague Phrases (Zero Tolerance!)
Never write any of these in `combination_task.md`:
- `"merge and fix conflicts"`
- `"align the APIs"`
- `"match task NN's expectations"`
- `"clean up as needed"`
- `"investigate"`
- `"use your judgment"`
- `"as defined above"` / `"see the atlas"` (inside `Done when.`)

### Mandatory Programmatic Verification Script Before Declaring Completion
Before finishing, run a Node verification script asserting:
1. All **201** `refs/heads/task/*` branches appear in `## Inventory` and map `1-to-1` to either exactly one `### Cxx` `Land.` block or `### Exclusions`.
2. Every `F-001`..`F-N` in `audit_findings.md` appears in `## Seam register` AND inside at least one `### Cxx` (`Seams.` or `Local defects.`).
3. Every `### Cxx` block has `35 <= nonBlankLines <= 55` and contains all 9 subheadings (`Architecture.`, `Land.`, `Freeze.`, `Seams.`, `Local defects.`, `Shared files.`, `Do not.`, `Done when.`, `Stop.`).
4. Zero matches for forbidden vague phrases across `combination_task.md`.
5. `git status` on `c:/Users/Ayush/Desktop/ef harness` and `C:/Users/Ayush/Desktop/ef-wt/integration` shows zero modified tracked files.
