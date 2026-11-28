---
task_id: "Task-160"
branch: "task/160-live-app-preview-runner"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/daemon/src/preview/**"
  - "apps/daemon/tests/preview/**"
  - "apps/renderer/src/preview/host/**"
  - "apps/renderer/tests/preview-host/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 160 handoff

`agent-worktree create` copies this file to `.agent-handoffs/task-NNN.md` and sets `status` to `in_progress`. Flip `status` back to `ready_for_integration` only after the verification section is filled in. Commit stays on `task/160-live-app-preview-runner`.

## Exports Provided

- `LivePreviewDaemonRunner` — `apps/daemon/src/preview/live-preview-daemon-runner.ts` (`createLivePreviewDaemonRunner` factory in `create-runner.ts`)
- `PersistentDemoDbManager` — `apps/daemon/src/preview/persistent-demo-db-manager.ts`
- `LastGoodPreviewFallbackStore` — `apps/daemon/src/preview/last-good-preview-fallback-store.ts`
- `IsolatedPreviewWebviewHost` — `apps/renderer/src/preview/host/isolated-preview-webview-host.ts`
- Local stand-ins until upstream tasks land: `LocalPortLeaseRepo` (014), `LocalWorktreeSlotPool` (038), `LocalWindowsJobSupervisor` (041), `LocalTestEnvOrchestrator` / `LocalTemplateDbSeeder` (050/052), `LocalRuntimeOnlyEnvInjector` (120)

## Shared Wiring Needs (Root / Index Barrels)

None. Preview code lives in disjoint subtrees with package-local barrels (`apps/daemon/src/preview/index.ts`, `apps/renderer/src/preview/host/index.ts`). Integrator should wire daemon IPC and renderer Preview tab when Tasks 123/155/162 consume these hosts.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/daemon test -- preview          # 17/17 passed
pnpm --filter @ef-harness/renderer test -- preview-host    # 7/7 passed
pnpm --filter @ef-harness/daemon typecheck                 # ok
pnpm --filter @ef-harness/renderer typecheck               # ok
pnpm lint                                                  # ok
node scripts/verify-harmony.mjs --task 160                 # pending at commit
```

## Known Limitations / Follow-Ups

- Postgres preview mode still recycles the dev server on `Reset Demo Data`; SQLite keeps the fixture hot because the dev server opens `DEMO_DB` per request.
- Local supervisors replace Task 040 Windows Job Objects and Task 050 service providers until those packages are on `harness/integration`.
- Console/network error strip and live reload hook surface are contract-ready on the renderer host; full Electron wiring awaits desktop integrator.