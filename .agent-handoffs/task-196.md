---
task_id: "Task-196"
branch: "task/196-windows-packaging-nsis"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "scripts/packaging/**"
  - "apps/desktop/build/**"
  - "tests/e2e/packaging/**"
  - ".agent-handoffs/task-196.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 196 handoff

Windows NSIS `electron-builder` packaging config, unsigned-dev staging pipeline, bundled binary integrity manifest, ASAR audit, CycloneDX SBOM export, and `CleanMachineWinSmokeSuite` for stripped-`PATH` clean-profile smoke on Windows 10/11. Commit stays on `task/196-windows-packaging-nsis`.

## Exports Provided

Build & audit CLI:

- `node scripts/packaging/build-win-nsis.mjs` — flags `--unsigned-dev` (default), `--release` (fails closed without signing env), `--dir` (skip NSIS artifact), `--output <dir>`.
- `node scripts/packaging/audit-asar.mjs` — optional `--target <win-unpacked|app.asar>`.

Modules:

- `scripts/packaging/lib/integrity-manifest.mjs` — `BundledBinaryIntegrityManifest`: `writeIntegrityManifest`, `verifyIntegrityManifest`, `verifyBundledBinaryIntegrity`, `BUNDLED_INTEGRITY_KEY_ID`, `MissingCodeSigningCredentialsError`.
- `scripts/packaging/lib/staging.mjs` — `stageWindowsPackage` (lean `win-unpacked`, `resources/bin` MinGit + gitleaks + harnessd stubs, WASM, 87-question corpus meta, 20 skill files, office atlas, policy fixture, `app.asar`, `latest.yml` when installer is emitted).
- `scripts/packaging/lib/signing.mjs` — `assertReleaseSigningCredentials`, `signPeFiles` (`signtool` + RFC 3161 timestamp when `EF_CODE_SIGNING_CERT_THUMBPRINT` is set; `EF_PACKAGING_SIGNING_FIXTURE=1` writes fixture stamp files for offline CI).
- `scripts/packaging/lib/asar-audit.mjs` — `auditAsarFile`, `resolveAsarPath`.
- `scripts/packaging/lib/sbom.mjs` — `writeSbomAndChecksums` → `sbom.cdx.json`, `SHA256SUMS.txt`.

E2E:

- `tests/e2e/packaging/CleanMachineWinSmokeSuite.mjs` — stripped `PATH`, `%LOCALAPPDATA%` profile under `Temp Test Üser`, MinGit `init`/`status`, 100% integrity, DPAPI round-trip (Windows), cold launch < 4s on packaged launch stub, zero surviving `EF Harness` / `harnessd` PIDs after quit.
- `tests/e2e/packaging/packaging.vitest.ts` — vitest config for packaging tests.

Production config:

- `apps/desktop/build/electron-builder.yml` — per-user NSIS (`oneClick: false`, `perMachine: false`, `allowElevation: false`), `appId` `com.efharness.desktop`, toast AUMID metadata, `latest.yml` / blockmap hooks for Task 132.
- `apps/desktop/build/nsis/uninstall-preserve-repos.nsh` — unconditional repo preservation; opt-in AppData cache wipe.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit frozen barrels in this task. Integrators should:

- Call `verifyBundledBinaryIntegrity(resourcesRoot)` at `harnessd` startup (wire to Task 132 `AvQuarantineIntegrityChecker` repair card on failure).
- Point release CI at `apps/desktop/build/electron-builder.yml` when running real `electron-builder` (this task stages unsigned-dev output without invoking full Electron compile on the foundation base).
- Map `ParkFirstAutoUpdater` feed to packaged `latest.yml` + NSIS artifact from this pipeline (Task 132).
- Re-export packaging CLIs from Task 200 release certification scripts if desired (`verify:packaging`).

Request `tests/e2e/vitest.config.ts` include glob `packaging/**/*.test.mjs` during integration so `pnpm --filter @ef-harness/e2e test -- packaging` matches acceptance without `exec vitest --config`.

## Dependency Intents (New Packages Requested)

None. `@electron/asar` is resolved via `scripts/packaging/lib/asar-runtime.mjs` from the existing `electron-builder` transitive install (`.pnpm/@electron+asar@3.4.1`); no root `package.json` edit.

## Contract Change Requests

Un-ignore packaged desktop build assets in root `.gitignore` (frozen in Task 001): add `!apps/desktop/build/` (and keep ignoring `apps/desktop/build/dist/`) so `electron-builder.yml`, NSIS includes, and packaging fixtures track in git without `git add -f`. This task force-adds those paths for the commit-only branch.

