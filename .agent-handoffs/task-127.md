---
task_id: "Task-127"
branch: "task/127-calm-notification-inbox-ui"
base_commit: "649773097c387ae534b686ea5825f449f843aa7c"
owned_paths:
  - "apps/renderer/src/cockpit/inbox/**"
  - "apps/renderer/tests/cockpit-inbox/**"
  - ".agent-handoffs/task-127.md"
status: "ready_for_integration"
commit_only_never_merged: true
---

# Task 127 handoff

Calm notification inbox: three-tier delivery, focus mode, interruption budget, and the six action cards. Commit stays on `task/127-calm-notification-inbox-ui`.

## Exports Provided

Import from `apps/renderer/src/cockpit/inbox/index.ts` (the renderer package barrel is outside this owned subtree):

- `CalmInboxPanel` — left-rail inbox. Owns cadence, focus, unread badge, keyboard triage, secret isolation, retirement, and the six cards.
- `NotificationCadenceScheduler` — Interrupt-Now, 10-minute batch with critical-path / `>= 2` subscriber early flush, and FYI digest.
- `FocusModeAndInterruptionBudget` — `Ctrl+.` focus mode, hourly cap of 4 routine batch releases, and the 30-minute snooze.
- `DecisionCard`, `SecretCard`, `ToolCard`, `AccountCard`, `ApprovalCard`, `ReviewCard` — the six card views.
- `createLeftRailInboxMount` — `{ ownerTask: "Task 127", render }` for the left rail.
- Also exported for tests and the shell: `runAxeCoreAudit`, `interpretInboxKey`, `SecretCardController`, `SecretInputBuffer` is not exported (use the controller), memory ports (`MemorySecretIpc`, `LocalStaleReplyReconciler`, `MemoryHumanStepProbe`, `MemoryNativeNotifications`, and the other `Memory*` doubles), and the cadence constants (`CALM_BATCH_MS`, `SNOOZE_MS`, `LIVE_KEY_REFUSAL`, `STALE_VS_CODE_PROMPT`, `AUTH_EXPIRY_TOAST`, `ZEN_MESSAGE`).

## Shared Wiring Needs (Root / Index Barrels)

`apps/renderer/src/index.ts` is outside this task's owned paths. Integration should add:

```ts
export {
  AccountCard,
  ApprovalCard,
  CalmInboxPanel,
  DecisionCard,
  FocusModeAndInterruptionBudget,
  NotificationCadenceScheduler,
  ReviewCard,
  SecretCard,
  ToolCard,
  createLeftRailInboxMount,
} from "./cockpit/inbox/index.js";
```

No root `package.json` script changes. No `packages/*/src/index.ts` re-exports. This task does not import another workspace package beyond the existing `@ef-harness/shared-contracts` dependency, and it does not call that package.

## Dependency Intents (New Packages Requested)

- `react` and `react-dom` are not in the foundation lockfile, so these cards are a typed `VNode` tree (`h` in `a11y.ts`) instead of JSX. `CalmInboxPanel` keeps secret text in `SecretCardController` and clears that state on a successful vault save, which is the React-state rule this task can satisfy without the package. When React is installed, map `h()` to `createElement` and pass `panel.render()` into Task 122's `LeftRailInboxSlot`.
- `axe-core` is not in the lockfile. `runAxeCoreAudit` checks the serious and critical rules this tree can violate: button name, input label, link name, image alt, duplicate id, nested interactive controls, contrast below 4.5:1, negative tabindex, targets under 24px, modal dialogs, and audio chimes. Swap the function body to `axe.run` on the mounted rail when the package exists. Do not add either dependency on this branch; `package.json` and `pnpm-lock.yaml` are frozen.

## Contract Change Requests

None. No `schema/` edits.

## Exact Verification Commands & Results

From `C:\Users\Ayush\Desktop\ef-wt\task-127-calm-notification-inbox-ui`:

