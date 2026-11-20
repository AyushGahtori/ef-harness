---
task_id: "Task-047"
branch: "task/047-harness-run-engine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/harness-run/**"
  - "packages/sandbox/tests/harness-run/**"
  - ".agent-handoffs/task-047.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 047 handoff

`harness.run` unified execution engine. Commit stays on `task/047-harness-run-engine`.

## Exports Provided

Import from `packages/sandbox/src/harness-run/index.ts` until the sandbox barrel is wired:

- `HarnessRunEngine` — `executeSandboxedCommand(request)` returns `SandboxedCommandResult`
- `CommandPolicyEvaluator` — allowlist plus hard denies, including every `&&`, `||`, `;`, `|`, substitution, and redirect segment
- `OutputSummarizer` — first 100 lines, last 200 lines, per-line 4000-character cap, explicit `harness.read_log` omission banner, Vitest/Jest/Playwright and tsc/ESLint summaries
- `SandboxedCommandResult` — `tier`, `mode`, `exitCode`, `timedOut`, `oomKilled`, `artifactId`, `omittedLines`, `failureFingerprint`, `durationMs`, `peakMemoryBytes`, `truncated`, `outputLimitExceeded`, `terminationReason`, `summary`, `stdoutSummary`, `stderrSummary`, `toolSummary`, `hint`, `nodeModulesReadOnly`, `commandId`

Also exported for tests and later wiring: `CommandDeniedError`, `CwdEscapeDeniedError`, `StreamingSecretRedactor`, `LocalArtifactManager`, `NestedCommandJobManager`, `WarmExecutionPool`, `InMemoryLocalTracer`, `TelemetryDb`, `computeFailureFingerprint`, `buildScrubbedEnv`, `resolveContainedCwd`, `serverRejectionHint`.

`SandboxedCommandResult.failureFingerprint` is a lowercase sha256 hex digest when `exitCode !== 0`, otherwise `null`. `hint` asks the worker to call `harness.start_service(name)` when a dev-server command times out after printing a listening URL.

## Shared Wiring Needs (Root / Index Barrels)

`packages/sandbox/src/index.ts` is outside this task's write scope. The integrator should add:

```ts
export {
  HarnessRunEngine,
  CommandPolicyEvaluator,
  OutputSummarizer,
} from "./harness-run/index.js";
export type { SandboxedCommandResult } from "./harness-run/index.js";
```

Sibling barrels are not on `harness/integration` yet. When they land, construct `HarnessRunEngine` with:

- `jobs`: `WindowsJobManager` from Task 040 (`createJob` with `killOnJobClose`, memory, and active-process limits)
- `artifacts`: `ArtifactManager` from Task 029 (`storeArtifact`, `readLogRange`, `promoteRetention`)
- `selector`: `SandboxTierSelector` from Task 043 (`acquire` returns a warm slot with `tier` and `mode`)
- `tracer`: `LocalTracer` from Task 011
- a streaming `SecretRedactor` from Task 011 (the engine's `StreamingSecretRedactor` is the local stand-in and already redacts before CAS and the model summary)

No root `package.json` or tsconfig edit is required.

## Dependency Intents (New Packages Requested)

None yet.

## Contract Change Requests

None yet.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-047-harness-run-engine`:

- `pnpm --filter @ef-harness/sandbox test -- harness-run` — pass, 2 files, 23 tests (allowlisted `node` and `git status`; denied `git push`, `pnpm add`, `curl | sh`, `pnpm test && git reset --hard`, and `cwd: "../.."`; 4000-line head/tail banner `3700 lines omitted; use harness.read_log(...)` plus Vitest/tsc summary and seekable `artifactId`; grandchild sleeper gone on return; synthetic secret absent from summary and CAS).
- `pnpm --filter @ef-harness/sandbox typecheck` — pass.
- `pnpm --filter @ef-harness/sandbox lint` — pass.
- `node scripts/verify-harmony.mjs --task 047` — pass (`harmony ok for Task-047`).

## Known Limitations / Follow-Ups

- Task 040, Task 029, Task 011, and Task 043 are not in this base commit, so the engine ships local ports with working defaults: a real Windows nested Job Object host (`KILL_ON_JOB_CLOSE`, memory and process caps, suspended assign), a zstd seekable artifact store with a 1000-line index above 1 MB, a streaming redactor, a 2-slot warm pool defaulting to tier C / `own_loop`, and `telemetry.db` progress rows. Swap those defaults for the sibling implementations at integration. Do not treat tier C here as Task 043's restricted-token sandbox.
- `node_modules` is marked read-only with a best-effort chmod and `nodeModulesReadOnly: true` on every result. ACL enforcement stays with Task 043.
- The default captured-output cap is 50 MB (`output_limit_exceeded`). The job host is 64-bit Windows only; compile uses the local C# compiler via PowerShell `Add-Type`.
