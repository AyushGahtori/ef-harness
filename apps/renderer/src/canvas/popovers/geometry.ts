import { POPOVER_GAP } from "./types.js";
import type { Placement, Rect, Size } from "./types.js";

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function placePopover(anchor: Rect, size: Size, viewport: Rect): Placement {
  const width = Math.min(size.width, viewport.width);
  const height = Math.min(size.height, viewport.height);
  let x = anchor.x + anchor.width + POPOVER_GAP;
  let y = anchor.y;
  let flippedX = false;
  let flippedY = false;

  if (x + width > viewport.x + viewport.width) {
    x = anchor.x - POPOVER_GAP - width;
    flippedX = true;
  }
  if (y + height > viewport.y + viewport.height) {
    y = anchor.y + anchor.height - height;
    flippedY = true;
    if (y + height > viewport.y + viewport.height || y < viewport.y) {
      y = anchor.y - POPOVER_GAP - height;
      flippedY = true;
    }
  }

  const minX = viewport.x;
  const minY = viewport.y;
  const maxX = viewport.x + viewport.width - width;
  const maxY = viewport.y + viewport.height - height;
  const clampedX = clamp(x, minX, maxX);
  const clampedY = clamp(y, minY, maxY);
  if (clampedX !== x) flippedX = true;
  if (clampedY !== y) flippedY = true;

  return { x: clampedX, y: clampedY, width, height, flippedX, flippedY };
}

export function placementInside(placement: Placement, viewport: Rect): boolean {
  return (
    placement.x >= viewport.x &&
    placement.y >= viewport.y &&
    placement.x + placement.width <= viewport.x + viewport.width &&
    placement.y + placement.height <= viewport.y + viewport.height
  );
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}
