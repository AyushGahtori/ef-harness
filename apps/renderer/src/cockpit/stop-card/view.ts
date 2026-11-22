import { escapeHtml, formatCountdown, formatMicroUsd, paidSwitchConfirmation } from "./format.js";
import {
  ADD_BUDGET_PLUS_10_MICRO_USD,
  ADD_BUDGET_PLUS_5_MICRO_USD,
  type AddBudgetIntent,
  type RenderedAction,
  type RenderedStopCard,
  type StopCardFacts,
  type StopCardInteraction,
  defaultInteraction,
} from "./types.js";

export class CheckpointStopCardView {
  constructor(private readonly now: () => number) {}

  render(facts: StopCardFacts, interaction: StopCardInteraction = defaultInteraction()): RenderedStopCard {
    const actions = deriveRecoveryActions(facts, this.now());
    const visible = actions.filter((action) => !action.hidden);
    const confirmationText = confirmationFor(facts, interaction);
    const title = titleFor(facts);
    const html = renderHtml(facts, visible, interaction, confirmationText, title);
    return {
      html,
      title,
      spentSummary: facts.spentSummary,
      finishedFeatures: facts.finishedFeatures,
      finishedTasksCount: facts.finishedTasksCount,
      inFlightCheckpointedTasks: facts.inFlightCheckpointedTasks,
      remainingTasksCount: facts.remainingTasks.length,
      actions,
      visibleActions: visible,
      confirmationText,
      autoResumeAtReset: interaction.autoResumeAtReset,
      vscodeCommand: facts.vscodeCommand,
    };
  }

  withAutoResume(interaction: StopCardInteraction, enabled: boolean): StopCardInteraction {
    return { ...interaction, autoResumeAtReset: enabled };
  }

  withSwitch(interaction: StopCardInteraction, targetId: string, confirmed: boolean): StopCardInteraction {
    return { ...interaction, switchTargetId: targetId, switchConfirmed: confirmed };
  }

  withCheaperConfirmed(interaction: StopCardInteraction, confirmed: boolean): StopCardInteraction {
    return { ...interaction, cheaperConfirmed: confirmed };
  }

  addBudgetIntent(kind: AddBudgetIntent["kind"], customMicroUsd?: number): AddBudgetIntent {
    if (kind === "plus_5") return { action: "add_budget", kind, deltaMicroUsd: ADD_BUDGET_PLUS_5_MICRO_USD };
    if (kind === "plus_10") return { action: "add_budget", kind, deltaMicroUsd: ADD_BUDGET_PLUS_10_MICRO_USD };
    if (customMicroUsd === undefined || !Number.isSafeInteger(customMicroUsd) || customMicroUsd <= 0) {
      throw new Error("custom budget must be a positive integer micro-USD amount");
    }
    return { action: "add_budget", kind: "custom", deltaMicroUsd: customMicroUsd };
  }
}

export function deriveRecoveryActions(facts: StopCardFacts, nowMs: number): readonly RenderedAction[] {
  const subscription = facts.subscription;
  const pressure =
    subscription !== null &&
    (subscription.usedPpm >= 900_000 || subscription.usedPpm * 10 >= subscription.limitPpm * 9);
  const highlightTrio = !facts.dollarCap && (pressure || facts.trigger === "window_exhausted" || facts.trigger === "subscription_wind_down");
  const countdown = subscription ? formatCountdown(subscription.resetAtMs - nowMs) : null;
  const floors = facts.remainingTasks
    .filter((task) => task.floor !== "junior")
    .map((task) => `${task.taskId} stays at ${task.floor}`);
  const cheaperDetail = `Preset Cheapest. Remaining ${facts.remainingTasks.length} tasks: ${formatMicroUsd(facts.cheaperProjectedMicroUsd)}.${floors.length ? ` ${floors.join("; ")}.` : ""}`;
  const active = facts.connections.find((connection) => connection.id === facts.activeConnectionId);
  const paid = active?.billing === "subscription"
    ? facts.connections.find((connection) => connection.billing === "pay-per-use" && connection.estimateMicroUsd !== null)
    : undefined;
  const switchDetail = paid && paid.estimateMicroUsd !== null
    ? paidSwitchConfirmation(paid.label, paid.estimateMicroUsd, paid.remainingTasks ?? facts.remainingTasks.length)
    : "Choose another connected provider";
  return [
    {
      id: "add_budget",
      label: "Add Budget",
      enabled: facts.dollarCap,
      highlighted: false,
      hidden: !facts.dollarCap,
      detail: "+$5 / +$10 / Custom",
    },
    {
      id: "cheaper_models",
      label: "Switch to Cheaper Models",
      enabled: facts.remainingTasks.length > 0,
      highlighted: false,
      hidden: false,
      detail: cheaperDetail,
    },
    {
      id: "switch_connection",
      label: "Switch Connection",
      enabled: facts.connections.length > 1,
      highlighted: highlightTrio,
      hidden: false,
      detail: switchDetail,
    },
    {
      id: "wait_for_reset",
      label: countdown ? `Wait for Reset (${countdown})` : "Wait for Reset",
      enabled: subscription !== null,
      highlighted: highlightTrio && subscription !== null,
      hidden: subscription === null,
      detail: countdown ? `Auto-resume at reset` : "No subscription window",
    },
    {
      id: "finish_by_hand",
      label: "Finish by Hand",
      enabled: true,
      highlighted: false,
      hidden: false,
      detail: "Export a wip branch and HANDOFF.md",
    },
    {
      id: "keep_parked",
      label: "Keep Parked",
      enabled: true,
      highlighted: highlightTrio,
      hidden: false,
      detail: "Leave parked at 0 CPU / 0 spend",
    },
  ];
}

