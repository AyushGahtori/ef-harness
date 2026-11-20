---
task_id: "Task-059"
branch: "task/059-static-audit-scanners-p2"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/completeness-gate/src/gate/**"
  - "packages/completeness-gate/tests/gate/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 059 handoff

Static completeness gate part 2. `CompletenessGateRunner` runs leaf and feature audits for workers, integrators, and human fixes. Commit stays on `task/059-static-audit-scanners-p2`.

## Exports Provided

From `packages/completeness-gate/src/gate/index.ts`:

- `CompletenessGateRunner` with `runLeafStaticAudit(input: LeafAuditInput)` and `runFeatureStaticAudit(input: FeatureAuditInput)`
- `createCompletenessGateRunner(overrides?)`
- `LeafAuditInput`, `FeatureAuditInput`, `StaticAuditReport`, `StaticAuditFinding`, `StaticAuditReceipt`
- `computeStaticAuditFingerprint`
- `ChangedFile`, `WorkspaceFile`, `ProducedContract`, `SchemaFieldPlan`, `StaticDataDeclaration`, `ConflictHunk`, `RegisteredName`, `RegistrySnapshot`, `RegisteredAsset`, `HumanOverrideRequest`, `HumanOverrideRecord`, `AllowedEscape`
- Port types: `StaticAuditAstEngine`, `NameRegistryService`, `GitSafetyScanner`, `SafetyScanReport`, `SecretHit`, `ExtractedCodeName`, `NameAuditFailure`
- Local factories kept for tests and for the swap below: `createLocalStaticAuditAstEngine`, `createLocalNameRegistry`, `createLocalGitSafetyScanner`, `maskSecretValue`

`StaticAuditReport` carries `level`, `passed`, `coverageMode` (`full` or `reduced_text_only`), hard `findings`, `softFindings`, `receipt` (`lintEscapesCount`, `allowedEscapes`, `recordedDeferrals`, `fingerprint`, `humanOverride`, `secretHitCount`), `overrideApplied`, and `landingSummary`.

Leaf audit allows a `produces` function with `plannedConsumerTaskId`, and a schema field with `assignedToLaterTaskId`, to be unused. Feature audit, once `mergedTaskIds` covers `allFeatureTaskIds`, hard-fails those same symbols if nothing consumes them. A developer `humanOverride` (`signedBy: "developer"` plus a non-empty reason) is recorded only when `actor` is `human`. Workers that attach one get `check.override-forbidden` and stay failed. Secret hits store a masked preview and rule location only.

## Shared Wiring Needs (Root / Index Barrels)

`packages/completeness-gate/src/index.ts` is frozen and was not edited. On integration, re-export the public gate surface from that barrel:

- `CompletenessGateRunner`
- `createCompletenessGateRunner`
- `LeafAuditInput`
- `FeatureAuditInput`
- `StaticAuditReport`
- `StaticAuditFinding`
- `computeStaticAuditFingerprint`

No root `package.json`, workspace, tsconfig, or eslint change.

## Dependency Intents (New Packages Requested)

None. `package.json` was not modified.

Check 9 uses the in-repo export reachability graph (the spec allows this instead of `knip`) because adding `knip` would edit the frozen package manifest. No new dependency is requested. TypeScript is already a devDependency of this package and is not imported by the gate.

## Contract Change Requests

None.

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-059-static-audit-scanners-p2`.

- `pnpm --filter @ef-harness/completeness-gate typecheck` — exit 0
- `pnpm --filter @ef-harness/completeness-gate lint` — exit 0
- `pnpm --filter @ef-harness/completeness-gate test -- gate` — exit 0, 3 files, 25 tests passed
- `node scripts/verify-harmony.mjs --task 059` — exit 0, `harmony ok for Task-059`

## Known Limitations / Follow-Ups

Sibling packages are not on this branch. Local ports stand in for them. At integration, inject the real implementations and delete the stand-ins from the default factory:

1. Task 058 `StaticAuditAstEngine` (`packages/completeness-gate/src/ast-scanners/**`, not published here) is swapped to `createLocalStaticAuditAstEngine` in `src/gate/local-ast-engine.ts`. Pass the real engine as `createCompletenessGateRunner({ astEngine })`. The local engine still runs marker, stub, swallowed-error, dead-control, elision, deletion-ratio, and soft special-case scans so the unified gate blocks stubs before that swap.
2. Task 019 `NameRegistryService.auditCodeNamesAgainstRegistry` (`packages/db/src/registry/**`) is swapped to `createLocalNameRegistry(input.registry)` unless `nameRegistry` is injected. The snapshot is kernel-supplied on `LeafAuditInput.registry`. It flags unregistered and foreign-owned names and allows `project_integrator` / `shared` owners. Route shadowing and prefix allocation stay in Task 019.
3. Task 036 `GitSafetyScanner.scanCommitDiffForSecrets` (`packages/git-engine/src/safety-scan/**`) is swapped to `createLocalGitSafetyScanner()` unless `safetyScanner` is injected. Vault values are passed from `LeafAuditInput.vaultSecrets`.

`ast-grep` is not bundled. Python, Go, Rust, and any other non-JS/TS extension set `coverageMode: "reduced_text_only"` while text, name, asset, and secret scans still run. Generated paths and seed/fixture globs are honored only from the kernel input, never from the worker diff. Static-data exemptions match only the plan `staticData` globs. Status and constant maps under 20 entries are allowed; structured record arrays over 5, and primitive collections of 20 or more, are not, unless that glob is declared.
