---
task_id: "Task-093"
branch: "task/093-phase0-controller-gate0"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/phase0/**"
  - "packages/planner/tests/phase0/**"
  - ".agent-handoffs/task-093.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 093 handoff

Phase 0 execution controller and Foundation Gate 0 verifier. Commit stays on `task/093-phase0-controller-gate0`.

## Exports Provided

Import from `packages/planner/src/phase0/index.ts` (package barrel is frozen):

- `Phase0ExecutionController` — Stage 0A is only `P0.1`. Stage 0B starts after that commit and runs `P0.2`–`P0.8` (or brownfield `P0.B1`/`P0.B2`) in disjoint worktrees with a serialized fast-forward/merge lane. `resume(projectId)` discards in-progress worktrees and continues from `harness/integration` HEAD. Completed tasks are not executed again. `isWave1Unlocked(projectId)` is true only when a PASS receipt matches the current integration HEAD.
- `FoundationGate0Verifier` — clean typecheck, lint, build, at least one real smoke (unit, template-clone when `P0.2` is active, headless styleguide smoke when the UI is active), test-env health on a leased port in `41000–48999`, zero leaked child processes, migration up/down/fresh-apply when `P0.2` is active, `/__styleguide` plus token lint when `P0.4` is active, `git status --porcelain` empty, gitleaks clean, canonical lockfile. Brownfield records pre-existing failures as quarantine and fails if any other baseline test goes red.
- `Gate0ReceiptSchema`, `buildGate0Receipt`, `wave1MayStart` — `gate0_receipt@1`. A FAIL receipt cannot set `wave1Unlocked`. Commands carry `durationMs` and `exitCode`. The styleguide thumbnail is the `1440` CAS object; the manifest also stores the `375` id.
- `createPhase0Stack` — composes the local ports below for tests and for a cold open against a real git repo plus `state.db`.

Supporting types: `Phase0RunRequest`, `Phase0RunResult`, `Phase0Plan`, `Phase0Recipe`, `FoundationManifest`, `Gate0Receipt`, `ActionCard`, `Escalation`.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/planner/src/index.ts` on this branch. When integrating, re-export the symbols above from that barrel:

```ts
export {
  FoundationGate0Verifier,
  Gate0ReceiptSchema,
  Phase0ExecutionController,
  buildGate0Receipt,
  wave1MayStart,
} from "./phase0/index.js";
```

`Task 094` (P0.4), `Task 095` (Wave 1 unlock), and `Task 105` (M2 kitchen exit) should import `Phase0ExecutionController`, `FoundationGate0Verifier`, and `Gate0ReceiptSchema`.

Gate 0 receipts are stored in `phase0_gate0_receipts` and `phase0_artifacts` (`kind = gate0_receipt`) for the Build Cockpit (`Task 124` / `Task 126`). The thumbnail bytes are in the `ContentAddressedStore` port (`Task 028`).

## Dependency Intents (New Packages Requested)

None. The implementation uses Node built-ins only (`node:sqlite`, `node:child_process`, `node:fs`, `node:crypto`, `node:net`). No `package.json` change.

## Contract Change Requests

`schema/state.sql` is frozen. `Phase0StateStore.open` creates these tables in the project `state.db` if they are missing. Please fold them into `schema/state.sql` on integration:

- `phase0_runs`
- `phase0_execution_tasks` (per-task `queued|running|done|failed|blocked`, attempt, worktree, unmerged sha)
- `phase0_foundation_manifests` (`gate0_commit_sha`, `installed_dependencies_hash`, `template_db_hash`, `exposed_exports_json`, `screenshot_cas_json`)
- `phase0_gate0_receipts`
- `phase0_quarantine`
- `phase0_action_cards`
- `phase0_artifacts`
- `phase0_install_receipts`

No root `package.json`, lockfile, tsconfig, eslint, or package-barrel edits.

## Sibling ports (not merged into this base)

| Consumed contract | Local stand-in | Swap when the sibling lands |
| --- | --- | --- |
| `Phase0RecipeGenerator` (`Task 090`) | `LocalPhase0RecipeGenerator` | Same `generate({ projectKind, database?, auth? })` shape: web SaaS is `P0.1` then `P0.2`–`P0.8`; headless CLI omits `P0.3`/`P0.4`/`P0.8`; API omits `P0.4`/`P0.8`; brownfield is only `P0.B1`/`P0.B2`. |
| `DeterministicGraphCompiler` (`Task 092`) | `LocalDeterministicGraphCompiler` | Phase 0 only: hoist parallel `package.json` / `pnpm-lock.yaml` writes and their dependency intents onto `P0.1`, then reject overlapping Stage 0B scopes. |
| `WorktreeSlotPool` (`Task 038`, exported there as `WorktreeSlotManager`) | `GitIntegrationRepo` | Real `git worktree` slots outside the integration directory, serialized `--ff-only` then `--no-ff` merges onto `harness/integration`. A failed merge aborts and leaves HEAD unchanged. |
| `KernelPackageInstaller` (`Task 048` in this task text; `Task 046` also exports that name) | `LocalKernelPackageInstaller` | Refuses offline registry and unapproved names. Writes a canonical lockfile. Never spawns `npm`, `pnpm`, `yarn`, or a postinstall script. |
| `TestEnvOrchestrator` (`Task 050`) | `LocalTestEnvOrchestrator` | Real loopback HTTP child on a port in `41000–48999`. |
| `TemplateDbSeeder` (`Task 052`) | `LocalTemplateDbSeeder` | SQLite template clone; up, down, fresh apply; template bytes stay unchanged. |
| gitleaks (`Task 036`) | `LocalGitleaksScanner` | Flags committed `.env` (not `.env.example`) and live-shaped assignments. |
| Job Object audit (`Task 041`) | `LocalJobObjectAudit` | `process.kill(pid, 0)` orphan check. |
| Baseline test health (`Task 170`) | `LocalBaselineTestHealthRunner` | Known failures are the quarantine list. `src/legacy.mjs` must still exit 0. |
| Action Card (`Task 127`) | `phase0_action_cards` | Installer errors set `blocksStage0B`. |
| Human-Step Probe (`Task 121`) and Component Downloader (`Task 132`) | ports on the controller | A second Gate 0 failure whose kind is `missing_environment_tool` escalates and does not start another coding repair. |
| CAS (`Task 028`) | `MemoryContentStore` | Styleguide viewports `375` and `1440`. |

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-093-phase0-controller-gate0`:

- `pnpm --filter @ef-harness/planner typecheck` — exit 0.
- `pnpm --filter @ef-harness/planner lint` — exit 0.
- `pnpm --filter @ef-harness/planner test -- phase0` — exit 0. Vitest v5.1.1: 3 files, 20 tests passed (scheduling, atomic merge abort, Gate 0 pass/fail, repair bound, Playwright-browser escalation, leaked process, brownfield quarantine, crash resume).
- `node scripts/verify-harmony.mjs --task 093` — exit 0. `harmony ok for Task-093` (schema 67/67, diagrams, scope, repo typecheck, lint, and tests).

## Known Limitations / Follow-Ups

- Gate 0 typecheck, lint, and build execute the Phase 0 scaffold commands (`node --check` on the entry, `scripts/phase0/lint.mjs`, `scripts/phase0/build.mjs`). They are real processes with real exit codes. They are not the target app's eventual package scripts; those scripts do not exist until `P0.1` has been applied to a product repo.
- The headless "Playwright" smoke is `node tests/e2e/playwright-smoke.mjs`, which reads `/__styleguide` and rejects `page-error` / `console-error`. It does not launch the Playwright browser or axe-core. `playwrightBrowserAvailable: false` still fails Gate 0 as `missing_environment_tool` and escalates to the human-step probe and the component downloader. Swap in real Playwright when `Task 132` / `P0.6` is wired.
- The local kernel installer does not call `pnpm`. It is the stand-in that keeps workers off raw installs. The integration branch should call the real `KernelPackageInstaller`.
- `LocalDeterministicGraphCompiler` covers Phase 0 hoist and disjoint write scopes only, not the nine-pass compiler from `Task 092`.
- Foundation manifest rows live in the runtime tables above until `schema/state.sql` accepts them.
- Wave 1 stays locked if integration HEAD moves after a PASS receipt. Callers must pass the current HEAD to `wave1MayStart`.