function confirmationFor(facts: StopCardFacts, interaction: StopCardInteraction): string | null {
  if (interaction.switchTargetId === null) {
    const active = facts.connections.find((connection) => connection.id === facts.activeConnectionId);
    if (active?.billing !== "subscription") return null;
    const paid = facts.connections.find((connection) => connection.billing === "pay-per-use");
    if (!paid || paid.estimateMicroUsd === null) return null;
    return paidSwitchConfirmation(paid.label, paid.estimateMicroUsd, paid.remainingTasks ?? facts.remainingTasks.length);
  }
  const target = facts.connections.find((connection) => connection.id === interaction.switchTargetId);
  const source = facts.connections.find((connection) => connection.id === facts.activeConnectionId);
  if (!target || !source) return null;
  if (source.billing === "subscription" && target.billing === "pay-per-use" && !interaction.switchConfirmed) {
    return paidSwitchConfirmation(
      target.label,
      target.estimateMicroUsd ?? 0,
      target.remainingTasks ?? facts.remainingTasks.length,
    );
  }
  return null;
}

function titleFor(facts: StopCardFacts): string {
  if (facts.trigger === "budget_100") return `Budget reached: ${facts.spentSummary}`;
  if (facts.trigger === "window_exhausted" || facts.trigger === "subscription_wind_down") {
    return "Waiting for allowance";
  }
  if (facts.trigger === "disk_red") return "Paused: disk is red";
  return "Build stopped";
}

function renderHtml(
  facts: StopCardFacts,
  actions: readonly RenderedAction[],
  interaction: StopCardInteraction,
  confirmationText: string | null,
  title: string,
): string {
  const features = facts.finishedFeatures.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("");
  const inflight = facts.inFlightCheckpointedTasks.map((taskId) => `<li>${escapeHtml(taskId)}</li>`).join("");
  const actionHtml = actions.map((action) => renderAction(action, facts, interaction, confirmationText)).join("");
  const vscode = facts.vscodeCommand
    ? `<button type="button" data-open-vscode="true">Open in VS Code</button><p data-vscode-command>${escapeHtml(facts.vscodeCommand)}</p>`
    : "";
  return [
    `<section data-stop-card="checkpoint" data-office-lights="${facts.officeLights}" data-trigger="${facts.trigger}">`,
    `<h1>${escapeHtml(title)}</h1>`,
    `<p data-saved>${escapeHtml(facts.savedLine)}</p>`,
    `<p data-spent>${escapeHtml(facts.spentSummary)}</p>`,
    `<p data-finished-tasks>${facts.finishedTasksCount}</p>`,
    `<ul data-finished-features>${features}</ul>`,
    `<ul data-inflight>${inflight}</ul>`,
    `<p data-remaining>${facts.remainingTasks.length}</p>`,
    `<ul data-actions>${actionHtml}</ul>`,
    vscode,
    `</section>`,
  ].join("");
}

function renderAction(
  action: RenderedAction,
  facts: StopCardFacts,
  interaction: StopCardInteraction,
  confirmationText: string | null,
): string {
  const buttons = action.id === "add_budget"
    ? `<button type="button" data-add="5">+$5</button><button type="button" data-add="10">+$10</button><button type="button" data-add="custom">Custom</button>`
    : "";
  const resume = action.id === "wait_for_reset"
    ? `<label><input type="checkbox" data-auto-resume="${interaction.autoResumeAtReset ? "true" : "false"}"${interaction.autoResumeAtReset ? " checked" : ""} /> Auto-resume at reset</label>`
    : "";
  const confirm = action.id === "switch_connection" && confirmationText
    ? `<p data-confirmation>${escapeHtml(confirmationText)}</p>`
    : "";
  const cheaper = action.id === "cheaper_models"
    ? `<p data-cheaper-confirmed="${interaction.cheaperConfirmed ? "true" : "false"}">${escapeHtml(action.detail)}</p>`
    : "";
  const floors = action.id === "cheaper_models"
    ? facts.remainingTasks.map((task) => `<span data-floor="${escapeHtml(task.taskId)}">${escapeHtml(task.floor)}</span>`).join("")
    : "";
  return [
    `<li data-action="${action.id}" data-highlighted="${action.highlighted ? "true" : "false"}" data-enabled="${action.enabled ? "true" : "false"}">`,
    `<h2>${escapeHtml(action.label)}</h2>`,
    `<p>${escapeHtml(action.detail)}</p>`,
    buttons,
    resume,
    confirm,
    cheaper,
    floors,
    `</li>`,
  ].join("");
}
