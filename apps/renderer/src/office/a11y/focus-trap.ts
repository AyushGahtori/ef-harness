export interface FocusableMirrorNode {
  readonly id: string;
  readonly tabIndex: number;
  readonly label: string;
}

export type FocusTrapDecision =
  | { readonly type: "noop" }
  | { readonly type: "focus"; readonly id: string }
  | { readonly type: "exit"; readonly target: "inspector" | "composer" };

function indexOf(nodes: readonly FocusableMirrorNode[], id: string | null): number {
  if (id === null) return -1;
  return nodes.findIndex((node) => node.id === id);
}

/**
 * Keyboard focus never traps inside the semantic mirror — sentinel nodes exit to shell regions.
 */
export function reduceOfficeFocusTrap(input: {
  readonly nodes: readonly FocusableMirrorNode[];
  readonly focusedId: string | null;
  readonly key: "Tab" | "Shift+Tab";
  readonly shift: boolean;
}): FocusTrapDecision {
  if (input.nodes.length === 0) return { type: "noop" };
  const ordered = input.nodes.slice().sort((left, right) => left.tabIndex - right.tabIndex);
  const currentIndex = indexOf(ordered, input.focusedId);
  const forward = input.key === "Tab" && !input.shift;
  const backward = input.key === "Tab" && input.shift;
  if (currentIndex < 0) {
    return { type: "focus", id: forward ? ordered[0]!.id : ordered[ordered.length - 1]!.id };
  }
  if (forward && currentIndex === ordered.length - 1) {
    return { type: "exit", target: "inspector" };
  }
  if (backward && currentIndex === 0) {
    return { type: "exit", target: "composer" };
  }
  const delta = forward ? 1 : -1;
  const next = ordered[currentIndex + delta];
  if (!next) return { type: "noop" };
  return { type: "focus", id: next.id };
}