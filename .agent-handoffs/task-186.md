---
task_id: "Task-186"
branch: "task/186-orphan-branch-portability"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/portability/src/exporter/**"
  - "packages/portability/tests/exporter/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 186 handoff

Incremental orphan-branch `harness-state` exporter: sorted per-entity YAML, append-only JSONL history, age-sealed checks, zero-checkout Git object writes, public-remote push guard, and pre-export secret gate.

## Exports Provided

Import from `packages/portability/src/exporter/index.ts` until the package barrel is wired.

- `OrphanBranchPortabilityExporter` — debounced export (`EXPORT_QUIET_DEBOUNCE_MS = 10_000`) to `refs/heads/harness-state` with canonical graph no-op detection
- `SortedPerEntityYamlSerializer` — sorted-keys LF YAML for manifest, lease, and per-entity files
- `AgeSealedChecksEncryptor` / `generateAgeRecipientKeys` — `age-encryption` armored `checks-sealed/<feature_id>.age`
- `GitFastImportWriter` — initial orphan commits via `git fast-import`; warm incremental updates via cached blob map + `git mktree` / `commit-tree` (Git 2.54 Windows: separate fast-import streams do not accept `from`)
- `PublicRemotePushGuard` — public remotes off-by-default; private remotes ask once
- `ExportSecretGate` / `PacketSecurityRedactor` — abort with `SecretDetectedInPortabilityExportError`
- `InMemoryKnowledgeGraphRepo` — deterministic tests/fixtures port until Task 017 wiring

Structural ports (integrate Tasks 007, 011, 017, 035, 091, 177):

- `KnowledgeGraphRepoPort`, `HiddenCheckPoolPort`, `CanonicalHashPort`, `PacketSecurityRedactorPort`, `MinGitRepoInspectorPort`, `GitHubAuthConnectorPort`

## Shared Wiring Needs (Root / Index Barrels)

`packages/portability/src/index.ts` is outside this task's owned write scope. Integrator should re-export:

```ts
export * from "./exporter/index.js";
```

## Dependency Intents (New Packages Requested)

- Workspace import of root-hoisted `age-encryption` via `createRequire` from repo `package.json` (no portability `package.json` change on frozen foundation)

## Contract Change Requests

None.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-186-orphan-branch-portability`.

- `pnpm --filter @ef-harness/portability test -- exporter` — pass (Vitest v5.1.1: 1 file, 10 tests passed; real Git repos, real age encrypt, 300-entity warm delta bounded ops)
- `pnpm --filter @ef-harness/portability typecheck` — pass (`tsc -b --pretty false`)
- `pnpm --filter @ef-harness/portability lint` — pass (`eslint .`)
- `node scripts/verify-harmony.mjs --task 186` — pass (`harmony ok for Task-186`, exit 0)

## Known Limitations / Follow-Ups

- Windows Git 2.54 rejects `from` on a second `git fast-import` process; incremental updates use cached blob SHAs + `mktree`/`commit-tree` into the object DB without working-tree checkout (same zero-checkout invariant).
- Sub-150ms incremental timing is validated algorithmically (dirty op count and writer `durationMs` on small graphs); full 300-entity mktree on Windows remains syscall-heavy — Task 198 can benchmark on integration hosts.
- Task 017/091/177 production adapters should replace in-package ports; `InMemoryKnowledgeGraphRepo` is test-only.