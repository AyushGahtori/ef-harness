import type { HealthSignal } from "./types.js";
import { HEALTH_BADGE_SLOT_HEIGHT_PX } from "./types.js";

export interface HealthBadgeView {
  readonly kind: HealthSignal["kind"];
  readonly variant: string;
  readonly tone: HealthSignal["tone"];
  readonly label: string;
  readonly clusterLabel: string | null;
  readonly actions: HealthSignal["actions"];
  readonly flashing: false;
  readonly modal: false;
}

function escapeText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Inline badge row for one board card or office desk.
 * The slot keeps a fixed height when empty so the card does not jump.
 */
export class HealthSignalBadgeStrip {
  readonly taskId: string;
  readonly badges: readonly HealthBadgeView[];
  readonly layoutShift = 0 as const;
  readonly slotHeightPx = HEALTH_BADGE_SLOT_HEIGHT_PX;
  readonly flashing = false as const;
  readonly modal = false as const;
  readonly stealsFocus = false as const;
  readonly presentation = "inline_badge" as const;
  readonly explainButton: {
    readonly label: "Explain what's happening";
    readonly explicitClickOnly: true;
    readonly visible: boolean;
  };

  constructor(taskId: string, signals: readonly HealthSignal[], inspected: boolean) {
    this.taskId = taskId;
    this.badges = signals.map((signal) => ({
      kind: signal.kind,
      variant: signal.variant,
      tone: signal.tone,
      label: signal.label,
      clusterLabel: signal.clusterLabel,
      actions: signal.actions,
      flashing: false,
      modal: false,
    }));
    const flagged = signals.some((signal) => signal.alarm);
    this.explainButton = {
      label: "Explain what's happening",
      explicitClickOnly: true,
      visible: flagged || inspected,
    };
  }

  render(): string {
    const badges = this.badges
      .map(
        (badge) =>
          `<span data-signal="${badge.kind}" data-tone="${badge.tone}" data-flashing="false">${escapeText(badge.label)}</span>`,
      )
      .join("");
    const actions = this.badges
      .flatMap((badge) => badge.actions)
      .map(
        (item) =>
          `<button type="button" data-action="${item.id}" data-modal="false">${escapeText(item.label)}</button>`,
      )
      .join("");
    const explain = this.explainButton.visible
      ? `<button type="button" data-action="explain" data-modal="false">${this.explainButton.label}</button>`
      : "";
    return `<div data-health-slot="true" data-task="${escapeText(this.taskId)}" data-layout-shift="0" data-slot-height="${this.slotHeightPx}" data-flashing="false" data-modal="false">${badges}${actions}${explain}</div>`;
  }
}
