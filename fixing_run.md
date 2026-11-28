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

---

## [C24] — Surface verifier fixes and one runner adapter

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `fa4b5df4d13d2cc5d6be393aaf77376393e910a8` (`integrate: C24 unify surface verifiers and land 061-063 fixes`)
- **Findings Fixed:** `F-025` task-061, task-062, and task-063 portion (binder dynamic import/require and path escape, post-action page errors, clean migration re-run refusal, and one `SurfaceVerifierAdapter` on `CleanVerifierRunner`). `task-064.patch` and `task-066.patch` stay for C25. The advanced alias stays for C25. Did not re-merge `task/061`, `task/062`, or `task/063`. Did not edit `schema/**` or `path_leases.mode`. Did not change `runner/ports.ts` `SurfaceVerifierAdapter` (`id`, `supports`, `collect`). Did not turn `RedBeforeGreenGate` into a surface collector. Did not merge `main`. Did not open a pull request. Did not start C25.

### What Changed
- Re-verified on `717ff83b422b0a8c2e57afe99b684518d2d8e68f`. `task/061-red-before-green-blind-binder` (`cc176e3`), `task/062-ui-interaction-contract-verifier` (`fe62a40`), and `task/063-multi-surface-verifiers` (`9b455fd`) are ancestors. `git apply --stat` and `git apply --check` were clean for all three patches, then `git apply` landed them.
- `task-061.patch` is 3 binder files (`+91/−9`). `auditBinderAdapter` rejects undeclared `require()` and dynamic `import()`. `hasUnsafePath` rejects absolute paths, drive letters, and parent traversal before a binder write. `task-062.patch` is 3 UI files (`+28/−1`). `inspect` records page and console errors after pointer actions, including a click handler that throws. `task-063.patch` is 3 migration files (`+39/−1`). `allowCleanRefusalOnRerun` passes idempotence when a second run refuses without changing rows or integrity.
- The landed runner plug-in stays `SurfaceVerifierAdapter` in `packages/verifier/src/runner/ports.ts`. The combination-task `run(ctx): Promise<CheckOutcome>` shape was not introduced. `CheckSurface` stays `unit | time | network | browser | api | auth | cli | migration | ai-eval | job`.
- Local names `SurfaceVerifierAdapter` in `ui-contract` and `surfaces` are now `UiCollectPort` and `SurfaceCheckVerifier`. The package barrel exports one `SurfaceVerifierAdapter`, and the old `UiContractSurfaceVerifierAdapter` / `SurfacesSurfaceVerifierAdapter` names are aliases of that runner type. `registerIntegratedSurfaceVerifiers` registers UI (`browser`), API, auth, time, job, CLI, and migration. Webhook, rate-limit, and concurrency stay on `createDefaultSurfaceRegistry` because `CheckSurface` has no token for them. `RedBeforeGreenGate` stays the Task 061 gate (`evaluate`, `lock`, `provePostHoc`).

### What It Fixed
- **F-025 (task-061):** `require("../src/internal")` and `await import("../src/internal")` in a binder adapter are `undeclared_helper`. Writes to `../../.harness-binder/...`, `/.harness-binder/...`, `C:\.harness-binder\...`, and `.harness-binder/../../src/evil.ts` throw `BindingDefectError`.
- **F-025 (task-062):** A Print button whose click listener throws `boom-after-click` fails with attribution `implementation` and message `Unhandled page error on /kitchen-post-action-throw`.
- **F-025 (task-063):** A migration that deletes a predecessor row fails through the runner adapter with `row count` in the log. An explicit clean refusal on re-run passes when data and integrity hold.
- **F-025 (wiring):** `CleanVerifierRunner.registerSurfaceVerifier` accepts the UI, API, CLI, and migration adapters from `integratedSurfaceAdapters`. One check id comes back from migration collect, not the split `:preservation` ids.

