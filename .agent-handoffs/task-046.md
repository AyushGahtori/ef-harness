---
task_id: "Task-046"
branch: "task/046-supply-chain-installer"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/installer/**"
  - "packages/sandbox/tests/installer/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 046 handoff

Kernel-only supply-chain installer: pnpm v10 script blocking, exact `allowBuilds` version pins, age/CVE/typosquat/license vetting, lockfile integrity, same-volume store alignment, and one reconciled lockfile update. Commit stays on `task/046-supply-chain-installer`.

## Exports Provided

Import from `packages/sandbox/src/installer/index.ts` until the sandbox barrel is wired:

- `KernelPackageInstaller` — `vetDependencyIntent`, `installLockedDependencies`, `addApprovedDependency`, `applyReconciledIntents`, `checkTyposquat`, `verifyLockfileIntegrity`, `reconcileDependencyIntents`
- `SupplyChainVetReport` — decision `allow | hold | deny` plus age, vulnerability, typosquat, and SPDX license signals
- `reconcileDependencyIntents` — semver range intersection; compatible ranges become one update, incompatible ranges return every task id and reason
- `checkTyposquat` — Damerau-Levenshtein distance 1–2, homoglyph fold, delimiter/suffix swaps, and scope confusion against the bundled popular npm/PyPI list (`POPULAR_PACKAGES`, 5123 names)
- `verifyLockfileIntegrity` — rejects non-registry tarball URLs, missing SHA-512 digests, and mismatched tarball bytes for `pnpm-lock.yaml`, `package-lock.json`, and `yarn.lock`
- `InstallScriptApprovalRequired` — inbox approval card pinned to exact `name@version`, with script preview and "Approve this version once"
- `DependencyAuditReceipt` — installed name, version, SHA-512 integrity, license, and whether that package's install scripts ran
- `isWorkerPackageManagerInstall` — flags `pnpm`/`npm`/`yarn` install/add/ci and `pip install` for Task 047's command allowlist
- `DiskLane` / `sharedDiskLane` — the single disk lane; installs run one at a time
- `alignStoreWithWorktree` — moves the pnpm store onto the worktree volume when hard links would cross drives
- `TierCInstallDenied`, `WorkerDirectInstallDenied`, `LockfileIntegrityError`, `SandboxRedTeamError`, `RegistryProfileError`, `LockfileMutationError`

`installLockedDependencies` always passes `--frozen-lockfile` / `npm ci` / `yarn install --immutable`, plus `--ignore-scripts` and pnpm `--config.strict-dep-builds=true`. It passes `--offline` when every locked SHA-512 is already in the shared store index. Unapproved `preinstall`/`install`/`postinstall` scripts halt before any package-manager process starts. Approved scripts run only for that exact version, then a red-team probe must fail to read the secret root and must fail to open a non-registry host.

## Shared Wiring Needs (Root / Index Barrels)

`packages/sandbox/src/index.ts` is outside this task's owned scope. When integrating, re-export `KernelPackageInstaller`, `SupplyChainVetReport`, `reconcileDependencyIntents`, `checkTyposquat`, `verifyLockfileIntegrity`, `InstallScriptApprovalRequired`, and `DependencyAuditReceipt` from that barrel for Tasks 047, 093, 110, and 193.

No root `package.json` change. Semver intersection is implemented in `semver.ts` so this task does not take a new dependency.

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

`KernelPackageInstaller` consumes structural ports because Tasks 040 and 044 are not on this branch:

- `InstallerJobRunner.runCommand` adapts Task 040 `WindowsJobManager.runCommand`. The adapter must spawn with the scrubbed `env` (attempt `HOME`/`USERPROFILE`, loopback `HTTP(S)_PROXY`, no `NPM_TOKEN` / provider keys) because `CommandRequest` does not carry an environment block. Pass `tier` A, B, or D, role `kernel_installer` or `install_script`, and close the nested command job when the process exits.
- `KernelInstallerProxy` adapts Task 044 `AllowlistProxyServer` with `profile: "kernel_installer"`, a loopback `proxyUrl`, and `allowedHosts` limited to package registries. The installer refuses every other profile.

`actor: "worker"` throws `WorkerDirectInstallDenied`. Workers must call `harness.request_dependency(pkg, range, reason)`. Only `kernel` and `integrator` may install or write `package.json` and the lockfile, and that write happens once inside `addApprovedDependency` / `applyReconciledIntents`.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-046-supply-chain-installer`.

`pnpm --filter @ef-harness/sandbox test -- installer`

```
Test Files  1 passed (1)
     Tests  18 passed (18)
Duration  918ms
```

Covers version-age gating under 72 hours, high/critical CVE blocking and explicit waivers, typosquat detection for `expresss`, `1odash`, `loadsh`, `lodash-js`, and `react-domm`, SPDX copyleft/unknown/missing checks, rogue tarball URLs, missing SHA-512 digests, integrity mismatches, compatible semver merge to `^3.23.0`, incompatible major rejection with both task ids and reasons, one lockfile update, unapproved postinstall canary blocking with an exact version pin, `esbuild@0.25.0` not approving `esbuild@0.25.1`, approved-script sandbox denial of a secret file, red-team probe failure, pnpm `--offline` plus read-only `node_modules`, npm `ci --ignore-scripts`, yarn `--immutable --ignore-scripts`, Tier C refusal, worker install refusal, cross-volume store alignment, frozen-lockfile mutation refusal, and single-lane serialization. The suite stubs `fetch` for registry hosts and recorded 0 live registry calls.

`pnpm --filter @ef-harness/sandbox typecheck`

Exit 0. `tsc -b --pretty false` completed with no diagnostics.

`pnpm --filter @ef-harness/sandbox lint`

Exit 0. `eslint .` completed with no diagnostics.

`node scripts/verify-harmony.mjs --task 046`

Exit 0. `harmony ok for Task-046` (schema, diagrams, owned-path scope, repo `typecheck`, `lint`, and `test`).

## Known Limitations / Follow-Ups

The node secret guard patches `fs` and `net` for approved JavaScript install scripts and the red-team probe. A native executable started by an approved script is not stopped by that preload. The job runner port must still be the Task 040 nested job inside the Task 041–043 OS sandbox (Tier A, B, or D) so a native build cannot read `~/.ssh`. This task refuses Tier C and fails the install when the probe exit code is not the denied code `2`.

`pnpm-lock.yaml` v9 entries that omit `tarball` are treated as the configured registry, not as rogue URLs. An explicit non-registry `tarball` or `resolved` URL is rejected. Local `file:` and `link:` records are not required to carry a SHA-512 digest.

Offline detection looks for `<store>/index/<sha512>` or `<store>/v10/<sha512>`. A production adapter can supply the same layout from the real pnpm content-addressable store.
