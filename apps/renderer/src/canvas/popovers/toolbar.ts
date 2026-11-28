import type { BoxChatIntentPort, CanvasViewportPort } from "./ports.js";
import { NARROW_TOOLBAR_AT, zeroTokenIntent } from "./types.js";
import type { CanvasNode, ToolbarAction } from "./types.js";

const SINGLE: readonly ToolbarAction[] = [
  { id: "ask", label: "Ask about selection", intent: "ask", tokens: 0, combined: false },
  { id: "change", label: "Change", intent: "change", tokens: 0, combined: false },
  { id: "correct", label: "Correct (misheard)", intent: "correct_misheard", tokens: 0, combined: false },
  { id: "add-child", label: "Add child", intent: "add_child", tokens: 0, combined: false },
  { id: "remove-defer", label: "Remove / Defer", intent: "remove_defer", tokens: 0, combined: false },
  { id: "explain", label: "Explain impact", intent: "explain_impact", tokens: 0, combined: false },
  { id: "focus-connected", label: "Focus connected", intent: "focus_connected", tokens: 0, combined: false },
];

export function toolbarActionsFor(count: number): readonly ToolbarAction[] {
  if (count <= 0) return [];
  if (count === 1) return SINGLE;
  if (count >= NARROW_TOOLBAR_AT) {
    return [
      { id: "ask", label: "Ask about selection", intent: "ask", tokens: 0, combined: true },
      { id: "change", label: "Change", intent: "change", tokens: 0, combined: true },
      {
        id: "explain",
        label: "Explain combined impact",
        intent: "explain_impact",
        tokens: 0,
        combined: true,
      },
      { id: "clear", label: "Clear", intent: "clear", tokens: 0, combined: true },
    ];
  }
  return [
    ...SINGLE.map((action) => ({ ...action, combined: true })),
    { id: "clear", label: "Clear", intent: "clear", tokens: 0, combined: true },
  ];
}

export class CanvasQuickActionToolbar {
  constructor(
    private readonly intents: BoxChatIntentPort,
    private readonly canvas: CanvasViewportPort,
  ) {}

  actionsFor(count: number): readonly ToolbarAction[] {
    return toolbarActionsFor(count);
  }

  activate(actionId: string, nodes: readonly CanvasNode[]): void {
    const action = this.actionsFor(nodes.length).find((item) => item.id === actionId);
    if (!action || action.intent === "clear" || nodes.length === 0) return;
    const nodeIds = nodes.map((node) => node.id);
    if (action.intent === "focus_connected") this.canvas.focusConnected(nodeIds);
    const tokens = zeroTokenIntent(action.intent) ? 0 : action.tokens;
    this.intents.launch({
      intent: action.intent,
      nodeIds,
      nodeRevisions: nodes.map((node) => node.revision),
      tokens,
      label: action.label,
      combined: action.combined,
    });
  }
}
