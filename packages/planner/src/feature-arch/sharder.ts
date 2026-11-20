import { countTokens, splitTokens } from "./tokens.js";
import { FEATURE_SHARD_TOKEN_CEILING, type GraphNode, type ShardFile, type ShardSet } from "./types.js";

const PROSE_BUDGET = 2_700;

export class ArchDocumentSharder {
  shard(nodes: readonly GraphNode[]): ShardSet {
    const assignment = new Map<string, string>();
    for (const node of nodes) assignment.set(node.id, initialPath(node));
    this.moveOversized(nodes, assignment);
    const linkLines = new Map<string, string[]>();
    this.addNodeLinks(nodes, assignment, linkLines);
    this.addSystemLinks(nodes, assignment, linkLines);
    const shards: ShardFile[] = [];
    const paths = [...new Set([...assignment.values(), ...linkLines.keys()])].sort();
    for (const shardPath of paths) {
      const group = nodes
        .filter((node) => assignment.get(node.id) === shardPath)
        .sort((a, b) => a.id.localeCompare(b.id));
      const links = unique(linkLines.get(shardPath) ?? []).sort();
      shards.push(...renderGroup(shardPath, group, links));
    }
    const duplicatedNodeIds: string[] = [];
    const seen = new Set<string>();
    for (const shard of shards) {
      for (const id of shard.canonicalNodeIds) {
        if (seen.has(id)) duplicatedNodeIds.push(id);
        seen.add(id);
      }
    }
    const overCeiling = shards.filter((shard) => shard.tokens > FEATURE_SHARD_TOKEN_CEILING).map((shard) => shard.path);
    shards.sort((a, b) => a.path.localeCompare(b.path));
    return {
      shards,
      ceiling: FEATURE_SHARD_TOKEN_CEILING,
      duplicatedNodeIds,
      overCeiling,
    };
  }

  private moveOversized(nodes: readonly GraphNode[], assignment: Map<string, string>): void {
    let guard = nodes.length + 2;
    while (guard > 0) {
      guard -= 1;
      let moved = false;
      const groups = groupBy(nodes, assignment);
      for (const [shardPath, group] of groups) {
        if (group.length <= 1) continue;
        if (countTokens(renderBody(shardPath, sectionsOf(group), [])) <= FEATURE_SHARD_TOKEN_CEILING) continue;
        const largest = [...group].sort(
          (a, b) => countTokens(b.text) - countTokens(a.text) || a.id.localeCompare(b.id),
        )[0];
        if (!largest) continue;
        assignment.set(largest.id, shardPath.replace(/\.md$/, `/${largest.id}.md`));
        moved = true;
        break;
      }
      if (!moved) break;
    }
  }

  private addNodeLinks(
    nodes: readonly GraphNode[],
    assignment: Map<string, string>,
    linkLines: Map<string, string[]>,
  ): void {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      const source = assignment.get(node.id);
      const links = node.fields.linkedNodeIds;
      if (!source || !Array.isArray(links)) continue;
      for (const link of links) {
        if (typeof link !== "string" || !byId.has(link)) continue;
        const target = assignment.get(link);
        if (!target || target === source) continue;
        pushLink(linkLines, source, `See ${link} (${target}).`);
      }
    }
  }

  private addSystemLinks(
    nodes: readonly GraphNode[],
    assignment: Map<string, string>,
    linkLines: Map<string, string[]>,
  ): void {
    for (const node of nodes) {
      if (node.kind !== "feature") continue;
      if (stringField(node.fields, "featureSlug") === "system") continue;
      const target = assignment.get(node.id);
      if (!target || target === "architecture/system.md") continue;
      pushLink(linkLines, "architecture/system.md", `See ${node.id} (${target}).`);
    }
  }
}

