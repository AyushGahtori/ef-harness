import { HealthSignalBadgeStrip } from "./badge-strip.js";
import { HEALTH_BADGE_SLOT_HEIGHT_PX } from "./types.js";

/** Local port of the badge slot Task 124 reserves on each board card. */
export interface BoardCardHealthSlot {
  readonly taskId: string;
  readonly owner: "task-125";
  readonly reservedHeightPx: number;
  readonly layoutShift: 0;
  readonly strip: HealthSignalBadgeStrip;
}

export function attachHealthSlots(
  cards: readonly { readonly taskId: string }[],
  strips: ReadonlyMap<string, HealthSignalBadgeStrip>,
): BoardCardHealthSlot[] {
  return cards.map((card) => {
    const strip = strips.get(card.taskId) ?? new HealthSignalBadgeStrip(card.taskId, [], false);
    return {
      taskId: card.taskId,
      owner: "task-125" as const,
      reservedHeightPx: strip.slotHeightPx,
      layoutShift: 0 as const,
      strip,
    };
  });
}

export const BOARD_HEALTH_SLOT_HEIGHT_PX = HEALTH_BADGE_SLOT_HEIGHT_PX;
