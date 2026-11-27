# EF Harness — Integration & Bugfix Run Log (`fixing_run.md`)

This log records every completed integration task (`C01`–`C79`), Wave Proof Gate (`Wave 0`–`Wave 7`), and final desktop app launch verification step (`Phase 9`) executed by subagents on `harness/integration` (`C:/Users/Ayush/Desktop/ef-wt/integration`), starting from base commit `30f2e9cb41169e3cea11f1a9946db74a5b32cfde`.

Each entry is appended by the executing subagent upon completing and verifying its work.

---


## [C01] — ESLint DAG_RANK Layer Graph & M0 Spike Vitest

- **Subagent Role & Model:** `C01 Integrator`, `inherit`
- **Commit on `harness/integration`:** `1d992c5a12a4b66c7b2ee6588bc5dbae8cc0ba06` (`integrate: wire C01 DAG_RANK layer graph and M0 spike vitest`)
- **Branches Verified / Lockfile Reconciled:**
  - Verified `c117ff2` (`task/002-spike-node-sqlite-electron`), `2938e90` (`task/003-spike-windows-sandbox`), and `a1d3a28` (`task/004-spike-execution-capacity`) are ancestors of `HEAD` (`git merge-base --is-ancestor`).
  - Confirmed clean `git status --short` in sibling worktrees `task-002-spike-node-sqlite-electron`, `task-003-spike-windows-sandbox`, and `task-004-spike-execution-capacity`.
  - Verified pre-existing `M pnpm-lock.yaml` against current workspace `package.json` manifests via `pnpm install --offline --frozen-lockfile` (exit `0`) and committed it with C01.
  - Populated `node_modules/electron/dist/electron.exe` (`electron@45.3.4`) offline from `%LOCALAPPDATA%\electron\Cache` via `node node_modules/electron/install.js` so `node-sqlite-electron` executes cleanly.
- **Findings Fixed:** `F-001`, `F-002`

### What Was Done
- [`scripts/layers.mjs`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/scripts/layers.mjs): Preserved `PACKAGE_LAYOUT` (`[id, layer, dir]` with `layer 0..5`), `LAYERS`, `PACKAGE_DIRS`, `LIBRARY_PACKAGE_IDS` (`layer < 5`, 28 library packages), and `scopedPackageName`, and added `export const DAG_RANK` with strict topological ranks `0..34` (`shared-contracts: 0` through `e2e: 34`).
- [`eslint.config.mjs`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/eslint.config.mjs): Updated `layerBoundary` (`ef/layer-boundary`) to import `DAG_RANK` instead of `LAYERS` and enforce `DAG_RANK[to] >= DAG_RANK[from]` for both `@ef-harness/*` barrel imports and relative cross-package imports.
- [`spikes/tests/windows-sandbox.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/spikes/tests/windows-sandbox.test.ts): Added a Vitest wrapper (`describe("windows-sandbox/windows-sandbox.test.mjs", ...)`) that executes `windows-sandbox/windows-sandbox.test.mjs` via `node --test` using a sanitized Windows environment allowlist (preventing Vitest-injected environment variables from causing `CreateProcessAsUserW` Tier C `child-action.mjs` exit `134`).
- [`spikes/vitest.config.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/spikes/vitest.config.ts): Added `exclude: ["execution-capacity/template-app/**", "**/node_modules/**", "**/dist/**"]` alongside `include: ["tests/**/*.test.ts", "test-services-windows/tests/**/*.test.ts"]` so all 5 M0 spike suites + `smoke.test.ts` run once each with zero skipped suites and without running `execution-capacity/template-app/**`.

### What It Fixed
- **Root Cause (`F-001`):** Coarse numeric tiers (`0..5`) in `LAYERS` caused `ef/layer-boundary` (`to >= from`) to reject legitimate acyclic intra-tier producer-to-consumer imports (`ipc -> db`, `mcp-server -> db/sandbox/test-env`, `verifier -> completeness-gate/db/sandbox/test-env`, `spec-expansion -> discovery`, `runtime-adapters -> providers/governor`, etc.). Checking `DAG_RANK` enforces strict acyclicity across all 35 workspace units while preserving `LAYERS` (`0..5`) and `LIBRARY_PACKAGE_IDS` (`28`) for `harmony.test.mjs` and package smoke tests.
- **Root Cause (`F-002`):** `spikes/vitest.config.ts` had no wrapper or runner for `spikes/windows-sandbox/windows-sandbox.test.mjs` (which uses `node:test`), and did not explicitly exclude `spikes/execution-capacity/template-app/**`. Adding the `spikes/tests/windows-sandbox.test.ts` Vitest wrapper and explicit exclusions ensures `pnpm --filter @ef-harness/spikes test` executes all 5 M0 validation spike suites cleanly without double-running existing `spikes/tests/*.test.ts` wrappers.

### Verification Run & Results
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" build` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused eslint-disable directive warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/spikes test` (`vitest run --config vitest.config.ts`): exit `0` — `Test Files 9 passed (9)`, `Tests 44 passed (44)`, `0` skipped (`tests/smoke.test.ts`, `tests/windows-sandbox.test.ts` running `windows-sandbox/windows-sandbox.test.mjs`, `tests/node-sqlite-electron.test.ts`, `tests/foreign-runtimes.test.ts`, `tests/execution-capacity.test.ts`, and `test-services-windows/tests/{oauth-mock,service-wrappers,localhost-cookies,job-object}.test.ts`)
- `node "C:/Users/Ayush/Desktop/ef-wt/integration/schema/schema-test.js"`: exit `0` — `67/67 passed · SQLite 3.53.0`
- `node --test "C:/Users/Ayush/Desktop/ef-wt/integration/scripts/harmony.test.mjs"`: exit `0` — `tests 6, suites 0, pass 6, fail 0, cancelled 0, skipped 0`
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" status --short`: clean (empty output)


---

## [C02] — Canonical JSON Hashing & Lossless SHA-256 Prefix Helpers

- **Subagent Role & Model:** `C02 Integrator`, `Gemini 2.5 Pro`
- **Commit on `harness/integration`:** `00e4377336e7e55197ffdc3fd614ad927b697d47` (`integrate: wire C02 canonical hashing and sha256 prefix helpers`)
- **Branches Verified:**
  - Verified `7c3a952` (`task/005-spike-test-services-windows`), `ed8b0b2` (`task/006-spike-foreign-runtimes`), and `baed849` (`task/007-canonical-hashing-ids`) are ancestors of `HEAD` (`git merge-base --is-ancestor`, all exited `0`).
  - Confirmed clean `git status --short` in sibling worktrees `task-005-spike-test-services-windows`, `task-006-spike-foreign-runtimes`, and `task-007-canonical-hashing-ids`.
- **Findings Fixed:** `F-007`, `F-002`

