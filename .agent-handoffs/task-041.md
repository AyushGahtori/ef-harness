---
task_id: "Task-041"
branch: "task/041-sandbox-tier-a-mxc"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/tier-a-mxc/**"
  - "packages/sandbox/tests/tier-a-mxc/**"
  - ".agent-handoffs/task-041.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 041 handoff

Tier A MXC policy engine, scrubbed environment, warm-instance binding, and fail-closed launcher. Commit stays on `task/041-sandbox-tier-a-mxc`.

## Exports Provided

Import from `packages/sandbox/src/tier-a-mxc/index.ts` (this branch does not re-export the package barrel).

- `SandboxTierProvider` — shared tier interface: `tier`, `capabilities`, `probe`, `acquireWarmInstance`, `executeCommand`, `spawnWrappedProcess`, `disposeInstance`.
- `SandboxLaunchSpec` — attempt paths, ports, mode (`per_command` | `wrapped`), and optional wrapped vendor.
- `TierAMxcProvider` and `createTierAMxcProvider` — Tier A implementation. Capabilities are `fileWritesEnforced: true`, `secretReadsDenied: true`, `networkEnforced: true`, `requiresAdmin: false`.
- `compileMxcPolicy` — declarative filesystem and network policy. Also exported: `evaluateAccess`, `evaluateNetwork`, `sealPolicyAtStart`.
- `probeMxcAvailability` — build gate plus `processmodel.dll` export probe. `26100.9277` and Windows 10 are `available: false`, `reason: "os_build_too_old"`. `26100.9278` and `26200.9278` are build-eligible. Launch still requires the pinned helper (`launchable`).
- `buildScrubbedEnvironment`, `injectSingleVendorToken` — allowlisted env. Never copies `process.env`. One scoped vendor token only, and only in wrapped mode.
- `WindowsJobManagerPort` — consumption shape for Task 040: `createJob`, `assignProcess`, `queryJobAccounting`, `terminateJob`. The provider assigns the helper pid when the process starts and closes the per-command job on foreground exit.
- `SandboxUnavailableError` — thrown when Tier A cannot launch. The provider does not spawn the user command unsandboxed.
- `runTierALiveRedTeam` — live probes (`read_ssh_canary`, `write_outside_worktree`, `write_git_head`, `raw_external_tcp`). Reports `skipped_env_no_mxc` when the build gate fails. Never sets `claimedOsEnforcement` unless the probes actually ran under the pinned helper.

## Shared Wiring Needs (Root / Index Barrels)

- `packages/sandbox/src/index.ts` and `packages/sandbox/package.json` are outside this task. Do not treat `@ef-harness/sandbox` as exporting Tier A until an integrator re-exports `packages/sandbox/src/tier-a-mxc/index.ts` from the package barrel.
- Task 040's `WindowsJobManager` is not in this branch. Adapt `createJob` / `assignProcess` / `queryJobAccounting` / `terminateJob` / `closeJob` onto `WindowsJobManagerPort`. This provider sets kill-on-close, a job memory cap, an active-process cap, and UI restrictions.
- `SandboxAuditLogger` and `SandboxGovernorSink` are the seams for Task 011 `StructuredLogger` and Task 117. Denial events and launch latency (`p50` / `p95`) go to both.
- Loopback ports in the policy are the attempt MCP port and the Task 044 allowlisting proxy. Wrapped mode names the vendor provider hosts and still denies direct TCP to those hosts; traffic must go through the proxy.

## Dependency Intents (New Packages Requested)

- `ef-mxc-launch`: Windows helper built from `openai/codex` crate `codex-rs/mxc-sandbox`, Apache-2.0. Pin: tag `rust-v0.162.1` (re-pin to the commit reviewed at integration; verdict in `spikes/windows-sandbox/CODEX_EVAL.md`, owned by Task 003). Transitive `mxc-sdk` from `microsoft/mxc` is MIT. Protocol on stdin is `ef-mxc-launch/1` with `failOpen: false`, FlatBuffer identifier `SBOX`, and `callsExportDirectly: false`.
- Do not add this helper to root `package.json`, `pnpm-workspace.yaml`, or a node-gyp / N-API addon. `MXC_HELPER_PIN.manifestPath` is `spikes/windows-sandbox/CODEX_EVAL.md`.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-041-sandbox-tier-a-mxc` on Windows build `26200.9974`, unelevated.

`pnpm --filter @ef-harness/sandbox test -- tier-a-mxc`

- Exit 0. Vitest 5.1.1: 5 files, 24 tests passed (about 1.6s).
- `compileMxcPolicy` covers writable worktree / temp / build output, read-only toolchains, pnpm store, and `node_modules` (`EPERM` on write), deny-write on `.git` (including a linked gitdir), deny-read for profile secrets, browser profiles, credential stores, `%LOCALAPPDATA%\EFHarness`, the developer checkout, and other worktrees.
- Traversal (`..`), relative paths, the developer checkout, and `%LOCALAPPDATA%\EFHarness\projects` are rejected before rules are compiled. Spaces and Unicode paths canonicalize.
- `probeMxcAvailability`: `26100.9277` false / `os_build_too_old`, `26100.9278` true, `26200.9278` true, Windows 10 `19045.3803` false / `os_build_too_old` in under 5 ms.
- Scrubbed env redirects `HOME`, `USERPROFILE`, `TEMP`, `TMP`, `TMPDIR`, `XDG_CACHE_HOME`, and eslint / vitest / turbo / playwright / npm cache variables into the attempt temp dir. `GH_TOKEN` and personal provider keys are absent. Wrapped Codex receives only `ACCESS_TOKEN`.
- Warm reuse wipes the temp dir between commands and across worktrees. Detached commands throw `MxcForegroundExitError` (Task 049 owns long-running servers).
- A missing helper or a helper result of `deny_paths_unsupported` throws `SandboxUnavailableError` and does not spawn the user command. A failed wrapped launch releases the warm instance.

`pnpm --filter @ef-harness/sandbox typecheck`

- Exit 0.

`pnpm --filter @ef-harness/sandbox lint`

- Exit 0 after removing an unused test import.

Live host probe (`probeMxcAvailability()` on this machine):

- `available: true`, `osBuild: "26200.9974"`, `reason: null`, `policyBasedGrants: true`, `runtimeExportPresent: true`, `helperPresent: false`, `launchable: false`, `launchBlocker: "mxc_requires_pinned_helper"`.
- `runTierALiveRedTeam`: `status: "not_run"`, `reason: "mxc_requires_pinned_helper"`, `claimedOsEnforcement: false`. All four probes have `executed: false` and `actuallyBlocked: false`. OS enforcement was not claimed.

`node scripts/verify-harmony.mjs --task 041`

- Exit 0. Output: `harmony ok for Task-041`. Scope stayed on `packages/sandbox/src/tier-a-mxc/**`, `packages/sandbox/tests/tier-a-mxc/**`, and this handoff. Schema, diagram, workspace typecheck, lint, and test scripts passed.

## Known Limitations / Follow-Ups

- This host has the MXC export and an eligible build, and it does not have `ef-mxc-launch`. Live red-team probes were not executed. Task 003 forbids calling `Experimental_CreateProcessInSandbox` without the pinned helper because a bad `SBOX` spec can fail open. The skip is explicit (`not_run` / `mxc_requires_pinned_helper`), not `skipped_env_no_mxc`, and it does not count as an OS pass.
- Deny-read file expansion at launch covers `.ssh`, `.aws`, `.azure`, `.gnupg`, and `.npmrc` only. Browser profiles, harness data, the developer checkout, and other worktrees are frozen as directory prefixes and are not walked. A file created after the snapshot is outside that file list; prefix evaluation in `evaluateAccess` still denies those trees for the policy unit tests.
- The helper must refuse to launch when native deny paths are unsupported (`requireNativeDenyPaths: true`). `allowLocalBinding` is required; `false` fails closed.
- Per-command jobs close when the foreground command exits. Wrapped sessions keep the job until `disposeInstance`. Detached dev servers are rejected here and belong to the Task 049 environment job.
