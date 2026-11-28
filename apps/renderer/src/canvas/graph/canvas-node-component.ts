import { memo, type ReactNode } from "react";
import { h } from "./dom.js";
import { visualGrammarForNode } from "./visual-grammar.js";
import type { GraphViewNode } from "./types.js";

export interface CanvasNodeComponentProps {
  readonly node: GraphViewNode;
  readonly theme: "light" | "dark";
  readonly onFocusConnected?: (nodeId: string) => void;
  readonly onOpenInspector?: (nodeId: string) => void;
}

function CanvasNodeView({ node, theme, onFocusConnected, onOpenInspector }: CanvasNodeComponentProps): ReactNode {
  const grammar = visualGrammarForNode({
    basis: node.basis,
    hasConflict: node.conflictBubble,
    skeletonLocked: node.skeletonLocked,
    theme,
  });
  const opacity = node.dimmed ? 0.25 : 1;
  const outline = node.highlighted
    ? `2px solid ${grammar.borderColor}`
    : `${String(grammar.borderWidthPx)}px ${grammar.borderStyle} ${grammar.borderColor}`;
  const badgeLine = node.aggregateBadge ?? node.taskBadge;

  return h(
    "div",
    {
      role: "group",
      "data-node-id": node.id,
      "data-kind": node.kind,
      "data-basis": node.basis ?? "none",
      "data-icon": grammar.icon,
      "data-border": grammar.borderStyle,
      "aria-label": `${node.label} ${grammar.ariaLabel}`,
      style: {
        opacity,
        padding: "8px 10px",
        borderRadius: 8,
        background: grammar.fill,
        color: grammar.textColor,
        border: outline,
        minWidth: 140,
        fontSize: 12,
        lineHeight: 1.35,
      },
    },
    h("div", { style: { display: "flex", gap: 6, alignItems: "center" } }, grammar.icon, node.label),
    grammar.badge ? h("div", { style: { fontSize: 10, marginTop: 4 } }, grammar.badge) : null,
    badgeLine ? h("div", { style: { fontSize: 10, marginTop: 4, fontVariantNumeric: "tabular-nums" } }, badgeLine) : null,
    onFocusConnected
      ? h(
          "button",
          {
            type: "button",
            "aria-label": `Focus connected ${node.label}`,
            "data-action": "focus-connected",
            style: { marginTop: 6, fontSize: 10 },
            onClick: () => onFocusConnected(node.id),
          },
          "Focus connected",
        )
      : null,
    node.kind === "task" && onOpenInspector
      ? h(
          "button",
          {
            type: "button",
            "aria-label": `Open worker inspector ${node.label}`,
            "data-action": "open-inspector",
            style: { marginTop: 6, fontSize: 10 },
            onClick: () => onOpenInspector(node.id),
          },
          "Open inspector",
        )
      : null,
  );
}

export const MemoizedCanvasNode = memo(CanvasNodeView);