- `pnpm --filter @ef-harness/renderer typecheck` — exit 0.
- `pnpm --filter @ef-harness/renderer lint` — exit 0.
- `pnpm --filter @ef-harness/renderer test -- cockpit-inbox` — exit 0. Test Files 2 passed, Tests 21 passed (10-minute batch, decision headline, critical-path flush, two-subscriber flush, FYI badge exclusion, focus mode with a disk emergency, four-per-hour budget, 30-minute snooze, zen state, one tray notification, six card types, keyboard J/K/1-4/Ctrl+Enter, VS Code stale reply, options version, tool badge, account and approval actions, DPAPI save and clear, live-key refusal, local mock).
- `pnpm --filter @ef-harness/renderer test` — exit 0. Test Files 3 passed, Tests 22 passed (includes the package smoke test).
- `node scripts/verify-harmony.mjs --task 127` — exit 0. `harmony ok for Task-127`.

## Known Limitations / Follow-Ups

Sibling branches are not merged. Local ports and the swap to make at integration:

- `LocalStaleReplyReconciler.receive` stands in for Task 116 `StaleReplyReconciler.receive`. A VS Code retirement shows `Already resolved via VS Code — Keep or Change?`. Task 116's constant `VS_CODE_STALE_PROMPT` is `Keep VS Code edit or apply this reply?`. Keep the Task 127 sentence on the card unless product picks one string. There is no `SharedQuestionArbiter` process on this branch; the panel stores the cards the arbiter would project.
- `PreloadSecretIpc.put` / `MemorySecretIpc` stands in for Task 120 `WindowsDpapiSecretsVault.put`. The refusal banner is `Live key refused for test scope — use sk_test_ or local mock`. Task 120's `stripeLiveRefusalMessage()` is the longer Stripe sentence. Map `LiveKeyRefusedError` onto this banner, or show the vault message if product wants the longer text. Plaintext is an argument to `put` only. After a successful save the controller writes zeroes through the buffer and drops it. Chat, the composer, the devtools log, and `user_messages` stay empty.
- `HumanStepProbePort.checkAgain` stands in for Task 121 `HumanStepProbeRegistry.checkAgain`. Badges are `Verified` and `Attested`. Task 121's attested label is `Self-attested by you (unprobed)`; use that as the attested detail when the registry is wired. The exact command is shown as preview text. This task does not spawn it. Task 121 `ConsentedTerminalInstaller` owns the consented run.
- `createLeftRailInboxMount` stands in for Task 122 `LeftRailInboxSlot`. That slot's `render` returns a React node. Adapt this `VNode` once React exists. `Ctrl+.` matches Task 122's `toggle-focus` command.
- `NativeNotificationPort` stands in for Task 131's tray notification. A background or minimized Interrupt-Now card fires at most one notice. Focus Mode suppresses every OS toast (`criticalAlertsAllowed` defaults false) while the in-app badge still shows P0. The ChatGPT auth-expiry body is `EF Harness needs you: ChatGPT sign-in expired`. Clicking it focuses that `AccountCard`.
- `ComposerQuestionBind.bind` stands in for Task 155. It records the question id and does not copy secret text into the draft.
- `ApprovalDecisionPort.decide` stands in for Task 176. Actions are `approve`, `edit`, and `decline`.

Behavior notes for the integrator:

- Early flush surfaces the triggering card only. The other quiet cards stay until the original 10-minute mark.
- The hourly cap of 4 counts routine window releases. Critical-path and two-subscriber flushes do not spend it. Focus Mode and snooze hold both the window and those early flushes.
- Opening the inbox manually reveals a held batch without an OS toast and without spending the hourly budget.
- FYI cards never increment the actionable unread count. The badge is Interrupt-Now cards plus flushed batch cards that still need a decision.
- `apps/renderer/src/index.ts` does not re-export this task yet. Wire the snippet above.
