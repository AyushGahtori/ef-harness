---
task_id: "Task-178"
branch: "task/178-push-pr-ci-repair"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/ship-deploy/src/ci-loop/**"
  - "packages/ship-deploy/tests/ci-loop/**"
  - ".agent-handoffs/task-178.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 178 handoff

Push, graph-generated PR, bounded CI repair loop, five-class triage, and Linux case-sensitivity auto-repair for M6 Ship.

## Exports Provided

- `ShipRunStateMachine` + `createShipRunRecord` — crash-resumable `ship_runs` lifecycle (`PREFLIGHT` → … → `SHIPPED`).
- `PrePushSafetyGate` — mandatory gitleaks + forbidden tracked-path gate before any `git_push` effect.
- `GraphGeneratedPrBuilder` — reviewer-ready PR title/body from graph nodes + landing summary (EF-Effect-Id trailer).
- `FailedCiLogFetcher` — failed-step log slice (~400 lines), ANSI strip + secret redaction.
- `FiveClassCiTriager` — deterministic 5-class CI failure classification aligned with `ci-triage@1`.
- `LinuxCaseSensitivityAutoRepair` — TS2307/case mismatch import repair, CRLF/shebang fixes, two-step `git mv` helper.
- `BoundedCiRepairLoop` — max 3 pushes per fingerprint (≤5 total), zero auto-merge without approval.

Module entry: `packages/ship-deploy/src/ci-loop/index.ts`.

## Shared Wiring Needs (Root / Index Barrels)

- Wire `packages/ship-deploy/src/ci-loop/**` into `packages/ship-deploy/src/index.ts` when Task 001 foundation allows package root edits.
- Connect consumed contracts: `CiTriageV1Schema` (009), `StateDb.ship_runs` (013), `SafetyScanner` (036), `LandingSummaryGenerator` (101), `ExternalEffectLedger` (176), `GitHubAuthConnector` / `ConditionalEtagPoller` (177).

## Dependency Intents (New Packages Requested)

None.

## Contract Change Requests

None.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/ship-deploy typecheck
pnpm --filter @ef-harness/ship-deploy lint
pnpm --filter @ef-harness/ship-deploy test -- ci-loop
node scripts/verify-harmony.mjs --task 178
```

All passed in `task/178-push-pr-ci-repair` on 2026-11-23.

## Known Limitations / Follow-Ups

- `ShipRunStore` ships with `InMemoryShipRunStore` for tests; Task 013 SQLite adapter wiring lands at integration.
- `FailedCiLogFetcher` uses injectable GitHub log source instead of live `gh` CLI until Task 177 connector is wired.
- Pre-push gate accepts injected `SafetyScanner` rather than invoking host `gitleaks` binary directly.