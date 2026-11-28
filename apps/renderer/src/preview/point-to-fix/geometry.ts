import type { LayoutBox, PreviewNode } from "./types.js";
import { CROP_PADDING_PX } from "./types.js";

export function overlaps(left: LayoutBox, right: LayoutBox): boolean {
  return (
    left.x < right.x + right.width &&
    left.x + left.width > right.x &&
    left.y < right.y + right.height &&
    left.y + left.height > right.y
  );
}

export function measureGap(
  left: LayoutBox,
  right: LayoutBox,
): { readonly axis: "vertical" | "horizontal"; readonly px: number } {
  const vertical = Math.max(
    left.y - (right.y + right.height),
    right.y - (left.y + left.height),
  );
  const horizontal = Math.max(
    left.x - (right.x + right.width),
    right.x - (left.x + left.width),
  );
  if (vertical >= 0 && (horizontal < 0 || vertical <= horizontal)) {
    return { axis: "vertical", px: vertical };
  }
  if (horizontal >= 0) return { axis: "horizontal", px: horizontal };
  return { axis: "vertical", px: 0 };
}

export function bestGap(
  boxes: readonly LayoutBox[],
): { readonly axis: "vertical" | "horizontal"; readonly px: number } {
  let best: { axis: "vertical" | "horizontal"; px: number } | null = null;
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const left = boxes[i];
      const right = boxes[j];
      if (!left || !right) continue;
      const gap = measureGap(left, right);
      if (!best || gap.px < best.px) best = gap;
    }
  }
  return best ?? { axis: "vertical", px: 0 };
}

export function cropRect(
  box: LayoutBox,
  viewport: { readonly width: number; readonly height: number },
  padding = CROP_PADDING_PX,
): LayoutBox {
  const x = Math.max(0, box.x - padding);
  const y = Math.max(0, box.y - padding);
  const right = Math.min(viewport.width, box.x + box.width + padding);
  const bottom = Math.min(viewport.height, box.y + box.height + padding);
  return {
    x,
    y,
    width: Math.max(1, right - x),
    height: Math.max(1, bottom - y),
  };
}

export function viewportBox(node: PreviewNode, scrollY: number): LayoutBox {
  void scrollY;
  if (node.styles.position === "fixed" || node.portal) return node.box;
  return node.box;
}

export function flattenNodes(nodes: readonly PreviewNode[]): PreviewNode[] {
  const flat: PreviewNode[] = [];
  const visit = (node: PreviewNode): void => {
    flat.push(node);
    for (const child of node.shadowChildren) visit(child);
    for (const child of node.children) visit(child);
  };
  for (const node of nodes) visit(node);
  return flat;
}

export function elementsForRegion(
  drag: LayoutBox,
  nodes: readonly PreviewNode[],
): PreviewNode[] {
  const flat = flattenNodes(nodes);
  const hits = flat.filter((node) => overlaps(node.box, drag));
  const selected = new Set<PreviewNode>(hits);
  const above = nearestAbove(drag, flat);
  const below = nearestBelow(drag, flat);
  if (above) selected.add(above);
  if (below) selected.add(below);
  if (selected.size < 2) {
    const left = nearestLeft(drag, flat);
    const right = nearestRight(drag, flat);
    if (left) selected.add(left);
    if (right) selected.add(right);
  }
  return [...selected];
}

function nearestAbove(drag: LayoutBox, nodes: readonly PreviewNode[]): PreviewNode | null {
  let best: PreviewNode | null = null;
  let bestBottom = -Infinity;
  for (const node of nodes) {
    const bottom = node.box.y + node.box.height;
    if (bottom <= drag.y && bottom > bestBottom) {
      best = node;
      bestBottom = bottom;
    }
  }
  return best;
}

function nearestBelow(drag: LayoutBox, nodes: readonly PreviewNode[]): PreviewNode | null {
  let best: PreviewNode | null = null;
  let bestTop = Infinity;
  for (const node of nodes) {
    if (node.box.y >= drag.y + drag.height && node.box.y < bestTop) {
      best = node;
      bestTop = node.box.y;
    }
  }
  return best;
}

function nearestLeft(drag: LayoutBox, nodes: readonly PreviewNode[]): PreviewNode | null {
  let best: PreviewNode | null = null;
  let bestRight = -Infinity;
  for (const node of nodes) {
    const right = node.box.x + node.box.width;
    if (right <= drag.x && right > bestRight) {
      best = node;
      bestRight = right;
    }
  }
  return best;
}

function nearestRight(drag: LayoutBox, nodes: readonly PreviewNode[]): PreviewNode | null {
  let best: PreviewNode | null = null;
  let bestLeft = Infinity;
  for (const node of nodes) {
    if (node.box.x >= drag.x + drag.width && node.box.x < bestLeft) {
      best = node;
      bestLeft = node.box.x;
    }
  }
  return best;
}
