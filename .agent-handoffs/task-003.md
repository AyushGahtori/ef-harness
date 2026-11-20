---
task_id: "Task-003"
branch: "task/003-spike-windows-sandbox"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "spikes/windows-sandbox/**"
  - ".agent-handoffs/task-003.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 003 handoff

Spike for Windows isolation tiers A-D, the Tier C write-restricted token, Job Object kill-on-close, the red-team probe, and the Codex reuse decision. Commit stays on `task/003-spike-windows-sandbox`.

## Exports Provided

- `spikes/windows-sandbox/src/capabilities.mjs` exports `TIER_CAPABILITIES`. Tier C is exactly the sandbox-and-security.md cells: file writes enforced, secret reads "Not enforced for paths the user can read", network "Advisory only (proxy environment variables)", `networkEnforced: false`, `secretReadsDenied: false`, `requiresAdmin: false`, badge `weaker sandbox`.
- `spikes/windows-sandbox/src/build.mjs` exports `isMxcBuildEligible`. `26100.9277` is false, `26100.9278` and `26200.9278` are true, Windows 10 `19045` is false. This host is `26200.9974`, so the build gate passes. The build gate is not sufficient: also require `processmodel.dll` to export `Experimental_CreateProcessInSandbox` via `LoadLibraryExW(..., LOAD_LIBRARY_SEARCH_SYSTEM32)`.
- `spikes/windows-sandbox/src/errors.mjs` exports `SandboxUnavailableError` (`code: SANDBOX_UNAVAILABLE`). `executeInTier` throws it when the requested tier is absent. It does not spawn the payload.
- `spikes/windows-sandbox/src/volume.mjs` exports `classifyPath`. UNC, network drives, FAT32, and exFAT return `aclCapable: false` and `recommendedTiers: ["A", "D"]`.
- `spikes/windows-sandbox/redteam-probe.mjs` prints the red-team matrix. Each row is `{ tier, testId, expectedBlocked, actuallyBlocked, exitCode, detail }`.
- `spikes/windows-sandbox/report.json` and `REPORT.md` are the measured matrix. `CODEX_EVAL.md` is the reuse verdict.
- Win32 decisions for Tasks 040-044:
  - Job objects: `CreateJobObjectW`, `SetInformationJobObject` class 9, `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (`0x2000`), UI restriction class 4 with flags `0x1|0x2|0x4|0x8|0x10|0x20|0x40|0x80`. Assign the root before it spawns. Do not set `JOB_OBJECT_LIMIT_BREAKAWAY_OK`. UI limits do not stop `SendInput`; a separate window station/desktop is required and Tier C cannot provide it.
  - Tier C: `CreateRestrictedToken` with `DISABLE_MAX_PRIVILEGE | LUA_TOKEN | WRITE_RESTRICTED` (`0x1|0x4|0x8`). Restricting SIDs in order: synthetic `S-1-5-21-...`, logon SID, Everyone `S-1-1-0`. Default DACL via `SetEntriesInAclW` (a 4096-byte `InitializeAcl` failed here with Win32 1344). Enable `SeChangeNotifyPrivilege`. Launch with `CreateProcessAsUserW` on `WinSta0\Default`, `CREATE_SUSPENDED`, assign to the job, `ResumeThread`. `CreateProcessWithTokenW` is only a fallback.
  - ACLs: inheritable modify for the capability SID on the empty worktree; deny write on `.git`; deny write on the hard-linked store file. `icacls` returns 1332 for an unmapped capability SID, so the empty-slot grant uses `FileSystemAccessRule` / `SecurityIdentifier`. Recursive cost was measured with `icacls /T` for the real user.
  - Tier A: do not call `Experimental_CreateProcessInSandbox` without a compiled `SBOX` FlatBuffer. A bad spec can fail open. Availability on this host: build eligible, DLL present, export present, launcher not linked (`mxc_requires_pinned_helper`).
  - Tier B accounts are `EFHarnessSandboxOffline` and `EFHarnessSandboxOnline`. Neither exists here. Setup status is `requires one-time admin consent`. No firewall rule was created. `--allow-elevated-tier-b-test` was not passed.
  - Env scrub is an allowlist, not a copy of the parent environment. `HOME`, `USERPROFILE`, `TEMP`, `TMP`, and `XDG_CACHE_HOME` point inside the attempt. `GH_TOKEN` is removed. `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` point at `http://127.0.0.1:9`.
  - AppContainer is not a tier. Node `v24.16.0`, Git `2.54.0.windows.1`, and pnpm `10.34.9` ran inside the restricted token. pnpm was launched as `node pnpm.cjs` because the extensionless `pnpm` shim is not a Win32 image and `pnpm.cmd` could not find `node` on PATH from `cmd.exe`.

