import { createElement, type ReactNode } from "react";
import { CenterWorkspaceTabs } from "./center-tabs.js";
import { h, tone } from "./dom.js";
import { CollapsibleInspectorShell } from "./inspector.js";
import { CollapsibleLeftRail } from "./left-rail.js";
import { FixedTopBar } from "./top-bar.js";
import type { ShellSlotRegistry, ShellViewModel } from "./types.js";

export function SingleAppShellView(props: {
  model: ShellViewModel;
  slots: ShellSlotRegistry;
}): ReactNode {
  const { model, slots } = props;
  return h(
    "div",
    {
      id: "single-app-shell",
      "data-phase": model.phase,
      "data-theme": model.tokens.name,
      "data-theme-preference": model.themePreference,
      "data-focus-mode": model.focusMode ? "true" : "false",
      "data-revision": String(model.revision),
      "data-focus-visible": model.keyboardModality ? "true" : "false",
      ...tone(model.tokens.text, model.tokens.canvas),
    },
    createElement(FixedTopBar, { model }),
    h(
      "div",
      { "data-zone": "columns" },
      createElement(CollapsibleLeftRail, { model, slots }),
      h(
        "main",
        {
          "aria-label": "Workspace",
          "data-zone": "center",
          "data-center-width": String(model.layout.centerWidthPx),
          "data-center-height": String(model.layout.centerHeightPx),
          "data-worker-count": String(model.workerCount),
          "data-tab": model.centerTab,
        },
        createElement(CenterWorkspaceTabs, { model, slots }),
      ),
      createElement(CollapsibleInspectorShell, { model, slots }),
    ),
  );
}
