---
task_id: "Task-061"
branch: "task/061-red-before-green-blind-binder"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/verifier/src/binder/**"
  - "packages/verifier/tests/binder/**"
  - ".agent-handoffs/task-061.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 061 handoff

Red-before-green gate, contract stub generator, and post-hoc `blind-binder@1` isolation. Commit stays on `task/061-red-before-green-blind-binder`.

## Exports Provided

From `packages/verifier/src/binder/index.ts`:

- `EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED`
- `ContractStubGenerator` (`generate`, `materializeMissing`)
- `RedBeforeGreenGate` (`evaluate`, `lock`, `provePostHoc`)
- `BlindBinderOrchestrator` (`bind`)
- `BinderModeRouter` (`route` → `contract_bound` | `post_hoc`)
- `BindingDefectError` (always `attribution: "binding_defect"`, `routedTo: "task_author"`, `workerPenalized: false`, `workerAttemptsCharged: 0`, `calibrationImpact: "none"`)
- `FakeModelAdapter` and `BinderModelAdapter`
- `parseBlindBinderV1` (local port of `BlindBinderV1Schema`)
- `InProcessCleanVerifierPort` and `compileCleanTree` (local port of clean-checkout execution)
- `assembleBlindBinderPrompt`, `sanitizeBinderInput`, `auditBinderAdapter`
- `BinderAdapterCache`, `entrySignatureHash`, `checkEntrySignatureHash`
- `kernelRun`, `adapterKernelRun`

Contract-bound is the default for a route, accessible UI button, OpenAPI endpoint, CLI command, or exported function whose signature matches the declared export. Post-hoc `blind-binder@1` runs only when the check adapts internal state setup/seeding or internal call wiring (`adaptsInternalState`, `adaptsInternalCall`, or an internal entry kind).

`ContractStubGenerator` emits a type-valid module for a missing declared entry. Sync stubs throw `EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED`. Async stubs `return Promise.reject(...)`. `behavior: "empty"` returns a typed empty value. Route and job stubs are labeled in the module comment.

`RedBeforeGreenGate` locks a new check only for an `AssertionError` / observation mismatch or the stub marker on the unmodified base plus stubs. A pass on that base is `false_green`. Syntax errors, `MODULE_NOT_FOUND` / cannot-find-module, TypeScript errors, and binder crashes are non-behavioral and are not red. `isPreservationRegression: true` requires green-on-base instead.

`BlindBinderOrchestrator` builds a prompt whose instruction is the only directing block. Check input, contract, and candidate source are `<data trust="untrusted">`. Keys `expect`, `expected`, `expectedOutput`, `rubric`, and `oracle` are stripped at every depth before serialization. After a verified adapter, retries with the same `(checkId, checkVersion, entrySignatureHash)` do not call the model. The same adapter is then run on the candidate file map and compared to the hidden expected value inside the gate.

## Shared Wiring Needs (Root / Index Barrels)

`packages/verifier/src/index.ts` is frozen. Re-export the binder from the package barrel:

```ts
export {
  BindingDefectError,
  BlindBinderOrchestrator,
  ContractStubGenerator,
  EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED,
  FakeModelAdapter,
  InProcessCleanVerifierPort,
  RedBeforeGreenGate,
  parseBlindBinderV1,
} from "./binder/index.js";
```

No root `package.json` or workspace change.

## Dependency Intents (New Packages Requested)

None. The binder typechecks and executes adapters with `typescript`, which is already a catalog devDependency of `@ef-harness/verifier`. It is imported from `packages/verifier/src/binder/**` at runtime. The integrator can move `typescript` from devDependencies to dependencies of `@ef-harness/verifier` when wiring; do not add a new package.

Task 009 and Task 060 are not on this base. Do not import them as if they were published.

- **Task 009 swap:** `parseBlindBinderV1` stands in for `BlindBinderV1Schema` / `BlindBinderV1` from `@ef-harness/shared-contracts`. It accepts either `{ blocked: true, reason, missing_ids? }` or `{ entry_used, observations_schema: { fields: [{ name, type }] } }`, rejects extra keys, and rejects expected/expectation/oracle/assertion names. When Task 009 is integrated, validate model output with `BlindBinderV1Schema` and delete the local parser if the published schema covers the same rules.
- **Task 060 swap:** `InProcessCleanVerifierPort` stands in for `CleanVerifierRunner` clean-checkout execution. `RedBeforeGreenGate` depends only on `CleanVerifierPort.invoke`. When Task 060 is integrated, implement that port with `CleanVerifierRunner` so base and candidate runs use the verifier worktree instead of the in-memory compiler.
- **Task 053 swap:** `BinderModelAdapter.complete(prompt)` is the model seam. `FakeModelAdapter` scripts valid, malicious, and defective turns for tests. Point `BlindBinderOrchestrator`'s constructor at the worker-loop model adapter when that package is wired. Keep the fake in tests.

## Contract Change Requests

None. No schema or root contract edits.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-061-red-before-green-blind-binder`:

- `pnpm --filter @ef-harness/verifier typecheck` — exit 0
- `pnpm --filter @ef-harness/verifier lint` — exit 0
- `pnpm --filter @ef-harness/verifier test -- binder` — exit 0, 5 files, 24 tests passed
- `node scripts/verify-harmony.mjs --task 061` — exit 0, `harmony ok for Task-061`

Covered by those tests: sync/async/route/job stubs; behavioral red and stub marker locked; false green (already-passing base, `true !== true`, forgotten await) rejected with `BindingDefectError`; syntax, missing module, and TypeScript errors rejected; preservation flag requires green-on-base; blindness strips nested expected/rubric fields; untrusted candidate wrapper; AST rejects expectation imports, undeclared `internalHelper`, constant adapters that skip the entry, and observation-key drift; product writes outside `.harness-binder/**` hard-fail; `{ blocked: true }` and helper/import defects route to the task author with zero worker charges; candidate mismatches are `attribution: "implementation"`; adapter cache skips a second model call until the declared signature changes.

## Known Limitations / Follow-Ups

- Clean execution is an in-memory TypeScript program plus a CommonJS loader. It is not a separate git worktree, and it does not call `CleanVerifierRunner.verifyCandidate`. Swap at `CleanVerifierPort`.
- `parseBlindBinderV1` is not the Zod schema from Task 009. Swap at the orchestrator's model-output parse.
- `FakeModelAdapter` does not speak the Task 053 model protocol. Swap at `BinderModelAdapter`.
- Exported `observe` must be a block-bodied function. An expression-bodied arrow is treated as a missing adapter.
- This package does not decrement worker attempt counters or calibration scores. Binding defects report `workerAttemptsCharged: 0` and `routedTo: "task_author"`. An implementation mismatch sets `attribution: "implementation"` and still charges nothing here; Task 065 owns ladder accounting.
- Free identifier calls must be the declared entry, a Phase 0 / base helper, a local binding, or a language global. Property calls are not fully resolved to a product symbol beyond the property name.
- The package barrel re-export above is not applied in this commit.
