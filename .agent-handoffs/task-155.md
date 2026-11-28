---
task_id: "Task-155"
branch: "task/155-single-composer-state-machine"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/composer/**"
  - "apps/renderer/tests/composer/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 155 handoff

Single composer target state machine for M5. One composer, four explicit targets, per-target drafts, a type-mismatch prompt, auto-return after a side Box or Element send, and multi-box clause splitting. This branch was created from `649773097c387ae534b686ea5825f449f843aa7c` (tag `foundation/task-001-complete`). Sibling task branches are not merged here.

## Exports Provided

Wire these from `apps/renderer/src/composer/index.ts`:

- `SingleComposerView` — the one composer. `viewModel()` is the mount payload: pill, draft, caret, mic, attachment chips, mismatch prompt, preview switch, Esc confirm, and auto-return toast. `composerCount` is `1` and `composerId` is `single-composer`.
- `ComposerTargetStateMachine` — `Question` / `Box` / `Element` / `General` transitions, send routing, snapshot lock, and keyboard handling.
- `PerTargetDraftStore` — unsent text plus cursor, in memory and session storage. Keys are `question:Q-04`, `box:D-17`, `element:E-9`, and `general`. Multi-box keys sort node ids (`box:D-17+D-Email`).
- `TargetTypeMismatchGuard` — deterministic prompt before a wrong-target send.
- `MultiBoxClauseSplitter` — ordered per-box `edit_existing` clauses with `nodeId` and `revision`.
- `useComposerTarget` — `getSnapshot()` / `subscribe()` binding for Task 122, Task 156, Task 157, and Task 161. It is the external-store shape, not a React hook. This package has no React dependency, and `package.json` is frozen.

Target pills:

- Question: `Replying to: Auth Method [Q-04] · ✕`
- Box: `Talking about: Cutoff Rule R17 (+2 more) · ✕` (one box omits the `+N more` suffix)
- Element: `Fixing UI: Submit Order button (OrderForm.tsx:84) · ✕`
- General: `Message project / steering`

Canvas or preview click while the active target is a Question opens a non-destructive preview and does not submit. The switch control is `Switch composer to this box` (or `Switch composer to these boxes` / `Switch composer to this element`). That explicit switch stashes the Question draft and sets the paused note `Paused: you're talking about {label}`. The selected option position is left unchanged.

After a Box or Element send while a Question is waiting, the toast is `Sent to {label} · Back to replying to '{title}' (Stay on {label})`. `stayOnSideTarget()` undoes the return and keeps the Question draft stashed.

`InputStartFocusSnapshot` locks on the first inserted character or mic press. A later inbox card does not replace `targetId` or `optionsVersion`. File drop locks as well, so a card cannot land between drop and Enter.

Enter sends. Shift+Enter inserts a newline. Esc dismisses a mismatch prompt, then a preview, then asks before clearing a non-empty explicit target. An empty explicit target returns to General immediately. The pill clear control moves the paragraph onto General and keeps a copy under the previous target key. Up Arrow at caret 0 recalls sent draft history.

Two or more selected boxes tag the submission with `nodeIds` and `nodeRevisions` and call `OrderedMultiClauseExecutor` with the split clauses. PDF, DOCX, HAR, and ordinary images route to intake on Send. SVG and logo/brand images route to the brand sanitizer. Chips show a type badge and a size label.

## Shared Wiring Needs (Root / Index Barrels)

`apps/renderer/src/index.ts` is outside this task's owned write scope. Add this re-export when the integrator lands the branch:

```ts
export {
  ComposerTargetStateMachine,
  MultiBoxClauseSplitter,
  PerTargetDraftStore,
  SingleComposerView,
  TargetTypeMismatchGuard,
  useComposerTarget,
} from "./composer/index.js";
export type {
  ComposerSubmission,
  ComposerTarget,
  ComposerViewModel,
  FocusSnapshot,
  MultiBoxSplit,
} from "./composer/index.js";
```

No root `package.json`, workspace, or tsconfig change. The renderer package export map stays `"."` until that barrel edit.

## Dependency Intents (New Packages Requested)

None. The composer uses the existing `@ef-harness/renderer` toolchain only.

## Contract Change Requests

Sibling packages are not on this base. The composer talks to them through local ports in `apps/renderer/src/composer/ports.ts`. Replace the adapters; do not keep the local copies once the real barrels exist.

| Needed sibling | This branch | Swap |
| --- | --- | --- |
| Task 113 `InputStartFocusSnapshotter` | `InputStartFocusSnapshotterPort.capture` | Freeze `inputStartedAt`, `targetType`, `targetId`, `optionsVersion`, `selectedNodeRevisions`, plus `activeTab`, `selectedCanvasNodeIds`, `openQuestionCardId`, `openQuestionOptionsVersion`, `focusedFeatureId`, `inspectedTaskId`, and `previewSelectedElement`. Capture once per draft. |
| Task 113 `UnifiedMessageSequencer` | `UnifiedMessageSequencerPort.assign` | Returns `{ msgSeq, messageId }`. This branch does not write `state.db`. The integrator's sequencer owns monotonic persistence. |
| Task 113 `OrderedMultiClauseExecutor` | `OrderedMultiClauseExecutorPort.execute` | Payload is `{ nodeIds, nodeRevisions, clauses[] }` with `intentType: "edit_existing"`. The local executor keeps splitter order. The real executor may apply its safety order; these clauses are all edits. |
| Task 122 `SingleAppShell` | `SingleAppShellPort.publish` | Slot is `chat-composer`. Publish the `SingleComposerView` model. Reject a second `composerId`. |
| Task 154 `MultiBoxSelectionController` | `MultiBoxSelectionControllerPort.subscribe` | Live selection calls `inspectBoxes`. An active Question stays the composer target. `switchComposerToPreview()` is the explicit retarget. |
| Task 156 box-chat submit | `ComposerSubmission` from `send()` | Read `routedKind`, `routedTargetId`, `nodeRevisions`, and `inputStartSnapshot`. This branch does not apply graph edits or open the impact modal. |
| Task 157 dictation live draft | `pressMic`, `setInterimDraft`, `applyDictationSyllable`, `DictationLiveDraftPort` | `tentative` is the grey tail. `confirmed` appends black text. Speech never sends. Mic press locks the snapshot. |
| Task 161 element target | `inspectPreviewElement` / `activateTarget({ kind: "Element" })` | Inspection while a Question is active keeps the Question. Explicit activation stashes the draft. |
| Task 097 + Task 098 intake | `DocumentIntakePort.convert` then `extract` | On Send, for PDF, DOCX, HAR, and non-brand images. |
| Task 099 brand sanitizer | `BrandAssetSanitizerPort.sanitize` | On Send, for SVG and for image names that contain `logo` or `brand`. |

## Exact Verification Commands & Results

Run from `C:\Users\Ayush\Desktop\ef-wt\task-155-single-composer-state-machine`.

- `pnpm --filter @ef-harness/renderer typecheck` — pass (`tsc -b`).
- `pnpm --filter @ef-harness/renderer lint` — pass (`eslint .`).
- `pnpm --filter @ef-harness/renderer test -- composer` — pass, 4 files, 26 tests. Covers all 16 target-pair transitions with cursor restore, the four pill strings, non-answering canvas and preview clicks, explicit switch plus paused note, session-storage draft restore, pill clear, Esc confirm, late inbox snapshot lock, mic press without auto-send, bare `2` and `Option 2` mismatch prompts, the Auth Method UI-tweak prompt, auto-return toast plus Stay, cutoff/catering and Menu/Orders clause splits, and PDF/SVG/HAR/DOCX chips.
- `node scripts/verify-harmony.mjs --task 155` — pass (`harmony ok for Task-155`). The harmony run also passed repo `typecheck`, `lint`, and `test`.

## Known Limitations / Follow-Ups

- The renderer has no DOM or React dependency, and adding one would edit the frozen package manifest. `SingleComposerView` is a view-model the shell mounts. `useComposerTarget` returns `getSnapshot` and `subscribe` for a later React adapter in Task 122.
- Clause breaks are the conjunction ` and ` and semicolons. Each clause is scored against box labels and node ids. Overlap uses a light prefix match so `Order` binds to `Orders`. There is no model call.
- Answering a Question, or confirming "switch to General steering", leaves the composer on General. The Question draft that was sent is cleared. A different stashed Question draft is pushed into Up Arrow history before that clear.
- The General pill has no clear control. Esc on General is a no-op.
- The local sequencer's `msgSeq` starts at 1 for the process. It is not durable across restarts.
- File drop locks the input-start snapshot even though the spec names keystroke and mic press. That keeps a late card from changing the target between drop and Enter.
- Auto-return uses the full toast template from the task requirement. The shorter edge-case wording is contained in that sentence (`Sent to Cutoff Rule R17` and the question title).
