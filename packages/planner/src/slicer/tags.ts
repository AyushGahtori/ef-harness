import { compareText } from "./tokens.js";
import { fieldStrings, type SliceEdge, type SliceGraph, type SliceNode } from "./types.js";

const TOUCH_EDGES = new Set(["touches", "reads", "writes"]);
const UI_TAGS = new Set(["ui", "interactive_ui", "web", "print", "web_frontend"]);
const PAYMENT_TAGS = new Set(["payment", "money"]);

export function isEntity(node: SliceNode): boolean {
  return node.kind === "entity" || fieldString(node, "archKind") === "entity";
}

export function isScreen(node: SliceNode): boolean {
  return node.kind === "screen" || fieldString(node, "archKind") === "screen";
}

export function hasUiTag(tags: readonly string[]): boolean {
  return tags.some((tag) => UI_TAGS.has(tag));
}

export function hasPaymentTag(tags: readonly string[]): boolean {
  return tags.some((tag) => PAYMENT_TAGS.has(tag));
}

function fieldString(node: SliceNode, key: string): string | null {
  const value = node.fields[key];
  return typeof value === "string" ? value : null;
}

export interface TagReport {
  readonly ownTags: readonly string[];
  readonly inheritedTags: readonly string[];
  readonly effectiveTags: readonly string[];
}

export class LocalEntityTagInheritor {
  readonly source = "local-port:task-077" as const;

  report(graph: SliceGraph, taskId: string): TagReport {
    const task = graph.nodes.find((node) => node.id === taskId);
    const ownTags = task ? unique(fieldStrings(task.fields, "tags")) : [];
    const inherited: string[] = [];
    for (const edge of graph.edges) {
      if (!TOUCH_EDGES.has(edge.type)) continue;
      const otherId = otherEnd(edge, taskId);
      if (!otherId) continue;
      const other = graph.nodes.find((node) => node.id === otherId);
      if (!other || !isEntity(other)) continue;
      inherited.push(...fieldStrings(other.fields, "tags"));
    }
    for (const touched of task ? fieldStrings(task.fields, "touches") : []) {
      const other = graph.nodes.find((node) => node.id === touched);
      if (!other) continue;
      inherited.push(...fieldStrings(other.fields, "tags"));
    }
    const inheritedTags = unique(inherited);
    return {
      ownTags,
      inheritedTags,
      effectiveTags: unique([...ownTags, ...inheritedTags]),
    };
  }
}

function otherEnd(edge: SliceEdge, id: string): string | null {
  if (edge.src === id) return edge.dst;
  if (edge.dst === id) return edge.src;
  return null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareText);
}
