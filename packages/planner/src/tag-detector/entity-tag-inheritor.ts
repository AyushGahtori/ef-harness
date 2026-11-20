import { isTouchTag, normalizeTouchTag, sortTouchTags, type TouchTag } from "./closed-tags.js";
import { RulesSeamsCatalogLoader } from "./catalog.js";
import {
  matchingRuleIds,
  type CrossCuttingRule,
  type RuleId,
} from "./rules.js";

const LINK_TYPES = new Set(["touches", "reads", "writes"]);
const RECEIVER_KINDS = new Set(["task", "endpoint", "screen", "api"]);

export interface GraphNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly tags: readonly string[];
}

export interface GraphLink {
  readonly type: string;
  readonly from: string;
  readonly to: string;
}

export interface KnowledgeGraphSnapshot {
  readonly nodes: readonly GraphNode[];
  readonly links: readonly GraphLink[];
}

export interface InheritedNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly ownTags: readonly string[];
  readonly inheritedTags: readonly string[];
  readonly effectiveTags: readonly string[];
  readonly packetRuleIds: readonly RuleId[];
}

export interface InheritanceReport {
  readonly nodes: readonly InheritedNode[];
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function orderTags(tags: readonly string[]): string[] {
  const closed: TouchTag[] = [];
  const extras: string[] = [];
  const seenClosed = new Set<TouchTag>();
  const seenExtra = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeTouchTag(tag);
    if (normalized && !seenClosed.has(normalized)) {
      seenClosed.add(normalized);
      closed.push(normalized);
    }
    if (!isTouchTag(tag) && !seenExtra.has(tag)) {
      seenExtra.add(tag);
      extras.push(tag);
    }
  }
  extras.sort((left, right) => left.localeCompare(right));
  return [...sortTouchTags(closed), ...extras];
}

function receiversForEntities(snapshot: KnowledgeGraphSnapshot): Map<string, Set<string>> {
  const adjacency = new Map<string, string[]>();
  for (const link of snapshot.links) {
    if (!LINK_TYPES.has(link.type)) continue;
    const from = adjacency.get(link.from) ?? [];
    from.push(link.to);
    adjacency.set(link.from, from);
    const to = adjacency.get(link.to) ?? [];
    to.push(link.from);
    adjacency.set(link.to, to);
  }
  const receiverIds = new Set(
    snapshot.nodes.filter((node) => RECEIVER_KINDS.has(node.kind)).map((node) => node.id),
  );
  const result = new Map<string, Set<string>>();
  for (const entity of snapshot.nodes.filter((node) => node.kind === "entity")) {
    const seen = new Set<string>([entity.id]);
    const queue = [entity.id];
    const hits = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const next of adjacency.get(current) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        if (receiverIds.has(next)) hits.add(next);
        queue.push(next);
      }
    }
    result.set(entity.id, hits);
  }
  return result;
}

function packetRules(tags: readonly string[], rules: readonly CrossCuttingRule[]): RuleId[] {
  const closed = new Set<TouchTag>();
  for (const tag of tags) {
    const normalized = normalizeTouchTag(tag);
    if (normalized) closed.add(normalized);
  }
  const ids = new Set<RuleId>(matchingRuleIds(rules, closed));
  if (tags.includes("pii") || tags.includes("personal_data") || closed.has("personal_data")) {
    ids.add("X-07");
  }
  if (tags.includes("money") || closed.has("money")) ids.add("X-04");
  if (tags.includes("multi_tenant")) ids.add("X-01");
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export class EntityTagInheritor {
  private loaded: readonly CrossCuttingRule[] | null = null;

  constructor(private readonly rules?: readonly CrossCuttingRule[]) {}

  private resolveRules(): readonly CrossCuttingRule[] {
    if (this.rules) return this.rules;
    this.loaded ??= new RulesSeamsCatalogLoader().loadRules();
    return this.loaded;
  }

  inherit(snapshot: KnowledgeGraphSnapshot): InheritanceReport {
    const rules = this.resolveRules();
    const byEntity = receiversForEntities(snapshot);
    const inheritedByNode = new Map<string, string[]>();
    for (const node of snapshot.nodes) inheritedByNode.set(node.id, []);
    for (const entity of snapshot.nodes.filter((node) => node.kind === "entity")) {
      const receivers = byEntity.get(entity.id) ?? new Set<string>();
      for (const receiverId of receivers) {
        const current = inheritedByNode.get(receiverId) ?? [];
        current.push(...entity.tags);
        inheritedByNode.set(receiverId, current);
      }
    }
    const nodes = snapshot.nodes.map((node) => {
      const inheritedTags = orderTags(unique(inheritedByNode.get(node.id) ?? []));
      const effectiveTags = orderTags(unique([...node.tags, ...inheritedTags]));
      return {
        id: node.id,
        kind: node.kind,
        title: node.title,
        ownTags: orderTags(node.tags),
        inheritedTags: RECEIVER_KINDS.has(node.kind) ? inheritedTags : [],
        effectiveTags: RECEIVER_KINDS.has(node.kind) ? effectiveTags : orderTags(node.tags),
        packetRuleIds: RECEIVER_KINDS.has(node.kind) ? packetRules(effectiveTags, rules) : [],
      };
    });
    nodes.sort((left, right) => left.id.localeCompare(right.id));
    return { nodes };
  }
}
