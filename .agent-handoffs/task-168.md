---
task_id: "Task-168"
branch: "task/168-brownfield-l2-summaries"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/brownfield/src/l2-cards/**"
  - "packages/brownfield/tests/l2-cards/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 168 handoff

Brownfield L2 targeted module cards: request-driven focus (≤20 files), pre-spend transparency, legacy secret masking before cloud egress, SHA-256 module-card cache with symbol parity repair, and deterministic stale-docs detection. Branch `task/168-brownfield-l2-summaries` is based on `649773097c387ae534b686ea5825f449f843aa7c`. Commit-only; never merge locally.

## Exports Provided

Wire from `packages/brownfield/src/l2-cards/index.ts` when the integrator lands the branch:

- `RequestDrivenFocusSelector` — PageRank + churn + symbol FTS + lexical request terms; never whole-repo summarization (`maxFiles` default 20).
- `L2PreSpendEstimator` — exact uncached input tokens, micro-USD estimate, plan-window percent, and confirmation reasons (`token_threshold`, `cost_threshold`, `first_repo_cloud_egress`).
- `CodeEgressSecretMasker` / `PacketSecurityRedactor` — local port of Task 011 for legacy hardcoded secrets; emits security notices and `[REDACTED_LEGACY_SECRET]` placeholders.
- `ModuleCardCacheEngine` — `(file_path, file_content_sha256, module-card-writer@1)` cache, per-file invalidation on edit, symbol parity repair against `code-index.db.symbols`.
- `StaleDocsDetector` — zero-LLM path/script/route drift checks plus doc/code churn skew (180d / 20 edits); live code outranks stale docs.
- `L2BrownfieldSummarizer` — bounded concurrency (≤4), pre-spend gate, declined-cloud / `l0_l1_only` skip, observed `brownfield_module` projection via port.
- Test doubles: `FakeModelAdapter`, `InMemoryModuleCardStore`, `InMemoryCodeMap`, `InMemoryObservedModuleGraph`, `InMemoryRepoCloudEgressLedger`.

`packages/brownfield/src/index.ts` is frozen outside this task; re-export the barrel above from the package root when integrating.

## Shared Wiring Needs (Root / Index Barrels)

```ts
export {
  CodeEgressSecretMasker,
  L2BrownfieldSummarizer,
  L2PreSpendEstimator,
  ModuleCardCacheEngine,
  PacketSecurityRedactor,
  RequestDrivenFocusSelector,
  StaleDocsDetector,
} from "./l2-cards/index.js";
export type {
  FocusSelectionResult,
  ModuleCardWriterV1Output,
  PreSpendSummaryText,
  StaleDocFinding,
} from "./l2-cards/index.js";
```

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 009 `ModuleCardWriterV1Schema` | `ModuleCardWriterV1Output` type in `types.ts` | Import the canonical Zod schema and validate model JSON before cache write. |
| Task 011 `PacketSecurityRedactor` | `PacketSecurityRedactor` in `packet-security-redactor.ts` | Replace with the shared redactor; keep the security notice card shape. |
| Task 014 `CodeIndexDbSchema.module_cards` | `InMemoryModuleCardStore` | Persist cards in `code-index.db` with the foundation DDL once `module_cards` lands in `schema/code-index.sql`. |
| Task 166 `BrownfieldL0RepoScanner` | `L0GroundTruthPort` | Feed existing paths, npm scripts, doc/code mtimes, and churn maps from L0 scan output. |
| Task 167 `CompactCodeMapQueryService` | `CodeMapQueryPort` / `InMemoryCodeMap` | Wire real PageRank, symbol FTS, and per-file hashes from L1. |
| Task 017 `state.db` nodes | `ObservedModuleGraphPort` | Project `node(type = brownfield_module, basis = observed)` on cache refresh. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-168-brownfield-l2-summaries`.

- `pnpm --filter @ef-harness/brownfield test -- l2-cards` — pass (1 file, 6 tests).
- `pnpm --filter @ef-harness/brownfield typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/brownfield lint` — pass (`eslint .`).
- `node scripts/verify-harmony.mjs --task 168` — pass (`harmony ok for Task-168`).

## Known Limitations / Follow-Ups

- `code-index.db` `module_cards` table is not on the foundation snapshot yet; the in-memory store models the Task 014 contract locally until integration.
- Cloud model calls use `ModelAdapterPort`; production should route through Task 140 pacing and real `module-card-writer@1` prompting.
- Stale-docs route matching is heuristic (symbol name / path substring) until L1 exports HTTP route symbols explicitly.