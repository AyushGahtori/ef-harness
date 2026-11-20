---
task_id: "Task-058"
branch: "task/058-static-audit-scanners-p1"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/completeness-gate/src/ast-scanners/**
  - packages/completeness-gate/tests/ast-scanners/**
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 058 handoff

Deterministic `STATIC_AUDIT` part 1 scanners for unfinished markers, stub bodies, swallowed errors, dead UI controls, elision placeholders, and unplanned large deletions. Zero model tokens. Exemptions come only from the kernel audit context.

## Exports Provided

Import from `packages/completeness-gate/src/ast-scanners/index.ts` until the package barrel is wired.

- `StaticAuditAstEngine` — `audit(input: StaticAuditInput): Promise<StaticAuditReport>`. Diff scope is `git diff --name-status <base> <candidate>` when `repoRoot`, `baseRef`, and `candidateRef` are set. `files` is the in-memory seam.
- `runStaticAudit(input, options?)` — same entry as a function.
- `StaticAuditFinding` — type with `ruleId`, `severity: "hard" | "soft"`, `file`, `line`, `column`, `snippet`, `message`, `remediation`.
- `computeStaticAuditFingerprint(findings)` — SHA-256 hex of the hard-finding multiset. Projection is `ruleId`, POSIX path, and whitespace-normalized snippet. Line and column are omitted so a blank-line shift does not mint a new fingerprint. Duplicate snippets stay in the multiset. Soft findings are ignored.
- `StaticAuditReport` — local stand-in for `StaticAuditReportSchema`: `schema: "static-audit-report@1"`, `coverageMode: "full_ast" | "reduced_text_only"`, `findings`, `hardFindings`, `softFindings`, `recordedDeferralIds`, `fingerprint`, `filesScanned`, `ignoredPaths`, `fileCoverage`.
- `StaticAuditContext.approvedDeferralIds` — membership means the id exists, is active, and is kernel-approved. An exact `TODO(DEF-12)` reference is recorded on the report. Any other unfinished marker hard-fails, including `TODO(DEF-999)`.
- `GitRunnerPort` and `createProcessGitRunner` — local read-only port (`diff`, `show`, `rev-parse`, `status`, `log`, `ls-tree`, `cat-file`) returning `{ exitCode, stdout, stderr, durationMs }`.
- `STATIC_AUDIT_AST_GREP_RULES`, `AstGrepRunner`, `createProcessAstGrepRunner` — Python, Go, and Rust patterns used only when `auditContext.astGrepLanguages` lists that language.
- Rule ids: `unfinished-marker`, `stub-body`, `swallowed-error`, `dead-ui-control`, `elision-placeholder`, `unplanned-large-deletion`, `diff-smaller-than-estimate` (soft), `complexity-below-must` (soft), `visible-example-special-case` (soft).

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/completeness-gate/src/index.ts` in this task. Integrator should append:

```ts
export {
  StaticAuditAstEngine,
  runStaticAudit,
  computeStaticAuditFingerprint,
  createProcessGitRunner,
  createProcessAstGrepRunner,
  STATIC_AUDIT_AST_GREP_RULES,
} from "./ast-scanners/index.js";
export type {
  AstGrepRule,
  AstGrepRunner,
  GitRunnerPort,
  ProducedSymbol,
  StaticAuditContext,
  StaticAuditEngineOptions,
  StaticAuditFinding,
  StaticAuditInput,
  StaticAuditReport,
} from "./ast-scanners/index.js";
```

No root `package.json` export change. Consumers inside this package import the subpath above. Task 059 should call `StaticAuditAstEngine.audit` from `packages/completeness-gate/src/gate/**` after the barrel export lands.

Sibling swap, not imported on this base:

- Replace `GitRunnerPort` / `createProcessGitRunner` with Task 035 `GitRunner.execGit` from `@ef-harness/git-engine` once that package exports it. `completeness-gate` (layer 2) may import `git-engine` (layer 1). The current git-engine barrel only exposes package identity, so this branch keeps a local port and never treats the stub as a wired runner.
- Pass the returned `StaticAuditReport` through Task 008 `StaticAuditReportSchema` once `packages/shared-contracts/src/packets` exports it. This branch does not import that unpublished module.

## Dependency Intents (New Packages Requested)

- Move `typescript` from devDependencies to dependencies on `@ef-harness/completeness-gate` (`catalog:`). The engine imports the TypeScript compiler API at runtime. `package.json` is frozen here, and typecheck already resolves the devDependency.
- Optional external binary `ast-grep` or `sg`. Do not add an npm dependency. When the binary is missing, Python/Go/Rust stay on the text fallback and the report sets `coverageMode: "reduced_text_only"`.

## Contract Change Requests

None to frozen `schema/`. When Task 008 lands `StaticAuditReportSchema`, include the fields listed under Exports Provided, especially `coverageMode`, separate hard and soft finding arrays, `recordedDeferralIds`, and `fingerprint`. Finding objects need `ruleId`, `severity`, `file`, `line`, `column`, `snippet`, `message`, and `remediation`.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-058-static-audit-scanners-p1`.

### `pnpm --filter @ef-harness/completeness-gate typecheck`

Exit 0.

### `pnpm --filter @ef-harness/completeness-gate lint`

Exit 0.

### `pnpm --filter @ef-harness/completeness-gate test -- ast-scanners`

Exit 0. Vitest v5.1.1: 2 files passed, 21 tests passed (markers, deferrals, stubs, swallowed errors, dead controls, elision, 80% deletion, generated/seed exclusions, visible-example soft finding, reduced coverage, fingerprint, git diff scope).

### `node scripts/verify-harmony.mjs --task 058`

Exit 0. `harmony ok for Task-058`.

## Known Limitations / Follow-Ups

- Task 059 owns the unified runner. This part does not implement hard-coded data, test tampering, type escapes, knip, name registry, assets, leaf-versus-feature audits, or human-fix overrides.
- A JSX spread attribute suppresses the missing form or button handler finding, because the handler may live in the spread. An explicit empty `onClick` / `onChange` / `onSubmit` still hard-fails.
- HTML form and button structure uses a tag scan. TypeScript and TSX use the compiler AST. `coverageMode` is `reduced_text_only` when any scanned file lacks a grammar, including HTML and unknown extensions. Per-file `fileCoverage` still marks TypeScript as `full_ast`.
- Trivial returns are exactly `null`, `[]`, `{}`, `true`, `0`, and `""`, plus an empty block and `throw new Error` of an unimplemented message. A declared `allowsConstantReturn` or `allowsEmptyReturn` exempts only that case.
- Deletion ratio hard-fails only when deleted lines are strictly greater than half the previous file (`deletions * 2 > originalLines`) and `brief.declaresDeletion` is false. Plan `excludedGeneratedPaths` and `seedFixturePaths` skip every check. Test paths skip unfinished markers and swallowed errors only. Cleanup helper names come from conventions.
- X-11 (`conventionRuleIds` contains `X-11`, or `requireStructuredErrors: true`) hard-fails a catch whose only calls are `console.log` / `console.error`. Empty catches and `.catch(() => {})` / `.catch(() => null)` hard-fail without X-11.
- Soft diff signal: estimate at least 40 lines and additions under 25% of that estimate. Soft complexity signal: at least 3 MUST entries and max cyclomatic complexity times 2 is still below that count.
- `createProcessAstGrepRunner` is not invoked unless `astGrepLanguages` is set. Text patterns still run for those languages.
