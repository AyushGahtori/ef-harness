---
task_id: "Task-156"
branch: "task/156-canvas-box-chat-intents"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/canvas/intents/**"
  - "apps/renderer/tests/canvas-intents/**"
  - ".agent-handoffs/task-156.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 156 handoff

Canvas box-chat intents (`Ask`, `Correct` vs `Change`, `Add`, `Remove/Defer`, `Explain Impact`), zero-token impact preview modal, revision-drift conflict prompt, smart defaults, cosmetic fast-path, multi-box impact union, and undo toast. Commit stays on `task/156-canvas-box-chat-intents`.

## Exports Provided

Import from `apps/renderer/src/canvas/intents/index.ts` (renderer package barrel is outside this owned subtree):

- `BoxChatIntentController` / `createBoxChatIntentController` — five core intents, composer revision locks, preview gating, drift settlement, undo toast, and local adapters for Tasks 102, 071, 087, 108, 129, 154, 155, 158, and 074.
- `CorrectVsChangeTogglePreset` — segmented `Correct (misheard)` vs `Change` preset with accessible radio group and live region.
- `ZeroTokenImpactPreviewModal` — SQL-only impact totals, canvas highlight ids, `Apply Change` / `Edit Instruction` / `Cancel (0 changes made)`, focus trap, and Esc cancel.
- `RevisionDriftConflictPrompt` — optimistic-concurrency 3-way prompt when `baseRevision !== currentDbRevision`.
- `IntentGraph` — in-memory `state.db` slice with canonical and cycle-safe `impact_walk`, version history, holds, and vocabulary corrections for tests and local ports.
- `LocalReverseImpactWalker`, `LocalRevisionImpactPreviewer`, `LocalChangeClassifier`, `LocalRevisionAutoStartPolicy`, `LocalEarlyCutoffReverifier`, `LocalReverifyBeforeReworkGate` — Task 087/108 local stand-ins.
- `runAxeCoreKeyboardFocusTrapAudit` — axe-style keyboard/focus-trap/radiogroup checks for modal and toggle surfaces.

## Shared Wiring Needs (Root / Index Barrels)

`apps/renderer/src/index.ts` is frozen on this branch. Integration should add:

```ts
export {
  BoxChatIntentController,
  CorrectVsChangeTogglePreset,
  RevisionDriftConflictPrompt,
  ZeroTokenImpactPreviewModal,
  createBoxChatIntentController,
} from "./canvas/intents/index.js";
```

Task 154 `LocalBoxChatIntentController.launch` maps to `BoxChatIntentController.submit` with intents:

| Toolbar / composer | `BoxChatSubmission.intent` |
|---|---|
| `ask` | `ask` |
| `correct_misheard` | `correct` |
| `change` | `change` |
| `add_child` | `add` |
| `remove_defer` | `remove_defer` |
| `explain_impact` | `explain_impact` |

`explain_impact`, `ask`, and combined multi-box explain keep `llmCalls === 0`. Task 155 should call `beginComposer(nodeIds, draft, cursor)` before edits so drift locks `(nodeId, baseRevision)` apply.

## Dependency Intents (New Packages Requested)

None added on this branch. `apps/renderer/package.json`, `pnpm-lock.yaml`, and foundation harness files are frozen.

## Contract Change Requests

None. No `schema/` edits. `CANONICAL_IMPACT_WALK_SQL` and `CYCLE_SAFE_IMPACT_WALK_SQL` in `sql.ts` quote the canonical recursive walk from `schema/queries.sql` for the in-memory graph test double.

Sibling branches are not on base `649773097c387ae534b686ea5825f449f843aa7c`. `IntentGraph` is the local port until Task 017 `state.db` wiring lands; swap the graph adapter, not intent routing.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-156-canvas-box-chat-intents`:

- `pnpm --filter @ef-harness/renderer typecheck` — exit 0.
- `pnpm --filter @ef-harness/renderer lint` — exit 0.
- `pnpm --filter @ef-harness/renderer test -- canvas-intents` — exit 0. Test Files 5 passed, Tests 29 passed (five intents, misheard correction + Task 071/158 routing, breaking change preview, cosmetic fast-path + Task 154 highlight, add-child edges, defer + Task 074, built-feature Task 129 inventory, offline zero-token explain impact under 15 ms, deduplicated multi-box union, preview cancel zero side-effect, revision drift, undo toast, axe modal/toggle).
- `node scripts/verify-harmony.mjs --task 156` — exit 0 (`harmony ok for Task-156`).

## Known Limitations / Follow-Ups

Sibling branches are not on this base (`649773097c387ae534b686ea5825f449f843aa7c`). Swap these local ports at integration. Do not import the unpublished packages as if they were already on `harness/integration`.

- `LocalReverseImpactWalker.walkCombined` swaps for Task 087 `ReverseImpactWalker.walkCombined`. It runs `CANONICAL_IMPACT_WALK_SQL` (the `schema/queries.sql` `impact_walk` text) and `CYCLE_SAFE_IMPACT_WALK_SQL` (that walk plus a visited-path guard and `belongs_to` / `consumes`). Depth 0 starts are excluded so a shared downstream node is counted once. `llmCalls` and `networkCalls` stay `0`.
- `LocalRevisionImpactPreviewer.format` swaps for Task 087 `RevisionImpactPreviewer`. `LocalChangeClassifier.classify` swaps for `ChangeClassifier`. `LocalEarlyCutoffReverifier.review` records the early-cutoff call and does not drop nodes until Task 087 fingerprints are injected. `LocalReverifyBeforeReworkGate.reverify` swaps for `ReverifyBeforeReworkGate` and returns no rework until real checks are injected.
- `LocalRevisionAutoStartPolicy.exceeds` swaps for Task 108 `RevisionAutoStartPolicy.evaluate`. This port uses the numeric ceilings (`DELTA_TASK_CEILING` 5, `DELTA_COST_CEILING_MICRO_USD` 1_000_000). A wording break confirms when it touches at least one active or merged task or exceeds those ceilings. Map Task 108 `breakingContract` onto `exceeds({ breaking: true })` when the edit is a contract-schema break.
- `LocalPremiseSupersessionReopener.reopenDependents(premiseId, falseValue)` swaps for Task 071 `PremiseSupersessionReopener.reopenDependents`. It reopens `derived_from` children that still contain the misheard value and leaves the corrected premise in place.
- `LocalAskOwnerResponder.answer` swaps for Task 102 `AskOwnerResponderEngine.answerQuestion` at `ask-owner-responder@1`. This port answers from the box quote, basis text, code status, and dependent task titles and does not call a model.
- `BoxChatIntentController` removal of an unbuilt node swaps for Task 074 deferral (`status = deferred` or `deprecated`, dependency ids from `impact_walk`). Removal of a landed or `DONE` feature swaps for Task 129 `FeatureUndoInventoryAnalyzer.analyze`: three steps, shared helpers, dormant-table default `keep_dormant`, and no node delete.
- `beginComposer` swaps for Task 155 `SingleComposerView` / the input-start `(nodeId, baseRevision)` lock. `LocalPostSendChangeHighlighter.highlight` swaps for Task 154 `PostSendChangeHighlighter`. `undoLast` swaps for Task 017 `KnowledgeGraphRepo` version history (`node_versions`), writing the prior content forward as the next version. `LocalDictationVocabulary.recordMisheardPair` swaps for Task 158 and stores pairs such as `11:15 → 11:50`.
- `IntentGraph` is the in-memory SQLite stand-in for `state.db`, not an IPC call to the desktop database. Holds use `task_holds(reason = revision_in_flight)`.
- The package barrel re-export above is not applied on this branch.
- `runAxeCoreKeyboardFocusTrapAudit` checks dialog name, button name, focus-trap wrap, Escape-to-cancel, tabindex, and radiogroup keyboard rules. `axe-core` is not a dependency because `package.json` is frozen, so this is not a browser `axe.run`.
- Drift and preview surfaces are `A11ySurface` trees (`a11y.ts`), not React components. Map them onto the Task 122 overlay when the shell mounts React.