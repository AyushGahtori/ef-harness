/**
 * Local port of Task 084 `ArchDocumentSharder`.
 * Each architectural node is assigned to exactly one shard. Feature shards stay
 * within 3,000 whitespace tokens by splitting overflow into linked part files.
 */

import { compareText } from "./canonical-hash.js";
import {
  compareNodes,
  stringField,
  type ViewNode,
} from "./knowledge-graph-port.js";

export const FEATURE_SHARD_TOKEN_CEILING = 3000;

export interface ShardAssignment {
  readonly nodeId: string;
  readonly relativePath: string;
}

export interface ArchDocumentSharder {
  assign(nodes: readonly ViewNode[]): readonly ShardAssignment[];
}

export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function slugify(value: string): string {
  const slug = value.normalize("NFC").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "untitled";
}

export class LocalArchDocumentSharder implements ArchDocumentSharder {
  assign(nodes: readonly ViewNode[]): readonly ShardAssignment[] {
    const buckets = new Map<string, ViewNode[]>();
    for (const node of nodes) {
      const path = shardBasePath(node);
      if (path === null) continue;
      const group = buckets.get(path);
      if (group) group.push(node);
      else buckets.set(path, [node]);
    }
    const assignments: ShardAssignment[] = [];
    for (const basePath of [...buckets.keys()].sort(compareText)) {
      const group = buckets.get(basePath) ?? [];
      for (const [relativePath, packed] of splitShardGroup(basePath, group)) {
        for (const node of packed) {
          assignments.push({ nodeId: node.id, relativePath });
        }
      }
    }
    return assignments.sort((left, right) => compareText(left.nodeId, right.nodeId) || compareText(left.relativePath, right.relativePath));
  }
}

export function nodeTokenCost(node: ViewNode): number {
  const fields = node.fields === undefined ? "" : JSON.stringify(node.fields);
  return estimateTokens(`${node.title}\n${node.text}\n${fields}`) + 40;
}

function shardBasePath(node: ViewNode): string | null {
  const role = stringField(node, "role");
  const scope = stringField(node, "scope");
  if (node.kind === "contract" || role === "contract") {
    return `architecture/contracts/${slugify(node.id)}.md`;
  }
  if (role === "screen" || stringField(node, "screen_slug") !== null || node.kind === "screen_spec") {
    const slug = slugify(stringField(node, "screen_slug") ?? node.id);
    return `architecture/screens/${slug}.md`;
  }
  if (node.kind === "feature") {
    return `architecture/features/${slugify(node.feature ?? node.title)}.md`;
  }
  if (node.kind === "arch_node") {
    if (node.feature === null || scope === "system") return "architecture/system.md";
    return `architecture/features/${slugify(node.feature)}.md`;
  }
  return null;
}

export function splitShardGroup(basePath: string, nodes: readonly ViewNode[]): Map<string, ViewNode[]> {
  const sorted = [...nodes].sort(compareNodes);
  const groups: ViewNode[][] = [];
  let current: ViewNode[] = [];
  let tokens = 0;
  for (const node of sorted) {
    const cost = nodeTokenCost(node);
    if (current.length > 0 && tokens + cost > FEATURE_SHARD_TOKEN_CEILING) {
      groups.push(current);
      current = [];
      tokens = 0;
    }
    current.push(node);
    tokens += cost;
  }
  if (current.length > 0) groups.push(current);
  const packed = new Map<string, ViewNode[]>();
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index] ?? [];
    const relativePath = index === 0 ? basePath : basePath.replace(/\.md$/, `--${String(index + 1)}.md`);
    packed.set(relativePath, group);
  }
  return packed;
}
