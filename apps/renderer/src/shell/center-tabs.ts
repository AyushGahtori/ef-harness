import type { ReactNode } from "react";
import { h, tone } from "./dom.js";
import { CENTER_TABS, centerTabById, type CenterTabId, type ShellSlotRegistry, type ShellViewModel } from "./types.js";

export function CenterWorkspaceTabs(props: {
  model: ShellViewModel;
  slots: ShellSlotRegistry;
}): ReactNode {
  const { model, slots } = props;
  return h(
    "div",
    { "data-zone": "center-tabs" },
    h(
      "div",
      { role: "tablist", "aria-label": "Workspace", "data-focus-zone": "tablist" },
      ...CENTER_TABS.map((tab) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            id: `tab-${tab.id}`,
            "data-command": `tab:${tab.id}`,
            "aria-selected": model.centerTab === tab.id ? "true" : "false",
            "aria-controls": `panel-${tab.id}`,
            tabIndex: model.centerTab === tab.id ? 0 : -1,
            "aria-label": tab.label,
          },
          tab.label,
        ),
      ),
    ),
    ...CENTER_TABS.map((tab) => renderPanel(tab.id, model, slots)),
  );
}

function renderPanel(id: CenterTabId, model: ShellViewModel, slots: ShellSlotRegistry): ReactNode {
  const tab = centerTabById(id);
  const slot = slots.center?.[id];
  const active = model.centerTab === id;
  const scratch = model.tabScratch[id];
  return h(
    "div",
    {
      role: "tabpanel",
      id: `panel-${id}`,
      "aria-labelledby": `tab-${id}`,
      "data-mounted": "true",
      "data-tab": id,
      "data-scratch": scratch,
      hidden: active ? undefined : true,
      ...tone(model.tokens.text, model.tokens.canvas),
    },
    slot
      ? slot.render(model)
      : h("p", {}, `${tab.label} mounts here (${tab.ownerTask}).`),
    id === "office"
      ? h(
          "ul",
          { "aria-label": "Active workers", "data-worker-count": String(model.workerCount) },
          ...(model.workers.length === 0
            ? [h("li", { key: "none" }, "No workers yet")]
            : model.workers.map((worker) =>
                h("li", { key: worker.id, "data-worker": worker.id }, `${worker.id} ${worker.status}`),
              )),
        )
      : null,
  );
}
