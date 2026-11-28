---
task_id: "Task-161"
branch: "task/161-jsx-source-plugin-point-to-fix"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "packages/planner/src/jsx-source-plugin/**"
  - "packages/planner/tests/jsx-source-plugin/**"
  - "apps/renderer/src/preview/point-to-fix/**"
  - "apps/renderer/tests/preview-point-to-fix/**"
  - ".agent-handoffs/task-161.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 161 handoff

Dev-only JSX `data-ef-source` build plugin (P0.8), App Preview Point-to-Fix picker overlay (hover, click, drag-box gap), grounded `visual-steer@1` routing, and Before/After baseline approval wired to Task 174 visual regression keys. Commit stays on `task/161-jsx-source-plugin-point-to-fix`.

## Exports Provided

**Planner (`packages/planner/src/jsx-source-plugin/index.ts`):**

- `DevOnlyJsxSourceTagPlugin` / `createDevOnlyJsxSourceTagPlugin` — Vite-compatible dev-only transform (zero `data-ef-source` in `production` / `NODE_ENV=production`)
- `transformJsxWithSourceTags`, `countEfSourceOccurrences`, `listInjectedSourceTags`, `EF_SOURCE_ATTR`

**Renderer (`apps/renderer/src/preview/point-to-fix/index.ts`):**

- `PointToFixPickerOverlay` / `createPointToFixPickerOverlay` — pick mode toggle, hover outlines, click + drag-box gap, `Esc` exit, Composer `Element` target binding
- `ElementAndGapContextCapturer` — `captureElement` + `captureGap` (CAS crop refs, role/name/DOM/styles, gap px)
- `VisualSteerRouter` / `createVisualSteerRouter` — workspace-validated `writeScope`, shared-primitive `"Only here vs Everywhere"` guard, brownfield `_debugSource` fallback
- `BeforeAfterBaselineApprover`, `InMemoryVisualBaselineStore`, `verifyCrossViewportAfterFix` — Before ↔ After approval / revert / cross-viewport gate (375 + 1440)
- `validatePickResultMessage`, `validateEfSourceInWorkspace`, `POINT_TO_FIX_PICKER_INJECTION_SCRIPT`

## Shared Wiring Needs (Root / Index Barrels)

Frozen on this branch — integration should re-export:

```ts
// packages/planner/src/index.ts
export {
  DevOnlyJsxSourceTagPlugin,
  createDevOnlyJsxSourceTagPlugin,
  transformJsxWithSourceTags,
  EF_SOURCE_ATTR,
} from "./jsx-source-plugin/index.js";
```

```ts
// apps/renderer/src/index.ts
export {
  BeforeAfterBaselineApprover,
  DevOnlyJsxSourceTagPlugin,
  ElementAndGapContextCapturer,
  PointToFixPickerOverlay,
  VisualSteerRouter,
  createPointToFixPickerOverlay,
  createVisualSteerRouter,
} from "./preview/point-to-fix/index.js";
```

`Task 160` `IsolatedPreviewWebviewHost` should mount picker toolbar + inject `POINT_TO_FIX_PICKER_INJECTION_SCRIPT` via narrow `postMessage`. `Task 155` should consume `bindComposerElementTarget` for the `Element` pill. `Task 093` Phase 0 `P0.8` wires `createDevOnlyJsxSourceTagPlugin({ mode })` into target UI Vite configs.

## Dependency Intents (New Packages Requested)

None. No `package.json`, lockfile, or foundation file edits.

## Contract Change Requests

None. Local `VisualSteerV1Output` mirrors `VisualSteerV1Schema` from Task 009 for tests until `shared-contracts` on integration includes that export on this base.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-161-jsx-source-plugin-point-to-fix` (run after `pnpm install`):

- `pnpm --filter @ef-harness/planner typecheck` — pass (expected exit 0)
- `pnpm --filter @ef-harness/planner lint` — pass (expected exit 0)
- `pnpm --filter @ef-harness/planner test -- jsx-source-plugin` — pass (dev tags, prod zero bytes, Vite plugin inert in production)
- `pnpm --filter @ef-harness/renderer typecheck` — pass (expected exit 0)
- `pnpm --filter @ef-harness/renderer lint` — pass (expected exit 0)
- `pnpm --filter @ef-harness/renderer test -- preview-point-to-fix` — pass (picker, visual-steer router, baseline approver)
- `node scripts/verify-harmony.mjs --task 161` — pass (`harmony ok for Task-161`)

## Known Limitations / Follow-Ups

- Vite is not a direct dependency on this foundation base; the plugin exposes a Vite-compatible `transform` hook. Task 093 adds it to real target-project Vite configs.
- Screenshot crops use synthetic CAS PNG refs in unit tests; Task 160 webview should supply real cropped bitmaps via `CasBlobStore` (Task 028).
- `Task 167` code-index lookup is stubbed via React Fiber `_debugSource` string fallback when `data-ef-source` is absent.