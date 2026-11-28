---
task_id: "Task-154"
branch: "task/154-canvas-popovers-multiselection"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/canvas/popovers/**"
  - "apps/renderer/tests/canvas-popovers/**"
  - ".agent-handoffs/task-154.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 154 handoff

Canvas multi-box selection, all 14 node-type popovers, the quick-action toolbar, and post-send change highlights. Commit stays on `task/154-canvas-popovers-multiselection`.

## Exports Provided

Import from `apps/renderer/src/canvas/popovers/index.ts` (the renderer package barrel is outside this owned subtree):

- `MultiBoxSelectionController` — single click, additive `Shift+Click` / `Ctrl+Click`, and marquee selection. Publishes `nodeIds` and `nodeRevisions` through `ComposerTargetPort.syncBoxSelection`. One plain click opens one popover. Two or more boxes close the popover.
- `NodeTypePopoverRegistry` — tailored popovers for the 14 canonical types (`project`, `decision`, `requirement`, `feature`, `entity`, `contract`, `screen_spec`, `cross_cutting_rule`, `seam`, `research_fact`, `task`, `check`, `conflict`, `brand_asset`). Aliases: `scope` to project, `api_endpoint` to contract, `oracle` to check, `brownfield_module` to the brand-asset card with module fields. `resolve` throws `UnknownCanvasNodeTypeError` instead of dumping JSON.
- `CanvasQuickActionToolbar` — `Ask about selection`, `Change`, `Correct (misheard)`, `Add child`, `Remove / Defer`, `Explain impact` (0 tokens), `Focus connected` on one box and on selections of 2–11, plus `Clear`. At 12 or more boxes the toolbar narrows to `Ask about selection`, `Change`, `Explain combined impact`, `Clear`.
- `PostSendChangeHighlighter` — 8 seconds (`HIGHLIGHT_MS`). `+ New` (green pulse), `Updated` (violet pulse), `Re-checking` (amber outline), `Removed / Deferred` (strike, opacity fades across the 8 seconds). Recap is `N boxes updated · N added · N held — View changes`. Off-screen updates use `N updated (N off-screen) — Jump to {label}`.
- `CanvasPopoverHost` / `createCanvasPopoverHost` — wires the four exports to the local ports. `placePopover` clamps the 320×360 popover inside the canvas viewport. `reduceEscape` closes the popover and keeps the selection; a second Esc clears it and returns focus to the anchor node.
- `runAxeCoreAudit` — local stand-in for axe-core (button name, link name, label, image alt, duplicate id, nested interactive, contrast below 4.5:1, negative tabindex, target under 24px, dialog name).

`popoverOmitsSealedSource` is the check that a sealed oracle's `sealedSource` string is absent from the popover model.

## Shared Wiring Needs (Root / Index Barrels)

`apps/renderer/src/index.ts` is frozen on this branch. Integration should add:

```ts
export {
  CanvasPopoverHost,
  CanvasQuickActionToolbar,
  MultiBoxSelectionController,
  NodeTypePopoverRegistry,
  PostSendChangeHighlighter,
  createCanvasPopoverHost,
} from "./canvas/popovers/index.js";
```

Do not re-export the local port classes (`LocalCanvasSelectionContext`, `LocalInteractiveArchitectureCanvas`, `LocalComposerTargetStateMachine`, `LocalBoxChatIntentController`, `LocalInspectorShell`, `LocalSiblingActionBus`, `LocalMotionPreference`, `MemoryCanvasNodeCatalog`, `ManualClock`) from the package barrel. Those names belong to sibling tasks. Keep the method names below and swap the constructors.

No root `package.json` script changes. No `packages/*/src/index.ts` re-exports.

Task 122 inspector slot: register `inspector["canvas-node"]` with `ownerTask: "Task 154"`. `LocalInspectorShell.pin` records `{ kind: "canvas-node", id, title, ownerTask: "Task 154" }` plus the expanded popover text. The shell slot's `render` should show that body inside `CollapsibleInspectorShell`.

## Dependency Intents (New Packages Requested)

None added on this branch. `apps/renderer/package.json` and `pnpm-lock.yaml` are frozen.

- `react` and `react-dom` are not dependencies of `@ef-harness/renderer` here. Popovers are a typed `VNode` tree (`h` in `a11y.ts`). When React is installed, map `h()` to `createElement` and pass `host.render()` into Task 153's canvas overlay and Task 122's inspector slot.
- `axe-core` is not in the lockfile. Swap the body of `runAxeCoreAudit` to `axe.run` on the mounted popover. Do not add either dependency on this branch.

## Contract Change Requests

None. No `schema/` edits.

Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. Local ports live under `apps/renderer/src/canvas/popovers/`. Replace the adapter, not the popover copy.

| Local port | Swap to | Call to keep |
|---|---|---|
| `MemoryCanvasNodeCatalog.get/list/archive` | Task 153 `InteractiveArchitectureCanvas` node projection from Task 017 `state.db` | `get` returns null after archive. The open popover then shows `This item was archived/removed`. |
| `LocalCanvasSelectionContext.write/read/subscribe` | Task 153 `CanvasSelectionContext` | `write(nodeIds)` on every gesture. |
| `LocalInteractiveArchitectureCanvas.panZoomTo` | Task 153 `InteractiveArchitectureCanvas` | `{ nodeId, x, y, zoom }` with zoom `1.2`. |
| `LocalInteractiveArchitectureCanvas.focusConnected` | Task 153 focus-neighborhood isolation | Returns the selected ids plus direct edge endpoints. |
| `LocalInteractiveArchitectureCanvas.isOffscreen` | Task 153 viewport cull | Drives the off-screen jump pill. |
| `LocalComposerTargetStateMachine.syncBoxSelection` | Task 155 `ComposerTargetStateMachine` | `{ nodeIds, nodeRevisions, labels }`. If an unanswered question is open, keep `activeTarget: "question"`, keep the draft and `optionsVersion`, submit nothing, and show `Talking about: {label} · Switch composer to this box`. Otherwise show `Talking about: {first} (+N more) · ✕`. |
| `LocalBoxChatIntentController.launch` | Task 156 `BoxChatIntentController` | `ask`, `change`, `correct_misheard`, `add_child`, `remove_defer`, `explain_impact`, `focus_connected`. `explain_impact`, `ask`, and `focus_connected` force `tokens: 0`. `combined` is true when 2 or more boxes are selected. |
| `LocalInspectorShell.pin` | Task 122 `InspectorSlot` `canvas-node` | Selection above. |
| `LocalMotionPreference.prefersReducedMotion` | `window.matchMedia("(prefers-reduced-motion: reduce)")` | When true, highlights set `pulse: false` and `staticContrast: true`. |
| `LocalSiblingActionBus.call` | Sibling methods below | `{ sibling, method, nodeId, tokens, detail }`. `detail` is popover text and never includes `sealedSource`. |

Sibling methods launched from popover actions:

| Method | Sibling | Swap |
|---|---|---|
| `show`, `pause`, `fixedItMyself`, `runCheck`, `viewReceipt` | Task 126 | `WorkerInspectorPanel.show` and the header / checks actions. `viewReceipt` during an active sealed build must keep using the safe summary. |
| `analyze` | Task 129 | `FeatureUndoInventoryAnalyzer` for `Undo feature`. |
| `openWireframe` | Task 084 | Low-fi wireframe thumbnail. |
| `refreshFact`, `openSource` | Task 082 | `.d.ts` verified research facts. |
| `swapAsset` | Task 099 | Brand asset license / thumbnail. |
| `propose`, `viewSchema` | Task 112 | `Propose CCR`. |
| `openPreview`, `openLivePreview` | Task 160 | Live preview. |
| `resolveConflict` | Task 081 | Z3 conflict resolution. |
| `inspectCallers` | Task 168 | Brownfield L1/L2 module card. |
| `editStage` | Task 155 | `Edit stage / View readiness` opens the composer; it does not answer an open question. |
| `overrideChoice`, `pauseFeature`, `splitRequirement`, `inspectSeamTests` | Task 156 | Box-chat intents. `overrideChoice` is the delegated `Override choice` button. |
| `viewRelations`, `showMatchedTasks` | Task 153 | Also calls `focusConnected` for the open node. |

Canvas `feature` runtime labels are the five task states `QUEUED`, `WORKING`, `LEAVES_MERGED`, `INTEGRATING`, `DONE`. Schema `feature_states` is a longer set. Map them when the catalog is swapped.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-154-canvas-popovers-multiselection`:

