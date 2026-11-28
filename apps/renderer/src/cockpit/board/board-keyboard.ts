import type { BoardLaneId } from "./types.js";

export interface NavCard {
  readonly taskId: string;
  readonly topPx: number;
  readonly heightPx: number;
}

export interface NavLane {
  readonly id: BoardLaneId;
  readonly cards: readonly NavCard[];
}

export type KeyDecision =
  | { readonly type: "noop" }
  | { readonly type: "activate"; readonly taskId: string }
  | {
      readonly type: "move";
      readonly taskId: string;
      readonly lane: BoardLaneId;
      readonly scrollTop: number;
    };

function reveal(top: number, height: number, scrollTop: number, viewport: number): number {
  if (top < scrollTop) return top;
  if (top + height > scrollTop + viewport) return Math.max(0, top + height - viewport);
  return scrollTop;
}

function locate(
  lanes: readonly NavLane[],
  taskId: string | null,
): { laneIndex: number; cardIndex: number } | null {
  if (taskId === null) return null;
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (!lane) continue;
    const cardIndex = lane.cards.findIndex((card) => card.taskId === taskId);
    if (cardIndex >= 0) return { laneIndex, cardIndex };
  }
  return null;
}

function firstCard(lanes: readonly NavLane[]): { laneIndex: number; cardIndex: number } | null {
  for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
    const lane = lanes[laneIndex];
    if (lane && lane.cards.length > 0) return { laneIndex, cardIndex: 0 };
  }
  return null;
}

function move(
  lanes: readonly NavLane[],
  laneIndex: number,
  cardIndex: number,
  scrollTop: number,
  viewport: number,
): KeyDecision {
  const lane = lanes[laneIndex];
  const card = lane?.cards[cardIndex];
  if (!lane || !card) return { type: "noop" };
  return {
    type: "move",
    taskId: card.taskId,
    lane: lane.id,
    scrollTop: reveal(card.topPx, card.heightPx, scrollTop, viewport),
  };
}

export function reduceBoardKey(input: {
  readonly lanes: readonly NavLane[];
  readonly selectedTaskId: string | null;
  readonly scrollTop: Readonly<Record<BoardLaneId, number>>;
  readonly viewportHeightPx: number;
  readonly key: string;
}): KeyDecision {
  const current = locate(input.lanes, input.selectedTaskId) ?? firstCard(input.lanes);
  if (!current) return { type: "noop" };
  const lane = input.lanes[current.laneIndex];
  if (!lane) return { type: "noop" };
  const scroll = input.scrollTop[lane.id] ?? 0;
  if (input.key === "Enter") {
    const card = lane.cards[current.cardIndex];
    if (!card) return { type: "noop" };
    return { type: "activate", taskId: card.taskId };
  }
  if (input.key === "Home") return move(input.lanes, current.laneIndex, 0, scroll, input.viewportHeightPx);
  if (input.key === "End") {
    return move(input.lanes, current.laneIndex, lane.cards.length - 1, scroll, input.viewportHeightPx);
  }
  if (input.key === "ArrowDown" && current.cardIndex + 1 < lane.cards.length) {
    return move(input.lanes, current.laneIndex, current.cardIndex + 1, scroll, input.viewportHeightPx);
  }
  if (input.key === "ArrowUp" && current.cardIndex > 0) {
    return move(input.lanes, current.laneIndex, current.cardIndex - 1, scroll, input.viewportHeightPx);
  }
  if (input.key === "ArrowRight" || input.key === "ArrowLeft") {
    const step = input.key === "ArrowRight" ? 1 : -1;
    for (
      let laneIndex = current.laneIndex + step;
      laneIndex >= 0 && laneIndex < input.lanes.length;
      laneIndex += step
    ) {
      const nextLane = input.lanes[laneIndex];
      if (!nextLane || nextLane.cards.length === 0) continue;
      const cardIndex = Math.min(current.cardIndex, nextLane.cards.length - 1);
      const nextScroll = input.scrollTop[nextLane.id] ?? 0;
      return move(input.lanes, laneIndex, cardIndex, nextScroll, input.viewportHeightPx);
    }
  }
  return { type: "noop" };
}
