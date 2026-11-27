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
