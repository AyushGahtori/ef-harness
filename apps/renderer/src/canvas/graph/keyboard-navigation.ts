export type CanvasKeyCommand =
  | { readonly kind: "zoom_in" }
  | { readonly kind: "zoom_out" }
  | { readonly kind: "zoom_fit" }
  | { readonly kind: "pan_toggle" }
  | { readonly kind: "focus_search" }
  | { readonly kind: "move_focus"; readonly direction: "next" | "prev" | "up" | "down" | "left" | "right" };

export function reduceCanvasKey(input: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly spaceDown: boolean;
}): CanvasKeyCommand | null {
  if (input.ctrlKey && input.key.toLowerCase() === "f") return { kind: "focus_search" };
  if (input.key === "+" || input.key === "=") return { kind: "zoom_in" };
  if (input.key === "-") return { kind: "zoom_out" };
  if (input.key === "0") return { kind: "zoom_fit" };
  if (input.key === " ") return { kind: "pan_toggle" };
  if (input.key === "Tab" && !input.shiftKey) return { kind: "move_focus", direction: "next" };
  if (input.key === "Tab" && input.shiftKey) return { kind: "move_focus", direction: "prev" };
  if (input.key === "ArrowUp") return { kind: "move_focus", direction: "up" };
  if (input.key === "ArrowDown") return { kind: "move_focus", direction: "down" };
  if (input.key === "ArrowLeft") return { kind: "move_focus", direction: "left" };
  if (input.key === "ArrowRight") return { kind: "move_focus", direction: "right" };
  return null;
}

export function tabOrderIds(visibleIds: readonly string[], currentId: string | null, direction: "next" | "prev"): string | null {
  if (visibleIds.length === 0) return null;
  const idx = currentId ? visibleIds.indexOf(currentId) : -1;
  if (direction === "next") {
    const next = idx + 1;
    return visibleIds[next >= visibleIds.length ? 0 : next] ?? null;
  }
  const prev = idx - 1;
  return visibleIds[prev < 0 ? visibleIds.length - 1 : prev] ?? null;
}

export function spatialNeighbor(
  nodes: readonly { id: string; x: number; y: number }[],
  currentId: string | null,
  direction: "up" | "down" | "left" | "right",
): string | null {
  if (nodes.length === 0) return null;
  const current = nodes.find((node) => node.id === currentId) ?? nodes[0];
  if (!current) return null;
  let best: { id: string; score: number } | null = null;
  for (const node of nodes) {
    if (node.id === current.id) continue;
    const dx = node.x - current.x;
    const dy = node.y - current.y;
    const aligned =
      (direction === "right" && dx > 0) ||
      (direction === "left" && dx < 0) ||
      (direction === "down" && dy > 0) ||
      (direction === "up" && dy < 0);
    if (!aligned) continue;
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2;
    if (!best || score < best.score) best = { id: node.id, score };
  }
  return best?.id ?? current.id;
}