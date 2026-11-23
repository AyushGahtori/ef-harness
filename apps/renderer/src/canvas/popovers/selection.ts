import type { CanvasNodeCatalog, CanvasSelectionContextPort, ComposerTargetPort } from "./ports.js";
import {
  NAME_LIST_LIMIT,
  selectionSummaryNoun,
} from "./types.js";
import type { CanvasNode, Rect } from "./types.js";
import { intersects } from "./geometry.js";

export class MultiBoxSelectionController {
  private ids: string[] = [];

  constructor(
    private readonly catalog: CanvasNodeCatalog,
    private readonly context: CanvasSelectionContextPort,
    private readonly composer: ComposerTargetPort,
  ) {}

  get selectedIds(): readonly string[] {
    return [...this.ids];
  }

  selectedNodes(): CanvasNode[] {
    const nodes: CanvasNode[] = [];
    for (const id of this.ids) {
      const node = this.catalog.get(id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  selectOnly(nodeId: string): void {
    if (!this.catalog.get(nodeId)) return;
    this.ids = [nodeId];
    this.publish();
  }

  add(nodeId: string): void {
    if (!this.catalog.get(nodeId)) return;
    if (!this.ids.includes(nodeId)) this.ids.push(nodeId);
    this.publish();
  }

  marquee(rect: Rect): void {
    this.ids = this.catalog
      .list()
      .filter((node) => intersects(node.rect, rect))
      .map((node) => node.id);
    this.publish();
  }

  drop(nodeId: string): void {
    const next = this.ids.filter((id) => id !== nodeId);
    if (next.length === this.ids.length) return;
    this.ids = next;
    this.publish();
  }

  clear(): void {
    if (this.ids.length === 0) {
      this.publish();
      return;
    }
    this.ids = [];
    this.publish();
  }

  resync(): void {
    this.publish();
  }

  private publish(): void {
    const nodes = this.selectedNodes();
    const nodeIds = nodes.map((node) => node.id);
    this.ids = nodeIds;
    this.context.write(nodeIds);
    this.composer.syncBoxSelection({
      nodeIds,
      nodeRevisions: nodes.map((node) => node.revision),
      labels: nodes.map((node) => node.label),
    });
  }
}

export function selectionPillText(nodes: readonly CanvasNode[]): string | null {
  if (nodes.length === 0) return null;
  if (nodes.length <= NAME_LIST_LIMIT) {
    const noun = nodes.length === 1 ? "box" : "boxes";
    const names = nodes.map((node) => node.label).join(", ");
    return `${nodes.length} ${noun} selected: ${names} · Clear`;
  }
  const buckets = new Map<string, { count: number; singular: string; plural: string; order: number }>();
  for (const node of nodes) {
    const noun = selectionSummaryNoun(node.type);
    const current = buckets.get(noun.plural);
    if (current) current.count += 1;
    else buckets.set(noun.plural, { count: 1, ...noun });
  }
  const parts = [...buckets.values()]
    .sort((left, right) => left.order - right.order || left.plural.localeCompare(right.plural))
    .map((part) => `${part.count} ${part.count === 1 ? part.singular : part.plural}`);
  return `${nodes.length} boxes selected (${parts.join(", ")})`;
}
