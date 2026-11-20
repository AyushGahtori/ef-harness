---
task_id: "Task-042"
branch: "task/042-sandbox-tier-b-users"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/tier-b-users/**"
  - "packages/sandbox/tests/tier-b-users/**"
  - ".agent-handoffs/task-042.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 042 handoff

Tier B sandbox users: consent-gated provisioning, empty-slot ACLs, firewall policy, and Mode S routing. Commit stays on `task/042-sandbox-tier-b-users`.

## Exports Provided

Import from `packages/sandbox/src/tier-b-users/index.ts` (this branch does not re-export the package barrel).

- `TierBSandboxUsersProvider` and `createTierBSandboxUsersProvider` — `SandboxTierProvider` for tier B. Capabilities are `fileWritesEnforced: true`, `secretReadsDenied: true`, `networkEnforced: true`, `requiresAdmin: true`.
- `SandboxTierProvider`, `SandboxLaunchSpec`, `TierProbeResult` — local copy of the Task 041 contract. `probe` returns `TierBProbe` with `available`, `provisioned`, `firewallActive`, and `missingComponents`.
- `TierBAdminProvisioner` — builds the auditable provision and deprovision plans. `provision` and `unprovision` run only after `source: "settings_sandbox_setup"`, `explicit: true`, `uacAccepted: true`, and a matching `action`. Startup and `acquireWarmInstance` do not call them.
- Accounts: `EFHarnessSandboxOffline` and `EFHarnessSandboxOnline`. Passwords are generated in memory (32+ characters) and stored through `SecretProtector` as DPAPI blobs owned by the developer SID. The script text does not contain the password. `sandboxUserCanDecryptDeveloperDpapi()` is `false`.
- `buildTierBFirewallRules` — outbound block rules for both accounts. Non-loopback addresses are blocked. Loopback TCP is blocked except the provisioned proxy port and harness MCP port. Loopback UDP is blocked. Permits are gaps in block ranges because a Windows block rule wins over an allow rule.
- `EmptySlotAclManager.onEmptySlotCreated(slotPath)` — Task 038 hook. `fs.readdirSync` must be empty or it throws `EmptySlotNotEmptyError` and applies nothing. One inheritable `(OI)(CI)(M)` ACE for the sandbox user SID, plus one inheritable modify ACE for a per-slot capability SID. No `/T`.
- `applyStoreReadOnly` — one inheritable `(OI)(CI)(RX)` ACE on the pnpm store root, not a recursive walk.
- `applyGitWriteDeny` — one non-recursive deny-write ACE on a `.git` directory.
- `reverifyStorageRoot` — confirms or applies the inheritable user ACE on a relocated root without reading child entries (`walkedChildren: 0`).
- `evaluateCrossWorktreeRead` — a token restricted to slot A's capability SID cannot read slot B.
- `resolveTierBExecutionMode` — Gemini CLI requested as wrapped returns Mode S (`file_login_on_tier_b`) and `homeAclMutations: []`. Token vendors stay wrapped: Codex `ACCESS_TOKEN`, Copilot env `GITHUB_TOKEN` with SDK field `gitHubToken`, Cursor `CURSOR_API_KEY`, Claude Console `ANTHROPIC_API_KEY`. Subscription tokens are rejected.
- `buildScrubbedEnvironment` and `injectSingleVendorToken` — allowlisted env, `HOME` / `USERPROFILE` / temp / cache / `APPDATA` inside the attempt temp dir, sandbox `USERNAME`, no `GH_TOKEN` or personal provider keys.
- `probeTierB` and `probeTierBForPath` — UNC, FAT32, FAT, and exFAT return guidance `Move project to local NTFS/Dev Drive, or use Tier A/D`. NTFS, ReFS, and Dev Drive are accepted.
- `explainProvisionFailure` — Win32 `5`, `1058`, and `0x80070422` are Group Policy or firewall-service blocks with fallback tiers A, D, and C.
- `buildDesktopIsolation("win32")` — non-interactive `EFHarnessSandboxWinSta\EFHarnessSandboxDesktop`, not `WinSta0\Default`.
- `buildRestrictedLogonPlan` — `LogonUser`, `CreateRestrictedToken`, `CreateProcessAsUserW`, nested job, restricting capability SID.
- `runTierBLiveRedTeam` — probes `read_ssh`, `read_dpapi`, `write_outside_worktree`, `write_git`, `raw_external_tcp`. This host is unprovisioned, so `claimedOsEnforcement` is false and no probe is marked blocked.

## Shared Wiring Needs (Root / Index Barrels)

- `packages/sandbox/src/index.ts` and `packages/sandbox/package.json` are outside this task. Do not treat `@ef-harness/sandbox` as exporting Tier B until an integrator re-exports `packages/sandbox/src/tier-b-users/index.ts`.
- Task 041's `SandboxTierProvider` is not on this branch. This subtree repeats the interface. An integrator should keep one shared declaration.
- Task 040's `WindowsJobManager` is not on this branch. Adapt `createJob` / `assignProcess` / `queryJobAccounting` / `terminateJob` onto `WindowsJobManagerPort`. Command jobs are nested under the attempt job with kill-on-close, a memory cap, an active-process cap, and UI restrictions.
- Task 038's `WorktreeSlotManager` accepts `onEmptySlotCreated(slotPath)`. Pass `EmptySlotAclManager.onEmptySlotCreated`. The hook must not create files inside the slot. Point `tempDirForSlot` at a directory outside the slot.
- `SandboxAuditLogger` is the seam for Task 011. `CreateProcessAsUserW` failures log `api`, `win32Error`, and an EDR hint, not the environment or the password.
- Loopback holes are the attempt MCP port and the Task 044 proxy port. Direct external TCP stays denied for both accounts. Kernel-approved test endpoints are recorded on the logon plan for the proxy; they do not open a firewall hole.

## Dependency Intents (New Packages Requested)

None. Provisioning uses `netapi32` `NetUserAdd` (`USER_PRIV_USER`, not Administrators), `advapi32` `LsaAddAccountRights` for `SeDenyInteractiveLogonRight` and `SeDenyRemoteInteractiveLogonRight`, and `netsh advfirewall`. No new package, native addon, or root manifest change.

## Contract Change Requests

None.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-042-sandbox-tier-b-users`.

`pnpm --filter @ef-harness/sandbox test -- tier-b-users`

- Exit 0. Vitest 5.1.1: 4 files, 18 tests passed.
- Provision plan names both sandbox accounts, denies interactive logon, keeps passwords out of the script, and refuses to run without Settings plus UAC consent.
- A consented run stores DPAPI blobs the sandbox SID cannot unwrap. Win32 `5` rolls the vault back and explains the Group Policy fallback to Tier A, D, or C. `0x80070422` and `1058` do the same for the firewall service.
- Firewall rules block non-loopback and every loopback TCP port except `4318` and `4320`. External TCP is denied for the offline and online accounts. Loopback to the proxy port is allowed.
- Deprovision plan removes both users, every firewall rule name, and the vault entries, and it also requires consent.
- Empty-slot grant is one user modify ACE, capability ACE included, no `/T`. A populated directory throws before any ACE. Store ACE is `RX`. `.git` write is deny. Storage-root reverify reports `walkedChildren: 0`.
- Profile root and `.ssh` grants throw `DeveloperHomeAclError`.
- Cross-slot read with a different capability SID is `cross_worktree_capability`.
- UNC and FAT32 are rejected with `Move project to local NTFS/Dev Drive, or use Tier A/D`. NTFS and Dev Drive are accepted.
- Gemini wrapped launch rejects with `TierBModeSRequiredError` and does not change ACLs or provision.
- Scrubbed env drops `GH_TOKEN` and personal keys. Cursor receives only `CURSOR_API_KEY`. Copilot's SDK field is `gitHubToken` and the env key is `GITHUB_TOKEN`.
- Coding commands use `EFHarnessSandboxOffline` on `EFHarnessSandboxWinSta\EFHarnessSandboxDesktop`, nest a kill-on-close job, and wipe temp residue. Kernel-approved test endpoints use `EFHarnessSandboxOnline` and still set `directExternalTcp: "deny"`. An unapproved online purpose throws.
- Wrapped Codex receives only `ACCESS_TOKEN`. `CreateProcessAsUserW` error `5` is logged with the API name and the EDR hint.
- A 20ms timeout rejects with `TierBCommandTimeoutError`. FAT32 acquire throws `VolumeRejectedError`.
- `runTierBLiveRedTeam` on this machine: `skipped_unprovisioned`, `claimedOsEnforcement: false`, every probe `executed: false`.

`pnpm --filter @ef-harness/sandbox typecheck`

- Exit 0.

`pnpm --filter @ef-harness/sandbox lint`

- Exit 0.

`node scripts/verify-harmony.mjs --task 042`

- Exit 0. Output: `harmony ok for Task-042`. Scope stayed on `packages/sandbox/src/tier-b-users/**`, `packages/sandbox/tests/tier-b-users/**`, and this handoff. Schema, diagram, workspace typecheck, lint, and test scripts passed.

## Known Limitations / Follow-Ups

- This host does not have `EFHarnessSandboxOffline` or `EFHarnessSandboxOnline`. `readWindowsTierBInspector` only queries `net user` and does not treat firewall rules or DPAPI blobs as valid, so live red-team probes were not executed and OS enforcement was not claimed. Opting in with `--tier-b-live` or `EF_TIER_B_LIVE=1` still does not launch a process as those users unless a caller supplies an OS logon backend; the report stays `not_run` / `os_logon_backend_not_attached` when the host is otherwise provisioned.
- The consent-gated script calls `NetUserAdd`, `LsaAddAccountRights`, and `netsh`. It was not executed here. Unit tests use a recording runner.
- `CreateProcessAsUserW` is represented by `RestrictedLogonPlan` and `LogonExecutor`. The default executor refuses live logon. Tests use a recording double (`enforcement: "test_double"`).
- The per-slot capability ACE is a second inheritable ACE on the empty folder so a shared sandbox user cannot read another slot. It is still O(1) and is not a recursive `icacls`.
- A deny-write ACE on `.git` is applied to that directory object without `/T`. Files created later inherit it. The access policy denies `.git` writes even when an inherited allow is present.
- Firewall allows are expressed as holes in block ranges. Changing the proxy or MCP port requires a consented re-provision; `acquireWarmInstance` rejects a spec whose ports differ.
- Temp directories must sit outside the slot. The empty-slot hook must not leave entries in the slot, or Task 038 rejects the hook.
