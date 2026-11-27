# Pass 02 — Chunk 001: Git Engine, Windows Sandbox, Loopback Proxy, Installer, and Harness Run (`Tasks 035–047`)

## 1. Chunk identification and scope
- **Pass number:** Pass 02
- **Chunk ID:** `pass-02/chunk-001`
- **Unit IDs:** `Tasks 035–039` (`packages/git-engine`), `Tasks 040–047` (`packages/sandbox`)
- **Branches and commits:**
  - `task/035-mingit-wrapper-folder-states` (`33895fd`), `task/036-git-safety-scanner` (`5872b0a`), `task/037-temp-index-snapshots` (`fe092d2`), `task/038-worktree-slot-manager` (`04aa278`), `task/039-branch-ref-leases-cas` (`68c4d3f`)
  - `task/040-windows-job-objects` (`ddcffc7`), `task/041-sandbox-tier-a-mxc` (`bca08dd`), `task/042-sandbox-tier-b-users` (`1b8a413`), `task/043-sandbox-tier-c-d-selector` (`4337b83`), `task/044-loopback-allowlist-proxy` (`d534d12`), `task/045-secure-doc-fetcher` (`d26eee9`), `task/046-supply-chain-installer` (`b27a210`), `task/047-harness-run-engine` (`c559222`)
- **Worktree paths:** `C:/Users/Ayush/Desktop/ef-wt/integration/packages/git-engine`, `C:/Users/Ayush/Desktop/ef-wt/integration/packages/sandbox`
- **Governing architecture documents:** `git-and-workspace-isolation.md`, `security-and-governance.md`, `verification-and-runtime.md`, `architecture-deep-review.md`, `schema/state.sql`, `IMPLEMENTATION_TASKS.md` (`Tasks 035–047`).

## 2. Units inspected
- All 13 units `Task 035` through `Task 047`.

## 3. Files inspected
- `packages/git-engine/package.json`, `packages/git-engine/src/index.ts`
- `packages/git-engine/src/runner/{git-runner.ts,resolve-git.ts}`, `packages/git-engine/src/safety-scan/safety-scanner.ts`, `packages/git-engine/src/snapshots/temp-index-snapshotter.ts`, `packages/git-engine/src/worktrees/worktree-slot-manager.ts`, `packages/git-engine/src/refs/ref-lease-manager.ts`
- `packages/sandbox/package.json`, `packages/sandbox/src/index.ts`
- `packages/sandbox/src/job-objects/windows-job-manager.ts`, `packages/sandbox/src/tier-a-mxc/tier-a-launcher.ts`, `packages/sandbox/src/tier-b-users/tier-b-launcher.ts`, `packages/sandbox/src/tier-c-d-selector/tier-selector.ts`
- `packages/sandbox/src/proxy/allowlist-proxy-server.ts`, `packages/sandbox/src/doc-fetcher/secure-doc-fetcher.ts`, `packages/sandbox/src/installer/kernel-package-installer.ts`, `packages/sandbox/src/harness-run/{engine.ts,warm-pool.ts,ports.ts}`

## 4. Architecture documents consulted
- `git-and-workspace-isolation.md` (bundled MinGit with dev PATH fallback, temp-index candidate snapshots, worktree slots, CAS ref leases via `leases` table in `state.db`)
- `security-and-governance.md` (Windows Job Objects, Tier A MXC, Tier B restricted worker accounts, Tier C Restricted Token + WFP/ACL, Tier D explicit approval, loopback allowlist proxy, supply-chain `--frozen-lockfile --ignore-scripts`)

## 5. Contracts and signatures discovered
- `MinGitRunner.run(args, options)` (`035`), `GitSafetyScanner` (`036`), `TempIndexSnapshotter` (`037`), `WorktreeSlotManager` (`038`), `RefLeaseManager` (`039`)
- `WindowsJobManager` (`040`), `TierAMxcSandbox` (`041`), `TierBUserSandbox` (`042`), `SandboxTierSelector` (`043`)
- `AllowlistProxyServer` (`044`: starts HTTP CONNECT/GET proxy on `127.0.0.1:<port>`), `SecureDocFetcher` (`045`: expects `proxy.fetch(req)`), `KernelPackageInstaller.install(...)` (`046`), `HarnessRunEngine.run(...)` (`047`)

## 6. Confirmed findings
- **F-017** — `packages/git-engine` `resolveGitBinary` (`035`) lacks system `git` `PATH` fallback on developer workstations without bundled `resources/mingit`, 5 submodules (`035–039`) define incompatible `GitRunner` interfaces, and `RefLeaseManager` (`039`) executes rogue `CREATE TABLE IF NOT EXISTS ref_leases` instead of using `leases` in `schema/state.sql`.
- **F-018** (**CRITICAL**) — `HarnessRunEngine` (`047`) defaults to unsandboxed `NestedCommandJobManager` + `WarmExecutionPool` (`child_process.spawn` directly as the logged-in user with ambient network) while reporting `tier: "C"`, leaks `WarmExecutionPool` slots when `jobManager` throws before `try/finally`, and defines incompatible `WindowsJobManager` / `SandboxTierSelector` ports vs `040–043`.
- **F-019** — `SecureDocFetcher` (`045`) expects `AllowlistProxyPort.fetch(request)` whereas `AllowlistProxyServer` (`044`) is a real loopback HTTP proxy (`127.0.0.1:<port>`) without a `.fetch()` method.
- **F-020** — `KernelPackageInstaller` (`046`) text-splices a partial `importers:` stub onto `pnpm-lock.yaml` and immediately runs `pnpm install --frozen-lockfile`, guaranteeing `--frozen-lockfile` failure whenever a package is added.

## 7. Unverified findings
- None (`0` unverified).

## 8. Producer-consumer relationships
- `git-engine` (`035–039`) → consumed by `mcp-server` (`048`), `verifier` (`060, 066`), `integrator` (`096, 110, 111, 129, 172`), `portability` (`186–187`).
- `sandbox` (`040–047`) → consumed by `mcp-server` (`048`), `verifier` (`060`), `research-engine` (`082`), `planner` (`093`), `intake` (`097`), `runtime-adapters` (`142–149`).

## 9. Defects and missing integrations
- Intra-package port disconnects inside `git-engine` (`035–039`) and `sandbox` (`040–047`).
- Unsandboxed default execution path in `HarnessRunEngine` (`047`).

## 10. Tests and verification performed
- Inspected `engine.ts`, `warm-pool.ts`, `ports.ts` (`047`), `secure-doc-fetcher.ts` (`045`), `allowlist-proxy-server.ts` (`044`), and `kernel-package-installer.ts` (`046`) line-by-line.

## 11. Unresolved questions
- None in this chunk.

## 12. Explicit files and relationships still requiring inspection
- `research-engine` (`082`) consumption of `SecureDocFetcher` (`045`), `planner/phase0` (`093`) consumption of `KernelPackageInstaller` (`046`), `intake` (`097`) sandbox runner, and `runtime-adapters` (`142+`) sandbox launching.
