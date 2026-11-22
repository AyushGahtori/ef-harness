import type { ReactNode } from "react";
import { h, tone } from "./dom.js";
import type { ShellSlotRegistry, ShellViewModel } from "./types.js";

export function CollapsibleInspectorShell(props: {
  model: ShellViewModel;
  slots: ShellSlotRegistry;
}): ReactNode {
  const { model, slots } = props;
  const selection = model.inspectorSelection;
  const slot = selection ? slots.inspector?.[selection.kind] : undefined;
  const open = !model.layout.inspectorCollapsed;
  return h(
    "aside",
    {
      ...tone(model.tokens.text, model.tokens.inspectorBg),
      "aria-label": "Inspector",
      "data-zone": "inspector",
      "data-collapsed": open ? "false" : "true",
      "data-overlay": model.layout.inspectorOverlay ? "true" : "false",
      "data-width": String(open ? model.layout.inspectorWidthPx : 0),
      "data-requested-width": String(model.inspectorRequestedWidthPx),
      "aria-expanded": open ? "true" : "false",
    },
    h(
      "button",
      {
        type: "button",
        "data-command": "toggle-inspector",
        "aria-expanded": open ? "true" : "false",
        "aria-controls": "inspector-body",
        "aria-label": open ? "Collapse inspector" : "Expand inspector",
      },
      open ? "Collapse" : "Expand",
    ),
    h(
      "div",
      {
        id: "inspector-body",
        hidden: open ? undefined : true,
        "data-kind": selection?.kind ?? "empty",
      },
      selection
        ? h("h2", {}, selection.title)
        : h("p", {}, "Nothing selected"),
      selection && slot ? slot.render(selection, model) : null,
      selection && !slot
        ? h("p", {}, `${selection.kind} detail mounts here.`)
        : null,
    ),
  );
}
