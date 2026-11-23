---
task_id: "Task-187"
branch: "task/187-rehydrate-zip-lease"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - packages/portability/src/rehydration/**
  - packages/portability/tests/rehydration/**
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 187 handoff

## Exports Provided

- `packages/portability/src/rehydration/index.ts` public barrel for Task 187.
- `OrphanBranchRehydrator` — lossless `refs/heads/harness-state` → SQLite rebuild + canonical hash verification.
- `PortableZipArchiveManager` — offline `.ef-project.zip` export/import with manifest SHA-256 checks.
- `CrossDeviceLeaseManager` — `lease.yaml` open-mode evaluation, non-FF takeover helper, stale epoch fencing.
- `LostKeyOracleRegenerator` — lost `age` key path with oracle regeneration hook.
- `AgeSealedChecksDecryptor`, `ensureDeviceId`, `assertHarnessStatePushAllowed`.

## Shared Wiring Needs (Root / Index Barrels)

- Wire `packages/portability/src/index.ts` to re-export `./rehydration/index.js` after integration.
- Add `package.json` exports subpath `./rehydration` for downstream Tasks `130`, `176`, and `186` round-trip.

## Dependency Intents (New Packages Requested)

- None (uses root `age-encryption` via `createRequire` like Task 186 exporter pattern).

## Contract Change Requests

- Request integrator add `"./rehydration"` export map entry on `@ef-harness/portability`.

## Exact Verification Commands & Results

- `pnpm --filter @ef-harness/portability typecheck` — pass
- `pnpm --filter @ef-harness/portability lint` — pass
- `pnpm --filter @ef-harness/portability test -- rehydration` — 7/7 pass (bare-remote two-laptop simulation, zip round-trip, lost-key card, force-with-lease guard)
- `node schema/schema-test.js` — 67/67 pass
- `node scripts/verify-harmony.mjs --task 187 --require-ready` — pass (after `pnpm test` completes)

## Local Port Wiring (Sibling Branches Off Base)

- Two-device tests use ephemeral bare Git remotes under the OS temp directory (no fixed ports).
- Task 186 exporter is not on base `6497730`; fixture seeding writes `harness-state` via normal Git commits compatible with Task 186 YAML layout.

## Known Limitations / Follow-Ups

- Full `state.sql` replay is intentionally narrowed to a rehydration-focused subset with FTS5 parity hooks; integrator Tasks `013`/`018`/`019`/`027` can widen DDL fidelity.
- `pushTakeover` expects caller-configured Git remotes; two-device tests use bare remote on local disk with explicit `--force-with-lease` ref.