import { h } from "./a11y.js";
import {
  AMBER_BG,
  AMBER_FG,
  BUTTON_BG,
  FADED_BG,
  FADED_FG,
  GREEN_BG,
  GREEN_FG,
  INK,
  PAPER,
  VIOLET_BG,
  VIOLET_FG,
} from "./types.js";
import type { ActiveHighlight, Placement, PopoverModel, ToolbarAction, VNode } from "./types.js";

export function renderPopover(model: PopoverModel, placement: Placement, pinned: boolean): VNode {
  const children: VNode[] = [
    h("h2", { id: "popover-title", fg: INK, bg: PAPER }, [model.title]),
  ];
  for (const item of model.fields) {
    children.push(
      h("p", { fg: INK, bg: PAPER }, [`${item.label}: ${item.value}`]),
    );
  }
  if (model.thumbnailAlt) {
    children.push(h("img", { id: "popover-thumb", alt: model.thumbnailAlt, fg: INK, bg: PAPER }, []));
  }
  model.links.forEach((link, index) => {
    children.push(
      button(`popover-link-${index}-${link.nodeId}`, link.label, {
        "data-node": link.nodeId,
        "data-kind": "provenance",
      }),
    );
  });
  for (const action of model.actions) {
    children.push(button(`popover-action-${action.id}`, action.label, { "data-action": action.id }));
  }
  return h(
    "div",
    {
      id: "canvas-popover",
      role: "dialog",
      ariaLabel: model.title,
      fg: INK,
      bg: PAPER,
      attrs: {
        "data-x": String(placement.x),
        "data-y": String(placement.y),
        "data-w": String(placement.width),
        "data-h": String(placement.height),
        "data-pinned": pinned ? "true" : "false",
        "data-archived": model.archived ? "true" : "false",
        "data-flipped-x": placement.flippedX ? "true" : "false",
        "data-flipped-y": placement.flippedY ? "true" : "false",
      },
    },
    children,
  );
}

export function renderToolbar(actions: readonly ToolbarAction[]): VNode {
  return h(
    "div",
    { id: "canvas-quick-actions", role: "toolbar", ariaLabel: "Canvas quick actions", fg: INK, bg: PAPER },
    actions.map((action) => button(`toolbar-${action.id}`, action.label, { "data-action": action.id })),
  );
}

export function renderPill(text: string): VNode {
  return h(
    "p",
    { id: "selection-pill", fg: INK, bg: PAPER },
    [text, button("selection-clear", "Clear", { "data-action": "clear" })],
  );
}

export function renderComposerPill(text: string): VNode {
  return h("p", { id: "composer-target-pill", fg: INK, bg: PAPER }, [text]);
}

export function renderRecap(text: string): VNode {
  return h(
    "p",
    { id: "change-recap", fg: INK, bg: PAPER },
    [text, button("change-recap-action", recapButtonLabel(text), { "data-action": "recap" })],
  );
}

export function renderHighlights(highlights: readonly ActiveHighlight[]): VNode {
  return h(
    "ul",
    { id: "change-highlights", fg: INK, bg: PAPER },
    highlights.map((item) => {
      const colors = toneColors(item.tone);
      return h(
        "li",
        {
          id: `halo-${item.nodeId}`,
          fg: colors.fg,
          bg: colors.bg,
          attrs: {
            "data-kind": item.kind,
            "data-pulse": item.pulse ? "true" : "false",
            "data-motion": item.pulse ? "pulse" : "static",
            "data-opacity": item.opacity.toFixed(3),
            "data-strike": item.strike ? "line-through" : "none",
            "data-outline": item.outline ? "true" : "false",
            "data-offscreen": item.offscreen ? "true" : "false",
            "data-contrast": item.staticContrast ? "high" : "standard",
          },
        },
        [item.badge],
      );
    }),
  );
}

function recapButtonLabel(text: string): string {
  if (text.includes("Jump to")) {
    const marker = "Jump to ";
    const index = text.indexOf(marker);
    return text.slice(index);
  }
  return "View changes";
}

function toneColors(tone: ActiveHighlight["tone"]): { fg: string; bg: string } {
  if (tone === "green") return { fg: GREEN_FG, bg: GREEN_BG };
  if (tone === "violet") return { fg: VIOLET_FG, bg: VIOLET_BG };
  if (tone === "amber") return { fg: AMBER_FG, bg: AMBER_BG };
  return { fg: FADED_FG, bg: FADED_BG };
}

function button(id: string, label: string, attrs: Readonly<Record<string, string>>): VNode {
  return h(
    "button",
    { id, ariaLabel: label, fg: INK, bg: BUTTON_BG, minTargetPx: 24, attrs },
    [label],
  );
}
