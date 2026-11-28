import type {
  BoundsEvent,
  BoundsRecovery,
  ConnectedDisplay,
  DipRect,
  SavedWindowPlacement,
  ScreenPort,
} from "./types.js";

/** Minimum on-screen intersection before a restored window is treated as visible. */
export const MIN_VISIBLE_WIDTH = 120;
export const MIN_VISIBLE_HEIGHT = 80;

/** Top bar row that holds the Stop control. It must stay inside a work area. */
export const TOP_BAR_HEIGHT = 48;
export const STOP_BUTTON_WIDTH = 64;

export class DisconnectedMonitorError extends Error {
  readonly code: "no-connected-display" | "unrecoverable";

  constructor(code: "no-connected-display" | "unrecoverable", message: string) {
    super(message);
    this.name = "DisconnectedMonitorError";
    this.code = code;
  }
}

interface OverlapCandidate {
  readonly display: ConnectedDisplay;
  readonly hit: DipRect;
}

/**
 * Keeps main and pop-out windows on a connected display. Bounds are DIP.
 * A saved monitor that is unplugged, or a DPI change that clips the Stop
 * button, is clamped onto a display that is still attached.
 */
export class DisconnectedMonitorBoundsGuard {
  constructor(private readonly screen: ScreenPort) {}

  recover(saved: SavedWindowPlacement, event: BoundsEvent): BoundsRecovery {
    const displays = this.screen.getAllDisplays().filter((display) => workable(display));
    const primary = this.screen.getPrimaryDisplay();
    if (displays.length === 0 || !displays.some((display) => display.id === primary.id)) {
      throw new DisconnectedMonitorError(
        "no-connected-display",
        "No connected display can host a window",
      );
    }

    const clean = displays.find((display) => hostsCleanly(saved, display.workArea));
    if (clean) {
      return {
        bounds: rectOf(saved),
        displayId: clean.id,
        rescued: false,
        centeredOnPrimary: false,
        topBarStopVisible: true,
        reason: "already-visible",
        widthWithinWorkArea: saved.width <= clean.workArea.width,
        heightWithinWorkArea: saved.height <= clean.workArea.height,
        destinationScaleFactor: clean.scaleFactor,
      };
    }

    const candidates = sufficientOverlaps(saved, displays);
    const preferred =
      candidates.find((candidate) => candidate.display.id === saved.displayId) ??
      largestOverlap(candidates);
    if (preferred) {
      const slid = slideIntoWorkArea(preferred.display.workArea, saved);
      if (hostsCleanly(slid, preferred.display.workArea)) {
        return {
          bounds: slid,
          displayId: preferred.display.id,
          rescued: true,
          centeredOnPrimary: false,
          topBarStopVisible: true,
          reason: event === "display-metrics-changed" ? "dpi-reflow" : "top-bar-clipped",
          widthWithinWorkArea: slid.width <= preferred.display.workArea.width,
          heightWithinWorkArea: slid.height <= preferred.display.workArea.height,
          destinationScaleFactor: preferred.display.scaleFactor,
        };
      }
    }

    const centered = centerOnWorkArea(primary.workArea, saved);
    if (!hostsCleanly(centered, primary.workArea)) {
      throw new DisconnectedMonitorError(
        "unrecoverable",
        "Primary work area cannot show the window and its Stop button",
      );
    }
    const hit = intersection(saved, primary.workArea);
    return {
      bounds: centered,
      displayId: primary.id,
      rescued: true,
      centeredOnPrimary: true,
      topBarStopVisible: true,
      reason: hit === null ? "offscreen-monitor" : "insufficient-intersection",
      widthWithinWorkArea: centered.width <= primary.workArea.width,
      heightWithinWorkArea: centered.height <= primary.workArea.height,
      destinationScaleFactor: primary.scaleFactor,
    };
  }
}

export function stopButtonRect(bounds: DipRect): DipRect {
  const width = Math.min(STOP_BUTTON_WIDTH, bounds.width);
  const height = Math.min(TOP_BAR_HEIGHT, bounds.height);
  return {
    x: bounds.x + bounds.width - width,
    y: bounds.y,
    width,
    height,
  };
}

export function isTopBarStopVisible(bounds: DipRect, displays: readonly ConnectedDisplay[]): boolean {
  const stop = stopButtonRect(bounds);
  return displays.some(
    (display) => workable(display) && contains(display.workArea, stop) && bounds.y >= display.workArea.y,
  );
}

export function intersectionSize(bounds: DipRect, workArea: DipRect): DipRect | null {
  return intersection(bounds, workArea);
}

function hostsCleanly(bounds: DipRect, workArea: DipRect): boolean {
  const hit = intersection(bounds, workArea);
  if (!hit || hit.width < MIN_VISIBLE_WIDTH || hit.height < MIN_VISIBLE_HEIGHT) return false;
  if (bounds.y < workArea.y) return false;
  return contains(workArea, stopButtonRect(bounds));
}

function sufficientOverlaps(
  saved: DipRect,
  displays: readonly ConnectedDisplay[],
): OverlapCandidate[] {
  const found: OverlapCandidate[] = [];
  for (const display of displays) {
    const hit = intersection(saved, display.workArea);
    if (hit && hit.width >= MIN_VISIBLE_WIDTH && hit.height >= MIN_VISIBLE_HEIGHT) {
      found.push({ display, hit });
    }
  }
  return found;
}

function largestOverlap(candidates: readonly OverlapCandidate[]): OverlapCandidate | null {
  let best: OverlapCandidate | null = null;
  for (const candidate of candidates) {
    if (!best || area(candidate.hit) > area(best.hit)) best = candidate;
  }
  return best;
}

function slideIntoWorkArea(workArea: DipRect, saved: DipRect): DipRect {
  const { width, height } = fitSize(workArea, saved);
  let x = saved.x;
  let y = saved.y;
  if (x < workArea.x) x = workArea.x;
  if (y < workArea.y) y = workArea.y;
  if (x + width > workArea.x + workArea.width) x = workArea.x + workArea.width - width;
  if (y + height > workArea.y + workArea.height) y = workArea.y + workArea.height - height;
  return { x, y, width, height };
}

function centerOnWorkArea(workArea: DipRect, saved: DipRect): DipRect {
  const { width, height } = fitSize(workArea, saved);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    width,
    height,
  };
}

function fitSize(workArea: DipRect, saved: DipRect): { width: number; height: number } {
  const minWidth = Math.min(workArea.width, MIN_VISIBLE_WIDTH);
  const minHeight = Math.min(workArea.height, MIN_VISIBLE_HEIGHT);
  return {
    width: Math.min(workArea.width, Math.max(saved.width, minWidth)),
    height: Math.min(workArea.height, Math.max(saved.height, minHeight)),
  };
}

function intersection(a: DipRect, b: DipRect): DipRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - x;
  const height = bottom - y;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function contains(outer: DipRect, inner: DipRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function area(rect: DipRect): number {
  return rect.width * rect.height;
}

function rectOf(saved: SavedWindowPlacement): DipRect {
  return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
}

function workable(display: ConnectedDisplay): boolean {
  return display.workArea.width > 0 && display.workArea.height > 0 && display.scaleFactor > 0;
}
