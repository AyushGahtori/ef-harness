import { h } from "./dom.js";
import type { GraphViewNode } from "./types.js";
import type { ReactNode } from "react";

export function renderAccessibleCanvasList(nodes: readonly GraphViewNode[]): ReactNode {
  const visible = nodes.filter((n) => !n.dimmed);
  return h(
    "ul",
    { role: "list", "aria-label": "Architecture canvas nodes" },
    ...visible.map((node) =>
      h("li", { key: node.id }, `${node.label} (${node.kind})${node.taskBadge ? ` — ${node.taskBadge}` : ""}`),
    ),
  );
}