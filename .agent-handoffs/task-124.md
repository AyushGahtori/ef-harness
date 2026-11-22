---
task_id: "Task-124"
branch: "task/124-board-cockpit-seven-lanes"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/cockpit/board/**"
  - "apps/renderer/tests/cockpit-board/**"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 124 handoff

Seven-lane Board Cockpit on `task/124-board-cockpit-seven-lanes`. Sibling branches are not merged into this base. The view reads a `task_runtime`-shaped projection and paints only the virtualized viewport.

## Exports Provided

Import from `apps/renderer/src/cockpit/board/index.ts`:

- `BoardCockpitView` — 7-lane board. `renderHtml()`, `snapshot()`, `setMode()`, `setSearch()`, `toggleFeatureGrouping()`, `toggleDoneCollapsed()`, `toggleGroup()`, `setScroll()`, `handleKeyDown()`, `activateCard()`, `performQuickAction()`, `enqueuePatches()`, `flushFrame()`, `replaceSnapshot()`, `laneOf()`. `BoardCockpitView.bindStore()` subscribes to a daemon store.
- `mapTaskToBoardLane` — exactly one of `queued`, `working`, `waiting_on_you`, `held`, `verifying`, `integrating`, `done`.
- `DeterministicStatusLineFormatter` — `format()` and `formatTask()`. `llmCalls` stays `0`.
- `FeatureSwimlaneGrouper` — feature or connection chips. Summary shape: `4/6 done · 2 working · 0 blocked`.
- `VirtualizedLaneColumn` — fixed or per-row window. Only the viewport slice is returned.
- `formatPoolCapacityHeader` — `Thinking: 8/12 · Run slots: 2/2 (1 Verifier, 1 Worker · 2 queued) · Merge queue: idle`.
- `formatAgentTag` — `A0014 · print page`, clamped to 22 characters. Full tag stays on the tooltip.
- `boardTaskFromStateDb` — adapts `task_runtime` columns plus hold, inbox, pool, and daemon-event joins. No percent-complete field.
- `InMemoryDaemonStore` — local stand-in for `DaemonStoreProvider`.
- `holdBadge`, `renderBoardHtml`, `projectBoard`, `HEALTH_BADGE_KINDS`, `BOARD_LANES`, `InspectorSelection`, `ThreePoolCapacitySnapshot`, `BoardHealthSignalPort`, `WorkerInspectorPort`, `BoardQuickActionPort`.

Lane precedence in `mapTaskToBoardLane`: terminal closure (`MERGED_TO_FEATURE`, `SUPERSEDED`, `CANCELLED`), then any active hold, then an open inbox item or `WAITING_INPUT` / `HUMAN_OWNED` / `EXHAUSTED`, then merge queue or feature/project wiring, then `ACCEPTED`, then `STATIC_AUDIT` / `CLEAN_VERIFY` / `reviewer@1`, then an active claim (`CODING`, `LEASED`, `ESCALATED`, parked with a holder or pool phase), otherwise `Queued`. Pool wait stays in `Working` with a `Waiting for run slot` badge.

`CANCELLED` and `SUPERSEDED` use the Done lane because the board has exactly seven lanes. Their captions stay `Cancelled` and `Superseded`. Done is collapsed by default. Empty lanes, including empty Waiting on You and Held, use the slim column.

## Shared Wiring Needs (Root / Index Barrels)

Do not edit `apps/renderer/src/index.ts` from this task. When an integrator owns that barrel, re-export:

```ts
export {
  BoardCockpitView,
  DeterministicStatusLineFormatter,
  FeatureSwimlaneGrouper,
  VirtualizedLaneColumn,
  mapTaskToBoardLane,
  formatPoolCapacityHeader,
  boardTaskFromStateDb,
  InMemoryDaemonStore,
} from "./cockpit/board/index.js";
```

Shell wiring, once sibling branches land:

- **Task 122 `SingleAppShell` / `DaemonStoreProvider`:** replace `InMemoryDaemonStore` with the shell provider and call `BoardCockpitView.bindStore`. Bind pointer events on `[data-action="open-inspector"]` to `activateCard(taskId, "click")`, keydown on the board to `handleKeyDown`, `[data-action]` buttons to `performQuickAction`, `[data-mode]` / `[data-feature-grouping]` / `#board-filter` / `[data-done-toggle]` / `[data-group-key]` to the matching methods, and viewport scroll to `setScroll`. The frame batcher coalesces `enqueuePatches` inside 800 ms so a `Working → Verifying → Integrating → Done` burst paints one card.
- **Task 119 `ThreePoolCapacityScheduler`:** pass its live counts as `ThreePoolCapacitySnapshot`. Card `poolPhase` is `thinking`, `waiting_for_run_slot`, or `running_command`.
- **Task 021 `TaskHoldsManager`:** supply `holds[]` with `reason`, `source`, and human `summary`. One hold renders `Held: paused` or `Held: clarifying cutoff`. Two or more render `Held (N reasons)` and list every summary in the tooltip. `submission_pending = 1` keeps a fixed Quarantined slot.
- **Task 126 `WorkerInspectorPanel`:** `activateCard` calls `WorkerInspectorPort.open(InspectorSelection)` with the full `AgentID · title`, lane, and `openedBy`.
- **Task 173:** `performQuickAction("i_fixed_it_myself", taskId)`.
- **Task 125:** `BoardHealthSignalPort.signalsFor` fills the five reserved 16 px slots (`stuck_clock`, `loop`, `throttled`, `allowance_reset`, `escalation`). Empty slots stay mounted, so card height stays 160 px.
- **Task 134 / Task 165:** mount `BoardCockpitView` for the 500-task board benchmark and for the Office → Board fallback. `mapTaskToBoardLane` is the shared lane function.

## Dependency Intents (New Packages Requested)

No package.json or lockfile edits from this task.

- `@tanstack/react-virtual` is not installed. `VirtualizedLaneColumn` is the lightweight fixed-height window the task allows. Add the package later only if the shell wants that virtualizer; keep `window()` as the seam.
- `react`, `react-dom`, and their `@types` packages are root devDependencies, not renderer dependencies. `apps/renderer/tsconfig.json` has no DOM lib and no `jsx` option, so this task does not import them. When Task 122 mounts the board, declare them on `@ef-harness/renderer` and render `renderBoardHtml` output or map `snapshot()` into the shell.
- `@testing-library/react` and `jsdom` are not installed. The 500-task timing test constructs `BoardCockpitView` and calls `renderHtml()` under Vitest. Declare those packages before converting the benchmark to React Testing Library.
- `axe-core` is a root devDependency. The accessibility test loads it with Playwright (also a root devDependency) because `jsdom` is absent. Declare `axe-core` on `@ef-harness/renderer` when the package boundary is opened.

## Contract Change Requests

None. No schema, barrel, or root config changes.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-124-board-cockpit-seven-lanes`:

- `pnpm --filter @ef-harness/renderer typecheck` — exit 0.
- `pnpm --filter @ef-harness/renderer lint` — exit 0.
- `pnpm --filter @ef-harness/renderer test -- cockpit-board` — 5 files, 22 tests passed. Covers unique 7-lane mapping for every canonical `task_states` value, deterministic captions with `llmCalls === 0` and `< 0.1 ms` each, path truncation, 20-worker grouping, `< 2 ms` `print` filter, Thinking / Waiting for run slot / Running command badges, hold tooltips, quarantine, collapsed Done, keyboard navigation, quick actions, WCAG AA theme pairs, axe-core with zero violations in light and dark, and the 500-task / 20-worker / 5,000-requirement mount and patch under 10 ms with at most 25 mounted cards.
- `node scripts/verify-harmony.mjs --task 124` — exit 0, `harmony ok for Task-124`.

## Known Limitations / Follow-Ups

- The renderer cannot open `state.db` itself. `boardTaskFromStateDb` is the adapter; Task 122's store is the live feed.
- Search matches the indexed haystack (agent tag, title, feature, connection, state, pool badge, command, verify flow, hold summaries). The card still shows the full deterministic status line.
- `SUPERSEDED` and `CANCELLED` sit in Done so they are not dropped and are not shown as runnable.
- The timed 500-task mount renders one throwaway card first so the measurement is the board work after the module has loaded.
- Health signals are slots only. Task 125 owns the detectors and must not change card geometry.
- Quick actions call the ports. Pause is enabled for Working, Verifying, and Integrating unless a user-pause hold is already present. Resume is enabled for that hold. Jump to Inbox is enabled only when `openInboxItemId` is set.