- `pnpm --filter @ef-harness/renderer typecheck` — exit 0.
- `pnpm --filter @ef-harness/renderer lint` — exit 0.
- `pnpm --filter @ef-harness/renderer test -- canvas-popovers` — exit 0. Test Files 3 passed, Tests 15 passed (14 node popovers and aliases, sealed-oracle withholding, no `JSON.stringify`, axe button-name, shift/ctrl additive selection, 12-box marquee summary, non-answering question, Esc focus, quick-action routing, 8-second highlights, off-screen jump, reduced motion, corner clamp, remote archive, provenance pan/zoom).
- `pnpm --filter @ef-harness/renderer test` — exit 0. Test Files 4 passed, Tests 16 passed (includes the package smoke test).
- `node scripts/verify-harmony.mjs --task 154` — exit 0. `harmony ok for Task-154`.

## Known Limitations / Follow-Ups

- The package barrel re-export above is not applied on this branch.
- Sibling task branches are not ancestors of `649773097c387ae534b686ea5825f449f843aa7c`. The local ports above are the swap points.
- Selections of 2–11 boxes keep the seven quick actions plus `Clear`, and `Explain impact` is launched with `combined: true`. Selections of 12 or more narrow to `Ask about selection`, `Change`, `Explain combined impact`, and `Clear`, and they do not open a popover.
- `Shift+Click` and `Ctrl+Click` are both additive. They do not toggle a box off. `Clear`, a replacing plain click, or a second Esc clears the selection.
- Esc with a multi-selection and no open popover clears the selection immediately.
- Highlight lifetime uses the injected `ManualClock`, not a CSS animation. Removed nodes stay in the model with falling opacity until 8000 ms and are not dropped on the first frame.
- `runAxeCoreAudit` is the rule catalog above, not a browser `axe.run`.