### What Was Done
- [`packages/shared-contracts/src/canonical/hash.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/canonical/hash.ts): Imported `z` from `"zod"` (not `"zod/v4"`), added `Sha256Prefixed` (`` `sha256:${string}` ``), `Sha256PrefixedSchema` (`/^sha256:[0-9a-f]{64}$/`), `Sha256HexSchema` (`/^[0-9a-f]{64}$/`), `toBareSha256Hex(digest)`, `toPrefixedSha256(digest)`, `canonicalJson` (re-export alias of `canonicalizeJson`), and `canonicalSha256(value)` (RFC 8785 JCS canonical JSON -> `sha256:<64-lowercase-hex>`), and narrowed `digestSha256` return type to `Sha256Prefixed`.
- [`packages/shared-contracts/src/canonical/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/canonical/index.ts) and [`packages/shared-contracts/src/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/index.ts): Exported `Sha256Prefixed`, `Sha256PrefixedSchema`, `Sha256HexSchema`, `canonicalJson`, `canonicalSha256`, `toBareSha256Hex`, and `toPrefixedSha256` from both the canonical subpath and root `@ef-harness/shared-contracts` barrel.
- [`packages/shared-contracts/tests/canonical/sha256-prefix.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/canonical/sha256-prefix.test.ts): Added 3 unit tests proving lossless round-trips (`toBareSha256Hex(toPrefixedSha256(h)) === h`, `toPrefixedSha256(h) === "sha256:" + h`), rejection of uppercase hex / wrong length / non-hex / invalid prefixes across helpers and Zod schemas, and RFC 8785 deterministic output for `canonicalJson` and `canonicalSha256`.
- [`spikes/foreign-runtimes/tests/foreign-runtimes.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/spikes/foreign-runtimes/tests/foreign-runtimes.test.ts), [`spikes/test-services-windows/tests/job-object.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/spikes/test-services-windows/tests/job-object.test.ts), and [`spikes/test-services-windows/src/localhost-cookies.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/spikes/test-services-windows/src/localhost-cookies.ts): Hardened `try ... finally` cleanup so ephemeral temp dirs (`ef-job-*`), Windows Job Objects/child processes, HTTP servers, browsers, and reserved loopback ports are released deterministically even if an assertion or launch fails.

### What It Fixed
- **Root Cause (`F-007`):** `@ef-harness/shared-contracts` previously only exposed `digestSha256` / `canonicalizeJson` returning unbranded `string`s and lacked canonical boundary converters and Zod schemas between `"sha256:<64-hex>"` packet digests and bare `<64-hex>` CAS/DB keys. Freezing `Sha256Prefixed`, `Sha256PrefixedSchema`, `Sha256HexSchema`, `toPrefixedSha256`, `toBareSha256Hex`, `canonicalJson`, and `canonicalSha256` gives downstream `db`, `ipc`, and `portability` packages one canonical, validated conversion boundary.
- **Root Cause (`F-002` cleanup hardening):** Several Windows spike tests/helpers placed child process termination, Job Object release, port release, or `fs.rmSync` after assertions without `try ... finally` guards; wrapping them ensures zero leaked child processes or temp directories on Windows.

### Verification Run & Results
- `pnpm --filter @ef-harness/shared-contracts lint`: exit `0`
- `pnpm --filter @ef-harness/shared-contracts test -- canonical`: exit `0` — `Test Files 8 passed (8)`, `Tests 39 passed (39)`, `0` skipped
- `pnpm --filter @ef-harness/shared-contracts test`: exit `0` — `Test Files 29 passed (29)`, `Tests 158 passed (158)`, `0` skipped
- `pnpm --filter @ef-harness/spikes lint`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused eslint-disable directive warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.0`
- `pnpm --filter @ef-harness/spikes test`: exit `0` — `Test Files 9 passed (9)`, `Tests 44 passed (44)`, `0` skipped (restored 4 auto-generated spike report files `spikes/node-sqlite-electron/{REPORT.md,report.json}` and `spikes/windows-sandbox/{REPORT.md,report.json}` afterwards)
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" status --short`: clean (empty output)


---

## [C03] — Unified Zod, EvidenceLocator, Non-Vacuous Receipts & Frozen RPC/Prompts

- **Subagent Role & Model:** `C03 Integrator`, `pro`
- **Commit on `harness/integration`:** `d7765b710f2be6091e464d1dd56fc7e02243e68e` (`integrate: wire C03 unified zod, EvidenceLocator, RPC, and prompt schemas`)
- **Branches Verified / Worktrees Harvested:**
  - Verified `9853d46` (`task/008-core-packet-schemas`) and `3d7784d` (`task/009-prompt-contract-schemas`) are ancestors of `HEAD` (`git merge-base --is-ancestor`, both exited `0`).
  - Harvested staged/uncommitted diffs from `C:/Users/Ayush/Desktop/ef-wt/task-008-core-packet-schemas` (`packages/shared-contracts/src/packets/receipt.ts`, `packages/shared-contracts/tests/packets/checkpoint.test.ts`) and `C:/Users/Ayush/Desktop/ef-wt/task-009-prompt-contract-schemas` (`packages/shared-contracts/src/prompts/common.ts`, `packages/shared-contracts/src/prompts/schemas/execution.ts`, `packages/shared-contracts/tests/prompts/schemas.test.ts`).
- **Findings Fixed:** `F-004`, `F-005`, `F-006`, `F-015`

### What Was Done
- [`packages/shared-contracts/src/packets/receipt.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/receipt.ts) and [`packages/shared-contracts/tests/packets/checkpoint.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/packets/checkpoint.test.ts): Applied `task-008` refinement on `CheckOutcomeSchema` rejecting `status === "pass"` when `collected_count === 0` (`path: ["collected_count"]`) and ported/expanded regression coverage for both `CheckOutcomeSchema` and `VerificationReceiptSchema`.
- [`packages/shared-contracts/src/packets/bounds.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/bounds.ts), [`errors.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/errors.ts), [`intents.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/intents.ts), [`messages.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/messages.ts), [`checkpoint.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/checkpoint.ts), [`worker-event.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/worker-event.ts): Standardized every packet module from `"zod/v4"` to `import { z } from "zod"` (`zod@^3.25.0`), replaced `z.int()` with `z.number().int()`, replaced `.meta({ description })` with `.describe(...)`, added `max?: number` to `integerUnits(options)` (used by `FrameHeaderSchema` and `WorkerEventSchema` instead of chaining `.max` on `ZodEffects`), updated `withinJsonByteLimit` to return `z.ZodEffects<T>`, and used `z.ZodIssueCode.custom` / `z.ZodTypeAny`.
- [`packages/shared-contracts/src/packets/catalog.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/catalog.ts): Replaced `"zod/v4"` `toJSONSchema` with an internal Zod-v3-to-JSON-Schema Draft 2020-12 converter (`zodToJsonSchema` emitting `$schema: "https://json-schema.org/draft/2020-12/schema"`, `additionalProperties: false` on `.strict()` objects, `type: "integer"` on `.int()` numbers, `prefixItems`/`items` on tuples, `propertyNames`/`additionalProperties` on records, `anyOf` on unions/discriminated unions/nullables, `allOf` on intersections, and unwrapping `ZodEffects`/`ZodOptional`/`ZodDefault`/`ZodBranded`/`ZodReadonly`/`ZodCatch`/`ZodPipeline`) and registered `stream-cancel@1`, `stream-end@1`, and `stream-error@1` in `PACKET_SCHEMAS`.
- [`packages/shared-contracts/src/packets/locators.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/locators.ts), [`packages/shared-contracts/src/prompts/common.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/prompts/common.ts), [`packages/shared-contracts/src/prompts/schemas/execution.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/prompts/schemas/execution.ts): Unified `EvidenceLocatorSchema` (aliased as `LocatorSchema` in `prompts/common.ts`) to accept all 6 kinds in both canonical camelCase (`turnId`, `charStart`/`charEnd`, `lineStart`/`lineEnd`, `region`+`ocrText`, `jsonPointer`) and snake_case prompt/intake arms (`turn`, `char_start`/`char_end`, `line_start`/`line_end`, `image` `{region, ocr_text?}` and `{x, y, w, h, ocr_text?}`, `pointer`) with `.strict()` on every object arm, exported `ImageRegionSchema`, `CanonicalEvidenceLocatorSchema`, and lossless `normalizeEvidenceLocator(locator)`, updated `refineLocator` to enforce non-empty spans (`end > start`, `charEnd > charStart`, `char_end > char_start`, `lineEnd >= lineStart`, `line_end >= line_start`) across both camelCase and snake_case variants, and ported `task-009` `LeafWorkerV1Schema` `dependency_intents`, `migration_intents`, and `wiring_needs` unions.
- [`packages/shared-contracts/src/packets/rpc.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/rpc.ts), [`packages/shared-contracts/src/packets/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/packets/index.ts), [`packages/shared-contracts/src/prompts/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/prompts/index.ts), [`packages/shared-contracts/src/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/index.ts): Kept `op_id` required on `MUTATING_RPC_METHODS` and forbidden on `READ_ONLY_RPC_METHODS` (`artifact.open`, `snapshot.get`, `events.subscribe`, `session.ping`, etc.); preserved `project_id` on `project.*`/`build.*`/`preview.*`, `question_id` on `question.answer`, `batch_id` on `batch.accept`; added optional `project?: idSchema` on project-targeted methods (`chat.send`, `question.answer`, `batch.accept`, `node.*`, `graph.view`, `impact.preview`, `plan.preview`, `inbox.*`, `artifact.open`, `diff.get`, `task.*`, `settings.*`, `diag.export`); added `stream_epoch?: nonNegativeIntSchema` on `EventsSubscribeParamsSchema`, `cursor?: z.string().min(1).max(256)` on `SnapshotGetParamsSchema`, and `stream_epoch` / `sections` / `nextCursor` compatibility alongside `views` on `SnapshotGetResultSchema`; preserved `StreamCreditGrantSchema` (`{ jsonrpc: "2.0", method: "stream.credit", params: { stream_id, credits } }`) and exported `StreamCreditNotificationSchema`, `StreamCancelNotificationSchema`, `StreamEndNotificationSchema`, `StreamErrorNotificationSchema`, `StreamControlNotificationSchema`, `JsonRpcResponseSchema`, `RpcRequestSchema`, `RpcResponseSchema`, and all 32 `*V1Schema` prompt contracts from `@ef-harness/shared-contracts`.
- Tests updated in [`tests/packets/checkpoint.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/packets/checkpoint.test.ts), [`tests/packets/examples.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/packets/examples.test.ts), [`tests/packets/rpc.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/packets/rpc.test.ts), [`tests/prompts/schemas.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/prompts/schemas.test.ts), and [`tests/smoke.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/smoke.test.ts).

### What It Fixed
- **Root Cause (`F-004`):** `CheckOutcomeSchema` lacked the refinement rejecting vacuous `status: "pass"` with `collected_count: 0`, permitting empty/unmatched test runs to pass receipt validation.
- **Root Cause (`F-005`):** Splitting `packets/*.ts` (`"zod/v4"`) from `prompts/*.ts` & `vocabularies/*.ts` (`"zod"`) produced incompatible `ZodType`/`ZodError` runtime classes, `LeafWorkerV1Schema` rejected `candidate@1` dependency/migration/wiring intents, and `EvidenceLocatorSchema` vs `LocatorSchema` diverged across camelCase packet shapes and snake_case intake/prompt shapes without lossless normalization.
- **Root Cause (`F-006`, `F-015`):** `packets/rpc.ts` lacked project-scoped `project?` params, `stream_epoch` on `events.subscribe` & `snapshot.get`, `cursor` / `sections` / `nextCursor` pagination on `snapshot.get`, and canonical stream control notification schemas (`stream.credit`, `stream.cancel`, `stream.end`, `stream.error`) needed as the sole Channel-0/Channel-1 wire authority.

### Verification Run & Results
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" grep -n "zod/v4" -- packages/shared-contracts`: exit `1` (zero matches remaining)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" build` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused eslint-disable directive warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/shared-contracts test` (`vitest run --config vitest.config.ts`): exit `0` — `Test Files 29 passed (29)`, `Tests 162 passed (162)`, `0` skipped
- `node "C:/Users/Ayush/Desktop/ef-wt/integration/schema/schema-test.js"`: exit `0` — `67/67 passed · SQLite 3.53.0`
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" status --short`: clean (empty output)


---

## [C04] — Closed Vocabularies & Zero-Leak Observability

- **Subagent Role & Model:** `C04 Integrator`, `pro`
- **Commit on `harness/integration`:** `c07aa07b51a3cc9dca6bc3558bf5cd96ce17b45e` (`integrate: wire C04 closed vocabularies and zero-leak observability`)
- **Branches Verified / Worktrees Harvested:**
  - Verified `d45eb68` (`task/010-closed-vocabularies`) and `f754213` (`task/011-logger-tracer-redactor`) are ancestors of `HEAD` (`git merge-base --is-ancestor`, both exited `0`).
  - Harvested uncommitted working-tree diffs from `C:/Users/Ayush/Desktop/ef-wt/task-011-logger-tracer-redactor` covering `.agent-handoffs/task-011.md`, `packages/shared-contracts/src/telemetry/redactor.ts`, `packages/shared-contracts/src/telemetry/tracer.ts`, `packages/shared-contracts/tests/telemetry/local-tracer.test.ts`, and `packages/shared-contracts/tests/telemetry/secret-redactor.test.ts`.
- **Findings Fixed:** `F-003`, `F-039`, `F-040`, `F-045`, `F-055`

### What Was Done
- [`packages/shared-contracts/src/telemetry/redactor.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/telemetry/redactor.ts) & [`packages/shared-contracts/src/telemetry/patterns.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/telemetry/patterns.ts): Applied `task-011` fixes (`StringDecoder("utf8")` across `Uint8Array` chunk boundaries, `SecretRedactor.register()` calling `this.forget(normalized)` for strings shorter than `MIN_REGISTERED_SECRET_LENGTH`, `collectHits()`, and `StreamingRedactor.push()` holding overlap BEFORE redaction with `renderRedactedPrefix`) plus added `findBuiltinPartialStart()` / `SecretRedactor.findPartialStart()` so partial/incomplete variable-length secret prefixes (e.g., `["sk", "_live_", "1234567890abcdef"].join("")` split before its minimum suffix length or across arbitrary byte offsets) are never sliced across `cut` when `overlap` is smaller than the token length.
- [`packages/shared-contracts/src/telemetry/tracer.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/telemetry/tracer.ts): Applied `createPooledIdFactory()` in `LocalTracer`.
- [`packages/shared-contracts/src/telemetry/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/telemetry/index.ts) & [`packages/shared-contracts/src/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/index.ts): Exported `SecretRedactor as PacketSecurityRedactor` alongside all telemetry and closed-vocabulary exports.
- [`packages/shared-contracts/src/vocabularies/basis-status.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/vocabularies/basis-status.ts), [`packages/shared-contracts/src/vocabularies/runtime.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/vocabularies/runtime.ts), & [`packages/shared-contracts/src/vocabularies/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/src/vocabularies/index.ts): Kept Task 010's `SETTLED_BASES`, `APPROVED_BASES`, `MODEL_LEVELS`, `HOLD_REASONS` (`5` SQL-parity entries in `schema/state.sql`), and `TOUCHES_TAGS` (`28`) intact without breaking existing tests; added `DECISION_BASES` / `DecisionBasis` (aliasing `SETTLED_BASES`), `NODE_STATUSES` / `NodeStatus` (`"draft" | "active" | "retired" | "superseded"`), `TASK_HOLD_REASONS` / `TaskHoldReason` (`[...HOLD_REASONS, "editor_overlap"]`), strict uppercase `PRESSURE_LEVELS` / `GOVERNOR_PRESSURES` / `PressureLevel` / `GovernorPressure` (`"GREEN" | "YELLOW" | "ORANGE" | "RED"`), `PROJECT_KINDS` / `ProjectKind` (`"web_saas" | "web_static" | "api_service" | "cli_tool" | "desktop_electron" | "mobile_web"`), `UI_PROJECT_KINDS` / `isUiProjectKind`, `WORKER_TIERS` / `WorkerTier` (`"Junior" | "Mid" | "Senior" | "Principal"`), `CREW_PRESETS` / `CrewPreset` (`"Fastest" | "Balanced" | "Cheapest"`), and canonical ingress normalizers (`normalizeProjectKind`, `normalizeWorkerTier`, `normalizeCrewPreset`).
- [`packages/shared-observability/package.json`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-observability/package.json), [`tsconfig.json`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-observability/tsconfig.json), & [`src/index.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-observability/src/index.ts): Added `"@ef-harness/shared-contracts": "workspace:*"` dependency and TypeScript project reference (updated `pnpm-lock.yaml` via `pnpm install --offline`); replaced the broken prefix-splitting `redactSecrets` stub with `getSharedSecretRedactor().redact(value)` while preserving `layer = 0`, `packageName`, `packageIdentity()`, and `formatLog`; re-exported `SecretRedactor`, `PacketSecurityRedactor`, `StreamingRedactor`, `StructuredLogger`, `LocalTracer`, `RotatingJsonlSink`, `getSharedSecretRedactor`, `scanForSecrets`, and related telemetry types/helpers.
- Tests & handoffs updated in [`.agent-handoffs/task-011.md`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/.agent-handoffs/task-011.md), [`packages/shared-contracts/tests/telemetry/local-tracer.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/telemetry/local-tracer.test.ts), [`packages/shared-contracts/tests/telemetry/secret-redactor.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/telemetry/secret-redactor.test.ts), [`packages/shared-contracts/tests/vocabularies/runtime.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-contracts/tests/vocabularies/runtime.test.ts), and [`packages/shared-observability/tests/smoke.test.ts`](file:///C:/Users/Ayush/Desktop/ef-wt/integration/packages/shared-observability/tests/smoke.test.ts).

### What It Fixed
- **Root Cause (`F-003`):** `@ef-harness/shared-observability` previously ran the Task-001 prefix-only `split(prefix).join("[redacted]")` stub leaving secret bodies in cleartext, while `StreamingRedactor` in `@ef-harness/shared-contracts` decoded chunks without `StringDecoder` and redacted before overlap holdback (plus lacked partial-prefix holdback for variable-length tokens longer than `overlap`), and `SecretRedactor.register` overwrote labels with empty variant entries on short strings. Wiring `@ef-harness/shared-observability` to `@ef-harness/shared-contracts` (valid under `DAG_RANK["shared-observability"] = 1 > DAG_RANK["shared-contracts"] = 0`) and adding pre-redaction partial-tail holdback guarantees zero leaked secret tail bytes across every byte offset and lossless UTF-8 decoding across both packages.
- **Root Cause (`F-039`, `F-040`, `F-045`, `F-055`):** Downstream packages (`planner`, `integrator`, `steering`, `governor`, `renderer`) previously defined conflicting local enums for `ProjectKind`, `WorkerTier`/`CrewLevel`, `CrewPreset`, `GovernorPressure`/`PressureLevel`, `TaskHoldReason`, and `PacketSecurityRedactor`. Freezing one authoritative vocabulary set in `@ef-harness/shared-contracts` (following `AUTHORITY_ORDER`: `schema/state.sql`, `architecture-deep-review.md`, `v1-knowledge-corpus.md`, `planning-and-crew.md`) gives all downstream integration waves a single typed contract surface while preserving Task 010 SQL-parity and prompt-schema invariants.

### Verification Run & Results
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" install --offline`: exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" build` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused eslint-disable directive warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/shared-contracts test`: exit `0` — `Test Files 30 passed (30)`, `Tests 171 passed (171)`, `0` skipped
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/shared-observability test`: exit `0` — `Test Files 1 passed (1)`, `Tests 3 passed (3)`, `0` skipped
- `node "C:/Users/Ayush/Desktop/ef-wt/integration/schema/schema-test.js"`: exit `0` — `67/67 passed · SQLite 3.53.0`
- `node --test "C:/Users/Ayush/Desktop/ef-wt/integration/scripts/harmony.test.mjs"`: exit `0` — `tests 6, suites 0, pass 6, fail 0`
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" status --short`: clean (empty output)


---

## [Wave 0 Proof Gate] — C01–C04 Verified

- **Subagent Role & Model:** `Wave 0 Gate Auditor`, `flash`
- **Commit on `harness/integration`:** `c07aa07b51a3cc9dca6bc3558bf5cd96ce17b45e` (`integrate: wire C04 closed vocabularies and zero-leak observability`)

### What Was Done
- Verified branch `harness/integration`, commit SHA `c07aa07b51a3cc9dca6bc3558bf5cd96ce17b45e`, and clean `git status --short` in `C:/Users/Ayush/Desktop/ef-wt/integration`.
- Executed the full Wave 0 Proof Gate suite across workspace build, typecheck, lint, all 5 M0 validation spikes (`@ef-harness/spikes`), `@ef-harness/shared-contracts`, `@ef-harness/shared-observability`, `schema/schema-test.js`, and `scripts/verify-diagrams.mjs`.
- Restored the 4 auto-generated spike report outputs (`spikes/node-sqlite-electron/REPORT.md`, `spikes/node-sqlite-electron/report.json`, `spikes/windows-sandbox/REPORT.md`, `spikes/windows-sandbox/report.json`) via `git checkout --` after `@ef-harness/spikes test` and re-verified `git status --short` is clean.

### What It Fixed / Verified
- **`DAG_RANK` & Workspace Hygiene (`C01`):** `tsc -b --pretty false` (`build` and `typecheck`) and `eslint .` (`lint`) passed across all 35 workspace packages/apps with `0` errors (`4` pre-existing unused eslint-disable directive warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`), confirming strict acyclic `DAG_RANK` layer boundaries.
- **All 5 M0 Spikes (`C01`–`C02`):** `@ef-harness/spikes test` passed all 9 test files (`44/44` tests, `0` skipped), verifying `node-sqlite-electron`, `windows-sandbox`, `foreign-runtimes`, `execution-capacity`, and `test-services-windows` (`oauth-mock`, `service-wrappers`, `localhost-cookies`, `job-object`).
- **Unified `zod`, `EvidenceLocator`, Non-Vacuous Receipts, RPC & 32 Prompts (`C02`–`C03`):** `@ef-harness/shared-contracts test` passed `30/30` test files (`171/171` tests, `0` skipped), confirming canonical RFC 8785 hashing + lossless `sha256:` prefix helpers, unified `zod` (`^3.25.0`), canonical `EvidenceLocator` + `normalizeEvidenceLocator`, non-vacuous `CheckOutcomeSchema` receipts, frozen Channel-0/Channel-1 RPC schemas, and all 32 prompt contract schemas.
- **Closed Vocabularies & Zero-Leak `StreamingRedactor` (`C04`):** `@ef-harness/shared-contracts` (`vocabularies/*`, `telemetry/*`) and `@ef-harness/shared-observability` (`3/3` tests in `1/1` test file) verified closed vocabularies (`SETTLED_BASES`, `APPROVED_BASES`, `HOLD_REASONS`, `TASK_HOLD_REASONS`, `PRESSURE_LEVELS`, `PROJECT_KINDS`, `WORKER_TIERS`, `CREW_PRESETS`) and zero-leak secret redaction across chunk/UTF-8 boundaries.
- **SQLite Schema & Diagram Integrity:** `schema/schema-test.js` passed `67/67` scenarios (`SQLite 3.53.0`) and `scripts/verify-diagrams.mjs` merged `31` diagrams into `ef-harness-complete.mmd` (`1219` lines) with exit `0`.

### Verification Run & Results
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" rev-parse HEAD`: `c07aa07b51a3cc9dca6bc3558bf5cd96ce17b45e` (branch `harness/integration`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" build`: exit `0` (`tsc -b --pretty false`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" typecheck`: exit `0` (`tsc -b --pretty false`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" lint`: exit `0` (`0` errors, `4` pre-existing warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/spikes test`: exit `0` — `Test Files 9 passed (9)`, `Tests 44 passed (44)`, `0` skipped
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/shared-contracts test`: exit `0` — `Test Files 30 passed (30)`, `Tests 171 passed (171)`, `0` skipped
- `pnpm --dir "C:/Users/Ayush/Desktop/ef-wt/integration" --filter @ef-harness/shared-observability test`: exit `0` — `Test Files 1 passed (1)`, `Tests 3 passed (3)`, `0` skipped
- `node "C:/Users/Ayush/Desktop/ef-wt/integration/schema/schema-test.js"`: exit `0` — `67/67 passed · SQLite 3.53.0`
- `node "C:/Users/Ayush/Desktop/ef-wt/integration/scripts/verify-diagrams.mjs"`: exit `0` — `Merged 31 diagrams into ef-harness-complete.mmd (1219 lines)`
- `git -C "C:/Users/Ayush/Desktop/ef-wt/integration" status --short`: clean (empty output after restoring the 4 generated spike report files)


---

## [C05] — Unified SqliteConnection, DbHandle, and ef_search_text

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `159657cc76ac6afbb534f78f713543399e9e0ca4` (`integrate: C05 unified db connections and ef_search_text`)
- **Findings Fixed:** `F-010`, `F-012`

### What Changed
- Cherry-picked `origin/harness/c05-wip` (`df255ed`) onto `harness/integration` (`c07aa07`) without committing, then closed the remaining gaps before the integration commit.
- Exported one `DbHandle` (`writer: SqliteConnection`, `readers: ReaderPool`, `query(name)`) and implemented it on `ProjectStateDb`, `GlobalBrokerDb`, `TelemetryDb`, and `CodeIndexDb`.
- Bound writer and reader connections to `@ef-harness/shared-contracts` `splitSearchText` through `registerEfSearchText`, including the `ReaderPool` worker. Deleted the divergent local splitters in `packages/db/src` (`driver`, `state-db`, `migrations`, `secret-purge`, `ledger`, `recovery`, `registry`, `grants`, `read-models`, `knowledge`, `search`) and re-exported the canonical function.
- Added `loadNamedQueries` / `loadCanonicalSqlAsset` / `resolveCanonicalSqlAsset`. `packages/db` build copies `schema/{state,global,telemetry,code-index,queries}.sql` into `dist/schema`.
- On this Node 22 runtime, `DatabaseSync.setAuthorizer` is absent (it exists from Node 24.10). The authorizer still installs when the method exists. Otherwise `ATTACH`/`DETACH` stay rejected by the SQL guard, and rollup writes stay rejected by the existing SQL check. Reader replacement failures no longer surface as unhandled rejections.
- Linux verification adjustments that keep the Windows checks: read-only blob opens expect `EACCES` off Windows and `EPERM` on Windows; a live owner start time is read from `/proc` off Windows and from PowerShell on Windows; the private-layout fixture is created outside `/tmp` so the world-readable warning stays a real check.

### What It Fixed
- **F-010:** `ef_search_text` on `state.db` writers and `ReaderPool` readers now uses the same acronym-aware `splitSearchText` (`XMLHttpRequest` includes `XML Http Request`; `parseXMLHttpRequest_v2` includes `parse XML Http Request v2`). Contentless `kb_words` insert and query paths no longer tokenize acronyms differently inside `packages/db`.
- **F-012:** The four databases share one `DbHandle` and one bundled SQL asset loader, so named queries resolve from the monorepo `schema/` tree and from `packages/db/dist/schema` after the package build.

### Verification Run & Results
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 61 passed (61)`, `Tests 361 passed (361)`
- `pnpm --filter @ef-harness/db build`: exit `0` — copied `state.sql`, `global.sql`, `telemetry.sql`, `code-index.sql`, and `queries.sql` into `packages/db/dist/schema`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

---

## [C06] — Forward user_version migrations

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `5103b12dc285a3ac800a06edafe1b3573429aba3` (`integrate: C06 forward user_version migrations`)
- **Findings Fixed:** `F-009`, `F-034`, `F-065`, `F-068`, `F-073`, `F-074`, `F-078`, `F-079`

### What Changed
- Wired `MigrationRunner.migrateToLatest` into `ProjectStateDb.open`, `GlobalBrokerDb.open`, and `CodeIndexDb.open` through `upgradeDatabaseOnOpen`. Added `"code-index"` to `TargetDb`.
- Frozen `schema/*.sql` stays at `user_version` 1. Production migrations now apply additive v2: `state.db` seeds `edge_types` `expands`, `contradicts`, and `informs` and creates `canvas_layout`, `investigations`, `sweep_symbol_maps`, and `stop_events`; `code-index.db` creates `module_cards` plus `schema_migrations`. A `user_version` above the known maximum is still refused. `global.db` has no v2 migration and stays at version 1.
- `packages/db/src/migrations/search-text.ts` and `packages/db/src/recovery/sqlite-io.ts` register `@ef-harness/shared-contracts` `splitSearchText` (recovery calls `registerEfSearchText`).
- `path_leases.mode` stays `'intent' | 'granted'`. `pathLeaseModeForDatabase` maps a helper value `exclusive` to `granted` and does not write `exclusive`.
- Did not edit `packages/sim`, and did not change Windows Job Object, DPAPI, named-pipe, or NSIS code.

### What It Fixed
- **F-009:** Opening a v1 `state.db` or `code-index.db` runs the forward migration (with a pre-upgrade `VACUUM INTO` backup) instead of rejecting `user_version !== 1`. `user_version` 3 on `state.db` still throws `DatabaseVersionTooNewError`.
- **F-034:** After migration, inserting edges of type `expands`, `contradicts`, and `informs` succeeds with foreign keys on. The v1 backup does not contain those types, and `schema/state.sql` is unchanged.
- **F-065 / F-068 / F-078:** `stop_events`, `canvas_layout`, `investigations`, and `sweep_symbol_maps` are created by the state v2 migration so later packages do not invent those tables on a private connection. Renderer, steering, and investigations package wiring stays in later tasks.
- **F-073:** `code-index.db` gains `module_cards` (`file_path`, `file_content_sha256`, `prompt_version`, `card_json`) at `user_version` 2. `schema/code-index.sql` is unchanged.
- **F-074 / F-079:** `work_items` was already in frozen `schema/state.sql`. Sweep lease mode stays `intent` then `granted`. Brownfield package wiring stays in later tasks.

### Verification Run & Results
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`). Plain `pnpm lint` aborted with exit `134` on the default heap before reporting results.
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 61 passed (61)`, `Tests 362 passed (362)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

---

## [C07] — Knowledge graph, FTS5 search, and name registry on ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `254f4db19d0103dda2132f5242dc51961aa31feb` (`integrate: C07 bind knowledge search and name registry`)
- **Findings Fixed:** `F-007`, `F-010`, `F-012`, `F-038` (this seam only)

### What Changed
- Did not re-merge `origin/task/017-knowledge-graph-repo`, `origin/task/018-fts5-knowledge-search`, or `origin/task/019-name-registry-hygiene`. Bound the live classes `KnowledgeGraphRepo`, `KnowledgeSearchService`, and `NameRegistryService` to the open `ProjectStateDb` writer (`bindKnowledgeGraph`, `bindKnowledgeSearch`, `bindNameRegistry`). None of those classes opens a private `DatabaseSync`.
- Knowledge and registry `queries.sql` parsing now uses the driver catalog (`parseQueryCatalog` / `lookupNamedQuery` / `loadCanonicalSqlAsset`). Removed the registry filesystem walker and its local `splitSearchText` wrapper. `openStateConnection` and `openMemoryStateDb` register `ef_search_text` through `registerEfSearchText`.
- `nodes.content_hash` writes go through `toPrefixedSha256` (`sha256:<64-hex>`). `KnowledgeGraphRepo` stores `fields.names` as objects `{kind, value}` and rejects a bare string before the trigger. `NameRegistryService` already wrote that shape and now stores a prefixed content hash.
- `KnowledgeSearchService` still tokenizes free text with `sanitizeFtsQuery` (quotes, `:`, `*`, `NEAR` never reach FTS5 as operators). Search reads on the bind path use the same writer connection as the graph.
- Left `MigrationRunner` and frozen `user_version` 1 alone. Did not edit `packages/sim`, `path_leases.mode`, or Windows Job Object, DPAPI, named-pipe, or NSIS code. Planner `SkeletonLockEnforcer` / synthesizer conflicts in `F-038` stay in the planner wave.

### What It Fixed
- **F-007:** Graph and name-registry node writes persist `sha256:<64-hex>` content hashes. Bare hex from the registry hasher is prefixed at the write boundary.
- **F-010:** This seam no longer has a local `ef_search_text` implementation. Inserts through `ProjectStateDb` and searches for `XMLHttpRequest` use the shared acronym split (`XML Http Request`).
- **F-012:** The three repositories share one `ProjectStateDb` writer and the driver query catalog instead of a second connection and a private `queries.sql` parser.
- **F-038:** `fields.names` committed by `KnowledgeGraphRepo` matches `schema/state.sql` (`json_each` of `{kind, value}`), so the `names` trigger fills and replaces registry rows in the same transaction. A duplicate name aborts the change set.

### Verification Run & Results
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 62 passed (62)`, `Tests 364 passed (364)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

---

## [C08] — Task claiming, path leases, holds, and DONE invariants

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `168f474549b6e273df8b7f07a0b035b276c868f6` (`integrate: C08 bind claiming holds and lifecycles`)
- **Findings Fixed:** `F-008`, `F-012`, `F-039`, `F-079` (this seam only)

### What Changed
- Did not re-merge `origin/task/020-task-claiming-leases-sleep-guard` (`336e7e5`), `origin/task/021-holds-submissions-fencing` (`4f5c3f6`), or `origin/task/022-feature-project-lifecycles` (`a3c8977`). All three are ancestors of `254f4db`. The 020 and 021 tips are handoff-only and were not reapplied. `task-008.patch`, `task-009.patch`, and `task-011.patch` were not applied.
- `git apply --stat` and `git apply --check` on `dirty_worktree_patches/task-022.patch` both exited `0` against `254f4db` (`packages/db/src/lifecycles/done.ts` 14 lines, `packages/db/src/lifecycles/repo.ts` 94 lines). `git apply` then exited `0`.
- `coversScope` treats a scope as covered only when an audited path equals it or the scope starts with that path (`scopePrefix.startsWith(audited)`). A child file or a sibling string prefix no longer satisfies `DONE`.
- `contractsCurrent` counts a `read_sets` row only from an `accepted` attempt at the task node's current `brief_version`.
- Leaving `BLOCKED` resumes only to the pre-block state stored in `meta` (`feature_pre_block_state:<feature>`), except `DEFERRED` and `ABANDONED`. Approved exits are stored in `meta` (`feature_exit_approved:<feature>`) and still count after outbox rows are deleted.
- Bound the live classes `TaskLeaseManager`, `TaskHoldAndSubmissionRepo`, and `LifecycleRepo` to the open `ProjectStateDb` writer (`bindTaskLeases`, `bindTaskHolds`, `bindLifecycles`). None of those classes opens a private `DatabaseSync`. Holds and lifecycles load `queries.sql` through `loadCanonicalSqlAsset` on that bind path.
- `path_leases.mode` stays `'intent' | 'granted'` (`schema/state.sql` CHECK). `pathLeaseModeForDatabase` still maps a helper value `exclusive` to `granted` and does not write `exclusive`. Hold reasons stay the five schema values (`user_pause`, `requirement_change`, `budget`, `ccr`, `governor`).
- Left `MigrationRunner` and the C07 knowledge, search, and name-registry binds alone. Did not edit `schema/**`, `packages/sim`, or Windows Job Object, DPAPI, named-pipe, or NSIS code. Dropped the unused `parseJsonObject` import in `repo.ts` after the outbox scan moved to `meta`.

### What It Fixed
- **F-008:** `DONE` no longer treats one child file as a full scope audit. A rejected attempt, or an accepted attempt on a different brief, no longer satisfies contract currency. A `BLOCKED` feature cannot skip to a later state, and an approved `DEFERRED` or `ABANDONED` exit remains after outbox pruning.
- **F-012:** Claiming, holds, and lifecycles share one `ProjectStateDb` writer instead of a second connection.
- **F-039:** This seam keeps `task_holds.reason` on the five schema values. `revision_in_flight`, `user_paused`, and `waiting_on_human_step` fail `isHoldReason`. Planner and MCP tool-name mismatches stay in later waves.
- **F-079:** Sweep leases still move `'intent'` to `'granted'`. A caller that says `exclusive` is stored as `granted`. An open intent lease still blocks an overlapping claim. Investigations package wiring stays in later tasks.

### Verification Run & Results
- `git merge-base --is-ancestor` for `336e7e5`, `4f5c3f6`, and `a3c8977`: exit `0` (all ancestors). `git rev-parse` tips match those SHAs.
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-022.patch`: exit `0`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-022.patch`: exit `0`
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-022.patch`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 63 passed (63)`, `Tests 369 passed (369)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

---

## [C09] — Integer budget reservations, cross-db grants, and group-commit write queue

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `d33a322ff65f234cc29c30d86649731100731fc7` (`integrate: C09 bind budget grants and write queue`)
- **Findings Fixed:** `F-012`, `F-013`, `F-047`, `F-065`, `F-081` (this seam only)

### What Changed
- Did not re-merge `origin/task/023-budget-reservation-ledger` (`96649df`), `origin/task/024-cross-db-grant-protocol` (`e16d754`), or `origin/task/025-idempotency-group-commit` (`b0a731a`). `git merge-base --is-ancestor` against `168f474` exited `0` for all three. No dirty patch for C09. `task-022.patch` was already applied and was not reapplied.
- Kept the live classes `BudgetLedgerRepo`, `BrokerGrantIssuer`, `ProjectGrantReceiver`, and `CoordinatorWriteQueue`. Did not rename them to `BudgetReservationLedger`, `CrossDbGrantProtocol`, or `IdempotencyOpsManager`. `enqueue` stays private. The public queue methods are `submitOperation` (Promise) and `submitOperationSync` (one idempotent write when the writer is free).
- Bound those classes to the open writers (`bindBudgetLedger`, `bindBrokerGrantIssuer`, `bindProjectGrantReceiver`, `bindCoordinatorWriteQueue`). None of the bind paths opens a second `DatabaseSync` or runs `ATTACH`.
- Added `BudgetLedgerRepo.getScopeSnapshot`. A scope is `hardStop` when any currency row is overrun or has `remainingUnits === 0`. `raiseBudgetLimit` stays the limit writer. There is no `setHardStop` column in `schema/state.sql`.
- `defaultComputeRequestHash` now calls `@ef-harness/shared-contracts` `computeRequestHash` (`sha256:` plus canonical NFC JSON). A repeated `op_id` with a different digest still throws `OpIdReusedError`.
- `ledger/database.ts` and `grants/session.ts` already registered `@ef-harness/shared-contracts` `splitSearchText`. No local splitter remained on `168f474`.
- `GrantSqlSession.adopt` uses the caller's writer and does not close it. `assertSingleDatabase` rejects attached databases other than `main` and `temp`.
- Left `MigrationRunner`, the C07 knowledge/search/registry binds, and the C08 path leases alone. `path_leases.mode` stays `'intent' | 'granted'`. Did not edit `schema/**`, `packages/sim`, or Windows Job Object, DPAPI, named-pipe, or NSIS code. ipc adapters, integrator, cockpit, and portability package wiring stay in later waves.

### What It Fixed
- **F-012:** Budget reservations, grant issue/deposit, and the write queue share the open `ProjectStateDb` and `GlobalBrokerDb` writers instead of a second connection.
- **F-013:** `CoordinatorWriteQueue` now has a synchronous receipt entrypoint and the existing Promise entrypoint, both keyed by the canonical request digest. ipc port adapters stay in a later wave.
- **F-047:** `BudgetLedgerRepo.getScopeSnapshot` is the scope read `CompletionWaveController` can call later. Integrator wiring stays in that wave. Live reserve/settle/release names were not renamed.
- **F-065:** The bound ledger is `BudgetLedgerRepo` on `state.db`, with integer `micro-USD` units. Steering's in-memory ledger stays in a later wave.
- **F-081:** `BrokerGrantIssuer` is bound to `GlobalBrokerDb`'s writer and `global.db.grants`. Portability's in-memory grant store stays in a later wave.
- **Idempotency:** operation payloads are stored as `sha256:<64-hex>`. Replaying the same `op_id` with a different payload is rejected and does not run the execute function again.
- **Last unit:** 50 `reserveAcrossScopes` calls for the last `1` micro-USD on one project scope produced `1` winner and `49` `{ ok: false }` results, with `0` `SQLITE_BUSY` errors. The live result is `blockingScopes`, not a separate `InsufficientBudgetError` type.

### Verification Run & Results
- `git merge-base --is-ancestor` for `96649df`, `e16d754`, and `b0a731a`: exit `0` (all ancestors of `168f474`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 64 passed (64)`, `Tests 370 passed (370)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

---

## [C10] — Transactional outbox and board rollups on ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `77877f0477abc7dcbb930c96b0eb3fcb9212be73` (`integrate: C10 bind outbox and read models`)
- **Findings Fixed:** `F-006`, `F-012`, `F-013`, `F-026`, `F-064` (this seam only)

### What Changed
- Re-verified on `d33a322`. Did not re-merge `origin/task/026-transactional-outbox` (`ce1ab76`) or `origin/task/027-read-models-rollups-drift` (`a95c149`). `git merge-base --is-ancestor` exited `0` for both. No dirty patch for C10. The only tip diff versus `a95c149` was `packages/db/src/read-models/sql.ts`, already using `@ef-harness/shared-contracts` `splitSearchText`. No local splitter remains on that production path.
- Kept the live classes `OutboxRepo` and `ReadModelRepo`. Did not rename them to `TransactionalOutboxRepo` or `ReadModelsAndRollupsRepo`. Did not add `getLatestSeq`.
- Bound those classes to the open `ProjectStateDb` writer (`bindOutbox`, `bindReadModels`). Neither bind opens a second `DatabaseSync`. `ReadModelRepo.close()` does not close the shared writer. The driver's `ATTACH` denial stays; the read-model connection refuses application writes to `rollup_feature_tasks` and `rollup_feature_requirements` except inside drift heal.
- `OutboxRepo.appendEvent` inserts `outbox` and `outbox_deliveries` on the bound writer and still requires the caller's open transaction, so a `CoordinatorWriteQueue` savepoint is the transaction. `readSinceSeq(streamEpoch, afterSeq, limit)` pages with the live gap-free replay. `ackDelivery` and `currentStreamEpoch` are the bound names. `currentStreamEpoch` returns the `meta.stream_epoch` text only when it is a non-empty canonical integer string (`"1"`, `"2"`, …).
- `ReadModelRepo.getBoardSnapshot(cursor?, limit?)` pages the trigger-maintained feature rollup. `getFeatureRollups` returns that rollup. `recomputeRollupsAndVerifyZeroDrift` runs the live drift heal and refuses a report that found drift and did not heal it. The board page reads rollup rows and does not `COUNT(*)` task facts.
- Left `MigrationRunner`, the C07 knowledge binds, the C08 path leases, and the C09 budget, grant, and write-queue binds alone. `path_leases.mode` stays `'intent' | 'granted'`. Did not edit `schema/**`, `packages/sim`, or Windows Job Object, DPAPI, named-pipe, or NSIS code. Did not start the three `CasBlobStore` unification. ipc adapters, `apps/daemon`, and `BoardCockpitView` wiring stay in later waves.

### What It Fixed
- **F-012:** Outbox append/replay and board/drift reads share the open `ProjectStateDb` writer instead of a second connection.
- **F-013:** The bound outbox exposes `readSinceSeq`, `ackDelivery`, and `currentStreamEpoch` next to the live connection-passed methods. The bound read model exposes `getBoardSnapshot` and `getFeatureRollups` next to `getBoardSummary` and `getFeatureProgress`. ipc port adapters stay in a later wave. `getLatestSeq` was not added.
- **F-006:** `currentStreamEpoch()` reads `state.db.meta.stream_epoch` and returns it as a non-empty canonical integer string. `ProjectStateDb.getStreamEpoch()` stays a number.
- **F-026:** Appending two events through `CoordinatorWriteQueue.submitOperationSync` plus `OutboxRepo.appendEvent` left `0` rows in the `outbox_without_deliveries` check and `0` `SQLITE_BUSY` errors. Daemon rewiring stays in a later wave.
- **F-064:** `getBoardSnapshot` is the cursor page of feature rollups a later board view can read. Renderer and health-slot wiring stay in a later wave.
- **Zero drift:** after a direct rollup tamper, `recomputeRollupsAndVerifyZeroDrift()` healed, and the next call reported `drifted === false` with `rollup_feature_tasks.n` back to `1`.

### Verification Run & Results
- `git merge-base --is-ancestor` for `ce1ab76` and `a95c149`: exit `0` (both ancestors of `d33a322`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 65 passed (65)`, `Tests 371 passed (371)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

## [C11] — Unified CasBlobStore, seekable logs, and secret purge

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `3d26ce9ba360874c349e65aa4bd68b49c266bf90` (`integrate: C11 unify CasBlobStore and secret purge`)
- **Findings Fixed:** `F-007`, `F-010`, `F-011`, `F-012` (this seam only)

### What Changed
- Re-verified on `77877f0477abc7dcbb930c96b0eb3fcb9212be73`. Did not re-merge `origin/task/028-cas-artifact-store-gc` (`49ff155`), `origin/task/029-seekable-logs-retention-archive` (`e289bb9`), or `origin/task/030-secret-purge-engine` (`71bacaa`). `git merge-base --is-ancestor` exited `0` for all three. No dirty patch for C11.
- One `CasBlobStore` now accepts `"zstd" | "zstd-seekable" | "raw"`. `zstd-seekable` writes store the caller's pre-framed bytes and do not compress them again. The key is still the SHA-256 of the uncompressed bytes. `normalizeCasHash` uses `@ef-harness/shared-contracts` `toBareSha256Hex`, so both `"sha256:<64-hex>"` and bare `<64-hex>` are accepted, and `cas_blobs.hash` stays bare. Reads and `forceDeletePurgedBlob` / `purgeDigestBytes` cover `.zst` and `.raw`.
- Added `put`, `getBytes`, `openReadStream`, `has`, `deleteUnreferencedGc`, and `purgeDigestBytes` beside the existing `putBlob` / `getBlob` / `runGarbageCollection` / `forceDeletePurgedBlob` methods. `toArtifactCasPort` + `bindArtifactManager` and `toSecretPurgeCasPort` + `bindSecretPurgeEngine` are the sync views `ArtifactManager` and `SecretPurgeEngine` call. `RawFileCasBlobStore` reads and unlinks both `.zst` and `.raw`, and it can store a pre-framed `zstd-seekable` payload.
- `SeekableLogArchiver` archives text logs through that store. Logs over 1 MB go in as `zstd-seekable`. `openReadStream(digest, { start, end })` returns an uncompressed byte range. `EffectsRepo` / `bindEffects` writes `state.db.effects` on the open `ProjectStateDb` writer using the schema states `intended | approved | sent | confirmed | failed | unknown`, stores `payload_hash` as bare hex, and rejects an idempotency key reused with a different hash.
- `ensureSearchTextFunction` now calls `registerEfSearchText`, which is `@ef-harness/shared-contracts` `splitSearchText`. If a connection already has `ef_search_text`, the probe must match `splitSearchText("XMLHttpRequest")` or purge refuses to continue.
- Left `bindOutbox`, `bindReadModels`, `appendEvent`, `readSinceSeq`, `ackDelivery`, `currentStreamEpoch`, `getBoardSnapshot`, `getFeatureRollups`, `recomputeRollupsAndVerifyZeroDrift`, the C09 grant binds, `MigrationRunner`, and `path_leases.mode` `'intent' | 'granted'` alone. Did not edit `schema/**`, `packages/ipc`, or `packages/sim`. Did not touch Windows Job Object, DPAPI, named-pipe, or NSIS code. Did not start C12.

### What It Fixed
- **F-007:** Packet `sha256:` digests and bare CAS hashes cross the store boundary through `toBareSha256Hex`. Rows and filenames stay bare 64-hex.
- **F-010:** Secret-purge FTS rebuild no longer keeps a local tokenizer. Step 4 uses the canonical acronym split (`XMLHttpRequest` → `XML Http Request`).
- **F-011:** `ArtifactManager` and `SecretPurgeEngine` run against the same `CasBlobStore`. A >1 MB log is stored as one pre-framed `.zst` seekable blob and a byte range reads back. Purge deletes both `.zst` and `.raw`, including a seekable blob that held the canary.
- **F-012:** `EffectsRepo` shares the open `ProjectStateDb` writer. Artifact and purge binds keep the caller's project database handle and do not open a second `DatabaseSync` for `state.db`.

### Verification Run & Results
- `git merge-base --is-ancestor` for `49ff155`, `e289bb9`, and `71bacaa`: exit `0` (all ancestors of `77877f0477abc7dcbb930c96b0eb3fcb9212be73`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 67 passed (67)`, `Tests 374 passed (374)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

## [C12] — IPC JSON-RPC bound to shared contracts and ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `b4395324530419cd30767dd662e0825c3d04f550` (`integrate: C12 bind ipc to db and contracts`)
- **Findings Fixed:** `F-003`, `F-006`, `F-013`, `F-014` (this seam only)

### What Changed
- Re-verified on `3d26ce9ba360874c349e65aa4bd68b49c266bf90`. Did not re-merge `origin/task/031-named-pipe-ipc-transport` (`e23f4fe`) or `origin/task/032-ipc-event-stream-resync` (`2117d11`). `git merge-base --is-ancestor` exited `0` for both. No dirty patch for C12. Live tree stays `packages/ipc/src/protocol/`, not `resync/`.
- `packages/ipc` now depends on `@ef-harness/db` and `@ef-harness/shared-observability`. `LocalSecretRedactor` is the canonical `SecretRedactor`. Transport logs still go through that redactor.
- Channel 0 requests validate with `@ef-harness/shared-contracts` `JsonRpcRequestSchema`. `op_id` sits on the mutating envelope. `question_id`, `batch_id`, and `project_id` are the wire names. `artifact.open` is read-only. `diag.export` is mutating. `events.subscribe` accepts a numeric `stream_epoch` or the canonical integer string and compares it to `currentStreamEpoch()`. A mismatch returns `resync_required` with an empty replay. `session.hello` still accepts only protocol `1.0` and `1.1`.
- `bindIpcProject` binds `bindCoordinatorWriteQueue`, `bindOutbox`, and `bindReadModels`. Mutating handlers run inside `execute(tx)`, which the write queue calls under `BEGIN IMMEDIATE`. `appendEvent` still throws outside that transaction. Replay uses `readSinceSeq`. `getLatestSeq` is not on the database; the port reads `highWaterSeq`. `getFeatureRollups()` is the zero-arg list. `ProjectStateDb.getStreamEpoch()` stays a number.
- `FrameCodec` keeps static `encode` and adds instance `encode(frame)` that delegates to it. Channel 1 `StreamFrameCodec` / `adaptFrameCodec` stay for C13. Did not edit `packages/sim`, `schema/**`, Windows Job Object, DPAPI, named-pipe ACLs, or NSIS. `path_leases.mode` stays `'intent' | 'granted'`. C06–C11 binds stay in place.

### What It Fixed
- **F-003:** IPC transport redaction uses `@ef-harness/shared-observability` `SecretRedactor` instead of a third local splitter.
- **F-006:** `@ef-harness/ipc` validates Channel 0 requests against `packets/rpc.ts`. CamelCase `questionId` / `batchId` and `op_id` inside read-only params are rejected.
- **F-013:** `RpcRouter`, `EventSubscriptionServer`, and `SnapshotAssembler` can run on a real `ProjectStateDb` through `createDbWriteQueuePort`, `createDbOutboxPort`, and `createDbReadModelPort`. Stream artifact catalog binding stays in C13.
- **F-014:** `new FrameCodec().encode(frame)` delegates to `FrameCodec.encode`. The static method remains. The streams half stays in C13.
- **Epoch mismatch:** a client `stream_epoch` of `2` against `meta.stream_epoch` `"1"` returns `resync_required` and `readSinceSeq` returns `resyncRequired` with an empty event list. Named-pipe loopback also proved `session.hello` and `op_id` replay through `CoordinatorWriteQueue` (one outbox row on the replayed `op_id`).

### Verification Run & Results
- `git merge-base --is-ancestor` for `e23f4fe` and `2117d11`: exit `0` (both ancestors of `3d26ce9ba360874c349e65aa4bd68b49c266bf90`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 67 passed (67)`, `Tests 374 passed (374)`
- `pnpm --filter @ef-harness/ipc test`: exit `0` — `Test Files 14 passed (14)`, `Tests 63 passed (63)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`


## [C13] — Channel 1 credit-windowed streams bound to CasBlobStore, and M0 sim certifies the real kernel

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `e0ed3c6891ce80527515ed3a21fc72cfe0cbb901` (`integrate: C13 bind streams to CAS and sim to the kernel`)
- **Findings Fixed:** `F-007`, `F-011`, `F-013`, `F-014`, `F-015`, `F-016` (this seam only)

### What Changed
- Re-verified on `b4395324530419cd30767dd662e0825c3d04f550`. Did not re-merge `origin/task/033-binary-artifact-streaming` (`6dfa32b`) or `origin/task/034-m0-deterministic-sim-exit-gate` (`15c4663`). `git merge-base --is-ancestor` exited `0` for both. No dirty patch for C13. Did not start C14. Did not edit `schema/**`, `packages/git-engine`, Windows Job Object, DPAPI, or NSIS. `path_leases.mode` stays `'intent' | 'granted'`. C06–C12 binds stay in place.
- Channel 0 `stream.credit` and `stream.cancel` demux onto `@ef-harness/shared-contracts` `StreamCreditGrantSchema` / `StreamCancelNotificationSchema`: params are `{ stream_id, credits }` (credits 1–1024) and `{ stream_id, reason? }`. The streams scheduler still counts chunk credits internally (`grantCredit(streamId, chunks)`, window 1–256, outstanding 512). The freeze text `{ stream_id, bytes }` was not added. A credit for a stream that has already closed is dropped; a live stream still rejects `-1`, `999999`, and `2^31`.
- `encodeJsonFrame` / `encodeBinaryFrame` delegate to `FrameCodec.encode`. `BinaryStreamManager` and `ArtifactPipeServer` take an optional `blobs: CasBlobStore`. `createCasArtifactCatalog` reads through `openReadStream`. A stream `ByteRange` `{ offset, length }` becomes a CAS range `{ start: offset, end: offset + length }`. Digests cross the boundary with `toBareSha256Hex` / `toPrefixedSha256`.
- `@ef-harness/sim` now depends on `@ef-harness/db`, `@ef-harness/ipc`, and `@ef-harness/shared-observability`. `KernelSession` opens `ProjectStateDb` and `GlobalBrokerDb` and binds `CoordinatorWriteQueue`, `OutboxRepo`, and `CasBlobStore`. Epoch bumps go through `submitOperationSync`. Outbox rows go through `appendEvent`. Named-pipe restart uses `NamedPipeServer`, `NamedPipeClient`, `FrameCodec`, and `SecretRedactor`. `packages/sim/src` no longer constructs `DatabaseSync`. The disk lock probe uses `openDatabase` from `@ef-harness/db` with `busy_timeout = 0`.

### What It Fixed
- **F-007:** Packet `sha256:` digests and bare CAS hashes cross the stream boundary through `toBareSha256Hex`. `cas_blobs.hash` stays bare.
- **F-011 / F-013:** `BinaryStreamManager` and `ArtifactPipeServer` read artifact bytes from the unified `CasBlobStore.openReadStream`, not a private file layout.
- **F-014:** Channel 1 `encodeJsonFrame` and `encodeBinaryFrame` call the transport `FrameCodec.encode`. Static and instance `encode` from C12 stay.
- **F-015:** `stream.credit` and `stream.cancel` are validated against the shared-contracts notification schemas and routed to `BinaryStreamManager`. `stream.end` and `stream.error` still reach `ArtifactStreamClient`, which accepts both `stream_id` / `bytes_sent` and the existing camelCase fields.
- **F-016:** The M0 simulator's success path drives real `@ef-harness/db` and `@ef-harness/ipc`. A 4 MB raw CAS blob streamed over Channel 1 with a 2-chunk (128 KB) credit window came back with the same SHA-256. Seed 42 and seed 1337 still share a trace hash, and the 500-memory plus 10-disk sweep passed with `failed === 0`.
- **Observable credit pause:** `BinaryStreamManager` still stops prefetch when `readBudget` is 0 and resumes on the next `stream.credit`. The pipe test rejects an oversize grant and drops a late grant after `stream.cancel`.

### Verification Run & Results
- `git merge-base --is-ancestor` for `6dfa32b` and `15c4663`: exit `0` (both ancestors of `b4395324530419cd30767dd662e0825c3d04f550`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 67 passed (67)`, `Tests 374 passed (374)`
- `pnpm --filter @ef-harness/ipc test`: exit `0` — `Test Files 15 passed (15)`, `Tests 66 passed (66)`
- `pnpm --filter @ef-harness/sim test`: exit `0` — `Test Files 2 passed (2)`, `Tests 19 passed (19)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`


## [Wave 1 Proof Gate] — C05–C13 Verified

- **Subagent Role & Model:** gate-auditor, grok-4.7-medium
- **Commit on `harness/integration`:** `e0ed3c6891ce80527515ed3a21fc72cfe0cbb901` (`integrate: C13 bind streams to CAS and sim to the kernel`)

### What Was Done
- Verified `harness/integration` at `e0ed3c6891ce80527515ed3a21fc72cfe0cbb901` with a clean `git status --short`. Product code was not changed. C14 was not started, `main` was not merged, and no pull request was opened.
- `@ef-harness/spikes test` was not run. It is outside this gate and rewrites `REPORT.md` files.
- `integration_progress.md` has no Wave 1 gate row, so the ledger rows were left unchanged. C14 stays pending.

### Verification Run & Results
- `pnpm build`: exit `0` (`tsc -b --pretty false`)
- `pnpm typecheck`: exit `0` (`tsc -b --pretty false`)
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint`: exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `pnpm --filter @ef-harness/db test`: exit `0` — `Test Files 67 passed (67)`, `Tests 374 passed (374)`
- `pnpm --filter @ef-harness/ipc test`: exit `0` — `Test Files 15 passed (15)`, `Tests 66 passed (66)`
- `pnpm --filter @ef-harness/sim test`: exit `0` — `Test Files 2 passed (2)`, `Tests 19 passed (19)`
- `pnpm verify:diagrams`: exit `0` — `Merged 31 diagrams into ef-harness-complete.mmd (1219 lines)`
- `git status --short`: exit `0` — clean (empty output)

## [C14] — Hermetic GitRunner with unpackaged PATH fallback

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `7a5034448969a1a99851d7322e0e833641aa66b4` (`integrate: C14 fall back to PATH git when unpackaged`)
- **Findings Fixed:** `F-017` (this seam only; `worktrees/`, `refs/`, and `@ef-harness/db` stay for C15)

### What Changed
- Re-verified on `e0ed3c6891ce80527515ed3a21fc72cfe0cbb901`. Did not re-merge `origin/task/035-mingit-wrapper-folder-states` (`33895fd`), `origin/task/036-git-safety-scanner` (`5872b0a`), or `origin/task/037-temp-index-snapshots` (`fe092d2`). `git merge-base --is-ancestor` exited `0` for all three. No dirty patch for C14. Did not start C15. Did not merge `main`. Did not open a pull request. Did not edit `schema/**`, `packages/sandbox`, `packages/git-engine/src/worktrees`, or `packages/git-engine/src/refs`. `path_leases.mode` stays `'intent' | 'granted'`. C05–C13 binds stay in place. Live names stay `GitRunner`, `GitSafetyScanner`, and `SnapshotManager` under `runner/` and `safety-scan/`.
- `resolveGitBinary` still prefers a Settings Git at `>= 2.38`, then bundled `<resources>/mingit/cmd/git.exe`. When neither is usable and `EF_HARNESS_PACKAGED !== "1"`, it resolves `git` on `PATH` with `source: "path"` after the same `>= 2.38` check. When `EF_HARNESS_PACKAGED === "1"`, the missing-bundled path still throws `GitBinaryNotFoundError`.
- `packages/git-engine/tests/runner/resolve-binary.test.ts` keeps the throw test and sets `EF_HARNESS_PACKAGED=1` so a `PATH` git (the stub reports `2.45.0`) cannot turn that test green. New cases cover a `2.45.0` `PATH` hit and a `2.30.2` `PATH` rejection.
- `createDefaultGitRunner` and `createProcessSnapshotGitRunner` delegate to `GitRunner.execGit`. Snapshot consent and line-ending errors stay in the snapshot adapter. `cat-file`, `for-each-ref`, `show-ref`, and `rev-list` are read-only so those calls are not treated as developer-checkout mutations.
- `pathIsInside` uses the Windows containment check for drive-letter and UNC inputs on every host, so the existing Windows assertion holds on Linux. The runner test helper still uses `where.exe` on Windows and uses `which git` otherwise. Did not add `@ef-harness/db`.

### What It Fixed
- **F-017:** Unpackaged developer and CI checkouts without bundled MinGit resolve `git` `>= 2.38` on `PATH` instead of throwing `GitBinaryNotFoundError`. A packaged process (`EF_HARNESS_PACKAGED=1`) still requires bundled MinGit.
- **F-017:** `GitSafetyScanner`'s default runner and `SnapshotManager`'s process runner go through canonical `execGit` (version check, `GIT_TERMINAL_PROMPT=0`, `core.longpaths=true`, `core.quotepath=false`, developer-checkout guard, and `index.lock` backoff). `worktrees/` and `refs/` runners, and the rogue `ref_leases` writer, are unchanged for C15.

### Verification Run & Results
- `git merge-base --is-ancestor` for `33895fd`, `5872b0a`, and `fe092d2`: exit `0` (all ancestors of `e0ed3c6891ce80527515ed3a21fc72cfe0cbb901`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/git-engine test`: exit `0` — `Test Files 17 passed (17)`, `Tests 121 passed (121)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

## [C15] — Worktree slots and ref leases on GitRunner and ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `1a94f8cae069f799c6ef1e5bd3def1aee1e1ec70` (`integrate: C15 bind worktrees and ref leases to GitRunner`)
- **Findings Fixed:** `F-012` (ref-lease writer only), `F-017` (worktree and ref runners; safety-scan and snapshots were already on `execGit` from C14)

### What Changed
- Re-verified on `7a5034448969a1a99851d7322e0e833641aa66b4`. Did not re-merge `origin/task/038-worktree-slot-manager` (`04aa2785`) or `origin/task/039-branch-ref-leases-cas` (`68c4d3fe`). `git merge-base --is-ancestor` exited `0` for both. No dirty patch for C15. Did not start C16. Did not merge `main`. Did not open a pull request. Did not edit `schema/**`, `packages/sandbox`, or harness-run. `path_leases.mode` stays `'intent' | 'granted'`. Live names stay `WorktreeSlotManager` (alias `WorktreeSlotPool`) and `RefLeaseManager.advanceRefCas`. Slot state stays `registry.json`. The plan directory `ref-leases/` is `refs/`.
- `createProcessGitRunner` and `createDirectGitRunner` call `GitRunner.execGit` from `runner/exec-git.ts`, so worktree and ref commands use the C14 binary resolver (`settings` → bundled MinGit → unpackaged `PATH` git). They no longer spawn the string `git`. `execGit` accepts `stdin` so `commit-tree -F -` and `interpret-trailers` stay off the argument vector. Harness-managed worktrees and ref updates pass `developerCheckout: false`; direct `GitRunner.execGit` callers still get the developer-checkout guard.
- Deleted `REF_LEASES_DDL` and the raw `DatabaseSync` opener in `refs/state-db.ts`. `bindRefLeaseStateDb` writes `ref_leases` through `ProjectStateDb.writer`. `schema/state.sql` already defines that table. `@ef-harness/db` is a `git-engine` dependency. `RefLeaseManager` awaits git inside the writer transaction. Tests still cover epoch fencing, concurrent `update-ref` `cas_mismatch`, and the canonical argv (`core.longpaths=true`, `core.quotepath=false`) with stdin kept out of the argument list.

### What It Fixed
- **F-017:** `worktrees/` and `refs/` pick up `resolveGitBinary`, `GIT_TERMINAL_PROMPT=0`, `core.longpaths=true`, `core.quotepath=false`, and `index.lock` backoff. Re-checked on this commit: `safety-scan/git-runner.ts` and `snapshots/git-runner.ts` already delegate to `execGit` and do not spawn `git`.
- **F-012:** Ref leases no longer open a second `state.db` connection or create a private `ref_leases` table. Lease rows use the canonical columns `ref`, `holder`, `epoch`, `expected_sha`, `expires_at` on the shared writer.

### Verification Run & Results
- `git merge-base --is-ancestor` for `04aa2785` and `68c4d3fe`: exit `0` (both ancestors of `7a5034448969a1a99851d7322e0e833641aa66b4`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/git-engine test`: exit `0` — `Test Files 17 passed (17)`, `Tests 121 passed (121)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

## [C16] — Job Object export and Tier B slot ACL revoke on dispose

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `c9d1ab3039dc85c0a5293e3aee12887044c7dd29` (`integrate: C16 revoke idle slot ACLs on dispose`)
- **Findings Fixed:** `F-022`, `F-060`, `F-070` (sandbox supervisor export and Tier B slot ACL revoke only). `test-env` stays for C19/C20. `runtime-adapters` stays for C17/C55. `apps/daemon` preview stays for C66. `F-018` was not implemented.

### What Changed
- Re-verified on `1a94f8cae069f799c6ef1e5bd3def1aee1e1ec70`. Did not re-merge `origin/task/040-windows-job-objects` (`ddcffc7`), `origin/task/041-sandbox-tier-a-mxc` (`bca08dd`), or `origin/task/042-sandbox-tier-b-users` (`1b8a413`). `git merge-base --is-ancestor` exited `0` for all three. No dirty patch for C16. Did not start C17. Did not merge `main`. Did not open a pull request. Did not add `@ef-harness/db` to sandbox. Did not edit `git-engine`, `schema/**`, harness-run, research-engine, runtime-adapters, or apps/daemon. `path_leases.mode` stays `'intent' | 'granted'`. Live directories stay `tier-a-mxc/` and `tier-b-users/`. Live class stays `WindowsJobManager` (exported alias `WindowsJobObjectManager`). Providers stay `TierAMxcProvider` and `TierBSandboxUsersProvider`. The Win32 job helper and `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` check stay in production; `WindowsJobManager.helper()` still throws `unsupported_platform` when `process.platform !== "win32"`. icacls stays a command plan on `AclPort` and is not spawned.
- `EmptySlotAclManager.revokeSlotGrant` records `icacls <slot> /remove:g *<sid>` for the sandbox-user SID and the per-slot capability SID, with no `/T`. `TierBSandboxUsersProvider.disposeInstance` calls it. `run()`'s `finally` still only closes the nested command job and wipes temp. `acquireWarmInstance` calls `regrantSlot` before `requireSlotGrant`, including when the slot directory already contains files. `packages/sandbox/tests/tier-b-users/provider.test.ts` still acquires again after dispose without a new `onEmptySlotCreated`.
- `@ef-harness/sandbox` re-exports `WindowsJobManager as WindowsJobObjectManager`. `JobHandle` was already exported from `job-objects`.

### What It Fixed
- **F-022, F-060, F-070:** `@ef-harness/sandbox` now exports one `WindowsJobObjectManager` name (the live `WindowsJobManager`) and `JobHandle` for later `test-env`, `runtime-adapters`, and preview wiring. Those packages were not edited.
- **Tier B slot recycle:** disposing an instance removes the idle slot's granted ACEs. The next acquire puts the same capability SID back before `requireSlotGrant`. A command that returns, including a timeout, does not revoke the slot while the instance is still held.

### Verification Run & Results
- `git merge-base --is-ancestor` for `ddcffc7`, `bca08dd`, and `1b8a413`: exit `0` (all ancestors of `1a94f8cae069f799c6ef1e5bd3def1aee1e1ec70`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/sandbox test`: exit `1` — `Test Files 5 failed | 25 passed | 2 skipped (32)`, `Tests 9 failed | 150 passed | 20 skipped (179)`. The same 9 failures are present at `1a94f8c` (`148` passed there; the 2 new Tier B tests passed). Failed: `tests/harness-run/engine.test.ts` (job host compile; suite load), `tests/harness-run/policy.test.ts` (`del /f` rule), `tests/tier-a-mxc/policy.test.ts` (6 tests, `C:\` paths are not absolute on Linux), `tests/tier-a-mxc/probe.test.ts` (live `osBuild` is `linux`), `tests/tier-b-users/provider.test.ts` (desktop `lpDesktop` is null off win32). Harness-run was not edited.
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

## [C17] — Tier resolve, allowlist fetch, and warm-slot release

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `19346259de6b56d67b5a89177437546373b1278a` (`integrate: C17 wire tier resolve and allowlist fetch`)
- **Findings Fixed:** `F-018` (warm-slot release, `SandboxTierSelector.resolve`, `WindowsJobManager` seam), `F-019` (proxy `fetch` / `proxyUrl` and `SecureDocFetcher` binding), `F-036` and `F-060` (export-only). `research-engine` and `runtime-adapters` were not edited. The rest of `F-018` (replacing the default Windows job host, honest tier when no selector is injected, `@ef-harness/db` artifact ports) stays for C18. Did not start C18. Did not apply `task-048`. Did not merge `main`. Did not open a pull request.

### What Changed
- Re-verified on `c9d1ab3039dc85c0a5293e3aee12887044c7dd29`. Did not re-merge `origin/task/043-sandbox-tier-c-d-selector` (`4337b83`), `origin/task/044-loopback-allowlist-proxy` (`d534d12`), or `origin/task/045-secure-doc-fetcher` (`d26eee9`). `git merge-base --is-ancestor` exited `0` for all three. The plan directory `run-engine/` does not exist; the live tree is `packages/sandbox/src/harness-run/`. Live method stays `SecureDocFetcher.fetchDocs`. Did not add `fetchCleanDoc`. Did not edit `package.json`, `pnpm-lock.yaml`, `schema/**`, `packages/mcp-server`, `packages/research-engine`, or `packages/runtime-adapters`. Did not add `@ef-harness/db` to sandbox. Did not re-edit the C16 ACL revoke. `path_leases.mode` stays `'intent' | 'granted'`. Win32 job-object and ACL code stays. No proxy client was defaulted to `http://127.0.0.1:9`.
- `HarnessRunEngine.run` acquires the warm slot, then creates the command job inside the same `try`/`finally` that calls `slot.release()`. A throw from `createJob` no longer leaks the slot. When `isolation` is a `SandboxTierSelector`, `resolve()` runs inside that `try`; a hold throws `SandboxTierHoldError` and still releases the slot. When `osJobs` is set, `createJob` / `closeJob` wrap the command in that same `try`/`finally`. Passing a `WindowsJobManager` off win32 throws `CommandLaunchError` and does not stub `helper()`. The default command job is still `NestedCommandJobManager` on win32. On Linux it is `PosixCommandJobManager` (a real process group). The default tier stamp is still the warm pool until a selector is injected.
- `AllowlistProxyServer` gained `proxyUrl` (`http://127.0.0.1:<lease port>`, lease range `41000–48999`) and `fetch(url, init)`. `SecureDocFetcher` now defaults to `BoundResearcherAllowlistProxy`, which calls that `fetch` after the existing SSRF check. `DirectResearcherAllowlistProxy` remains for the explicit policy test. `@ef-harness/sandbox` already exported both classes; it now also exports `ProxyFetchError`, `ProxyFetchInit`, `ProxyFetchResponse`, and `BoundResearcherAllowlistProxy`.
- Drive-letter and UNC paths in the MXC policy and the `del /f` rule use `path.win32` on Linux so `C:\` stays absolute. The live MXC probe on Linux still reports `not_windows`. Tier B `lpDesktop` stays null off win32.

### What It Fixed
- **F-018:** A failure while creating the command job releases the warm slot. Callers can pass `SandboxTierSelector` and `WindowsJobManager`; resolve holds unsandboxed work, and the Windows job manager is not invoked off win32.
- **F-019:** Documentation fetches go through `AllowlistProxyServer.fetch` (allowlist audit, pinned address, SSRF, byte cap). The default client is no longer `DirectResearcherAllowlistProxy`.
- **F-036, F-060:** `AllowlistProxyServer.proxyUrl` / `.fetch()` and `SecureDocFetcher.fetchDocs` are on the `@ef-harness/sandbox` barrel for later research-engine and runtime-adapter wiring. Those packages were not edited.

### Verification Run & Results
- `git merge-base --is-ancestor` for `4337b83`, `d534d12`, and `d26eee9`: exit `0` (all ancestors of `c9d1ab3039dc85c0a5293e3aee12887044c7dd29`).
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/sandbox test`: exit `0` — `Test Files 30 passed | 2 skipped (32)`, `Tests 169 passed | 14 skipped (183)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Windows-host checks still skipped on this Linux VM (assertions kept): `tests/harness-run/engine.test.ts` detached-grandchild kill and `vite.cmd` dev-server timeout (`it.skipIf` not win32; win32 still uses `NestedCommandJobManager`); `tests/job-objects/windows-job-manager.test.ts` (10 tests, pre-existing `describe` skip off win32); `tests/tier-c-d-selector/tier-c-live.test.ts` (pre-existing `skipIf` not win32). `tests/doc-fetcher/renderer.test.ts` is skipped because Chromium is not installed. Live MXC `osBuild` `/^\d+\.\d+$/` stays inside the win32 branch; Linux expects `reason: "not_windows"`. Tier B `lpDesktop` `EFHarnessSandboxWinSta\EFHarnessSandboxDesktop` stays inside the win32 branch; Linux expects `null`.

## [C18] — Lockfile resolve, honest tier, and MCP kernel binds

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `fc94482468252f5a5129061a2c6788dc5977e8db` (`integrate: C18 wire lockfile resolve and mcp kernel`)
- **Findings Fixed:** `F-018` (remainder: default job host, honest tier when no isolation selector is injected, db artifact ports), `F-020` (lockfile resolution), `F-021` (`task-048.patch`, git runner, kernel deps), `F-039` (kb aliases), `F-049` (private read-set DDL removed; `harness.read_result` stays on the injected artifact port). Did not add `@ef-harness/db` to sandbox. Did not add `@ef-harness/test-env` to mcp-server. Did not edit `research-engine` or `runtime-adapters`. Did not start C19. Did not merge `main`. Did not open a pull request.

### What Changed
- Re-verified on `19346259de6b56d67b5a89177437546373b1278a`. `git apply --stat` and `git apply --check` for `dirty_worktree_patches/task-048.patch` exited `0` (clean: `packages/mcp-server/src/scope.ts`, `server.ts`, `tools.ts`). Applied only that patch. Did not re-apply `task-008`/`009`/`011` or later worker-loop patches. `createJob` stays inside the warm-slot `try`/`finally`.
- Default command host is `PosixCommandJobManager` on every platform. `NestedCommandJobManager` is no longer the default. The two win32-only harness-run tests inject it explicitly. When no `SandboxTierSelector` is injected, `HarnessRunEngine` reports `UNSANDBOXED` instead of `C`. A resolved isolation tier is still reported as returned. No proxy client was defaulted to `http://127.0.0.1:9`. `path_leases.mode` stays `'intent' | 'granted'`. No Windows Job Object, DPAPI, named-pipe, or NSIS stubs.
- `KernelPackageInstaller.addApprovedDependency` and `applyReconciledIntents` update `package.json`, run `packageResolveCommand` (`pnpm install --lockfile-only --ignore-scripts`, `npm install --package-lock-only --ignore-scripts`, or `yarn install --mode update-lockfile --ignore-scripts`), then `installBody` (`--frozen-lockfile` with the lockfile hash check). The hand-spliced `packages:` / npm / yarn lockfile text is gone.
- `packages/mcp-server` depends on `@ef-harness/db`, `@ef-harness/sandbox`, and `@ef-harness/git-engine`. `createKernelAttemptMcpDeps` binds `KnowledgeGraphRepo` / `KnowledgeSearchService`, a db-backed command artifact port and `harness.read_result` port, `HarnessRunEngine`, and `GitRunner.execGit` (no `gitBinary`, so the C14 PATH fallback runs). Snapshot `add` / `commit` pass `developerCheckout: false`. Existing tool names stay. `kb.get_node` aliases `kb.get`, `kb.get_contract` aliases `kb.contract`, and `kb.list_rules` aliases the planner name `kb.list_rules_for_tags`. Private `READ_SET_DDL` is deleted. `openReadSetDatabase` applies `schema/state.sql`. The scratch opener leaves foreign keys off because `ProjectStateDb` is the coordinator that enforces them; the kernel store writes the schema tables through that writer.

### What It Fixed
- **F-018:** Commands no longer default to the developer-token Windows job host, and a missing isolation selector is stamped `UNSANDBOXED`. Warm-slot release on `createJob` failure is unchanged. Kernel command artifacts and `harness.read_result` can use `@ef-harness/db` without sandbox importing that package.
- **F-020:** Approved dependency adds resolve the lockfile with ignore-scripts before the frozen install. The frozen step no longer runs against a hand-spliced lockfile.
- **F-021:** `**/` zero-segment globs, `core.quotepath=false`, pull-quota charges of `0`, and the first `shutdownReason` are on `harness/integration`. Git scope checks go through `GitRunner.execGit`.
- **F-039:** Planner tool names `kb.get_node`, `kb.get_contract`, and `kb.list_rules` / `kb.list_rules_for_tags` reach the live MCP handlers. Existing `kb.get` and `kb.contract` names stay.
- **F-049:** MCP read-set persistence uses `schema/state.sql` `read_sets`, `search_reads`, and `edge_read_sets` instead of a private DDL. `harness.read_result` still reads the injected artifact port.

### Verification Run & Results
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-048.patch`: exit `0` (3 files, `scope.ts` / `server.ts` / `tools.ts`)
- `git apply --check` on that patch: exit `0` (clean on `19346259de6b56d67b5a89177437546373b1278a`)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0` (re-run after the final read-set opener edit; same `tsc -b`)
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/sandbox test`: exit `0` — `Test Files 30 passed | 2 skipped (32)`, `Tests 169 passed | 14 skipped (183)`
- `pnpm --filter @ef-harness/mcp-server test`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Windows-host checks still skipped on this Linux VM (assertions kept). The two `it.skipIf(process.platform !== "win32")` harness-run tests inject `NestedCommandJobManager`; the engine default does not.

## [C19] — Port leases, env processes, and job-object registry

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `0d86e53494baac6930ad7bd9afa45e39a3605157` (`integrate: C19 wire port leases and env processes`)
- **Findings Fixed:** `F-012` (test-env no longer opens a second writer on `global.db` / `state.db`), `F-022` (port leases go through `GlobalBrokerDb.leasePort`, `env_processes` go through `ProjectStateDb.writer`, Windows jobs use `WindowsJobObjectManager` with an injected registry). The third `ServiceProvider` in `packages/test-env/src/auth-payment-mocks` was not edited. Did not edit `packages/sandbox`. Did not add `@ef-harness/test-env` to `packages/mcp-server`. Did not re-apply `task-048.patch`. Did not start C20. Did not merge `main`. Did not open a pull request.

### What Changed
- Re-verified on `fc94482468252f5a5129061a2c6788dc5977e8db`. Did not re-merge `task/049-test-env-orchestrator-core` (`cc26926`) or `task/050-native-backing-services` (`57eca20`). Live orchestrator methods stay `create`, `handle.destroy`, and `reconcileOnStartup`. `path_leases.mode` stays `'intent' | 'granted'`.
- Deleted `openGlobalDatabase` and `openStateDatabase`. `SqlitePortLeaseStore` leases through `GlobalBrokerDb.leasePort` / `releasePort` / `listPortLeases` inside `41000–48999`. `SqliteEnvProcessStore` reads and writes `env_processes` on `ProjectStateDb.writer` and is the sandbox `ProjectStateDb` registry (`insertEnvProcess`, `deleteEnvProcess`, `listEnvProcesses`). `createWindowsJobObjectManager(registry)` constructs `WindowsJobObjectManager` from the `@ef-harness/sandbox` barrel with `{ registry }` and does not pass `stateDbPath`.
- `WindowsJobManager.reconcileOrphanedProcesses()` is zero-arg. The orchestrator no longer hands it rows. The test double and the sandbox manager both read start times from their own registry. On win32, `TrackingWindowsJobManager` assigns and reconciles through `WindowsJobObjectManager` and the PowerShell job-object host is gone. Off win32 it still tracks PIDs and signals them. `@ef-harness/db` and `@ef-harness/sandbox` are dependencies of `@ef-harness/test-env`. `@faker-js/faker` stays. The auth-payment-mocks `ServiceProvider` was left as its own interface.

### What It Fixed
- **F-012 / F-022:** A test environment can lease ports and record `(pid, start_time)` while `GlobalBrokerDb` and `ProjectStateDb` are the writers. Startup reconciliation compares `start_time` to the job manager's registry before any kill, so a recycled PID is not terminated. Service providers on Windows no longer simulate Job Objects in PowerShell.

### Verification Run & Results
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/test-env test`: exit `1` — `Test Files 3 failed | 15 passed (18)`, `Tests 3 failed | 84 passed | 3 skipped (90)`. The same three failures are present at `fc94482468252f5a5129061a2c6788dc5977e8db` on this Linux VM: `tests/services/binary-launcher.test.ts` (`accounting.native` is false off win32), `tests/orchestrator/lifecycle.test.ts` (port 3000 ignore-port probe), and `tests/auth-payment-mocks/port-fallback.test.ts` (`EADDRINUSE 127.0.0.1:3000` when those files run together). Assertions were not weakened. Orchestrator lease, destroy, and `reconcileOnStartup` tests passed.
- `pnpm --filter @ef-harness/sandbox test`: exit `0` — `Test Files 30 passed | 2 skipped (32)`, `Tests 169 passed | 14 skipped (183)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

## [C20] — OAuth, Stripe, and template clones on the attempt server

- **Subagent Role & Model:** integrator-worker, grok-4.7-medium
- **Commit on `harness/integration`:** `a12f6fabf5dd9c806cb839580763bc57590087b7` (`integrate: C20 wire attempt mocks and port attribution`)
- **Findings Fixed:** `F-021` (`@ef-harness/test-env` is now a dependency of `@ef-harness/mcp-server` only; `createKernelAttemptMcpDeps` provisions per-attempt isolation before `harness.run` and `harness.start_service`), `F-022` (`LocalOAuthMockProvider` and `StripeMockAndWebhookProvider` adapt onto the C19 `ServiceProvider`; `TemplateDatabaseManager.ensureTemplate` / `cloneFromTemplate` supply the sqlite clone). Did not re-apply `task-048.patch`. Did not add `@ef-harness/db` to `@ef-harness/sandbox`. Did not edit harness-run. Did not merge `main`. Did not open a pull request. Did not start C21.

### What Changed
- Re-verified on `0d86e53494baac6930ad7bd9afa45e39a3605157`. Did not re-merge `task/051-oauth-stripe-mocks-port-fallback` (`9c562b8`) or `task/052-template-db-synthetic-data` (`1c3bb83`); both are ancestors. Live classes stay `LocalOAuthMockProvider`, `StripeMockAndWebhookProvider`, and `TemplateDatabaseManager`. There is no `LocalWebhookMockProvider`. Directories stay `auth-payment-mocks/` and `synthetic-data/`. C19 `GlobalBrokerDb.leasePort` and `ProjectStateDb.writer` binds were not reverted. `path_leases.mode` stays `'intent' | 'granted'`. Port `3000` is not inserted into `port_leases` (`41000–48999` only). Template sqlite files stay on their own `DatabaseSync`.
- The test-env barrel now exports `adaptAuthPaymentProvider`, `adaptTemplateDatabase`, `registerAttemptMockProviders`, and `AttemptIsolationHost`. `AttemptMcpServer` kernel deps call that host so each attempt gets a distinct template clone plus loopback OAuth and Stripe mock URLs. `harness.run` was not reopened.
- Linux attributes a listening socket to its pid through `/proc/net/tcp`, so the ignore-port probe can see that the child bound `127.0.0.1:3000`, and an HTTP/TCP readiness probe accepts a listener only when that pid is the child. The hard-coded port `3000` bind waits out `EADDRINUSE` instead of sharing the port with the other file. `accounting.native === true` remains the win32 assertion; on Linux the same test still launches the real node child and checks the tracked pid.

### What It Fixed
- **F-021:** `harness.run` and `oauth` / `stripe` / `sqlite` `harness.start_service` on the kernel dependency factory provision an isolated sqlite clone and local mock endpoints for that attempt.
- **F-022:** Auth and payment mocks register on the frozen orchestrator `ServiceProvider`. Template clones do not open `state.db`.
- The two port `3000` failures no longer fail when `lifecycle.test.ts` and `port-fallback.test.ts` run together. The Windows job-accounting assertion is unchanged and is not a skip.

### Verification Run & Results
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/test-env test`: exit `0` — `Test Files 18 passed (18)`, `Tests 87 passed | 3 skipped (90)`. The 3 skips are the pre-existing missing-binary cases (`postgres`, `mailpit`, `redis`). `accounting.native` is still asserted on win32 and was not skipped; Linux does not require `native === true`.
- `pnpm --filter @ef-harness/sandbox test`: exit `0` — `Test Files 30 passed | 2 skipped (32)`, `Tests 169 passed | 14 skipped (183)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`

## [C21] — Provider protocol fixes and CAS-backed tool shrinker

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `81031712977f47bf3c63bd40b7258ffa658e7ab1` (`integrate: C21 wire protocol fixes and CAS shrinker`)
- **Findings Fixed:** `F-023` task-053 portion (HTTP 429 `insufficient_quota` is billing, assistant-text `cost` is not parsed, Responses reasoning stays before `function_call`, duplicate `tool_call` events are dropped, and `canAssignCodingTask` accepts a 32k tool-calling profile). `F-011` was not reopened in `packages/db`; the C11 `CasBlobStore` is what `ToolOutputShrinker` writes. Task-056 and task-057 stay for C22. Did not apply `task-056.patch` or `task-057.patch`. Did not edit `packages/db`. Did not re-merge `task/053`, `task/054`, or `task/055`. Did not revert the C19 port-lease binds or the C20 port 3000 fix. Did not merge `main`. Did not open a pull request. Did not start C22.

### What Changed
- Re-verified on `a12f6fabf5dd9c806cb839580763bc57590087b7`. `task/053-worker-loop-provider-protocols` (`445b340`), `task/054-worker-loop-context-compaction` (`f62475b`), and `task/055-worker-loop-tool-shrinker` (`460527d`) are ancestors. `git apply --stat` and `git apply --check` on `task-053.patch` were clean (`+284/−35`, 8 protocol files), then `git apply` landed that delta. Live names stay `ModelProtocolAdapter.stream`, `CompactionPipeline`, and `ToolOutputShrinker.shrinkForHistory`. Trees stay `context/` and `read-tools/`. The `./edits` export stays. `path_leases.mode` stays `'intent' | 'granted'`. Port `3000` is not inserted into `port_leases`.
- `@ef-harness/db` and `@ef-harness/shared-observability` are dependencies of `@ef-harness/worker-loop` only. `ToolOutputShrinker` defaults to `StreamingRedactor` over `SecretRedactor` from `@ef-harness/shared-observability`. `shrinkForHistory` is async. When a `CasBlobStore` is supplied, omitted or at least 256 KiB test and build stdout/stderr are redacted and `putBlob`'d. The history result keeps the head/tail excerpt and adds a `sha256:` digest.

### What It Fixed
- **F-023 (task-053):** A 429 body with `insufficient_quota` is `billing` and is not a scheduling retry. Assistant text that contains a `cost` field does not change ledger micro-USD; only structured `usage.cost` does. Replayed reasoning items precede the assistant `function_call`, and `done` plus `completed` emit one `tool_call`. A 32,768-token tool-calling profile can take a coding task; an 8,192-token profile cannot.
- **F-011 (consumer only):** A 500 KB tool log shrinks to a head/tail excerpt, the full redacted bytes round-trip through `CasBlobStore.getBlob`, and a provider key in the middle of that log is stored as `[REDACTED:ANTHROPIC_KEY]`.

### Verification Run & Results
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-053.patch`: exit `0` — `8 files changed, 284 insertions(+), 35 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-053.patch`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/worker-loop test`: exit `0` — `Test Files 25 passed (25)`, `Tests 137 passed (137)`
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

## [C22] — Edit safety fixes and executor recovery

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `9aedea0848c027fe65cbf318248ca54ccb3c9f91` (`integrate: C22 edit safety fixes and executor recovery`)
- **Findings Fixed:** `F-023` task-056 and task-057 portion (CRLF `rangeHash` uses logical lines, a single-space blank context line is kept, `.git` / `node_modules` / `.harness` are denied case-insensitively, `unknown_timeout` throws `UnknownOutcomeReconciliationError`, unlocked `replace_lines` is admitted, a null fingerprint no longer resets `no_progress`, and `stuck` sets `countsAsFailedAttempt`). `F-021` was not reopened in `packages/mcp-server`; C22 only adds the worker-loop dependency. Did not apply `task-053.patch`. Did not edit `packages/db`. Did not re-merge `task/056` or `task/057`. Did not merge `main`. Did not open a pull request. Did not start C23.

### What Changed
- Re-verified on `81031712977f47bf3c63bd40b7258ffa658e7ab1`. `task/056-worker-loop-edit-applier` (`42aafc7`) and `task/057-worker-loop-executor-checkpoints` (`a3e3d60`) are ancestors. `git apply --stat` and `git apply --check` were clean for both patches, then `git apply` landed both deltas. `task-056.patch` is 5 edit files (`+66/−8`). `task-057.patch` is 7 executor files (`+271/−27`). They do not overlap.
- Live class stays `EditToolDispatcher`. `NativeWorkerLoop.runAttempt(attemptId)` stays. C21 exports stay, including `@ef-harness/db`, `@ef-harness/shared-observability`, and `ToolOutputShrinker` defaulting to `StreamingRedactor`. `UnknownOutcomeReconciliationError` is exported from `executor/index.ts` by the patch and from `packages/worker-loop/src/index.ts` by hand.
- After the patches, `assertInside` also denies a `.harness` path segment, case-insensitively. The patches did not. A new dispatcher test covers `.harness` and `.HARNESS`.
- `@ef-harness/git-engine`, `@ef-harness/sandbox`, and `@ef-harness/mcp-server` are dependencies of `@ef-harness/worker-loop` only, on top of the C21 deps, with matching `tsconfig.json` project references. `pnpm-lock.yaml` adds those three `link:` entries under `packages/worker-loop` only. `path_leases.mode` stays `'intent' | 'granted'`. No Windows stub was added.
- The patch's recovery test expected the raw `replace_lines` bytes after `runAttempt`. `prepareSubmit` still formats in-scope files, so the assertion now expects `export const value = 2;\n/*formatted*/\n` and `formatted === [["src/recover.ts"]]`. No assertion was removed.

### What It Fixed
- **F-023 (task-056):** `hashLineRange` hashes logical lines joined by `\n`, so a CRLF range matches Task 055 `rangeHash` and `replace_lines` keeps CRLF. `parseOpenAiApplyPatch` keeps a single-space blank context line. `.GIT` and `Node_Modules` writes throw `ProtectedPathError`. `.harness` and `.HARNESS` writes throw `ProtectedPathError`.
- **F-023 (task-057):** `unknown_timeout` after transmit throws `UnknownOutcomeReconciliationError` and holds the reservation. `replace_lines` is allowed once `availableTools` unlocks it. Edit errors 1–3 return tool results (`NearestCandidateError`, `FreshRegionViewError`, `ReplaceLinesUnlockedError`); the fourth escalates to `stuck`. A null check fingerprint no longer resets the `no_progress` streak. `countsAsFailedAttempt` and `countsAsWorkerFailure` are true when the outcome is `stuck`.
- **F-021 (dependency only):** `@ef-harness/worker-loop` can import `@ef-harness/mcp-server` (and git-engine and sandbox) through their barrels. `packages/mcp-server` was not edited. `NativeWorkerLoop` still takes injected ports.

### Verification Run & Results
- `git merge-base --is-ancestor 42aafc7 HEAD`: exit `0`
- `git merge-base --is-ancestor a3e3d60 HEAD`: exit `0`
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-056.patch`: exit `0` — `5 files changed, 66 insertions(+), 8 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-056.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-056.patch`: exit `0` (clean)
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-057.patch`: exit `0` — `7 files changed, 271 insertions(+), 27 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-057.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-057.patch`: exit `0` (clean)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/worker-loop test` (before the format-stamp expectation fix): exit `1` — `Test Files 1 failed | 24 passed (25)`, `Tests 1 failed | 145 passed (146)`
- `pnpm --filter @ef-harness/worker-loop test` (after that expectation fix): exit `0` — `Test Files 25 passed (25)`, `Tests 146 passed (146)` (C21 was `137`; `9` new tests, `0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

## [C23] — Static audit fixes and clean verifier wiring

- **Subagent Role & Model:** integrator-worker, grok-4.7-high
- **Commit on `harness/integration`:** `717ff83b422b0a8c2e57afe99b684518d2d8e68f` (`integrate: C23 static audit fixes and clean verifier`)
- **Findings Fixed:** `F-024` (task-058 stub and standalone-button scanners, task-059 `.js` to `.ts` reachability and integrator hunk line bounds, default gate engine swapped to the Task 058 scanners, live `NameRegistryService` and `GitSafetyScanner` methods bound onto the gate ports, `CompletenessGateRunner` wired into `CleanVerifierRunner.verifyCandidate`). Did not apply `task-061.patch`, `task-062.patch`, `task-063.patch`, `task-064.patch`, `task-066.patch`, or `task-079.patch`. Did not collapse the four `SurfaceVerifierAdapter` aliases. Did not re-merge `task/058`, `task/059`, or `task/060`. Did not edit `schema/**`, `path_leases.mode`, or `CheckOutcomeSchema`. Did not stub Windows code. Did not revert the C21 shrinker or the C22 `.harness` denial. Did not merge `main`. Did not open a pull request. Did not start C24.

### What Changed
- Re-verified on `9aedea0848c027fe65cbf318248ca54ccb3c9f91`. `task/058-static-audit-scanners-p1` (`71ea882`), `task/059-static-audit-scanners-p2` (`b6e79b2`), and `task/060-clean-verifier-harness` (`a06d371`) are ancestors. `git apply --stat` and `git apply --check` were clean for both patches, then `git apply` landed both deltas. `task-058.patch` is 3 scanner files (`+92/−13`). `task-059.patch` is 4 gate files (`+113/−25`). There is no `task-060.patch`. They do not overlap.
- Live class stays `CleanVerifierRunner.verifyCandidate` in `packages/verifier/src/runner/`. There is no `clean-harness/` directory. `CompletenessGateRunner.runLeafStaticAudit` / `runFeatureStaticAudit` stay synchronous.
- The gate default was `createLocalStaticAuditAstEngine` (regex). That regex already flagged a standalone `<button>`. Task 058's AST scanner did not, until the patch. The patch was applied first, then the default was swapped to the Task 058 scanners (`scanStubBodies`, `scanJsxDeadControls`, markers, swallowed errors, elision). Gate rule ids stay `ast.stub`, `ast.marker`, `ast.dead-control`, and `ast.special-case`. `audit()` stays async for git diffs; the in-memory `scan()` path is the same scanner pipeline.
- `bindNameRegistryService` calls `NameRegistryService.auditCodeNamesAgainstRegistry({ feature, names })` and maps a thrown `CodeNameAuditError` onto the gate's `NameAuditFailure[]`. `bindGitSafetyScanner` calls `GitSafetyScanner.scanCommitDiffForSecrets(base, candidate)` and maps `DiffSecretScanResult` onto the existing `SafetyScanReport`. No third interface was added. The in-memory secret scanner remains the default for diffs that have no revisions.
- `@ef-harness/db` and `@ef-harness/git-engine` are dependencies of `@ef-harness/completeness-gate`. `@ef-harness/completeness-gate` and `@ef-harness/git-engine` are dependencies of `@ef-harness/verifier`, with matching `tsconfig.json` project references. Verifier keeps `typescript` on the catalog and keeps `fast-check`, `playwright`, `yaml`, and `zod`. `pnpm-lock.yaml` adds those `link:` entries only.
- `bindCompletenessGate` is what `verifyCandidate` runs when the gate port is the real runner. The callback receives the clean checkout path. `bindWorktreeSlotPool` calls `WorktreeSlotPool.acquireSlot` (`WorktreeSlotManager.acquireSlot`) and `releaseSlot`. The verifier slot `kind` stays `"verifier"`; the pool slot stays an attempt slot. `path_leases.mode` stays `'intent' | 'granted'`. `CheckOutcomeSchema.collected_count` stays in `@ef-harness/shared-contracts`.

### What It Fixed
- **F-024 (task-058):** `return;`, `return false;`, and `() => undefined` are stub bodies. A standalone `<button type="button">Save</button>` is a dead control. A button with `onClick`, `type="submit"` plus `form`, or a spread attribute is not.
- **F-024 (task-059):** `import { x } from "./group.js"` resolves to `group.ts` and the feature audit passes. An integrator edit inside the declared hunk lines is in scope. An edit on a line outside `[hunk.startLine, hunk.endLine]` is `check11.out-of-scope`.
- **F-024 (wiring):** The gate default uses the patched AST scanners. A live name registry reports `unregistered` and `foreign_owned` through the gate port. A live safety scanner reports a vault hit between two commits without copying the raw value. `verifyCandidate` fails that undefined-arrow stub, does not run the candidate, and does not read `DIRTY.txt` from the worker slot.

### Verification Run & Results
- `git merge-base --is-ancestor 71ea882 HEAD`: exit `0`
- `git merge-base --is-ancestor b6e79b2 HEAD`: exit `0`
- `git merge-base --is-ancestor a06d371 HEAD`: exit `0`
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-058.patch`: exit `0` — `3 files changed, 92 insertions(+), 13 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-058.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-058.patch`: exit `0` (clean)
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-059.patch`: exit `0` — `4 files changed, 113 insertions(+), 25 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-059.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-059.patch`: exit `0` (clean)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/completeness-gate test`: exit `0` — `Test Files 7 passed (7)`, `Tests 50 passed (50)` (`0` skipped)
- `pnpm --filter @ef-harness/verifier test` (before Playwright Chromium was installed): exit `1` — `Test Files 1 failed | 30 passed (31)`, `Tests 167 passed | 11 skipped (178)` (`HumanStepRequired('install_playwright_chromium')` in `tests/ui-contract/verifier.test.ts` beforeAll)
- `pnpm exec playwright install chromium`: exit `0`
- `pnpm --filter @ef-harness/verifier test` (after that install): exit `0` — `Test Files 31 passed (31)`, `Tests 178 passed (178)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
