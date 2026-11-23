import { createElement, type ReactNode } from "react";
import { renderAccessibleCanvasList } from "./accessible-list-view.js";
import { h } from "./dom.js";
import { ReactFlowCanvasView } from "./react-flow-canvas-view.js";
import type { CanvasGraphSnapshot } from "./types.js";

const ZOOM_PILLS = ["Level 1", "Level 2", "Level 3", "Level 4"] as const;
const STATUS_FILTERS = [
  "All",
  "Open / Needs Decision",
  "Conflicts",
  "Chosen For You (Delegated)",
  "Working",
  "Held",
  "Done",
] as const;
const LAYER_TOGGLES = ["Today", "Change", "Both"] as const;

export function renderCanvasSurface(snapshot: CanvasGraphSnapshot): ReactNode {
  return h(
    "section",
    {
      "aria-label": "Architecture canvas",
      "data-semantic-level": String(snapshot.semanticLevel),
      "data-minimap": snapshot.minimapCollapsed ? "collapsed" : "expanded",
      "data-minimap-corner": "bottom-right",
      "data-search-armed": snapshot.searchArmed ? "true" : "false",
      "data-panning": snapshot.panning ? "true" : "false",
    },
    h("input", { type: "search", "aria-label": "Search canvas", defaultValue: "" }),
    h(
      "div",
      { role: "group", "aria-label": "Status filters" },
      ...STATUS_FILTERS.map((label) => h("button", { type: "button", "aria-label": label }, label)),
    ),
    h(
      "div",
      { role: "group", "aria-label": "Brownfield layer" },
      ...LAYER_TOGGLES.map((label) => h("button", { type: "button", "aria-label": label }, label)),
    ),
    h(
      "div",
      { role: "group", "aria-label": "Semantic zoom" },
      ...ZOOM_PILLS.map((label) => h("button", { type: "button", "aria-label": label }, label)),
    ),
    h("button", { type: "button", "aria-label": "Auto-arrange layout" }, "Auto-arrange layout"),
    h(
      "button",
      { type: "button", "aria-label": snapshot.minimapCollapsed ? "Show minimap" : "Hide minimap" },
      "Minimap",
    ),
    createElement(ReactFlowCanvasView, { snapshot }),
    renderAccessibleCanvasList(snapshot.nodes),
  );
}
