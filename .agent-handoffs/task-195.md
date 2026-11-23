---
task_id: "Task-195"
branch: "task/195-e2e-cross-milestone-suite"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "tests/e2e/full-lifecycle/**"
  - "tests/e2e/tests/full-lifecycle.test.ts"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 195 handoff

End-to-end cross-milestone integration suite for greenfield, multi-project broker, and CLI/API journeys. Stays on `task/195-e2e-cross-milestone-suite`; never merge.

## Exports Provided

- `FullLifecycleMultiProjectE2eSuite` from `tests/e2e/full-lifecycle/index.ts`. `run()` executes the three journey files, rejects skip/todo markers, and returns a `CrossMilestoneIntegrationReport`.
- `CrossMilestoneIntegrationReport` at version `cross-milestone-integration/1`, plus `writeReport` and `reportToMarkdown`. Passing `run({ reportDir })` writes `cross-milestone-integration.json` and `cross-milestone-integration.md`.
- Local-port stand-ins: `GlobalMultiProjectBroker`, `CrossProjectGrantLeaseManager`, `MachineWideSlotCoordinator`, and `MachinePortLeasePool` (41000–48999 assignment without `EADDRINUSE`).

Task 200 should import these from `tests/e2e/full-lifecycle/index.ts`.

## Shared Wiring Needs (Root / Index Barrels)

- Frozen `tests/e2e/vitest.config.ts` includes only `tests/**/*.test.ts`. The owned suite lives in `tests/e2e/full-lifecycle/**`. `tests/e2e/tests/full-lifecycle.test.ts` is a side-effect loader so `pnpm --filter @ef-harness/e2e test -- full-lifecycle` runs all journey tests without editing the frozen config.
- At integration, add `full-lifecycle/**/*.test.ts` to the vitest include and delete the loader. Do not edit `tests/e2e/src/index.ts` on this branch.

## Dependency Intents (New Packages Requested)

None. Sibling tasks 001–194 and 196–200 are not on base `649773097c387ae534b686ea5825f449f843aa7c`. Journeys use local engines under `tests/e2e/full-lifecycle/lib`, real `git`, `node:sqlite`, and loopback HTTP.

When packages land on `harness/integration`, wire the journeys to their exports:

| local-port | Target export (from spec / Task 200 matrix) |
| --- | --- |
| local-port:task-031–033 | Named pipe IPC, event resync, binary stream manager |
| local-port:task-188 | `GlobalMultiProjectBroker`, grant leases, machine-wide slots |
| local-port:task-105 | Kitchen hidden acceptance (greenfield slice) |
| local-port:task-051 | Webhook signature verification, mock OAuth |
| local-port:task-098 | OpenAPI schema import |
| local-port:task-101 | Completion wave and safe landing |
| local-port:task-187 | Portability export and laptop-B rehydration |

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/e2e test -- full-lifecycle` — pass. Vitest 5.1.1, 1 file, 4 tests, 0 failed, about 1.2s. `journey-greenfield-full`, `journey-multi-project-broker`, `journey-cli-and-api`, and completeness certification all passed (3/3 journeys, 0 skipped, suite `< 150s`, board update `< 10ms`).
- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b --pretty false`).
- `pnpm --filter @ef-harness/e2e lint` — pass (`eslint .`).
- `pnpm typecheck` — pass (workspace root).
- `pnpm lint` — pass (workspace root).
- `pnpm test` — pass (recursive package tests + `scripts/harmony.test.mjs`).
- `node scripts/verify-harmony.mjs --task 195` — run by `node scripts/agent-worktree.mjs commit 195` immediately before this commit.

## Known Limitations / Follow-Ups

- Journeys are **local-port fixtures** on base `6497730`, not a live 28-package harnessd run. Full wiring executes once branches land on `harness/integration`.
- Port leases use deterministic assignment inside 41000–48999 without binding sockets on every lease (preview ports are also exercised via ephemeral loopback for webhooks).
- IPC is simulated in-process; production uses Windows named pipes plus Electron preload bridge.
- Greenfield git history uses local `git init`, not MinGit worktrees bundled for ship.