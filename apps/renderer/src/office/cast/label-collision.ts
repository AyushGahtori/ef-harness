import type { OfficeViewState, PlacedAgentLabel, SeatedCastMember } from "./types.js";

const LABEL_CHAR_PX = 6;
const LABEL_HEIGHT = 12;
const STAGGERS = [0, -14, 14, -28, 28] as const;

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function isProtected(seat: SeatedCastMember, view: OfficeViewState): boolean {
  return (
    seat.flagged || seat.agentId === view.hoveredAgentId || seat.agentId === view.selectedAgentId
  );
}

function protectionRank(seat: SeatedCastMember, view: OfficeViewState): number {
  return isProtected(seat, view) ? 1 : 0;
}

/**
 * At 1× with 15 or more desks, stagger labels and cull the ones that still
 * overlap. Hovered, selected, and flagged tags stay visible at the top.
 */
export function placeAgentLabels(
  seats: readonly SeatedCastMember[],
  view: OfficeViewState,
): PlacedAgentLabel[] {
  const cull = view.zoom === 1 && seats.length >= 15;
  const ranked = seats.slice().sort((a, b) => {
    const rank = protectionRank(b, view) - protectionRank(a, view);
    if (rank !== 0) return rank;
    return a.agentId.localeCompare(b.agentId);
  });
  const placed: PlacedAgentLabel[] = [];
  for (const seat of ranked) {
    const width = Math.max(seat.tag.text.length * LABEL_CHAR_PX, 12);
    const protectedLabel = isProtected(seat, view);
    const baseX = seat.x;
    const baseY = seat.y - 18;
    let chosen: { readonly x: number; readonly y: number } | null = null;
    for (const stagger of STAGGERS) {
      const box = { x: baseX, y: baseY + stagger, width, height: LABEL_HEIGHT };
      const hits = placed.some((label) => label.visible && intersects(label, box));
      if (!hits) {
        chosen = { x: box.x, y: box.y };
        break;
      }
    }
    const visible = protectedLabel || chosen !== null || !cull;
    const point = chosen ?? { x: baseX, y: baseY };
    placed.push({
      agentId: seat.agentId,
      taskId: seat.taskId,
      text: seat.tag.text,
      fullTitle: seat.tag.fullTitle,
      x: point.x,
      y: point.y,
      width,
      height: LABEL_HEIGHT,
      visible,
      culled: !visible,
      protected: protectedLabel,
      z: protectedLabel ? 1000 + placed.length : placed.length,
    });
  }
  return placed.sort((a, b) => a.agentId.localeCompare(b.agentId));
}