### Verification Run & Results
- `git merge-base --is-ancestor cc176e3 HEAD`: exit `0`
- `git merge-base --is-ancestor fe62a40 HEAD`: exit `0`
- `git merge-base --is-ancestor 9b455fd HEAD`: exit `0`
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-061.patch`: exit `0` — `3 files changed, 91 insertions(+), 9 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-061.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-061.patch`: exit `0` (clean)
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-062.patch`: exit `0` — `3 files changed, 28 insertions(+), 1 deletion(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-062.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-062.patch`: exit `0` (clean)
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-063.patch`: exit `0` — `3 files changed, 39 insertions(+), 1 deletion(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-063.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-063.patch`: exit `0` (clean)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/verifier test` (before Playwright Chromium was installed): exit `1` — `Test Files 1 failed | 31 passed (32)`, `Tests 171 passed | 11 skipped (182)` (`HumanStepRequired('install_playwright_chromium')` in `tests/ui-contract/verifier.test.ts` beforeAll)
- `pnpm exec playwright install chromium`: exit `0`
- `pnpm --filter @ef-harness/verifier test -- tests/binder tests/ui-contract tests/surfaces tests/integrated-surfaces.test.ts`: exit `0` — `Test Files 32 passed (32)`, `Tests 182 passed (182)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

---

## [C25] — Boundary probes, hint ladder, and candidate acceptance

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `d1af8055d3e3ff1a80d53235d6cd12f8b6524c19` (`integrate: C25 wire boundary probes, hint ladder, and candidate acceptance`)
- **Findings Fixed:** `F-025` task-064 and task-066 portion (role-guard mutants drop to `{}`, `X-01` fires on `authz` alone, receipt JSON and `artifact_refs` blobs promote to `evidence`), plus `F-012` and `F-017` wiring of `CandidateAcceptanceCoordinator` and `PersistentHintLadder` onto `ProjectStateDb`, `CoordinatorWriteQueue`, `TaskHoldAndSubmissionRepo`, `LifecycleRepo`, `OutboxRepo`, `CasBlobStore`, and `RefLeaseManager`. Did not re-merge `task/064`, `task/065`, or `task/066`. Did not apply patches after `task-066.patch`. Did not edit `schema/**` or `path_leases.mode`. Task `done` stays the schema flag on `ACCEPTED` (`task_states` has no `DONE` row). Did not merge `main`. Did not open a pull request. Did not start C26.

### What Changed
- Re-verified on `fa4b5df4d13d2cc5d6be393aaf77376393e910a8`. `task/064-ai-eval-property-mutation-probes` (`3a84cad`), `task/065-hint-ladder-dispute-routing` (`9f0c374`), and `task/066-candidate-acceptance-tx` (`f68afb3`) are ancestors. `git apply --stat` and `git apply --check` were clean for both patches, then `git apply` landed both deltas.
- `task-064.patch` is 2 files (`+60/−1`). An early-exit negated role guard is replaced with `{}` so the body after the guard still runs. `task-066.patch` is 3 files (`+112/−10`). `X-01` is `{ any: ["authz"], all: [] }`. `promoteReceiptArtifacts` promotes diagnostic blobs referenced by receipt JSON (`traceDigest`, `logDigest`, `observationsDigest`, and sibling ids) and by `artifact_refs`.
- `acceptVerifiedCandidate` previews the decision, calls `RefLeaseManager.advanceRefCas` only when that preview is `accepted` and no hard hold is active, then runs `CandidateAcceptanceCoordinator.finalizeCandidateAcceptance` inside `CoordinatorWriteQueue.submitOperation`. A failed compare-and-swap or a hard hold (`requirement_change`, `budget`, `ccr`, `governor`) rolls the accept back with `ref_cas_failed` or `blocking_hold` and leaves the task in `CLEAN_VERIFY`. A fencing-epoch mismatch still archives the attempt as `rejected` / `superseded` and does not write `TaskAccepted`.
- `PersistentHintLadder` and `DisputeTestRouter` persist through the same queue on `ProjectStateDb.writer`. Hint and dispute text go through `SecretRedactor` before they are stored. Step 1 hints stay `ruleId`, `ruleText`, and `failureType`. Sealed example filenames and sealed expected tokens are not copied into that hint.
- The seven verifier submodules (`runner`, `binder`, `ui-contract`, `surfaces`, `advanced`, `hint-ladder`, `acceptance`) stay exported from `packages/verifier/src/index.ts`. `@ef-harness/db` is a verifier dependency, with a matching `tsconfig.json` project reference. `pnpm-lock.yaml` adds that `link:` entry.

### What It Fixed
- **F-025 (task-064):** `if (user.role !== "admin") { return []; }` becomes `{}` followed by `return ["secret"]`. The guest probe kills that mutant.
- **F-025 (task-066):** An `authz`-only touch queues `X-01`. A diagnostic blob named by `runs[].traceDigest` and a blob linked from `artifact_refs` both move to `evidence`.
- **F-012 / F-017 (wiring):** On a real `ProjectStateDb`, a successful accept moves `refs/heads/harness/f/F12` to the candidate commit, sets `task_runtime.state` to `ACCEPTED` (`task_states.done = 1`), and inserts `TaskAccepted`. Epoch `2` against runtime epoch `3` quarantines the attempt and leaves the ref and the done flag unchanged. A `governor` hold and a compare-and-swap mismatch do the same. A step-1 hint stored in `operations.result` contains `[REDACTED:VAULT]` and not the registered vault value.

### Verification Run & Results
- `git merge-base --is-ancestor 3a84cad HEAD`: exit `0`
- `git merge-base --is-ancestor 9f0c374 HEAD`: exit `0`
- `git merge-base --is-ancestor f68afb3 HEAD`: exit `0`
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-064.patch`: exit `0` — `2 files changed, 60 insertions(+), 1 deletion(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-064.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-064.patch`: exit `0` (clean)
- `git apply --stat ../ef-audit-handoff/dirty_worktree_patches/task-066.patch`: exit `0` — `3 files changed, 112 insertions(+), 10 deletions(-)`
- `git apply --check ../ef-audit-handoff/dirty_worktree_patches/task-066.patch`: exit `0` (clean)
- `git apply ../ef-audit-handoff/dirty_worktree_patches/task-066.patch`: exit `0` (clean)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/verifier test` (before Playwright Chromium was installed): exit `1` — `Test Files 1 failed | 33 passed (34)`, `Tests 177 passed | 11 skipped (188)` (`HumanStepRequired('install_playwright_chromium')` in `tests/ui-contract/verifier.test.ts` beforeAll)
- `pnpm exec playwright install chromium`: exit `0`
- `pnpm --filter @ef-harness/verifier test` (after that install): exit `0` — `Test Files 34 passed (34)`, `Tests 188 passed (188)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

---

## [C26] — Daemon, desktop pipes, and the real M1 exit gate

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `40201d11ab38446c014f0065a3e4565f1a76e6cf` (`integrate: C26 wire daemon, desktop pipes, and the M1 exit gate`)
- **Findings Fixed:** `F-026` (daemon opens `ProjectStateDb`, `GlobalBrokerDb`, and `TelemetryDb`, and pairs every `outbox` row with `outbox_deliveries` through `CoordinatorWriteQueue` + `OutboxRepo`), `F-027` (`PipeClientBridge` keeps one rolling `FrameCodec` and a `Map` of window ports), and `F-028` (the kitchen exit gate drives the real M1 packages and accepts into `ProjectStateDb`). Did not re-merge `task/067` or `task/068`. Did not apply `task-079.patch`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C27 or the Wave 2 proof gate.

### What Changed
- Re-verified on `d1af8055d3e3ff1a80d53235d6cd12f8b6524c19`. `task/067-m1-daemon-minimal-viewer` (`d1109c7`) and `task/068-m1-kitchen-exit-gate` (`76f8a9c`) are ancestors. C26 has no dirty patch of its own. `task-079.patch` was left for C31.
- Landed names differ from the combination-task freeze: there is no `NamedPipeRpcServer`, `OutboxEventStreamer`, `BinaryArtifactStreamServer`, or `TransactionalOutboxRepo`. The daemon uses `OutboxRepo` and `CoordinatorWriteQueue` from `@ef-harness/db`. The M1 socket server stays `HarnessDaemon` because `NamedPipeServer` cannot emit `events.batch` notifications. The exit gate does listen with the landed `NamedPipeServer` and `SessionTokenStore`. `stream.credit` still accepts `streamId` / `chunks` and also `stream_id` / `credits`.
- `daemon.lock` stores `{ pid, processStartTime }`. A live PID is not enough; a reused PID with a different start token is replaced. On Linux, a pipe left behind by `SIGKILL` is removed only when nothing is accepting connections. Windows named-pipe retry is unchanged.
- `PipeClientBridge` forwards only complete frames after `session.hello`. A partial frame stays in the codec. Each `windowId` keeps its own `MessagePort`.
- `tests/e2e/m1-exit-gate/real-stack.ts` opens the kitchen state and global databases through `@ef-harness/db`, appends `TaskAccepted` with a delivery row, and constructs `WorktreeSlotManager`, `CompletenessGateRunner`, `CandidateAcceptanceCoordinator`, `CleanVerifierRunner`, `HarnessRunEngine`, `NativeWorkerLoop`, `AttemptMcpServer`, `TestEnvOrchestrator`, `WindowsJobManager`, `HarnessDaemon`, and `NamedPipeServer`.

### What It Fixed
- **F-026:** `HarnessDaemon.insertEvent` calls `OutboxRepo.appendEvent` inside `CoordinatorWriteQueue`, which inserts `outbox_deliveries` in the same transaction. The kitchen gate hygiene query reports outbox without deliveries = 0. `user_version`, WAL, `journal_size_limit`, and `temp_store` come from `ProjectStateDb` / `GlobalBrokerDb` open. A lock whose PID is this process but whose start token is not refuses the next start.
- **F-027:** One socket read that contains `session.hello`, one full event frame, and the first bytes of a second event delivers each event once to two windows and does not forward the hello frame or the partial bytes.
- **F-028:** `pnpm --filter @ef-harness/e2e test -- m1` accepts K01–K20, rejects the adversarial set, records 0/7 red-team escapes, and writes the exit report from that run. Tier C remains not OS-enforced.

### Verification Run & Results
- `git merge-base --is-ancestor d1109c7 HEAD`: exit `0`
- `git merge-base --is-ancestor 76f8a9c HEAD`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/daemon test`: exit `0` — `Test Files 3 passed (3)`, `Tests 18 passed (18)` (`0` skipped)
- `pnpm --filter @ef-harness/desktop test`: exit `0` — `Test Files 2 passed (2)`, `Tests 2 passed (2)` (`0` skipped)
- `pnpm --filter @ef-harness/e2e exec vitest run --config vitest.config.ts tests/m1-exit-gate.test.ts`: exit `0` — `Test Files 1 passed (1)`, `Tests 2 passed (2)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

---

## [Wave 2 Proof Gate] — C14–C26 Verified

- **Subagent Role & Model:** gate-auditor, grok-4.7
- **Commit on `harness/integration`:** `40201d11ab38446c014f0065a3e4565f1a76e6cf` (`integrate: C26 wire daemon, desktop pipes, and the M1 exit gate`)
- **Product fix SHA:** none

### What Was Done
- Verified `harness/integration` at `40201d11ab38446c014f0065a3e4565f1a76e6cf` with a clean `git status --short` before the gate. Did not redo C26. Did not start C27. Did not merge `main`. Did not open a pull request. Did not edit product code. `path_leases.mode` was not touched. No spike test rewrote `REPORT.md` or `report.json`.
- The Wave 2 proof-gate command in `combination_task.md` is `pnpm --filter @ef-harness/e2e test -- m1`. The same run also executed the Wave 2 unit-scope package suites (`git-engine`, `sandbox`, `mcp-server`, `test-env`, `worker-loop`, `completeness-gate`, `verifier`, `daemon`, `desktop`).
- `pnpm lint` with the default Node heap aborted (`exit 134`, ineffective mark-compacts near the ~2GB heap limit). The same `eslint .` command passed with `NODE_OPTIONS=--max-old-space-size=4096`. That is an environment heap limit, not a product defect.
- `pnpm --filter @ef-harness/verifier test` first failed because Playwright Chromium was not installed (`HumanStepRequired('install_playwright_chromium')` from `tests/ui-contract/verifier.test.ts` `beforeAll`, which skipped the 11 tests in that file). `pnpm exec playwright install chromium` downloaded the browser. The same verifier command then passed `188/188`. No test was weakened and no product file was changed. A later sandbox re-run stayed `169` passed and `14` skipped.

### Verification Run & Results
- `git rev-parse HEAD`: `40201d11ab38446c014f0065a3e4565f1a76e6cf` (branch `harness/integration`)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/git-engine test`: exit `0` — `Test Files 17 passed (17)`, `Tests 121 passed (121)`
- `pnpm --filter @ef-harness/sandbox test`: exit `0` — `Test Files 30 passed | 2 skipped (32)`, `Tests 169 passed | 14 skipped (183)`. Re-run after the Chromium install: exit `0`, same counts.
- `pnpm --filter @ef-harness/mcp-server test`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)`
- `pnpm --filter @ef-harness/test-env test`: exit `0` — `Test Files 18 passed (18)`, `Tests 87 passed | 3 skipped (90)`
- `pnpm --filter @ef-harness/worker-loop test`: exit `0` — `Test Files 25 passed (25)`, `Tests 146 passed (146)`
- `pnpm --filter @ef-harness/completeness-gate test`: exit `0` — `Test Files 7 passed (7)`, `Tests 50 passed (50)`
- `pnpm --filter @ef-harness/verifier test` (before Playwright Chromium was installed): exit `1` — `Test Files 1 failed | 33 passed (34)`, `Tests 177 passed | 11 skipped (188)`
- `pnpm exec playwright install chromium`: exit `0`
- `pnpm --filter @ef-harness/verifier test` (after that install): exit `0` — `Test Files 34 passed (34)`, `Tests 188 passed (188)`
- `pnpm --filter @ef-harness/daemon test`: exit `0` — `Test Files 3 passed (3)`, `Tests 18 passed (18)`
- `pnpm --filter @ef-harness/desktop test`: exit `0` — `Test Files 2 passed (2)`, `Tests 2 passed (2)`
- `pnpm --filter @ef-harness/e2e test -- m1`: exit `0` — `Test Files 2 passed (2)`, `Tests 3 passed (3)` (`tests/m1-exit-gate.test.ts` 2 tests, `tests/smoke.test.ts` 1 test)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `pnpm verify:diagrams`: exit `0` — `Merged 31 diagrams into ef-harness-complete.mmd (1219 lines)`
- `git status --short`: exit `0` — clean (empty output)

---

## [C27] — Discovery decisions, async entailment, and bounded delegation

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `f73ec3739638700b6114c41d0b9c2af8d96970c7` (`integrate: C27 unify discovery decisions, async entailment, and bounded delegation`)
- **Findings Fixed:** `F-029` (one decision payload for opening, prompts, and entailment, async `check` / `checkAll` / `sendAsync`, and node writes through `@ef-harness/db` `KnowledgeGraphRepo`), `F-030` (`valueSatisfiesLimits` accepts non-SQLite options whose tags match), and `F-031` (prompt assets no longer walk for `pnpm-workspace.yaml`; public prompt schemas and `entailment-checker@1` come from `@ef-harness/shared-contracts`; `ef_search_text` uses `splitSearchText` / `registerEfSearchText`). `F-035` is only the decision-field half: settled decisions now keep `criterionId`, `groupId`, and `selectedOptionId`. `task-079.patch`, `listCells`, `listMaterializedRequirements`, and `z3-solver` stay for C31. Did not re-merge `task/069`, `task/070`, or `task/071`. Did not apply a dirty patch. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C28.

### What Changed
- Re-verified on `40201d11ab38446c014f0065a3e4565f1a76e6cf`. `task/069-discovery-core-opening-rubrics` (`0df0a18`), `task/070-discovery-prompts-quote-verifier` (`326728d`), and `task/071-entailment-derivations-reopening` (`2c91b46`) are ancestors. C27 has no dirty patch. No task branch was merged.
- `DecisionFields` keeps the landed `criterion` / `status` / `value` shape and also round-trips `criterionId`, `groupId`, `selectedOptionId`, `must_ask`, delegation limits, and evidence that cites `turn` without `rubricId`. `decisionFieldsJson` writes `criterionId` and, for a settled string value, `selectedOptionId`. `toDecisionNodeFields` is the frozen read shape.
- `valueSatisfiesLimits` still accepts `sqlite` for `free` + `local`. It also accepts `postgres` / `postgres_relational` for `relational_acid`, and the declared tags `local_only`, `zero_paid_saas`, `serverless_compatible`, and `relational_acid`. An unknown option such as `paid-hosted-oracle` still fails.
- `SemanticEntailmentGate.check` and `checkAll` are async and await `EntailmentModelPort.complete`. `parseEntailmentCheckerV1` uses `EntailmentCheckerV1Schema`. Persisted entailment fields also store `must_ask`, `criterionId`, `selectedOptionId`, and `groupId` when the claim has them. `DiscoverySessionManager.send` stays synchronous. `sendAsync` validates optional `resolveBatch` / `checkEntailment` results with `BatchResolveV1Schema` and `EntailmentCheckerV1Schema`.
- Prompt text and `skills/infer-or-ask/SKILL.md` resolve from `EF_HARNESS_RESOURCES_DIR`, `EF_HARNESS_RESOURCES`, `process.resourcesPath` when that directory contains `opening-prompts.md`, or `canonicalAssetAbsolute("inferOrAskSkill")`. There is no parent walk for `pnpm-workspace.yaml`. The exported `BatchResolveV1Schema`, `OpeningReviewV1Schema`, and `ClarifyV1Schema` are the shared-contracts schemas. The orchestrator still parses its multi-proposal document locally because that payload is not the single-criterion schema.
- `LocalSqliteKnowledgeGraph` opens `schema/state.sql`, registers `ef_search_text` through `@ef-harness/db`, seeds `meta.last_rev`, and commits a node through `KnowledgeGraphRepo.commitChangeSet` when it is not already inside a discovery transaction. Content hashes use `computeNodeContentHash` (`sha256:` prefix). `core`, `depth`, and `readiness` no longer ship their own `splitSearchText` bodies.
- `validatedDiscoveryModel` binds a worker-loop `ModelProtocolAdapter` to `resolveBatch` / `checkEntailment` and rejects JSON the shared schemas refuse. `@ef-harness/discovery` depends on `@ef-harness/db` and `@ef-harness/worker-loop`.

### What It Fixed
- **F-029:** A decision written with `criterionId`, `groupId`, `must_ask`, and evidence `{ turn, start, end, quote }` parses without `BasisStatusSeparationError` and still exposes `criterion` plus `turnId`. Entailment checks await the model port. A direct `insertNode` of a settled email channel goes through `KnowledgeGraphRepo` and stores `criterionId`, `groupId`, and `selectedOptionId` with a `sha256:` content hash.
- **F-030:** `valueSatisfiesLimits("postgres", ["relational_acid"])` is true. `valueSatisfiesLimits("sqlite", ["free", "local"])` stays true. `valueSatisfiesLimits("paid-hosted-oracle", ["free", "local"])` stays false.
- **F-031:** Loading `opening-review@1`, `batch-resolve@1`, `clarify@1`, and the infer-or-ask skill does not search for `pnpm-workspace.yaml`. `ef_search_text` is the shared splitter, including the acronym split.
- **F-035 (decision fields only):** Settled discovery decisions persist `selectedOptionId` and `groupId` for later spec checks. Collapse, `listCells`, and the Z3 solver are unchanged.

### Verification Run & Results
- `git merge-base --is-ancestor 0df0a18 HEAD`: exit `0`
- `git merge-base --is-ancestor 326728d HEAD`: exit `0`
- `git merge-base --is-ancestor 2c91b46 HEAD`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/discovery exec vitest run --config vitest.config.ts core prompts entailment`: exit `0` — `Test Files 10 passed (10)`, `Tests 67 passed (67)` (`0` skipped)
- `pnpm --filter @ef-harness/discovery test -- core prompts entailment`: exit `1` — vitest is invoked as `vitest run --config vitest.config.ts -- core prompts entailment`, which loads every discovery suite. `Test Files 2 failed | 24 passed (26)`, `Tests 150 passed (150)`. The two failures are import-time and were not introduced here: `tests/corpus-loader/corpus-loader.test.ts` (`YamlParseError` on `corpus/packs/web-api-cli/api.yaml`) and `tests/corpus-web-api-cli/corpus-web-api-cli.test.ts` (`corpus/packs/core-data-auth/auth.yaml: missing string pack`). That is `F-032`, which stays on C29.
- `pnpm --filter @ef-harness/discovery exec vitest run --config vitest.config.ts tests/depth tests/readiness tests/selector`: exit `0` — `Test Files 10 passed (10)`, `Tests 67 passed (67)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`

---

## [C28] — Discovery session coordinator, observed pre-settlement, and exact readiness counts

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `111614ad5818f2afe2f4c12dad56d8f406c8d100` (`integrate: C28 wire discovery session coordinator on ProjectStateDb`)
- **Findings Fixed:** `F-029` (selector, depth, and readiness now share one session over `ProjectStateDb` and the C27 decision payload). `F-074` only for the discovery port: `preSettleObservedCriteria({ workItemId, settlements })` is on `DiscoverySessionCoordinator` for `BrownfieldOpeningController`. The brownfield package silos, ambient `git`, and in-memory `work_items` stay on C60 and C61. Did not re-merge `task/072`, `task/073`, or `task/074`. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C29. Did not fix the two corpus import failures (`F-032`).

### What Changed
- Re-verified on `f73ec3739638700b6114c41d0b9c2af8d96970c7`. `task/072-adaptive-question-selector` (`7f8f233`), `task/073-discovery-depth-controls` (`47801e2`), and `task/074-honest-readiness-calculator` (`27758b5`) are ancestors. C28 names no merge and no dirty patch. No task branch was merged.
- `DiscoverySessionCoordinator` (`startSession`, `ingestUserTurn`, `acceptRecommendedDefaults`, `preSettleObservedCriteria`, `getReadinessSnapshot`) runs on an open `ProjectStateDb`. Decision and stage nodes commit through `@ef-harness/db` `KnowledgeGraphRepo`. Work items, scopes, turns, batches, and change-set rows commit through `CoordinatorWriteQueue`.
- Stored decisions keep the depth fields and also `criterionId`, `groupId`, `scopeId`, `scope_id`, and, once settled, `selectedOptionId`. `parseDecisionFields` accepts that payload. `acceptRecommendedDefaults` writes `basis: "delegated"` and refuses `explicit`. Observed settlements write `basis: "observed"` and are left out of the next `selectNextBatch`. A second observed call skips a criterion that is already settled.
- `HonestReadinessCalculator.snapshot` returns integer counts `{ explicitCount, confirmedCount, delegatedChosenForYouCount, observedCount, blockingUnsettledCount, deferredCount, readyToPlan }`. `confirmedCount` is the derived-basis count. `delegatedChosenForYouCount` is delegated plus defaulted. `readyToPlan` is false while any blocker remains. No percentage is emitted.
- Question batches use `selectNextBatch` and are stored in `discovery_batches`. Accept-all's batch picker is `GreedyQuestionSelector`, not the depth-local stand-in. `StageDepthController` is exported as `DiscoveryDepthController`. `GreedyQuestionSelector` is exported as `AdaptiveQuestionSelector`.

### What It Fixed
- **F-029:** An opening turn, delegated defaults, and an observed pre-settlement share one `ProjectStateDb` and one decision payload. Delegated storage is `basis: "delegated"` with `selectedOptionId: "sqlite"`. The must-ask auth criterion stays open. The observed repository criterion is not asked again.
- **F-074 (discovery port only):** `preSettleObservedCriteria({ workItemId, settlements })` is the call `BrownfieldOpeningController` was missing on discovery. Brownfield's own barrel, git runner, and in-memory stores are unchanged.

### Verification Run & Results
- `git merge-base --is-ancestor 7f8f233 HEAD`: exit `0`
- `git merge-base --is-ancestor 47801e2 HEAD`: exit `0`
- `git merge-base --is-ancestor 27758b5 HEAD`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/discovery exec vitest run --config vitest.config.ts tests/core tests/prompts tests/entailment tests/depth tests/readiness tests/selector tests/session tests/smoke.test.ts`: exit `0` — `Test Files 22 passed (22)`, `Tests 136 passed (136)` (`0` skipped)
- `pnpm --filter @ef-harness/discovery test`: exit `1` — `Test Files 2 failed | 25 passed (27)`, `Tests 151 passed (151)`. The two failures are import-time and were not introduced here: `tests/corpus-loader/corpus-loader.test.ts` (`YamlParseError` on `corpus/packs/web-api-cli/api.yaml`) and `tests/corpus-web-api-cli/corpus-web-api-cli.test.ts` (`corpus/packs/core-data-auth/auth.yaml: missing string pack`). That is `F-032`, which stays on C29.
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C29.

---

## [C29] — Corpus pack loader for core, web-api-cli elaborations, and rules

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `b3056776d4f95e262b4e69321677a6a59b56fac2` (`integrate: C29 wire corpus pack loader for core, elaborations, and rules`)
- **Findings Fixed:** `F-032` for the landed `075`–`077` corpus. `CorpusPackLoader.loadAllBundledPacks()` loads `core-data-auth`, `web-api-cli` questions and elaborations, `X-01`..`X-14`, `UP-01`..`UP-08`, and `S-01`..`S-10` with bounded YAML aliases and zero dangling option ids. `Task 103` and `Task 104` stay on C30. Did not re-merge `task/075`, `task/076`, or `task/077`. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C30.

### What Changed
- Re-verified on `111614ad5818f2afe2f4c12dad56d8f406c8d100`. `task/075-corpus-loader-core-data-auth` (`db21117`), `task/076-corpus-web-api-cli-elaborations` (`8764a25`), and `task/077-cross-cutting-rules-seams-tags` (`b73f44c`) are ancestors. C29 names no merge and no dirty patch. No task branch was merged.
- The discovery YAML parser accepts anchors, aliases, and `<<` merge keys. Alias expansion stops at 100. Duplicate keys and bad indentation still fail with a line number.
- `CorpusPackLoader.load()` in `@ef-harness/discovery` still returns the 29 canonical core, data, and auth questions. It parses the other corpus YAML, skips `manifest.yaml` and `activation-table.yaml`, and does not treat a document without `kind` as a `075` question pack. The bundle hash of the repository corpus still matches the three canonical files.
- The web-api-cli test loader adopts a sibling file only when every question has a string `pack`. `corpus/packs/core-data-auth/auth.yaml` is a `075` question pack, so the loader keeps `core_source: "task-075-port"` and does not require `pack` on those questions.
- `@ef-harness/corpus` exports `CorpusPackLoader.loadAllBundledPacks()`. It parses with `yaml` (`merge: true`, `maxAliasCount: 100`), checks touches tags with `TouchesTagSchema`, and resolves elaboration and `conflicts_with` option ids against the bundled questions plus the authored core question file. `api.style` `stage_suitability` aliases resolve to `prototype`, `mvp`, and `production`.

### What It Fixed
- **F-032:** `loadCorpusPacks(repositoryCorpusRoot())` no longer throws `YamlParseError` on `corpus/packs/web-api-cli/api.yaml`. The web-api-cli suite no longer throws `auth.yaml: missing string pack`. The bundled catalog loads 18 core, 6 data, and 5 auth questions, the web, api, and cli questions, at least 60 elaborations, rules `X-01`..`X-14`, policies `UP-01`..`UP-08`, and seams `S-01`..`S-10`, with `danglingOptionIds` empty.

### Verification Run & Results
- `git merge-base --is-ancestor db21117 HEAD`: exit `0`
- `git merge-base --is-ancestor 8764a25 HEAD`: exit `0`
- `git merge-base --is-ancestor b73f44c HEAD`: exit `0`
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 6 passed (6)` (`0` skipped)
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 27 passed (27)`, `Tests 171 passed (171)` (`0` skipped)
- `pnpm --filter @ef-harness/planner test -- tag-detector`: exit `0` — `Test Files 26 passed (26)`, `Tests 144 passed (144)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C30.

## [C30] — 87-question corpus and 20-skill vetting catalog

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `ae6e426367673956b4ac948a932ef23c91922db8` (`integrate: C30 wire 87-question corpus and 20-skill vetting catalog`)
- **Findings Fixed:** `F-032` for `Task 103` and `Task 104` on top of the C29 loader, and `F-033` for one 20-skill catalog. Merged `task/103-corpus-wave1-expanded-packs` (`1637274`) and `task/104-corpus-wave2-packs-14-skills` (`c02800d`). `task/078-skill-vetting-quarantine-catalog` (`404d945`) was already an ancestor. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C31.

### What Changed
- `CorpusPackLoader.loadAllBundledPacks()` in `@ef-harness/corpus` loads 44 M2 questions, 28 Wave 1 questions, and 15 Wave 2 questions (87 unique YAML ids) with empty `danglingOptionIds`. Sidecar `manifest.yaml` and `activation-table.yaml` stay in the file digest and are not read as packs. Wave 1 elaborations may omit `touches`.
- `selectLoadedCorpusBatch()` feeds those 87 questions to `AdaptiveQuestionSelector`. Discovery's strict loader still accepts only documents that declare `kind`, so Wave 2's non-075 YAML does not enter the 075 validator.
- `corpus/skills/manifest.json` now lists the 6 M2 skills and the 14 Wave 2 skills. Each entry has `skillPath`. M2 `allowedTouches` use closed `TOUCHES_TAGS` (`form_input`, `logging`, `search`, `interactive_ui`, `migration`, `destructive_write`, `authz`, `route`). `SkillVettingCatalog` checks hashes, the 2,000-token cap, quarantine receipts, and byte parity of `corpus/skills/m2/infer-or-ask/SKILL.md` with `skills/infer-or-ask/SKILL.md`. `verifyPinnedCatalog` still checks the original 6 M2 skills.

### What It Fixed
- **F-032:** Wave 1 and Wave 2 packs load through the C29 corpus loader with zero schema or dangling-option errors. The strict discovery loader no longer throws on Wave 2 indentation.
- **F-033:** `SkillManifestRegistry.loadForMount` resolves all 20 skills, and every `allowedTouches` tag is in the 28-tag vocabulary.

### Verification Run & Results
- `git merge-base --is-ancestor 404d945 HEAD`: exit `0`
- `git merge --no-ff origin/task/103-corpus-wave1-expanded-packs`: exit `0` (`81d776e`)
- `git merge --no-ff origin/task/104-corpus-wave2-packs-14-skills`: exit `0` (`8a0ffd6`)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped; prior 6 plus the 87-question case)
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped; includes the prior 27 files / 171 tests plus wave1, wave2, and the adaptive batch test)
- `pnpm --filter @ef-harness/meta-lab test -- skill-vetting`: exit `0` — `Test Files 6 passed (6)`, `Tests 18 passed (18)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- Stopped before C31.

---

## [C31] — Spec expansion over ProjectStateDb with Z3 cutoff checks

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `21daf72b96a07a36b17aebfabd0b7f50d6007dd0` (`integrate: C31 wire spec expansion over ProjectStateDb and Z3`)
- **Findings Fixed:** `F-034` for `expands` and `contradicts` edges written through `KnowledgeGraphRepo` (the v2 migration already seeds `expands`, `contradicts`, and `informs`; the repo now accepts those additive types without changing the 14-row `schema/state.sql` seed), and `F-035` for the uncommitted `task-079` collapse and requirements-view fixes, `listCells` / `listMaterializedRequirements`, discovery decision fields (`selectedOptionId`, `groupId`, with `value` / `criterionId` fallbacks), and Layer-4 `z3-solver` WASM. `task/079-spec-matrix-generators` (`f19582e`), `task/080-spec-cell-filler-proposed-review` (`0f5e3d9`), and `task/081-five-layer-contradiction-checker` (`24fe966`) were already ancestors. Applied `dirty_worktree_patches/task-079.patch`. Did not re-merge those task branches. Did not merge `task/162` or `task/164`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C32.

### What Changed
- Re-verified on `ae6e426367673956b4ac948a932ef23c91922db8`. `git merge-base --is-ancestor` succeeded for `f19582e`, `0f5e3d9`, and `24fe966`. No task branch was merged.
- `git apply --stat` and `git apply --check` succeeded for `task-079.patch`, then the patch was applied. `ScopedRuleCollapser` keeps the majority signature as the rule. Matrix manifests and groups are `source` nodes, and unfilled cells stay `draft`, so they stay out of the `requirements` view. `sealCell` returns a new cell. Generators that still build drafts go through `finish`, which keeps that return value.
- `SpecMatrixGenerator` runs the 12 matrix generators and writes rules, exception cells, and `expands` edges through `KnowledgeGraphRepo`. `SpecCellFiller` materializes settled discovery decisions into spec items and links each active spec to its decision with `expands`. A `proposed` basis stays `draft`. `FiveLayerContradictionChecker` solves kitchen print versus order cutoff with `z3-solver` WASM and records a `contradicts` edge. `OrderedCellFillerPipeline.listMaterializedRequirements` and `MatrixCellPersistenceRepo.listCells` are available to the sibling packages. `Z3UnsatCoreSolver.solve` stays the deterministic boolean fallback used when WASM is disabled.

### What It Fixed
- **F-034:** `KnowledgeGraphRepo` accepts `expands` and `contradicts` on a `ProjectStateDb` that has already run the v2 edge-type migration. Spec cells and contradiction pairs are inserted through that repo, not by a side-channel `edge_types` insert.
- **F-035:** Majority-signature collapse no longer anchors on the first cell or drops covered cells at 47. Manifest and group rows no longer enter `requirements`. Settled discovery decisions keep `selectedOptionId` and `groupId` (falling back to `value` and `criterionId`). Layer 4 uses the installed `z3-solver` WASM for the cutoff/window constraint, with the deterministic comparison only when WASM is explicitly disabled.

### Verification Run & Results
- `git merge-base --is-ancestor f19582e HEAD`: exit `0`
- `git merge-base --is-ancestor 0f5e3d9 HEAD`: exit `0`
- `git merge-base --is-ancestor 24fe966 HEAD`: exit `0`
- `git apply --stat` and `git apply --check` on `task-079.patch`: exit `0` (4 files, +125/−74)
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/spec-expansion test`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped)
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C32.

---

## [C32] — Research facts in ProjectStateDb and a shared skeleton lock

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `2636b51f8fc1e728581d996bb36fdb815e982c0c` (`integrate: C32 wire research facts and the shared skeleton lock`)
- **Findings Fixed:** `F-034` for `informs` edges written through `KnowledgeGraphRepo` (the v2 migration already seeds `informs`; this commit does not edit `schema/**`), `F-036` for durable research fact bodies, and `F-038` for one async feature-architecture writer that uses the system `SkeletonLockEnforcer` and persists `fields.names`. `task/082-research-engine-api-verifier` (`a6d8908`), `task/083-system-architecture-synthesizer` (`e753d6f`), and `task/084-feature-architecture-wireframes` (`8ce7ede`) were already ancestors. Did not re-merge those branches. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C33.

### What Changed
- Re-verified on `21daf72b96a07a36b17aebfabd0b7f50d6007dd0`. `git merge-base --is-ancestor` succeeded for `a6d8908`, `e753d6f`, and `8ce7ede`. No task branch was merged.
- `ResearchFactCache.putDurable` / `getDurable` store the fact body in `CasBlobStore` and the cache row in `global.db.research_cache`. A new cache instance over the same stores reloads the body from the artifact hash. `informs` targets become `research_fact` nodes and `informs` edges on `ProjectStateDb`. `typescript` is a runtime dependency. `FeatureResearchOrchestrator` calls `fetchCleanDoc` when the fetcher provides it, and `adaptSecureDocFetcher` maps `SecureDocFetcher.fetchDocs` onto that method.
- `FeatureArchitectureSynthesizer` runs the existing feature draft, then asks the system `SkeletonLockEnforcer` before writing. Accepted graphs persist through `KnowledgeGraphRepo` with `fields.names` shaped as `{ kind, value }`. A second owner of the same name is rejected by `state.db.names`. A breaking column on a locked table is not written.

### What It Fixed
- **F-034:** Verified research facts can record `informs` edges on a `ProjectStateDb` that has already run the v2 edge-type migration.
- **F-036:** Restarting `ResearchFactCache` over the same `ProjectStateDb` and `CasBlobStore` hits the cached fact with `0` network fetches. `typescript` is available as a production dependency, and doc fetch goes through `fetchCleanDoc`.
- **F-038:** Feature architecture persistence uses the system skeleton lock and writes `fields.names` that the names trigger enforces. A locked breaking mutation is refused unless a CCR allows it.

### Verification Run & Results
- `git merge-base --is-ancestor a6d8908 HEAD`: exit `0`
- `git merge-base --is-ancestor e753d6f HEAD`: exit `0`
- `git merge-base --is-ancestor 8ce7ede HEAD`: exit `0`
- No dirty-worktree patch was assigned to C32. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/research-engine test`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/planner test -- system-arch feature-arch`: exit `0` — `Test Files 27 passed (27)`, `Tests 145 passed (145)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion test`: first run exit `1` — catalog layer timing `6.35 ms` against a `5 ms` budget (1 failed, 50 passed). Rerun exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped)
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C33.

---

## [C33] — Views round-trip and requirement_change holds

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `c8547ac89c4d3623c4980c4e15763c22f1211267` (`integrate: C33 wire views round-trip and requirement_change holds`)
- **Findings Fixed:** `F-037` for one `.harness/views/` manifest and `ef:node` grammar shared by export and import, and `F-039` for `HybridRevisionEngine` holds using `requirement_change`. `task/085-knowledge-views-exporter` (`b104c7b`), `task/086-markdown-direct-edit-importer` (`8adf0a5`), and `task/087-hybrid-revision-impact-engine` (`a1e4945`) were already ancestors. Did not re-merge those branches. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C34.

### What Changed
- Re-verified on `2636b51f8fc1e728581d996bb36fdb815e982c0c`. `git merge-base --is-ancestor` succeeded for `b104c7b`, `8adf0a5`, and `a1e4945`. No task branch was merged.
- Export and import manifests both carry `{ schemaVersion: 1, exportedAt: number, files: Record<relPath, { sha256, nodeIds }> }`. Each reader also accepts the other writer's rows, so an export manifest is no longer an empty import and an import manifest is no longer a corrupt export. Node rows keep the opener `base_hash`. File hashes compare with or without the `sha256:` prefix.
- `<!-- ef:node id=… rev=… base_hash=sha256:… -->` is parsed by the importer, including the exporter's `sha256:` prefix, backslash escapes, and `<a id>` anchors (anchors stay out of prose). `LocalExportPauseLock` is the exporter's `ExportPauseLock`, so `pause` / `acquire` share one map. `MarkdownDirectEditImporter` scans edited view files with `SecretRedactor.scanForSecrets` before commit and opens a `base_hash` conflict when the opener does not match the manifest. `ProjectStateKnowledgeGraph` commits those edits through `KnowledgeGraphRepo` on `ProjectStateDb`.
- `HybridRevisionEngine` places `requirement_change` holds. When an impact port is supplied, the blast radius is `KnowledgeGraphRepo.impactWalk`. `ProjectStateHoldWriter` writes those holds through `TaskHoldAndSubmissionRepo`.

### What It Fixed
- **F-037:** Exporting `.harness/views/` and importing the edited Markdown recognizes the same manifest, the same `ef:node` opener, and the same pause lock. A stale `base_hash` stays uncommitted. A scanned secret blocks the commit.
- **F-039:** Revision holds use `requirement_change`, the reason in `schema/state.sql` `task_holds`. The slicer and `kb.*` tool-name half of this finding stays for C34.

### Verification Run & Results
- `git merge-base --is-ancestor b104c7b HEAD`: exit `0`
- `git merge-base --is-ancestor 8adf0a5 HEAD`: exit `0`
- `git merge-base --is-ancestor a1e4945 HEAD`: exit `0`
- No dirty-worktree patch was assigned to C33. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/planner test -- views-export views-import revision`: exit `0` — `Test Files 29 passed (29)`, `Tests 148 passed (148)` (`0` skipped). The pnpm `--` reaches vitest as an end-of-options marker, so this invocation runs the whole planner package. The previous package total recorded at C32 was 27 files / 145 tests; this adds the 2 C33 files and 3 C33 tests.
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts views-export views-import revision`: exit `0` — `Test Files 15 passed (15)`, `Tests 60 passed (60)` (`0` skipped)
- `pnpm --filter @ef-harness/planner test -- system-arch feature-arch`: exit `0` — `Test Files 29 passed (29)`, `Tests 148 passed (148)` (`0` skipped; same whole-package run as above, which still covers the C32 145)
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts system-arch feature-arch`: exit `0` — `Test Files 8 passed (8)`, `Tests 30 passed (30)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine test`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion test`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C34.

---

## [C34] — kb pull tools, MUST bands, and worker tier caps

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `f97fbdfce1a17d69b990f49a7edca1dd2254066f` (`integrate: C34 wire kb pull tools and worker tier caps`)
- **Findings Fixed:** `F-021` for sealed and `oracle_only` concealment on the kernel knowledge path, and `F-039` for one `kb.search` / `kb.get_node` / `kb.list_rules` / `kb.get_contract` surface, uppercase `MUST | SHOULD | COULD` bands, and `Junior | Mid | Senior | Principal` caps. `task/088-knowledge-packet-slicer` (`c8cf1f8`) and `task/089-rule-matching-pull-to-push` (`cde3a46`) were already ancestors. Did not re-merge those branches. Did not apply a dirty patch. Did not apply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C35.

### What Changed
- Re-verified on `c8547ac89c4d3623c4980c4e15763c22f1211267`. `git merge-base --is-ancestor` succeeded for `c8cf1f8` and `cde3a46`. No task branch was merged.
- `KnowledgePacketSlicer.compileTaskBrief` returns `CompiledTaskBrief | MustBandOversizeRefusal`. Bands are `MUST | SHOULD | COULD`. Worker tiers are `Junior | Mid | Senior | Principal`, with Junior kept at 2–3k (refusal at 3,000) and Senior at 4–6k (refusal at 6,000). An oversized MUST band is returned as `MustBandOversizeRefusal` and is not truncated. Optional brownfield conventions are capped at 600 tokens and `[RECENT SWEEP SYMBOL MAP]` at 300 tokens. `upsertBand` applies a pull-to-push promotion on the next compile. Could pointers include `kb.search`, `kb.get_node`, `kb.list_rules`, and `kb.get_contract`.
- `KbPullToolHandlers` registers `kb.list_rules` beside `kb.list_rules_for_tags` and accepts the MCP argument names (`id`, `idAtVersion`, `filters.kind`). `kb.search` and `kb.get_node` drop nodes marked sealed or `visibility = oracle_only` and return the same `NOT_FOUND` body as a missing id. `ProjectStateFtsSearchRepo` reads those tools from `ProjectStateDb`. `AttemptMcpServer` delegates the four tools to that port when `kbPull` is set, which `createKernelAttemptMcpDeps` forwards.

### What It Fixed
- **F-021:** Kernel knowledge binding treats `oracle_only`, `sealed`, and `sealed_oracle` the same way it treats held-back checks, so a pull cannot return the sealed body.
- **F-039:** The slicer, `KbPullToolHandlers`, and `AttemptMcpServer` share `kb.search`, `kb.get_node`, `kb.list_rules`, and `kb.get_contract`. Brief bands are uppercase. Worker levels accept the four shared-contract tiers. Revision holds stay on `requirement_change` from C33.

### Verification Run & Results
- `git merge-base --is-ancestor c8cf1f8 HEAD`: exit `0`
- `git merge-base --is-ancestor cde3a46 HEAD`: exit `0`
- No dirty-worktree patch was assigned to C34. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts slicer pull`: exit `0` — `Test Files 4 passed (4)`, `Tests 33 passed (33)` (`0` skipped)
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 30 passed (30)`, `Tests 151 passed (151)` (`0` skipped). The previous package total recorded at C33 was 29 files / 148 tests; this adds the C34 file and 3 C34 tests.
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts views-export views-import revision`: exit `0` — `Test Files 15 passed (15)`, `Tests 60 passed (60)` (`0` skipped)
- `pnpm --filter @ef-harness/mcp-server exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine test`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion test`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C35.


---

## [C35] — sandboxed converters, semantic chunker, and exact schema importer

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `ccbcdea1fd6545780103552dbf3f802146fc119d` (`integrate: C35 wire intake converters, chunker, and schema importer`)
- **Branches merged:** `origin/task/097-external-intake-converters` (`f41cfd0e9842c9fb927c6a4bf00ac3f9f73bbc64`) as `9f603bd`, then `origin/task/098-intake-chunker-openapi-importer` (`f266844790ec3e411d8b372b14fefb592d10fe00`) as `8415b9e`, both `git merge --no-ff`. No dirty-worktree patch was assigned. Did not reapply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**` or `path_leases.mode`. Did not merge `main`. Did not open a pull request. Did not start C36.
- **Findings Fixed:** `F-005` for evidence locators that validate against the landed `EvidenceLocatorSchema`, `F-011` for raw bytes stored through `@ef-harness/db` `CasBlobStore`, and `F-046` for one `NormalizedDocument` shared by the converter and the chunker. `099` and `100` stay for C36.

### What Changed
- Merged task 097 then task 098 onto `f97fbdf`. `SandboxedDocumentConverter` still emits its converter document and now also publishes `normalized`: `docId`, `sourcePath`, `mimeType`, `rawCasSha256`, `sections`, `strippedHiddenSpansCount`, and `warnings`. `IntakeSemanticChunker` chunks that document. `ExactSchemaImporter` is the deterministic OpenAPI, SQL, and Prisma importer.
- Section and contract citations are `EvidenceLocator` values (`pdf`, `docx`, `text`, `image`, or `spec`). The landed schema from C03 has no `doc_span` arm, so citations use those kinds. OpenAPI `#/paths/...` refs are stored as RFC 6901 pointers.
- `createHarnessDocumentConverter` writes raw bytes through `CasBlobStore` (prefixed digest at the intake boundary, bare hex in the store) and runs the converter worker with `HarnessRunEngine`. `ProjectKnowledgeGraph` binds `KnowledgeGraphRepo` on the open `ProjectStateDb`. Entity ids use `SRC-` and `C-`. On Linux the converter still keeps the Windows Job Object path and also applies `prlimit` so `jobAssigned` is a real limit.

### What It Fixed
- **F-005:** Intake evidence rows parse with `EvidenceLocatorSchema` instead of a private `{ label, charStart, charEnd }` object.
- **F-011:** The production converter stores the original file bytes in the shared `CasBlobStore`, not only the in-memory stand-in.
- **F-046:** A PDF or markdown file converted by task 097 can be chunked by task 098, and an OpenAPI import writes `contract` nodes into `ProjectStateDb`.

### Verification Run & Results
- No dirty-worktree patch was assigned to C35. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/intake exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 10 passed (10)`, `Tests 42 passed (42)` (`0` skipped)
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 30 passed (30)`, `Tests 151 passed (151)` (`0` skipped)
- `pnpm --filter @ef-harness/mcp-server exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine test`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion test`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Stopped before C36.


## [C36] — brand sanitizer and bug scrubber on ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `b94ed452703c0f3d48b8e18c0a99d9975e91e9a7` (`integrate: C36 wire brand sanitizer and bug scrubber`)
- **Branches merged:** `origin/task/099-brand-asset-sanitizer-registry` (`8c8e2f76ba71728a5d48b87c010438c878d518f2`) as `6f70e7efa1152d59a50c18b28e3e3dfd40d566db`, then `origin/task/100-bug-har-scrubber-triage` (`74e4e4a18f540ab5ccf7c295640953fe3ee291d1`) as `5923aceaa9712cb97402244030631da1e4152c6f`, both `git merge --no-ff`. No dirty-worktree patch was assigned. Did not reapply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**`. `path_leases.mode` stays `intent|granted`. Did not merge `main`. Did not open a pull request. Did not start C37.
- **Findings Fixed:** `F-011` for sanitized brand bytes and scrubbed symptom payloads in `@ef-harness/db` `CasBlobStore`, `F-012` for asset and symptom rows on the open `ProjectStateDb` writer, `F-046` for deleting `SqliteBrandAssetState` and delegating residual secret scans to `SecretRedactor`, and `F-079` for `getSymptomCard(id)` on the persisted symptom card. Citations stay on the landed `EvidenceLocatorSchema` (`pdf`, `docx`, `text`, `image`, `spec`). No `doc_span` arm was added.

### What Changed
- Merged task 099 then task 100 onto `ccbcdea`. `BrandAssetSanitizer.sanitizeAndRegisterAsset` strips SVG script, event handlers, and external hrefs, strips raster EXIF, and stores the bytes in `CasBlobStore` (raw, bare hex) with an `asset` node and an `artifacts` row on `ProjectStateDb`. `SqliteBrandAssetState` is gone.
- `BugIntakePipeline.ingestBugReport` scrubs `Authorization`, `Cookie`, `Set-Cookie`, and OAuth query keys, runs `@ef-harness/shared-observability` `SecretRedactor`, and stores the scrubbed `SymptomCard` as a `source` node. `getSymptomCard(id)` reads that node. `packages/intake/src/index.ts` exports converters, extraction, brand assets, and the bug scrubber.
- A caller holder kind of `symptom-card` is pinned as `project` at the CAS boundary. No intake code writes `path_leases.mode = 'exclusive'`.

### What It Fixed
- **F-011:** Brand files and scrubbed symptom payloads go through the shared `CasBlobStore`, not an in-memory stand-in on the production path.
- **F-012:** Brand metadata and symptom cards share the open `ProjectStateDb` writer. Intake no longer opens a second `DatabaseSync` on `state.db`.
- **F-046:** `NormalizedDocument` from C35 stays in place. The rogue brand SQLite file is deleted, and secret scanning delegates to `SecretRedactor` plus the existing header, cookie, and OAuth rules.
- **F-079:** `getSymptomCard(id)` returns the persisted card for the mystery-bug pipeline. Lease mode was not widened.

### Verification Run & Results
- No dirty-worktree patch was assigned to C36. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/intake exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 18 passed (18)`, `Tests 73 passed (73)` (`0` skipped). The previous 10 files / 42 tests still pass inside this run.
- `pnpm --filter @ef-harness/planner exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 30 passed (30)`, `Tests 151 passed (151)` (`0` skipped)
- `pnpm --filter @ef-harness/mcp-server exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine test`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion test`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery test`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus test`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1` pre-commit `verify-harmony.mjs`: exit `0` — `harmony ok`
- Stopped before C37.

## [C37] — master plan, sealed oracles, and graph compiler on ProjectStateDb

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `3c1f29053ca65f29efb11aa6760c995dcef29fbe` (`integrate: C37 wire master plan, sealed oracles, and graph compiler`)
- **Branches merged:** `origin/task/090-master-planner-wave-budgets` (`b6b1e95826a62b3215216bee765cfa337df35c51`) as `46e73932317687f996119ecacb1dd1cadb3a28e7`, then `origin/task/091-feature-planner-sealed-oracles` (`c779647d472773cdc087b300ba147ad687cae984`) as `42de073334d1b63560d20e9f17ea1808cb498a09`, then `origin/task/092-deterministic-graph-compiler` (`95d6eb504141a3ded030de27625536de4909565a`) as `6add0bfca4f1137f41c45d7ced898bd6946033a4`, all `git merge --no-ff`. No dirty-worktree patch was assigned. Did not reapply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**`. `path_leases.mode` stays `intent|granted`. No `doc_span` arm. Did not merge `main`. Did not open a pull request. Did not start C38.
- **Findings Fixed:** `F-040` for canonical `ProjectKind` and `WorkerTier` on the three engines and barrel exports, `F-041` for deleting the private planner SQLite schemas and persisting features, tasks, `depends_on` edges, budgets, and sealed checks on `ProjectStateDb`, and the C37 slice of `F-080` (`listSealedForFeatures` on `HiddenCheckPoolStore`). `DeterministicGraphCompiler` gained `compileFeatureWave` and `validateDisjointWriteScopes`.

### What Changed
- Merged task 090, then 091, then 092 onto `b94ed45`. `MasterPlanStore`, `FeaturePlanDatabase`, and `HiddenCheckPoolStore` write through `@ef-harness/db` `ProjectStateDb`. Plan documents are `plan` nodes. Features, phase-0 tasks, and compiled tasks are `feature` / `task` nodes with `feature_runtime` / `task_runtime`. Dependencies are `depends_on` edges. Paperwork budgets are `wave_paperwork` rows parented to one project scope. Sealed check bodies are CAS files; the check node text stays empty and `visibility` is `held_back`.
- `touches_entity` is stored as canonical `documents` plus `fields.touched_entities`, because `schema/state.sql` has no `touches_entity` edge type. `listEdges` still reports `touches_entity`.
- `ProjectKind` normalizes through `@ef-harness/shared-contracts` (`headless_cli` to `cli_tool`, `api` to `api_service`). Brownfield is a flag, not a kind. Phase 0 levels use `WorkerTier`. Feature planning and oracle authoring `complete()` return `Promise`. `MasterPlanOrchestrator.planFromModel` awaits the master-planner model port.
- `compileFeatureWave` refuses a feature with no sealed checks and a slicer `MustBandOversizeRefusal`. The traceability gate evaluates the named queries from `schema/queries.sql` with the same coverage rules as `schema/state.sql` views, without a per-compile database, so the 500-task compile stays inside 100 ms.

### What It Fixed
- **F-040:** The three engines share the canonical project kind and worker tier, export from `@ef-harness/planner`, and call models through async ports.
- **F-041:** Private `CREATE TABLE` schemas in 090, 091, and 092 are gone. Planning and compilation persist on the shared `ProjectStateDb` writer. Budget children are not a second `project` scope.
- **F-080:** `HiddenCheckPoolStore.listSealedForFeatures` returns every sealed check for the named features, for the later portability exporter.

### Verification Run & Results
- No dirty-worktree patch was assigned to C37. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm exec vitest run --config vitest.config.ts` in `packages/planner`: exit `0` — `Test Files 43 passed (43)`, `Tests 211 passed (211)` (`0` skipped). The previous 30 files / 151 tests still pass inside this run.
- `pnpm --filter @ef-harness/intake exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 18 passed (18)`, `Tests 73 passed (73)` (`0` skipped)
- `pnpm --filter @ef-harness/mcp-server exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1` pre-commit `verify-harmony.mjs`: exit `0` — `harmony ok`
- Stopped before C38.

## [C38] — phase 0, design system, and sequential runner on real workers

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **Commit on `harness/integration`:** `13e9b60e538f655232161debd626f3014f541152` (`integrate: C38 wire phase0, design system, and sequential runner`)
- **Branches merged:** `origin/task/093-phase0-controller-gate0` (`1d460bd67c8c3d996197c11c427a446aeac3e493`) as `785613ad52d930d8797e13bfd56bf930a74eb031`, then `origin/task/094-ui-design-system-pipeline` (`0e553ab3190576b30a2b7ead0c24848a10c7434e`) as `392346a87bc737eb84b6f0a877d8825d55f20eb3`, then `origin/task/095-sequential-task-dispatcher` (`769e91a74b34942c9f2c6cb915de10101652742c`) as `8b55ddc6f8d6da2b66fff5a47ac16bd15714e5fd`, all `git merge --no-ff`. No dirty-worktree patch was assigned. Did not reapply `task-079.patch`. Did not merge `task/162` or `task/164`. Did not edit `schema/**`. `path_leases.mode` stays `intent|granted`. No `doc_span` arm. Did not merge `main`. Did not open a pull request. Did not start C39.
- **Findings Fixed:** the C38 slice of `F-040` for canonical project kinds and barrel exports of phase 0, the design system, and the sequential runner, `F-041` for deleting the private Phase 0 and sequential SQLite schemas, `F-042` for sandboxed Gate 0 commands, kernel install vetting, and Playwright styleguide screenshots, and `F-043` for `ProjectStateDb` receipts, harness smoke, and CLI/API features with zero UI journeys.

### What Changed
- Merged task 093, then 094, then 095 onto `3c1f290`. `Phase0StateStore` keeps the run on one `plan` node in `ProjectStateDb`. `Phase0KernelInstaller` vets dependencies through `KernelPackageInstaller`. Gate 0 commands and post-merge smoke run in `HarnessRunEngine`. `/__styleguide` screenshots are Chromium captures stored as `sha256:` digests. `cli_tool` and `backend_api` skip `P0.4` and `P0.8`. `web_fullstack` still runs `P0.1` before the later Phase 0 tasks.
- `SequentialBuildRunner` persists attempt receipts as `comment` nodes on `ProjectStateDb`, with canonical `sha256:` content hashes and the shared `ef_search_text` function. A feature with zero journeys completes, and a feature that declares journeys completes after its leaves merge. The default verifier and static audit check sources through `HarnessRunEngine`. `CandidateAcceptanceCoordinator` is constructed on the same writer. A `NativeWorkerLoop` passed as the worker is driven by `runAttempt`.
- `@ef-harness/planner` exports `Phase0ExecutionController`, `StyleguideRouteVerifier`, and `SequentialBuildRunner`. Offline Playwright remains available when a unit test injects it. No `doc_span` arm was added.

### What It Fixed
- **F-040:** Phase 0 and the design system normalize project kinds through `@ef-harness/shared-contracts`. Headless and API projects do not scaffold UI Phase 0 tasks. The three modules are exported from the planner barrel.
- **F-041:** Private `phase0_*` tables and `sequential_attempt_receipts` are gone. Both stores use the open `ProjectStateDb` writer.
- **F-042:** Phase 0 does not spawn host commands. Install decisions go through `KernelPackageInstaller`. Styleguide screenshots come from Chromium, not a one-color buffer, and land in content-addressed storage.
- **F-043:** Default smoke executes through `HarnessRunEngine`. A CLI or API feature with `journeys === 0` is accepted, and a UI feature with journeys is accepted after its leaves merge.

### Verification Run & Results
- No dirty-worktree patch was assigned to C38. `task-079.patch` was not applied again.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `pnpm lint` (`eslint .`): exit `134` (JavaScript heap out of memory)
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm exec vitest run --config vitest.config.ts` in `packages/planner`: exit `0` — `Test Files 51 passed (51)`, `Tests 269 passed (269)` (`0` skipped). The previous 43 files / 211 tests still pass inside this run.
- `pnpm --filter @ef-harness/intake exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 18 passed (18)`, `Tests 73 passed (73)` (`0` skipped)
- `pnpm --filter @ef-harness/mcp-server exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 17 passed (17)` (`0` skipped)
- `pnpm --filter @ef-harness/research-engine exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 7 passed (7)`, `Tests 19 passed (19)` (`0` skipped)
- `pnpm --filter @ef-harness/spec-expansion exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 11 passed (11)`, `Tests 51 passed (51)` (`0` skipped). The 5 ms catalog budget was not changed.
- `pnpm --filter @ef-harness/discovery exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 30 passed (30)`, `Tests 196 passed (196)` (`0` skipped)
- `pnpm --filter @ef-harness/corpus exec vitest run --config vitest.config.ts`: exit `0` — `Test Files 2 passed (2)`, `Tests 7 passed (7)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1` pre-commit `verify-harmony.mjs`: exit `0` — `harmony ok`
- Stopped before C39.

## [ledger-sync] — confirm C01–C38 against origin/harness/integration

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **When:** 2026-11-28 00:35 Europe/Berlin
- **Product HEAD:** `13e9b60e538f655232161debd626f3014f541152` (`integrate: C38 wire phase0, design system, and sequential runner`)
- **Audit branch before this entry:** `ea21711` (`log: record C38 progress`)
- **Branches merged:** none. No product commit. Did not cherry-pick `origin/harness/c05-wip`. Did not merge `main`.
- **Patches applied:** none
- **Findings fixed:** none (ledger only)

### What Changed
- Fetched all remotes and tags. `harness/integration` now tracks `origin/harness/integration`. Both tips are `13e9b60`.
- A handoff said C41 was already done. Git history disagrees. `git log --grep='^integrate: C'` ends at C38. `git merge-base --is-ancestor` is false for `f69c07d` (task 096), `8660af4` (task 101), and `61496c7` (task 102).
- Re-checked the ledger short SHAs for C01–C38 against `git log -1`. They match the subjects already recorded (`1d992c5` through `13e9b60`). Left C39–C79 and Phase 9 pending. The next product task is C39.

### Verification
- `git rev-parse HEAD` on `harness/integration`: `13e9b60e538f655232161debd626f3014f541152`
- `git rev-parse origin/harness/integration`: same SHA
- `git status -sb`: `## harness/integration...origin/harness/integration` clean

## [C39] — feature integrator, completion wave, and ask-owner

- **Subagent Role & Model:** integrator-worker, grok-4.7
- **When:** 2026-11-28 00:54 Europe/Berlin
- **Commit on `harness/integration`:** `4457ba97f5ee527a1aece4acfdbaad2ba7f265fd` (`integrate: C39 wire feature integrator, completion wave, and ask-owner`)
- **Branches merged:** `origin/task/096-feature-integrator-engine` (`f69c07dfe8132f5a38b542de06b8e5cb818bb68c`) as `a3134a1f663fc4f00c760f6f039d5d3f2fff9ff1`, then `origin/task/101-completion-wave-final-audit` (`8660af4883fed6f2e113c8f65ac2535cd8cd3d6f`) as `221c3789a7ef62c413f2d881b959e3193d011463`, then `origin/task/102-specialist-review-qa-prompts` (`61496c7e1e8dd970e75dc4a92690e3961125165d`) as `4522aa2b6062989246134f67102f9774228c93ca`, all `git merge --no-ff`. No dirty-worktree patch was assigned. Did not merge `task/162` or `task/164`. Did not edit `schema/**`. `path_leases.mode` stays `intent|granted`. Did not merge `main`. Did not open a pull request.
- **Findings Fixed:** the C39 slice of `F-044` (async specialist model, real line sets, grounded ask-owner text, `ProjectStateDb` specialist store), `F-047` (integrator barrel, async feature integration, `ProjectStateDb` final-audit store, `BudgetLedgerRepo` snapshots), and `F-054` (async `answerQuestion` with real `llmCalls`).

### What Changed
- `@ef-harness/integrator` depends on `@ef-harness/db` and exports `FeatureIntegratorEngine`, `CompletionWaveController`, `FinalAuditStore`, `LandingSummaryGenerator`, `InMemoryBudgetLedger`, and `ProjectStateBudgetLedger`.
- `FinalAuditStore` and `SpecialistStateDb` persist on `ProjectStateDb` comment nodes. Private `CREATE TABLE` stores for those two modules are gone.
- `ProjectStateBudgetLedger` registers `usd`, creates the project scope plus `final-audit` and `audit-fix` feature children (2% and 10%), and reserves with purpose `effect`. `CompletionWaveController` reads `getScopeSnapshot` for the hard stop and remaining units. `InMemoryBudgetLedger` stays for the existing unit tests.
- `FeatureIntegratorEngine.integrate`, `FeatureJourneyGate.evaluate`, and `runBoundedFixLoop` are async. `BlindBinderPort.bind` may return a `Promise`. The default path is still the in-memory journey gate, because the 096 tests drive `CodeSnapshot` callbacks. A real binder can be injected.
- `AskOwnerResponderEngine.answerQuestion` accepts `string | OwnerQuestionRequest`, awaits the model, and sets `llmCalls`. A schema-valid answer is returned only when every content token is in the fact sheet. Hallucinated text still falls back to the grounded template and still counts one model call. Unknown questions do not call the model.
- Taste and high-risk review await `SpecialistModel.complete`. Taste line sets come from `fileTexts` or a real file read. A missing file has zero lines, so a `1..400` citation fails.
- `dispute-adjudicator@1` is not in the merged specialists package. `resolveDisputeChoice` remains the dispute path. `FourRouteSteeringDispatcher` is task 114 and is not merged; C44 can await `answerQuestion`. Final-audit `ProjectKind` stays the local `web | cli | openapi` union so the landed tests keep passing. Canonical `ProjectKind` is the C40/C41 slice of `F-040`. `USER_PAUSED_REASON` is left for C44/C45. Windows Job Objects, DPAPI, named pipes, and NSIS were not touched.

### What It Fixed
- **F-044:** Specialist review no longer treats a promise as a completed model payload, and citations are checked against the real file. Ask-owner keeps a grounded model answer and still discards a hallucination. Specialist rows live in `ProjectStateDb`.
- **F-047:** The integrator barrel exports the feature engine and the completion-wave controller. Final-audit rows live in `ProjectStateDb`. The completion wave reads `BudgetLedgerRepo.getScopeSnapshot` instead of a missing `getBudgetRemaining` on the production ledger.
- **F-054:** `answerQuestion` is async and reports the real `llmCalls` count so the later steering dispatcher can stop throwing on a synchronous call.

### Verification Run & Results
- No dirty-worktree patch was assigned to C39.
- `pnpm build` (`tsc -b --pretty false`): exit `0`
- `pnpm typecheck` (`tsc -b --pretty false`): exit `0`
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm lint` (`eslint .`): exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/integrator test -- feature-integrator completion-wave`: exit `0` — `Test Files 15 passed (15)`, `Tests 48 passed (48)` (`0` skipped)
- `pnpm --filter @ef-harness/planner test -- specialists`: exit `0` — `Test Files 3 passed (3)`, `Tests 23 passed (23)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` — `67/67 passed · SQLite 3.53.4`
- `EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit`: exit `0` — `harmony ok`
- Next product task is C40.

## [C40] - Crew-Levels Expected-Cost Selector & HEFT Scheduler Integration (Tasks 106 & 107)
- **Subagent Role & Model:** EF Harness Integration Worker (`gpt-5.4` / default execution environment)
- **Commit SHA(s) & Subject(s) on `harness/integration`:**
  - `50898a8` (`50898a879e9dbdf07b4bc52b372d2331ae0ac030`) - `integrate: Task 106 crew-levels-expected-cost`
  - `28da19c` (`28da19ccc86d2070e54c7967756357aba7168375`) - `integrate: Task 107 heft-scheduler-crew-presets`
  - `b7ec2cc` (`b7ec2cc7f2b1d0a9898b1e8ea7a228a14e474975`) - `integrate: C40 wire crew-levels roster and HEFT scheduler`
- **Branches Merged / Verified & Dirty Worktrees Harvested:**
  - Merged `task/106-crew-levels-expected-cost` (`279569d3a80d0eb7d74594c548f652278250a660`) via `--no-ff`
  - Merged `task/107-heft-scheduler-crew-presets` (`3f1744aa46a61091ac1db118618036220de2832e`) via `--no-ff`
  - Dirty worktrees harvested: none
- **Findings Fixed:** `F-039`, `F-040`, `F-045`
### What Was Done
- **Canonical `@ef-harness/shared-contracts` vocabulary alignment (`F-039`):** Updated `packages/planner/src/crew-levels/{errors,types,difficulty,rationale,calibrator,selection-core,roster,selector,ports,index}.ts` and `packages/planner/src/scheduler/{errors,types,write-scope,ports,parallelism,presets,dispatch,project,dynamic-schedule-rebalancer,heft-critical-path-scheduler,index}.ts` to emit canonical `WORKER_TIERS` (`"Junior" | "Mid" | "Senior" | "Principal"`), `CREW_PRESETS` (`"Fastest" | "Balanced" | "Cheapest"`), `PRESSURE_LEVELS` / `GOVERNOR_PRESSURES` (`"GREEN" | "YELLOW" | "ORANGE" | "RED"`), `HOLD_REASONS` / `TASK_HOLD_REASONS`, and `@ef-harness/db` `SCOPE_KINDS` (`ScopeKind`). Boundary coercion helpers normalize legacy/lowercase inputs (`"junior"`, `"manager"`, `"budget"`, `"thorough"`, `"Green"`, `"Red"`, etc.) into canonical runtime types.
- **Concrete `modelId` propagation & expected-cost wiring (`F-045`):** Extracted cycle-free `packages/planner/src/crew-levels/selection-core.ts`, added `VersionedModelRoster.defaultSeed()`, `defaultModelRoster()`, `resolveModelForTier`, `estimateTaskExpectedCostMicroUsd`, and `ResolvedModelAssignment`, and wired `CrewPresetProfileEngine`, `LocalExpectedCostLevelSelector`, `CrewLevelsSelectorAdapter`, `dispatchReady`, `projectSchedule`, `DynamicScheduleRebalancer`, and `HeftCriticalPathScheduler` (plus `scheduleReadyWave`) onto `ExpectedCostLevelSelector` + `VersionedModelRoster` (`defaultSchedulerRoster()`) so concrete `LevelAssignment.modelId` values flow into `claimTask`, `DispatchAssignment.modelId`, `TaskPlacement.modelId`, and `InFlightTurn.modelId` instead of tier names.
- **DB, Graph Compiler & Planner barrel wiring (`F-040`):** Added `GlobalBrokerDb.listConnections()` via shared `mapConnection` helper in `packages/db/src/auxiliary-dbs/global-broker-db.ts` (without modifying `schema/global.sql`), bound `crew-levels/ports.ts` onto `GlobalBrokerDb`, `TelemetryDb`, `CodeIndexDb`, and `BudgetLedgerRepo` (`bindGlobalDbRepo`, `bindTelemetryDbRepo`, `bindCodeIndexRepo`, `bindBudgetLedgerRepo`, plus `graphTaskFromPlanTask`), bound `scheduler/ports.ts` onto `TaskLeaseManager` (`bindTaskClaimManager`), `TaskHoldAndSubmissionRepo` (`bindTaskHoldsManager`), and `DeterministicGraphCompiler.validateDisjointWriteScopes` (`writeScopesOverlap`, `validateDisjointScheduleWriteScopes`, re-exporting `patternsOverlap`), and exported `crew-levels` and `scheduler` from `packages/planner/src/index.ts` without symbol collisions.
- **Tests:** Updated `packages/db/tests/auxiliary-dbs/global-broker.test.ts`, `packages/planner/tests/crew-levels/{roster,selector}.test.ts`, and `packages/planner/tests/scheduler/crew-and-rebalance.test.ts`, and added `packages/planner/tests/scheduler/c40-integration.test.ts` covering SQLite DB bindings, disjoint write-scope checks, vocabulary normalization, concrete `modelId` dispatch, and root barrel exports.
### What It Fixed
- Eliminated enum/vocabulary mismatches (`F-039`) between `shared-contracts`, `db`, `crew-levels`, and `scheduler` while retaining backwards compatibility at input boundaries.
- Eliminated the `scheduler/dispatch.ts` tier-name-as-`modelId` bug (`F-045`) by resolving concrete provider model IDs through the shared `VersionedModelRoster` / `ExpectedCostLevelSelector` path.
- Replaced unbound port gaps (`F-040`) with working `@ef-harness/db` and `graph-compiler` adapters and exposed both modules cleanly from `@ef-harness/planner`.
### Verification Run & Results
- `pnpm build`: exit `0`
- `pnpm typecheck`: exit `0`
- `$env:NODE_OPTIONS="--max-old-space-size=4096"; pnpm lint`: exit `0` (`0` errors; `4` pre-existing unused-disable warnings in `packages/planner/src/system-arch/vendor/mermaid-parse.mjs`)
- `pnpm --filter @ef-harness/db test`: exit `0` - `Test Files  67 passed (67)`, `Tests  374 passed (374)` (`0` skipped)
- `pnpm --filter @ef-harness/planner test`: exit `0` - `Test Files  64 passed (64)`, `Tests  343 passed (343)` (`0` skipped)
- `node schema/schema-test.js`: exit `0` - `67/67 passed Â· SQLite 3.53.0`
- `$env:EF_HARNESS_MAINTAINER="1"; node scripts/verify-harmony.mjs --pre-commit`: exit `0` - `harmony ok`
- Stopped after C40 without editing `integration_progress.md` or starting `C41`.
## [C41] - PlanPreviewAndAutoStartGate and real M2 kitchen exit gate
- Subagent Role & Model: integrator-worker
- Commit SHA & Subject: 658248a integrate: C41 wire plan preview auto-start gate and real M2 kitchen exit gate
- Branches Verified: task/108-plan-preview-autostart-gate, task/105-m2-kitchen-exit-gate (already merged at 87f90f1, 74ce2bc)
- Findings Fixed: F-040, F-045, F-048
- What Was Done: Finished the interrupted C41 WIP on harness/integration without reverting it. (1) F-040: exported the missing AuditResult interface from the sequential-runner barrel so the 17-module planner barrel (system-arch, feature-arch, views-export, views-import, revisions, slicer, rule-matching, master-plan, feature-plan, graph-compiler, phase0, design-system, sequential-runner, specialists, crew-levels, scheduler, plan-preview) resolves end to end. (2) F-045: made the rolling 24h auto-start spend counters and ceilings durable through GlobalBrokerDb settings keys plan_preview.auto_start.history / plan_preview.auto_start.settings via bindGlobalBrokerAutoStartStore plus RevisionAutoStartPolicy.open(globalDb), verified to survive a GlobalBrokerDb close/reopen; the volatile store now only backs bare unit construction and is never wired by the production sources. (3) F-048: the M2 exit gate now executes the real packages (discovery, corpus, spec-expansion, research-engine, intake, planner, worker-loop, verifier, integrator) with .js ESM relative specifiers and no pre-baked static HTML/JS fixture copying; executePipeline stays deterministic (two independent temp dirs produce the same traceDigest). Repaired the shared state.db integration seams the real run exposed: the sequential runner now allocates change-set revisions against the live change_sets maximum and advances meta.last_rev (with its own CS-runner- id namespace so it cannot clash with the knowledge repo), addFeature reuses architecture-owned feature nodes, feature-architecture synthesis is additive over existing nodes/edges, compiled leaf specs can declare implementsRequirements so the real spec_item/edge_case/journey requirement nodes become passing for the feature-done gate, wave-2 specItems no longer collide with spec-expansion ids, state-expansion matrix coverage counts both matrix_cell and universal_rule rows (all 12 matrices), the recorded system-architecture skeleton matches architect-schema@1 (feature_map title/owns, string error_envelope and response_convention, context plus data_flow diagrams), leaf tasks declare exactly one responsibility with their matched X-* rule ids in the MUST band, and every runner commit carries EF-* trailers through a new commitMessage hook plus the exported trailerLines helper. Tests: added packages/planner/tests/plan-preview/c41-integration.test.ts and tests/e2e/m2-exit-gate/kitchen-codegen.ts.
- What It Fixed: F-040 - the planner barrel now exposes all 17 submodules with no unresolved exports. F-045 - the 5 USD / 10 percent rolling 24h auto-start cap is persisted in global.db instead of resetting to zero on restart, and survives close/reopen. F-048 - the Task 105 exit gate genuinely exercises the M2 pipeline (hidden acceptance suite 29/29 against the built Kitchen app) instead of copying a static fixture, so the gate can no longer report PASS while the M2 packages are broken.
- Verification Run & Results: pnpm build -> exit 0; pnpm typecheck -> exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint -> exit 0, 0 errors and 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs; pnpm --filter @ef-harness/planner test -> exit 0, Test Files 68 passed (68), Tests 376 passed (376); pnpm --filter @ef-harness/e2e test -- m2 -> exit 0, Test Files 1 passed (1), Tests 4 passed (4), gate exit 0, reasons none, hidden checks 29/29, paperworkPct 0.18, leakedPids 0, secretsFound 0, claimedCertification true, autoStarted false, deterministic traceDigest; node schema/schema-test.js -> exit 0, 67/67 passed (SQLite 3.53.0); EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit -> exit 0, harmony ok; git status --short -> clean.

## [reconcile] - duplicate C39 histories merged into harness/integration
- Subagent Role: orchestrator (non-agent shell)
- Merge commit: 13287657feb0d679779119b278a8de6039e8710d (parents 658248a + 4457ba9)
- Problem: origin/harness/integration (4457ba9, C39) and local harness/integration (658248a, C41) shared base 13e9b60, but carried the same Task 096/101/102/C39 work as different SHAs (a3134a1/221c378/4522aa2/4457ba9 vs 8010128/784e592/4aafbc5/09525f2). Local additionally had C40 (b7ec2cc) and C41 (658248a). Branches diverged 14 ahead / 4 behind, so a plain push was rejected.
- Resolution: merged origin/harness/integration into local harness/integration. All 22 content conflicts (packages/integrator/**, packages/planner/src/index.ts, packages/planner/src/specialists/**, pnpm-lock.yaml) resolved to the local C41 tree per instruction. git diff --stat 658248a is EMPTY, i.e. the merged tree is byte-identical to pre-merge local HEAD: origin contributed no content delta and no C41 verification result was lost.
- Verification: pnpm build exit 0; pnpm typecheck exit 0; git merge-base --is-ancestor origin/harness/integration HEAD exit 0; git status --short clean; push 4457ba9..1328765 non-force; ahead/behind 0/0.
- Not done: main untouched at 6497730; C42 not started.

## [C42] - Artifact handoffs, role mailbox, and parallel feature branches
- Subagent Role: integrator-worker
- Commit SHA & Subject: 0d36570 integrate: wire handoffs/feature-branches (`0d365707cb3be5ab3b9c30699c3327b8240b8c7c`)
- Branches Merged: task/109-artifact-handoff-mailbox-engine (`989041d67eec9bd201151305c7efe0854e06f425`) as `136cf39`; task/110-parallel-feature-branches-migrations (`08a8f3620d5cae431b9c9f11bbccb81934c7f210`) as `efaeed4`. No dirty-worktree patch.
- Findings Fixed: F-049 (C42 slice: handoffs and feature branches on the shared ProjectStateDb, CasBlobStore, and GitEngine), F-050 (C42 slice: DependencyIntentAggregator calls KernelPackageInstaller.reconcileDependencyIntents). C43 merge-queue, CCR, and undo were not started.
- What Was Done: Handoff pointer rows (`handoff_artifacts`, `role_mailbox`, and the rest of the handoff tables except the three private stores) live in state v2 SQL on the canonical state.db. Raw payloads are files under the CasBlobStore layout, keyed `sha256:<64-hex>`. Wait-graph edges are `depends_on` and `waits_on` on `state.db.edges` through KnowledgeGraphRepo reads. Contract owners are contract nodes plus the names registry. `cas_blobs`, `graph_edges`, and `contract_owners` are not created. Feature coordination uses `feature_coordination` plus LifecycleRepo `feature_runtime` (PLANNED, JIT_READY, IN_WAVE). Ref leases use the canonical `ref_leases` table and RefLeaseManager.readRefLease. WorktreeSlotPool is constructed beside the synchronous slot pool. DependencyIntentAggregator constructs KernelPackageInstaller and reconciles ranges through reconcileDependencyIntents while the injected lockfile installer still writes the lockfile. AttemptMcpServer.bindHandoffPull registers harness.read_result for handoff_id pulls and pullTool rejects any other tool name. Integrator package.json and tsconfig references add mcp-server, sandbox, planner, and shared-observability. schema/state.sql was not edited. schema user_version stays 2.
- What It Fixed: F-049 - handoffs and parallel feature branches no longer keep private SQLite blob, graph, owner, runtime, or lease tables; they share ProjectStateDb, CasBlobStore, and GitEngine. F-050 - dependency aggregation now goes through KernelPackageInstaller instead of a lockfile-only reconciler. The toy build.mjs gate, merge queue, and undo stack remain C43.
- Verification Run & Results: pnpm install exit 0; pnpm build exit 0; pnpm typecheck exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; pnpm --filter @ef-harness/mcp-server test exit 0, Test Files 2 passed (2), Tests 18 passed (18), 0 skipped; pnpm --filter @ef-harness/integrator test -- handoffs feature-branches exit 0, Test Files 24 passed (24), Tests 100 passed (100), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C43 not started. main not merged.

## [C43] - Merge queue, contract-change requests, and planned-feature undo
- Subagent Role: integrator-worker
- Commit SHA & Subject: 95062f7 integrate: wire integrator m3 barrels/seams (`95062f7a9433e9ff896af3c6a3bd5f49fae44e4b`)
- Branches Merged: task/111-project-merge-queue-integrator (`72b37e612adefa28ca562f910044acbf0b262f9c`) as `27eea4b`; task/112-contract-change-request-pipeline (`5ed8f81a2092f4c7ecbdf34d0bc4508c7e97871e`) as `e39e0f7`; task/129-planned-feature-undo-engine (`94ca48c317432e5612052b40b9b486763b267afe`) as `0fd1564`. No dirty-worktree patch.
- Findings Fixed: F-049 (C43 slice: merge queue, CCR, and undo on ProjectStateDb; the twelve CCR local ports call the real siblings), F-050 (C43 slice: CombinedRegressionGate and FeatureUndoEngine run inside HarnessRunEngine and no longer shell out to build.mjs, template/app.sqlite, manifest.json, or node --check of .js only). C42 handoffs and feature branches were not redone. C44 was not started.
- What Was Done: state v2 now creates merge_queue_items (with runtime columns), merge_queue_events, merge_queue_worktrees, the five ccr_* tables, undo_edges, undo_inbox, undo_workers, and undo_ownership, and seeds feature state UNDONE. feature_queue_runtime, undo_nodes, and a second ref_leases table are not created. Queue runtime lives on merge_queue_items. Archived features are nodes.status retired plus feature_runtime UNDONE; the public nodeStatus stays undone. Inbox questions stay on undo_inbox because canonical inbox_items cannot store retired. CombinedRegressionGate typechecks with tsc when a tsconfig or typecheck script exists, lints, runs a package build script when present, applies migrations on a fresh sqlite database, and runs test files through HarnessRunEngine. It also calls GitSafetyScanner, CompletenessGateRunner, and CleanVerifierRunner. FeatureUndoEngine delegates to that gate. CCR review and project-integrator resolve go through an offline ModelProtocolAdapter. Default CCR ports call SkeletonLockEnforcer, ReverseImpactWalker, DurableRoleMailbox, WaitGraphCycleDetector, RevisionAutoStartPolicy, MigrationIntentAndConflictLinter, ProjectMergeQueue, CombinedRegressionGate, TaskHoldAndSubmissionRepo with reason ccr, and HybridRevisionEngine. The integrator barrel exports handoffs, feature-branches, merge-queue, ccr, and undo without dropping feature-integrator or final-audit. schema/state.sql, package.json, and pnpm-lock.yaml were not edited.
- What It Fixed: F-049 - merge queue, CCR, and undo no longer keep private runtime databases or a private ref lease table, and the CCR engine no longer defaults to the twelve stand-in ports. F-050 - the combined gate and undo no longer spawn unsandboxed node --check, require build.mjs, copy template/app.sqlite, or read features/*/manifest.json. Duplicate route strings are not rewritten in manifests.
- Verification Run & Results: pnpm install --frozen-lockfile exit 0; pnpm build exit 0; pnpm typecheck exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; pnpm --filter @ef-harness/integrator test -- merge-queue ccr undo feature-integrator final-audit exit 0, Test Files 29 passed (29), Tests 179 passed (179), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C44 not started. main not merged.

## [C44] - Steering router and four-route dispatcher
- Subagent Role: integrator-worker
- Commit SHA & Subject: 8024fce integrate: wire steering router/dispatcher (`8024fcee977dd27c4ebd3011479eff6d76af86f2`)
- Branches Merged: task/113-message-sequencing-intent-router (`4c86c46942305f767fcfca78a2a10f83c5f9e389`) as `e2dcb5e`; task/114-four-route-steering-dispatcher (`05609eb0f6fca72c495bfe3b37c7f950b4985e7a`) as `9cc29a9`. No dirty-worktree patch.
- Findings Fixed: F-053 (C44 slice: steering messages on ProjectStateDb; no private outbox, outbox_deliveries, or router_catalog; route telemetry and pause state in TelemetryDb and state.db), F-054 (C44 slice: provider router@1 clauses are kept, Route 1 accepts AskOwnerResponderEngine, hold reason is user_pause). C42 and C43 were not redone. C45 was not started.
- What Was Done: state v2 creates user_messages, message_clauses, and input_focus_snapshots. Catalog rows are nodes. Outbox writes use the canonical outbox. Offline routing still uses planMessage after an offline ModelProtocolAdapter echo. A provider model keeps the validated router@1 clauses. SteeringMessageRouter.submit and FourRouteSteeringDispatcher.dispatchReadOnlyQuery are async. Route 1 can call AskOwnerResponderEngine and no longer throws READ_ONLY_LLM when the answer used the model. pauseFeature writes task_holds.reason user_pause and steering.control_state in meta. Route telemetry flushes to TelemetryDb when a telemetry path is set. DispatcherClausePort sends executor clauses to the four-route dispatcher. schema/state.sql was not edited. The steering barrel stays a stub for C45.
- What It Fixed: F-053 - steering no longer creates a second outbox or router_catalog, and pause/telemetry can land in state.db and telemetry.db. F-054 - a real router@1 clause is executed, Route 1 accepts an owner answer that called the model, and holds use user_pause.
- Verification Run & Results: pnpm install exit 0; pnpm build exit 0; pnpm typecheck exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; pnpm --filter @ef-harness/steering test -- router dispatcher exit 0, Test Files 5 passed (5), Tests 35 passed (35), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C45 not started. main not merged.

## [C45] - Multi-interpretation holds, question arbiter, and cold-open reentry
- Subagent Role: integrator-worker
- Commit SHA & Subject: 3e8e9c1 integrate: wire steering m3 barrels/seams (`3e8e9c18e84f37c58ae4bbbe526b63b189905d36`)
- Branches Merged: task/115-multi-interpretation-hold-engine (`2c95cd8dcecbc0acf9ce90369df4b9abd30a864c`) as `f6e78e0`; task/116-shared-question-queue-arbiter (`2370d7abfef49a62aa9e1cd21e77eed90e94b89c`) as `00aedbe`; task/130-reentry-reconciliation-welcome-back (`a92052c78a578af4618d8ef69fbfe854442911ee`) as `82b6ae1`. No dirty-worktree patch.
- Findings Fixed: F-053 (C45 slice: holds, questions, and reentry on ProjectStateDb; no private task_runtime or task_holds DDL; no qa_* shadow tables; telemetry stays out of state.db; attempts are parked with attempt_checkpoints), F-054 (C45 slice: 114 hold placement writes canonical task_holds, and ColdOpenReconciler reads git-engine, planner view manifests, and inbox_items without clicking Resume). C44 router and dispatcher were not redone. C46 was not started.
- What Was Done: state v2 adds hold_reason_details, task_checkpoints, feature_heads, ambiguous_readings, hold_reading_hits, clarification_cards, quarantined_candidates, and ambiguity_reminders. openHoldDatabase opens canonical state.sql plus that migration and does not create task_runtime or task_holds. SharedQuestionArbiter stores cards in inbox_items and active waiters in inbox_subscribers. Domain status retired is stored in the payload and the inbox status is dismissed. Settled facts, wakes, pending replies, and question holds live in meta, not qa_* tables. Interruption metrics use schema/telemetry.sql on telemetry.db and refuse to create telemetry inside state.db. ProjectReentryStore writes attempts.state parked and an attempt_checkpoints row. durableTaskHolds places user_pause on task_holds. Cold open uses commandIsReadOnly from git-engine, loadManifest from planner, and inbox_items, and leaves the gate in REENTRY_AWAITING_RESUME. The steering barrel exports router, dispatcher, holds, questionArbiter, and reentry. WelcomeBackScreen is exported from the renderer barrel. schema/state.sql, package.json, and pnpm-lock.yaml were not edited.
- What It Fixed: F-053 - opening holds against state.db no longer crashes on existing task_runtime, the question queue no longer writes qa_inbox_items, and reentry no longer records CHECKPOINTED. F-054 - the dispatcher hold port and the cold-open reconciler share the landed steering modules and the canonical databases.
- Verification Run & Results: pnpm install --frozen-lockfile exit 0; pnpm build exit 0; pnpm typecheck exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; pnpm --filter @ef-harness/steering test exit 0, Test Files 16 passed (16), Tests 102 passed (102), 0 skipped; pnpm --filter @ef-harness/renderer test exit 0, Test Files 2 passed (2), Tests 4 passed (4), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C46 not started. main not merged.

## [C46] - Governor telemetry, hysteresis footprints, and three-pool capacity
- Subagent Role: integrator-worker
- Commit SHA & Subject: 0185622 integrate: wire governor telemetry/pools (`0185622da520de54c4914a2fa1c15d995f08d9be`)
- Branches Merged: task/117-governor-windows-telemetry (`dcee6821b371e82ac7e9e592b10d0e9989e2b54a`) as `1b8afd9`; task/118-governor-hysteresis-footprints (`865cae260c52363f6f7eb6fc51cec7bf2b93b55d`) as `4bd2ad6`; task/119-three-pool-capacity-scheduler (`b9a1b25532643b0aaa6a1d2934af50b85b0c089b`) as `9a7a21e`. Wire commit on top. No dirty-worktree patch from C45.
- Findings Fixed: F-055 (C46 slice: items 1–3 and the Win32 helper half of item 5 — real collector, uppercase pressure, 14-metric footprints on GlobalBrokerDb, prebuilt helper before csc, no posix fallback on win32), F-045 (C46 slice only: HeftCriticalPathScheduler and ThreePoolCapacityScheduler accept uppercase GovernorPressure and a WorkloadFootprint). Vault dual-DB and waiting_on_human_step stay C47. Crew preset, modelId dispatch, plan-preview, and 24h auto-start were not redone. C45 was not redone. C47 was not started.
- What Was Done: GovernorPressure stays GREEN|YELLOW|ORANGE|RED in @ef-harness/shared-contracts. normalizeGovernorPressure accepts legacy case only at ingress. PressureHysteresisStateMachine keeps readonly pressure, adds subscribe((level) => void) beside the object listener, and sample() observes then returns the level. applyGovernorPressure feeds that sample into ThreePoolCapacityScheduler.setPressure, HeavyLaneSemaphore.setPressure, and DiskHeadroomGuard.observe, and reads GpuWhisperPriorityArbiter.headroomMb on the same tick. Capacity pools store uppercase and no longer throw CapacityError on GREEN. LearnedFootprintStore writes the 14-metric calibration through GlobalBrokerDb. MigrationRunner applies additive global v2 columns (p90_mb, peak_ram_mb, peak_cpu_time_ms, disk_write_bytes, wall_clock_ms, high_watermark_mb, predicted_mb, peak_ram_samples_json). schema/global.sql and schema/state.sql were not edited. The Win32 collector throws TelemetryError instead of constructing PosixFallbackTelemetryProvider. compileHelper prefers a real MZ win32-helper.exe, then csc.exe. packages/governor/scripts/ensure-win32-helper.mjs exits 0 on Linux when csc is absent and does not check in a stub exe. The C# helper source stays. Governor references @ef-harness/db. HeftCriticalPathScheduler.scheduleWithFootprints merges wallClockMs into the exec override after coercing pressure. Planner re-exports the shared normalizeGovernorPressure and does not import governor.
- What It Fixed: F-055 — Windows telemetry no longer silently substitutes the posix provider, pressure no longer crashes the pool scheduler on uppercase, and learned footprints persist the calibration columns in global.db. F-045 — the heft scheduler and the three-pool scheduler share uppercase pressure, and a learned wall-clock footprint shortens the critical path. GREEN→YELLOW→ORANGE→RED through sample into setPressure throws 0 errors and subscribe fires YELLOW, ORANGE, RED.
- Verification Run & Results: pnpm build and pnpm typecheck (both `tsc -b --pretty false`) exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/governor test -- telemetry admission capacity-pools exit 0, Test Files 17 passed (17), Tests 81 passed | 1 skipped (82) (live-win32 describe.skipIf on Linux); pnpm --filter @ef-harness/planner test -- scheduler exit 0, Test Files 69 passed (69), Tests 377 passed (377), 0 skipped; pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C47 not started. main not merged. task/162 and task/164 not merged.

## [C47] - DPAPI vault metadata and human-step holds
- Subagent Role: integrator-worker
- Commit SHA & Subject: 8cf8678 integrate: wire governor m3 barrels/seams (`8cf867815b64fcffdcebada0623d8e1f32b9a783`)
- Branches Merged: task/120-dpapi-secrets-vault-env-injection (`f1fad0a9cb2e3bdc9cb318bc49e8871d0e67bcd5`) as `05ef075`; task/121-human-step-probing-verification (`f8fb5d039371ad20d3a4d7e3f7dc73501c0a2b77`) as `d9f057a`. Wire commit on top. No dirty-worktree patch. C46 was not redone.
- Findings Fixed: F-055 (C47 slice: vault dual-DB and waiting_on_human_step). SqliteVaultMetadataStore no longer opens raw DatabaseSync handles on global.db and state.db. HumanStepStateStore no longer writes task_holds.reason waiting_on_human_step. C46 items 1–3 and the Win32 helper half of item 5 were left as landed.
- What Was Done: WindowsDpapiSecretsVault takes GlobalBrokerDb and ProjectStateDb and exposes storeSecret, readPlaintextForKernel, and deleteSecret. Metadata writes go through those single-writer handles, one file at a time, with no ATTACH. MigrationRunner v2 adds vault_secret_metadata on global.db and state.db, and human_steps plus human_step_counter on state.db. schema/global.sql and schema/state.sql were not edited. The local PacketSecurityRedactor is gone; the vault uses @ef-harness/shared-observability StreamingRedactor and PacketSecurityRedactor. Governor package.json depends on @ef-harness/db, shared-observability, sandbox, and planner. packages/governor/src/index.ts exports telemetry, admission, capacityPools, vault, and humanSteps, plus WindowsDpapiSecretsVault, RuntimeOnlyEnvInjector, LiveKeyTestRefusalGuard, HumanStepProbeRegistry, and AttestedVsVerifiedBadgePolicy. Human-step holds use reason governor and source human_step:<stepId>. isHoldReason rejects any other reason before insert. NTFS icacls stays the Windows implementation and is not invoked off win32. C46 uppercase pressure and the Win32 helper were not changed.
- What It Fixed: F-055 — vault metadata no longer opens a second writer on global.db and state.db, and human-step holds are rows HoldsSubmissionsRepo and HeftCriticalPathScheduler can accept. The governor barrel exports all five submodules.
- Verification Run & Results: pnpm install exit 0; pnpm build and pnpm typecheck (both `tsc -b --pretty false`) exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/governor test exit 0, Test Files 28 passed (28), Tests 118 passed | 1 skipped (119) (live-win32 describe.skipIf on Linux, unchanged from C46); pnpm --filter @ef-harness/db test exit 0, Test Files 67 passed (67), Tests 374 passed (374), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 node scripts/verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C48 not started. main not merged. task/162 and task/164 not merged.

## [C48] - Single app shell, phase presets, and pop-out windows
- Subagent Role: integrator-worker
- Commit SHA & Subject: ef283f1 integrate: wire desktop/renderer shell (`ef283f13662730eef6f7c4a68bbfd8cad87d4f68`)
- Branches Merged: task/122-single-app-shell-framework (`2c6aeffb1dfa3f46ce681f3cb17919f55d3b9d2d`) as `7e41b90`; task/123-phase-presets-popout-windows (`7a522a64c4127adbfd9a32ee6e7a45816e4936e3`) as `ded24e2`. Wire commit on top. No dirty-worktree patch. C47 was not redone.
- Findings Fixed: F-063 (react and react-dom declared on @ef-harness/renderer, BridgePayload and renderer NamedPipeClient removed, governor pressure stored as GREEN|YELLOW|ORANGE|RED, SharedHarnessdStream resets on stream_epoch instead of throwing, ShellLayoutContext.applyPreset/readCanvas/writeCanvas). F-027 (C48 slice: pop-out windows attach a distinct MessagePort and do not replace the primary window port; C26 frame reassembly in PipeClientBridge was left as landed).
- What Was Done: Merged task 122 then task 123. apps/renderer/package.json depends on react, react-dom, @types/react, and @types/react-dom. SingleAppShell takes an injected preload MessagePort. Outbound calls are JsonRpcRequestSchema documents: events.subscribe, snapshot.get, build.stop, build.pauseAll, and build.start, each mutating call carrying a non-empty op_id. The landed RPC catalog has no run.stop, run.pause, or run.resume, so those names were not added. Resume uses build.start. readPressure stores normalizeGovernorPressure output, so lowercase and uppercase ingress both become GREEN|YELLOW|ORANGE|RED. ShellLayoutContext.applyPreset(preset, reason) drives phase, center tab, left rail, and inspector, and readCanvas/writeCanvas keep one viewport. SharedHarnessdStream tracks streamEpoch, clears lastSeq and the ring on epoch change, ignores a non-advancing seq, and caps history at 256. PipeClientBridge publishes events.batch frames into that stream and posts them to the utility parent. startDesktopMain in apps/desktop/src/bootstrap/main.ts (the Task 067 main; there is no apps/desktop/src/main.ts) constructs PopOutWindowCoordinator on the same stream and opens each pop-out with its own renderer-port window id. schema/** was not edited. task/162 and task/164 were not merged.
- What It Fixed: F-063 — the shell can speak the landed preload RPC, keep uppercase governor samples, survive a daemon restart at seq 1, and accept PhaseWorkspaceController.applyPreset. F-027 — a pop-out window is another entry in the utility port map, so the primary window keeps its port.
- Verification Run & Results: pnpm install exit 0; pnpm build and pnpm typecheck (both `tsc -b --pretty false`) exit 0; NODE_OPTIONS=--max-old-space-size=4096 pnpm lint exit 0 (0 errors, 4 pre-existing unused-disable warnings in packages/planner/src/system-arch/vendor/mermaid-parse.mjs); pnpm --filter @ef-harness/desktop test exit 0, Test Files 4 passed (4), Tests 20 passed (20), 0 skipped; pnpm --filter @ef-harness/renderer test -- shell presets exit 0, Test Files 6 passed (6), Tests 41 passed (41), 0 skipped; node schema/schema-test.js exit 0, 67/67 passed, SQLite 3.53.4; EF_HARNESS_MAINTAINER=1 commit hook verify-harmony.mjs --pre-commit exit 0, harmony ok.
- Not done: C49 not started. main not merged. task/162 and task/164 not merged.
