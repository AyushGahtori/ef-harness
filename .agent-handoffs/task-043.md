---
task_id: "Task-043"
branch: "task/043-sandbox-tier-c-d-selector"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/sandbox/src/tier-c-d-selector/**"
  - "packages/sandbox/tests/tier-c-d-selector/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 043 handoff

Tier C write-restricted tokens, the optional Tier D container builder, the Tier E stub, and `SandboxTierSelector` live under `packages/sandbox/src/tier-c-d-selector/`. This branch never merges.

## Exports Provided

- `TierCRestrictedTokenProvider` — unelevated `CreateRestrictedToken` (`WRITE_RESTRICTED | DISABLE_MAX_PRIVILEGE | LUA_TOKEN`) with a synthetic capability SID, logon SID, and Everyone. Grants that capability SID modify on the empty attempt worktree and temp dir, and deny-write on `.git` and `node_modules`. Advisory `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, and a failing `GIT_SSH_COMMAND`. Capabilities are frozen as `{ fileWritesEnforced: true, secretReadsDenied: false, networkEnforced: false, badge: "weaker_sandbox_yellow" }`. `spawnWrappedProcess` throws `WrappedModeForbiddenOnTierCError`.
- `isTaskEligibleForTierC(taskSpec, runtime)` — allows Tier C only when the task needs no external network and does not run third-party code beyond locked dependencies. Hard-blocks dependency installs, untrusted dev servers, network, and untrusted package runners.
- `TierDContainerProvider` — probes `docker info` (3s bound) and `wsl.exe --status`. Container args always include `--cap-drop ALL`, `--security-opt no-new-privileges`, `--network none` or an `ef-proxy-*` sidecar, `--pids-limit`, `--memory`, `--cpus`, `--user`, scrubbed `-e` allowlist, read-only `.git` and package-store mounts, `core.autocrlf=false`, and labels `ef-harness.managed=true`, `ef-harness.project=<id>`, `ef-harness.attempt=<id>`. `reconcileManagedContainers` removes those labeled containers. `buildTierDContainerArgs` and `linuxParityShell` cover CI case, line-ending, path-separator, and native-package reproduction.
- `adviseWslMemory` / `reportWslMemory` — report Tier D VM memory to a `HardwareGovernorSink` and recommend a `.wslconfig` cap. Read-only. `editedWslConfig` is always `false`.
- `SandboxTierSelector` — startup probe preference `A → B → D → C`, or pinned Tier D. Per-task eligibility. Holds with `reason: "sandbox_tier_insufficient"` and offers "Set up Tier B (one-time admin)", "Install Docker (Tier D)", and "Run unsandboxed for this project (red warning)". Never executes unsandboxed unless `runUnsandboxed` is explicitly on, in which case every new task card and `VerificationReceipt` gets `sandboxTier: "UNSANDBOXED"` and `redBannerWarning: true`. Turning the opt-in off affects the next command only. Foreign agents on Tier C are forced to `mode: "stripped"`; `mode: "wrapped"` throws `WrappedModeForbiddenOnTierCError`. Receipts record `tier` and `mode` (`own_loop | wrapped | stripped`).
- `RemoteExecutionProvider` and `UnimplementedRemoteExecutionProvider` — Tier E git transfer, secret-free directive, runner-enforced network policy, and `usd` ledger. Every method throws `TierENotInV1Error`. `SandboxTierSelector` does not import this module.
- Supporting types: `SandboxTierProvider`, `SandboxLaunchSpec`, `WindowsJobManager`, `VerificationReceipt`, `TaskHold`, `TIER_C_CAPABILITIES`, `TIER_PREFERENCE`.

## Shared Wiring Needs (Root / Index Barrels)

Re-export the public API from `packages/sandbox/src/index.ts` when this branch is integrated. This task does not edit that barrel (it is outside the owned subtree). Consumers (`Task 047`, `Task 119`, `Task 142–151`, `Task 178`) should import from `@ef-harness/sandbox` after that wiring, or from `packages/sandbox/src/tier-c-d-selector/index.ts` until then.

No root manifest, workspace, or `packages/shared-contracts/src/index.ts` edit.

## Dependency Intents (New Packages Requested)

None. Windows token and ACL work goes through an in-repo PowerShell broker (`tier-c-broker.ps1`) and Node's built-in `child_process`. Docker and WSL are probed as external CLIs.

## Contract Change Requests

`SandboxTierProvider`, `SandboxLaunchSpec`, and `WindowsJobManager` are declared in this subtree so the selector compiles before Tasks 040–042 are integrated. At integration, keep a single definition. The local shapes are the structural contract this task consumes: `probe`, `acquireWarmInstance`, `executeCommand`, `spawnWrappedProcess`, `disposeInstance`, and honest capability flags. If Task 041's exported interface differs, adapt the selector in a follow-up rather than silently widening Tier C's flags.

## Exact Verification Commands & Results

Ran from `C:\Users\Ayush\Desktop\ef-wt\task-043-sandbox-tier-c-d-selector`:

- `pnpm --filter @ef-harness/sandbox test -- tier-c-d-selector` — pass, 6 files, 29 tests (eligibility matrix, selector hold/opt-in/wrapped/UNC/pin, Tier D args and daemon probe, live Tier C write restriction on Windows, Tier E stub, WSL advice).
- `pnpm --filter @ef-harness/sandbox typecheck` — pass.
- `pnpm --filter @ef-harness/sandbox lint` — pass.
- `node scripts/verify-harmony.mjs --task 043` — pass (`harmony ok for Task-043`).

## Known Limitations / Follow-Ups

- The restricting SID list includes the logon SID and Everyone so a console process can finish DLL init (`0xC0000142` otherwise). The synthetic capability SID is the only SID granted write on the attempt worktree and temp directory. `.git` and `node_modules` get an inheritable deny-write ACE for that SID. An object that already grants Everyone or the logon SID write access can still pass the write-restricted check. The live test shows a normal user directory outside the worktree is denied, while a read of that directory still succeeds.
- ACL grants run only on an empty worktree and temp directory. A later checkout inherits them. Re-prepare is skipped when `.ef-harness-tierc.json` is already present.
- Tier D selection requires a running Docker daemon so `--cap-drop ALL`, `--network none`, and the mount allowlist are real. WSL2 is probed and its memory is reported; raw WSL is not treated as an enforcing sandbox because the distro can see host `/mnt` drives. `.wslconfig` is never written.
- The optional live Docker test runs only when `docker info` succeeds and a local `node`, `alpine`, `debian`, `ubuntu`, or `busybox` image is already present. It does not pull an image.
- `tier-c-broker.ps1` is loaded from the source directory via `import.meta.url`. A published `dist/` build needs that script copied beside the compiled broker.
- Tier C processes are launched on `WinSta0\Default`. A private desktop is not created here.
- Tier E has no local pool calls and no v1 implementation.
