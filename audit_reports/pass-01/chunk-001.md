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