Integrity manifest envelope (for Task 132 / harnessd):

- `{ manifest, signature }` where `signature` is Ed25519 over `canonicalJson(manifest)` (see `scripts/packaging/lib/canonical-json.mjs`).
- `manifest.keyId` must equal `ef-harness-integrity-2026`.
- `manifest.files[]` entries: `{ path, sha256, sizeBytes }` relative to `resources/`.
- Unsigned-dev builds also emit `integrity-manifest.meta.json` with `publicKeyBase64` for verification without a release pin.

Release Authenticode (CI only, never in repo):

- `EF_CODE_SIGNING_CERT_THUMBPRINT` or `AZURE_TRUSTED_SIGNING_ACCOUNT` or `WINDOWS_SIGNING_CERTIFICATE_FILE` required for `--release`.
- `EF_INTEGRITY_MANIFEST_SIGNING_KEY_PEM` for release manifest signing (optional; unsigned-dev generates ephemeral keys).

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-196-windows-packaging-nsis`:

- `node scripts/packaging/build-win-nsis.mjs --unsigned-dev` — pass (JSON `ok:true`, `unpackedBytes` ~46 500, installer stub when `--dir` omitted, exit 0).
- `node scripts/packaging/build-win-nsis.mjs --unsigned-dev --dir` — pass (lean `win-unpacked` < 180 MB, `integrity-manifest.json`, `sbom.cdx.json`, `SHA256SUMS.txt`, exit 0).
- `node scripts/packaging/audit-asar.mjs` — pass (`audit-asar ok`, 0 forbidden `.env`/test/dev-only paths, exit 0).
- `node scripts/packaging/build-win-nsis.mjs --release --dir` — pass fail-closed (exit 2, `MissingCodeSigningCredentialsError` when signing env absent).
- `pnpm --filter @ef-harness/e2e exec vitest run --config packaging/packaging.vitest.ts` — pass (Vitest v5.1.1, 2 files, 5 tests, exit 0, ~4s).
- `pnpm --filter @ef-harness/desktop typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/desktop lint` — pass (`eslint .`, exit 0).
- `pnpm --filter @ef-harness/e2e typecheck` — pass (`tsc -b`, exit 0).
- `pnpm --filter @ef-harness/e2e lint` — pass after removing unused imports (`eslint .`, exit 0).
- `node scripts/verify-harmony.mjs --task 196` — pass (pending commit with handoff `ready_for_integration`).

## Known Limitations / Follow-Ups

- **Not a live signed NSIS / Authenticode smoke:** Unsigned-dev uses staged fixtures (`apps/desktop/build/fixtures/**`), `ef-harness-launch.mjs` launch stub, MinGit `git.cmd`, and optional `EF_PACKAGING_SIGNING_FIXTURE=1` signing stamps. A live release smoke still needs EV/Trusted Signing credentials, real `electron-builder` compile of Tasks 067/131, bundled production `harnessd`, and a clean VM install of the signed `.exe`.
- **Sibling branches not on this base:** Task 131 tray/lifecycle, Task 132 `ParkFirstAutoUpdater` + component downloader, Task 035 MinGit, Task 036 gitleaks, Task 162 office art, Task 167 Tree-Sitter grammars, Task 133 self-check UI are wired via local ports below; swap at integration without importing unpublished packages.
  - `local-port:task-131` — replace `harnessd-launch.mjs` stub with detached `harnessd` spawn from `DaemonShutdownCoordinator`.
  - `local-port:task-132` — feed `latest.yml` / blockmap from release `build-win-nsis.mjs --release`; map integrity failures to `AvQuarantineIntegrityChecker`.
  - `local-port:task-035` — replace `mingit/cmd/git.cmd` with pinned Portable MinGit x64 binaries.
  - `local-port:task-036` — replace `gitleaks.exe` fixture with pinned release binary.
  - `local-port:task-167` — replace WASM stubs with pinned `web-tree-sitter` grammar WASM set.
  - `local-port:task-162` — replace `office/atlas.json` stub with 16px Aseprite atlas assets.
  - `local-port:task-103-104` — replace skill/corpus stubs with vetted corpus pack from `corpus/`.
- `pnpm --filter @ef-harness/e2e test -- packaging` returns no files until root vitest include wiring (see Shared Wiring).
- Installer budget enforcement uses staged artifact size (< 180 MB); full Electron production builds need the same check on the real NSIS `.exe` in release CI.