function renderGroup(shardPath: string, group: readonly GraphNode[], links: readonly string[]): ShardFile[] {
  const extras: ShardFile[] = [];
  const sections = group.map((node) => {
    const split = splitProse(shardPath, node);
    extras.push(...split.extras);
    return { id: node.id, prose: split.prose };
  });
  const withLinks = renderBody(shardPath, sections, links);
  if (links.length === 0 || countTokens(withLinks) <= FEATURE_SHARD_TOKEN_CEILING) {
    return [shardFile(shardPath, group.map((node) => node.id), withLinks), ...extras];
  }
  const refsPath = shardPath.replace(/\.md$/, "--refs.md");
  const refsBody = renderBody(refsPath, [], links);
  extras.push(shardFile(refsPath, [], refsBody));
  const pointed = renderBody(shardPath, sections, [`See refs (${refsPath}).`]);
  return [shardFile(shardPath, group.map((node) => node.id), pointed), ...extras];
}

function splitProse(shardPath: string, node: GraphNode): { prose: string; extras: ShardFile[] } {
  const whole = renderBody(shardPath, [{ id: node.id, prose: node.text }], []);
  if (countTokens(whole) <= FEATURE_SHARD_TOKEN_CEILING) return { prose: node.text, extras: [] };
  const chunks = splitTokens(node.text, PROSE_BUDGET);
  const first = chunks[0] ?? "";
  const rest = chunks.slice(1);
  const extras: ShardFile[] = [];
  const notes: string[] = [];
  rest.forEach((chunk, index) => {
    const part = shardPath.replace(/\.md$/, `/${node.id}--${index + 2}.md`);
    notes.push(`Continues in ${part}.`);
    const body = renderBody(part, [{ id: `${node.id} part ${index + 2}`, prose: chunk }], []);
    const extra = shardFile(part, [], body);
    extra.continuesNodeId = node.id;
    extras.push(extra);
  });
  const prose = [first, ...notes].filter((item) => item.trim() !== "").join("\n\n");
  return { prose, extras };
}

function sectionsOf(group: readonly GraphNode[]): { id: string; prose: string }[] {
  return group.map((node) => ({ id: node.id, prose: node.text }));
}

function renderBody(
  shardPath: string,
  sections: readonly { id: string; prose: string }[],
  links: readonly string[],
): string {
  const parts = [`# ${shardPath}`];
  for (const section of [...sections].sort((a, b) => a.id.localeCompare(b.id))) {
    const prose = section.prose.trim();
    parts.push(prose ? `## ${section.id}\n\n${prose}` : `## ${section.id}`);
  }
  for (const link of [...links].sort()) parts.push(link);
  return parts.join("\n\n");
}

function shardFile(shardPath: string, canonicalNodeIds: string[], body: string): ShardFile {
  return {
    path: shardPath,
    canonicalNodeIds: [...canonicalNodeIds].sort(),
    body,
    tokens: countTokens(body),
  };
}

function initialPath(node: GraphNode): string {
  const role = stringField(node.fields, "role");
  const slug = stringField(node.fields, "slug") ?? node.id;
  const featureSlug = stringField(node.fields, "featureSlug");
  const owner = stringField(node.fields, "owner");
  if (role === "screen_spec") return `architecture/screens/${slug}.md`;
  if (node.kind === "contract" || role === "contract") return `architecture/contracts/${slug}.md`;
  if (
    role === "hoisted_rule" ||
    role === "shared_file" ||
    role === "system" ||
    owner === "phase0-foundation" ||
    featureSlug === "system"
  ) {
    return "architecture/system.md";
  }
  if (featureSlug) return `architecture/features/${featureSlug}.md`;
  return "architecture/system.md";
}

function groupBy(nodes: readonly GraphNode[], assignment: Map<string, string>): Map<string, GraphNode[]> {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const shardPath = assignment.get(node.id);
    if (!shardPath) continue;
    const list = groups.get(shardPath) ?? [];
    list.push(node);
    groups.set(shardPath, list);
  }
  return groups;
}

function pushLink(linkLines: Map<string, string[]>, shardPath: string, line: string): void {
  const list = linkLines.get(shardPath) ?? [];
  list.push(line);
  linkLines.set(shardPath, list);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stringField(fields: Record<string, unknown>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}
