---
task_id: "Task-174"
branch: "task/174-ui-consistency-pipeline"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/integrator/src/ui-checks/**"
  - "packages/integrator/tests/ui-checks/**"
  - ".agent-handoffs/task-174.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 174 handoff

Complete six-stage UI consistency verification for parallel frontend workers: token lint, duplicate primitives, Playwright geometry ports, axe gate, cross-screen rhythm, and approved screenshot regression. Commit stays on `task/174-ui-consistency-pipeline`.

Import from `packages/integrator/src/ui-checks/index.ts` until the package barrel is wired.

## Exports Provided

Required by Task 096, Task 101, Task 161, and Task 175:

- `UiConsistencyPipeline` — runs stages 1–6, skips cleanly with `not_applicable_no_ui` for CLI/API projects, optionally hands captured screenshots to advisory taste review when budget allows
- `DuplicateComponentDetector` — normalized JSX + prop-signature similarity (`>= 0.80`) against `src/components/ui/*`
- `ThreeWidthLayoutAndTapTargetChecker` — `375`/`768`/`1440` audits, light + dark when enabled, overflow/tap-target/overlap/broken-image invariants
- `CrossScreenRhythmAuditor` — deterministic cross-screen header/typography/card/button rhythm outliers
- `ApprovedScreenshotRegressionRunner` — approved-baseline-only `toHaveScreenshot` with Windows-tuned `maxDiffPixelRatio <= 0.005` and `threshold 0.15`, dynamic mask support, CAS artifact packaging via `InMemoryCasStore`
- Local consumed ports: `LocalDesignTokenLint` (Task 094), `LocalBrandAssetRegistry` (Task 099), `LocalStaticAuditGate` (Task 054), `MemoryBeforeAfterBaseline` (Task 161), `LocalTasteReviewer` (Task 102)

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `packages/integrator/src/index.ts` on this branch. When integration wires the barrel, re-export the ui-checks module from `./ui-checks/index.js`.

## Dependency Intents (New Packages Requested)

None. Playwright/axe integrations stay behind injected audit payloads until Task 057/094 production packages are merged.

## Contract Change Requests

None.

## Exact Verification Commands & Results

- `pnpm install --frozen-lockfile --prefer-offline` (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` when needed)
- `pnpm --filter @ef-harness/integrator typecheck` — pass
- `pnpm --filter @ef-harness/integrator lint` — pass
- `pnpm --filter @ef-harness/integrator test -- ui-checks` — pass
- `node scripts/verify-harmony.mjs --task 174` — pass

## Known Limitations / Follow-Ups

Browser stages accept deterministic `RenderedRouteAudit`/`RasterFrame` inputs in tests; merge Task 057/094/161 adapters to drive live Playwright runs in integration.