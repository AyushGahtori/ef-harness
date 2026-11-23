---
task_id: "Task-159"
branch: "task/159-spec-browser-plan-tree-tabs"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/canvas/tabs/**"
  - "apps/renderer/tests/canvas-tabs/**"
  - ".agent-handoffs/task-159.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 159 handoff

Spec Browser, 12-matrix coverage explorer, medium-risk proposal review, Plan Tree & Preview, and virtualized Runtime Tasks tabs on `task/159-spec-browser-plan-tree-tabs`. Local ports stand in for Tasks 073, 079, 080, 084, 108, and 126 until integration.

## Exports Provided

For Task 122–123 (center tab mounts), Task 126 (row click → Worker Inspector):

- `SpecBrowserTab` — searchable outline from canonical `state.db` (overview, Chosen for you, features/EARS/contracts/screens+SVG wireframes/seams/research, X-01..X-14), provenance pills, cross-links to Canvas and VS Code, conflict strip, markdown copy.
- `MatrixCoverageExplorer` — collapsed universal rules + exceptions across 12 matrices; optional virtualized raw-cell expansion.
- `MediumRiskProposalReviewPanel` — grouped Approve/Edit/Reject and Approve-all-in-feature with atomic `LocalProposedRequirementReviewQueue` + `EarsOracleValidator`.
- `PlanTreeAndPreviewTab` — Planned Now vs Projected Later, preset switcher (`LocalInteractivePlanEditor`), Start Build gating on conflicts/must-ask, Chosen-for-you ledger links.
- `RuntimeTasksTableTab` — sortable/filterable virtualized table (500+ rows); row click opens `LocalWorkerInspector`.
- `CrossTabSelectionContext` — selection preserved across canvas/spec/plan/board/vscode.
- `CanonicalStateDb` — read models for outline, matrices, plan, runtime, and review settlement on in-memory canonical schema.
- Supporting: `renderConflictStrip`, `featureSpecMarkdown`, `LocalLowFiWireframeRenderer`, plan pricing (`pricePlan`), format/html/types, and theme contrast helpers.

## Shared Wiring Needs (Root / Index Barrels)

Do **not** edit `apps/renderer/src/index.ts` on this branch. Integration should export from `apps/renderer/src/canvas/tabs/index.js` and mount tabs on Task 122 `CenterWorkspaceTabs` **Spec / Plan** and related workspace slots.

## Dependency Intents (New Packages Requested)

None. Renderer uses existing `@ef-harness/shared-contracts` for canonical `stateSql` asset path only.

## Contract Change Requests

None on this branch; consumes foundation `state.db` via local `CanonicalStateDb` for tests and HTML render surfaces.

## Exact Verification Commands & Results

```text
pnpm --filter @ef-harness/renderer test -- canvas-tabs
# exit 0 (10 tests)

pnpm --filter @ef-harness/renderer typecheck
# exit 0

pnpm --filter @ef-harness/renderer lint
# exit 0

node scripts/verify-harmony.mjs --task 159
# exit 0
```

## Known Limitations / Follow-Ups

- Replace local ports (`LocalChosenForYouOverride`, `LocalWorkerInspector`, `LocalVsCodeOpener`, `LocalStartBuild`, etc.) with Task 073/080/084/108/126 production adapters at integration.
- Tab UI is HTML string surfaces for Vitest/RTL; React shell wiring is Task 122 follow-up.