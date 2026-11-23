---
task_id: "Task-197"
branch: "task/197-docs-diagram-consistency"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "scripts/verify-docs-diagrams.mjs"
  - "tests/e2e/docs-parity/**"
  - ".agent-handoffs/task-197.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 197 handoff

Documentation, diagram, schema, and contract parity verification gate for M6. Commit stays on `task/197-docs-diagram-consistency`.

## Exports Provided

CLI: `node scripts/verify-docs-diagrams.mjs` (optional `--root <dir>`, `--check <diagram|links|schema|contract|benchmark|policy>`).

Module exports from `scripts/verify-docs-diagrams.mjs`:

- `verifyDiagramSync`, `verifyMarkdownLinks`, `verifySchemaParity`, `verifyContractParity`, `verifyBenchmarkManifest`, `verifyOwnerDecisionPolicy`
- `runAllChecks`, `CHECKS`, `formatIssues`, `defaultRoot`, `main`

E2E suite: `tests/e2e/docs-parity/DocsAndSchemaParitySuite.mjs` — class `DocsAndSchemaParitySuite` with `runAll()`, `runCheck(name)`, `runCli()`, plus re-exports of `CHECKS` / `runAllChecks` / `formatIssues`.

Proposed root script for Task 200 (not applied here; `package.json` is frozen):

```json
"verify:parity": "node scripts/verify-docs-diagrams.mjs"
```

## Shared Wiring Needs (Root / Index Barrels)

`tests/e2e/vitest.config.ts` is outside this task's owned write scope. Extend Vitest discovery so CI can run the suite with the task-spec filter:

```ts
include: ["tests/**/*.test.ts", "docs-parity/**/*.test.mjs", "docs-parity/**/*.test.ts"],
```

Until that lands, run:

`pnpm --filter @ef-harness/e2e exec vitest run --config docs-parity/parity.vitest.ts`

`pnpm --filter @ef-harness/e2e test -- docs-parity` exits non-zero today because the default e2e config only includes `tests/**/*.test.ts`.

When `packages/contracts` (Task 009), `packages/contracts/src/vocab` (Task 010), `packages/kernel/src/migrations` (Tasks 013–015), and `corpus/skills/m2/infer-or-ask/SKILL.md` (Task 078) merge, `verifyContractParity` and migration DDL alignment automatically enforce runtime 1:1 parity; on foundation `6497730` they validate doc-side invariants and run `schema-test.js` only.

Sibling branches are not on this base. No cross-worktree ports.

## Dependency Intents (New Packages Requested)

None. Offline checks use Node built-ins plus existing `schema/schema-test.js` and `tools/merge-diagrams.js`.

## Contract Change Requests

Request `tests/e2e/vitest.config.ts` include glob extension (above) during integration so `pnpm --filter @ef-harness/e2e test -- docs-parity` matches Task 197 acceptance without a separate config path.

Request root `package.json` script `verify:parity` pointing at `node scripts/verify-docs-diagrams.mjs` for Task 200 release certification.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-197-docs-diagram-consistency`:

- `node scripts/verify-docs-diagrams.mjs` — pass (`docs-diagram-schema parity ok (~3s)`, exit 0).
- `pnpm --filter @ef-harness/e2e exec vitest run --config docs-parity/parity.vitest.ts` — pass (Vitest v5.1.1, 6 tests, exit 0, ~11s wall; in-process positive gate < 5s).
- `pnpm --filter @ef-harness/e2e test -- docs-parity` — **expected fail until vitest include wiring** (`No test files found`, exit 1).
- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 197` — pass (pending commit with handoff `ready_for_integration`).

Negative fixtures (broken link, bad benchmark pin, missing prompt contracts, forbidden provider id in `packages/`) fail in < 5s via `DocsAndSchemaParitySuite.runCheck`.

## Known Limitations / Follow-Ups

- Kernel migration DDL cross-check is skipped when `packages/kernel/src/migrations/` is absent; `schema/schema-test.js` still must report `67/67 passed`.
- Mermaid validation is structural (frontmatter strip, diagram type, non-empty SVG sibling); it does not shell out to `@mermaid-js/mermaid-cli` to keep the < 5s offline budget.
- `corpus/skills/m2/infer-or-ask/SKILL.md` byte parity runs only when that path exists after Task 078 merges.