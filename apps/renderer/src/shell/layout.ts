import {
  CENTER_MIN_PX,
  INSPECTOR_MAX_PX,
  INSPECTOR_MIN_PX,
  LEFT_RAIL_COLLAPSED_PX,
  LEFT_RAIL_MAX_PX,
  LEFT_RAIL_MIN_PX,
  TOP_BAR_HEIGHT_PX,
  type PaneRequest,
  type ResolvedLayout,
} from "./types.js";

export function clampPaneWidth(px: number, min: number, max: number): number {
  if (!Number.isFinite(px)) return min;
  return Math.min(max, Math.max(min, Math.round(px)));
}

export function clampLeftWidth(px: number): number {
  return clampPaneWidth(px, LEFT_RAIL_MIN_PX, LEFT_RAIL_MAX_PX);
}

export function clampInspectorWidth(px: number): number {
  return clampPaneWidth(px, INSPECTOR_MIN_PX, INSPECTOR_MAX_PX);
}

export function resolveLayout(input: PaneRequest): ResolvedLayout {
  const leftWidth = clampLeftWidth(input.leftWidthPx);
  const inspectorWidth = clampInspectorWidth(input.inspectorWidthPx);
  let leftCollapsed = input.leftCollapsed;
  let inspectorCollapsed = input.inspectorCollapsed;
  let leftForce = false;
  let inspectorForce = false;
  let leftOverlay = false;
  let inspectorOverlay = false;

  const center = (): number => {
    const left = leftOverlay ? 0 : leftCollapsed ? LEFT_RAIL_COLLAPSED_PX : leftWidth;
    const inspector =
      inspectorOverlay || inspectorCollapsed ? 0 : inspectorWidth;
    return input.viewportWidth - left - inspector;
  };

  if (center() < CENTER_MIN_PX) {
    const open = [
      { pane: "left" as const, at: input.leftOpenedAt, open: !leftCollapsed },
      { pane: "inspector" as const, at: input.inspectorOpenedAt, open: !inspectorCollapsed },
    ]
      .filter((item) => item.open)
      .sort((a, b) => a.at - b.at || (a.pane === "left" ? -1 : 1));
    const older = open[0];
    if (older?.pane === "left") {
      leftCollapsed = true;
      leftForce = true;
    } else if (older?.pane === "inspector") {
      inspectorCollapsed = true;
      inspectorForce = true;
    }
  }

  if (center() < CENTER_MIN_PX && !inspectorCollapsed) {
    inspectorOverlay = true;
  } else if (center() < CENTER_MIN_PX && inspectorForce) {
    inspectorCollapsed = false;
    inspectorForce = false;
    inspectorOverlay = true;
  }

  if (center() < CENTER_MIN_PX && !leftCollapsed) {
    leftCollapsed = true;
    leftForce = true;
  }

  if (center() < CENTER_MIN_PX && input.viewportWidth >= CENTER_MIN_PX) {
    leftOverlay = true;
    leftCollapsed = true;
    leftForce = true;
    if (!inspectorCollapsed) inspectorOverlay = true;
  }

  const leftTaken = leftOverlay ? 0 : leftCollapsed ? LEFT_RAIL_COLLAPSED_PX : leftWidth;
  const inspectorTaken = inspectorOverlay || inspectorCollapsed ? 0 : inspectorWidth;
  return {
    topBarHeightPx: TOP_BAR_HEIGHT_PX,
    leftWidthPx: leftCollapsed ? LEFT_RAIL_COLLAPSED_PX : leftWidth,
    leftCollapsed,
    leftForceCollapsed: leftForce,
    leftOverlay,
    inspectorWidthPx: inspectorCollapsed ? 0 : inspectorWidth,
    inspectorCollapsed,
    inspectorForceCollapsed: inspectorForce,
    inspectorOverlay: inspectorOverlay && !inspectorCollapsed,
    centerWidthPx: input.viewportWidth - leftTaken - inspectorTaken,
    centerHeightPx: Math.max(0, input.viewportHeight - TOP_BAR_HEIGHT_PX),
  };
}

export function layoutHoldsCenter(layout: ResolvedLayout, viewportWidth: number): boolean {
  if (viewportWidth < CENTER_MIN_PX) return layout.centerWidthPx === viewportWidth;
  return layout.centerWidthPx >= CENTER_MIN_PX;
}