## Shared Wiring Needs (Root / Index Barrels)

None. Do not export this spike from `spikes/src/index.ts`. Tasks 040-044 should read this handoff and the files under `spikes/windows-sandbox/` directly.

## Dependency Intents (New Packages Requested)

- `ef-mxc-launch`: a Windows helper built from `openai/codex` crate `codex-rs/mxc-sandbox`, Apache-2.0. Starting pin: tag `rust-v0.162.1`. Re-pin to the commit reviewed when Task 041 integrates. Transitive `mxc-sdk` from `microsoft/mxc` is MIT. Do not add this to root `package.json` or `pnpm-workspace.yaml`. No node-gyp and no N-API addon for Tier A.
- Task 040 should call `kernel32` job APIs from a small native helper or direct bindings. The PowerShell `Add-Type` process in this spike is the probe harness, not the per-command launcher.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-003-spike-windows-sandbox` on Windows 11 build `26200.9974`, unelevated, not in the Administrators group.

`node --test --test-concurrency=1 spikes/windows-sandbox/windows-sandbox.test.mjs`

- 8 passed, 0 failed (about 52s on the last run).
- Job close: 0 orphans, `elapsedMs` 0, within 1000 ms. Handle-owner kill: 0 orphans, `elapsedMs` 29, within 1000 ms. Tree is node, then PowerShell, then node sleeper.
- Tier C `CreateProcessAsUserW` exit 0. Worktree write and attempt-temp write succeeded. Outside write and `.git/HEAD` returned `EPERM`. Synthetic canary read succeeded. Raw `net.connect` to `1.1.1.1:443` returned `CONNECTED` while `HTTP_PROXY` was `http://127.0.0.1:9`, so Tier C did not report the socket as blocked.
- Hard link: same NTFS file (`nlink` 2). Write through `node_modules` returned `EPERM` for the current user after a deny ACE, and `EPERM` for the capability SID. The owner could write the store file again after the ACE purge.
- Empty-slot inheritable ACE: 13.68 ms. Recursive `icacls /T` over 10000 files: 13719.37 ms. Delta: 13705.69 ms. A file created after the empty-slot grant inherited the synthetic SID.
- Tier A, B, and D red-team rows are `not_run` with `actuallyBlocked: false`. Tier C rows match the expected blocked flags. `networkEnforced` and `secretReadsDenied` are false.
- Docker is not installed. `wsl.exe` is present and lists no distros (`wsl_installed_no_distro`). No firewall change. Scratch prefix `ef-harness-task-003-` was removed.

`pnpm --filter @ef-harness/spikes test -- windows-sandbox`

- Exit 1. Vitest 5.1.1 reported `No test files found` with `include: tests/**/*.test.ts` and filter `windows-sandbox`. `spikes/vitest.config.ts` is frozen by Task 001 and is outside this task's owned paths, so the suite lives at `spikes/windows-sandbox/windows-sandbox.test.mjs` and is run with `node --test`.

`node scripts/verify-harmony.mjs --task 003`

- Exit 0. Output: `harmony ok for Task-003`. Scope was limited to `spikes/windows-sandbox/**` and this handoff. Schema, diagram, typecheck, lint, and the workspace test scripts passed.

## Known Limitations / Follow-Ups

- Tier A was not executed. The export is present, and calling it with a hand-built specification can fail open. Task 041 should use the pinned `codex-mxc-sandbox` helper. MXC child-exit and deny-read timing were not measured in the kernel. The local snapshot shows a file created after the scan is outside the start-time list. Documented behavior still stands: foreground exit stops remaining children, so `harness.start_service` must own detached servers on an environment job.
- Tier B was not provisioned. Creating `EFHarnessSandboxOffline` / `EFHarnessSandboxOnline` or firewall rules needs the explicit admin opt-in. This spike does not implement that mutation even if the flag is passed.
- Tier C reads and raw sockets are advisory. Do not mark them enforced.
- `CreateDesktop("EFHSpike...")` succeeded and `sendInputIsolated` is false. UIPI does not contain a same-user medium-integrity token. Job UI limits are not a `SendInput` boundary.
- `icacls` cannot grant an unmapped capability SID (Win32 1332). Use `SecurityIdentifier` for those ACEs.
- Anonymous-pipe `spawnSync` inside the token returned `EPERM`. The same tools ran when stdout was a file handle in the worktree. The sleeper used `stdio: "ignore"` and was killed by the job.
- The PowerShell helper compiles C# on startup. That is acceptable for a spike and too heavy for every `harness.run`.
