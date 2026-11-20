import path from "node:path";
import {
  LocalArchDocumentSharder,
  slugify,
  splitShardGroup,
  type ArchDocumentSharder,
} from "./arch-document-sharder.js";
import { compareText, computeNodeContentHash } from "./canonical-hash.js";
import {
  EfNodeMarkerFormatter,
  extractNumericBounds,
  extractTouches,
  type EfFieldLink,
} from "./ef-node-marker.js";
import {
  asRecord,
  compareNodes,
  type KnowledgeViewSource,
  type ViewEdge,
  type ViewNode,
} from "./knowledge-graph-port.js";
import { renderMermaid } from "./mermaid.js";

export interface RenderedNode {
  readonly nodeId: string;
  readonly exportedRev: number;
  readonly contentSha256: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly fieldsYaml: string;
  readonly prose: string;
}

export interface RenderedViewFile {
  readonly relativePath: string;
  readonly content: string;
  readonly nodes: readonly RenderedNode[];
}

const formatter = new EfNodeMarkerFormatter();

export function renderViewTree(
  source: KnowledgeViewSource,
  sharder: ArchDocumentSharder = new LocalArchDocumentSharder(),
): readonly RenderedViewFile[] {
  const revision = source.currentRevision();
  const nodes = source.listNodes();
  const edges = source.listEdges();
  const groups = groupNodes(nodes, sharder);
  const pathByNode = new Map<string, string>();
  for (const [relativePath, group] of groups) {
    for (const node of group) pathByNode.set(node.id, relativePath);
  }
  const anchors = assignAnchors(nodes);
  const edgesBySrc = indexEdges(edges);
  const paths = [...groups.keys()].sort(compareText);
  const files: RenderedViewFile[] = [];
  for (const relativePath of paths) {
    const group = [...(groups.get(relativePath) ?? [])].sort(compareNodes);
    const renderedNodes = group.map((node) =>
      renderNode(node, relativePath, pathByNode, anchors, edgesBySrc.get(node.id) ?? []),
    );
    const content = renderMarkdown(relativePath, revision, paths, renderedNodes);
    files.push({ relativePath, content, nodes: renderedNodes.map(toRecord) });
  }
  const architectureNodes = nodes.filter((node) => (pathByNode.get(node.id) ?? "").startsWith("architecture/"));
  files.push({
    relativePath: "overview.mmd",
    content: renderMermaid("overview", revision, nodes, edges),
    nodes: [],
  });
  files.push({
    relativePath: "architecture/overview.mmd",
    content: renderMermaid("architecture/overview", revision, architectureNodes, edges),
    nodes: [],
  });
  return files.sort((left, right) => compareText(left.relativePath, right.relativePath));
}

function groupNodes(nodes: readonly ViewNode[], sharder: ArchDocumentSharder): Map<string, ViewNode[]> {
  const assignments = sharder.assign(nodes);
  const shardPath = new Map(assignments.map((assignment) => [assignment.nodeId, assignment.relativePath]));
  const initial = new Map<string, ViewNode[]>();
  for (const node of nodes) {
    const relativePath = shardPath.get(node.id) ?? routeLoose(node);
    const group = initial.get(relativePath);
    if (group) group.push(node);
    else initial.set(relativePath, [node]);
  }
  const grouped = new Map<string, ViewNode[]>();
  for (const relativePath of [...initial.keys()].sort(compareText)) {
    const group = initial.get(relativePath) ?? [];
    if (relativePath.startsWith("architecture/")) {
      grouped.set(relativePath, group);
      continue;
    }
    for (const [splitPath, splitGroup] of splitShardGroup(relativePath, group)) {
      grouped.set(splitPath, splitGroup);
    }
  }
  return grouped;
}

function routeLoose(node: ViewNode): string {
  switch (node.kind) {
    case "decision":
      return "decisions.md";
    case "spec_item":
    case "edge_case":
    case "journey":
      return node.feature ? `features/${slugify(node.feature)}.md` : "requirements.md";
    case "rule":
      return node.feature ? `features/${slugify(node.feature)}.md` : "rules/cross-cutting.md";
    case "research_fact":
      return "research.md";
    case "plan":
      return "plans.md";
    case "task":
      return "tasks.md";
    case "check":
      return "checks.md";
    case "waiver":
    case "ccr":
      return "governance.md";
    default:
      return `records/${slugify(node.kind)}.md`;
  }
}

function assignAnchors(nodes: readonly ViewNode[]): Map<string, string> {
  const used = new Set<string>();
  const anchors = new Map<string, string>();
  for (const node of [...nodes].sort(compareNodes)) {
    let anchor = slugify(node.id);
    if (used.has(anchor)) {
      let suffix = 2;
      while (used.has(`${anchor}-${String(suffix)}`)) suffix += 1;
      anchor = `${anchor}-${String(suffix)}`;
    }
    used.add(anchor);
    anchors.set(node.id, anchor);
  }
  return anchors;
}

function indexEdges(edges: readonly ViewEdge[]): Map<string, ViewEdge[]> {
  const bySrc = new Map<string, ViewEdge[]>();
  for (const edge of edges) {
    if (edge.validToRev !== null) continue;
    const list = bySrc.get(edge.src);
    if (list) list.push(edge);
    else bySrc.set(edge.src, [edge]);
  }
  for (const list of bySrc.values()) {
    list.sort(
      (left, right) =>
        compareText(left.type, right.type) ||
        compareText(left.dst, right.dst) ||
        (left.dstVersionPin ?? -1) - (right.dstVersionPin ?? -1),
    );
  }
  return bySrc;
}

interface FormattedPlacement {
  readonly node: ViewNode;
  readonly block: string;
  readonly fieldsYaml: string;
  readonly prose: string;
  readonly fieldsSha256: string;
  readonly proseSha256: string;
  readonly contentSha256: string;
}

function renderNode(
  node: ViewNode,
  filePath: string,
  pathByNode: ReadonlyMap<string, string>,
  anchors: ReadonlyMap<string, string>,
  edges: readonly ViewEdge[],
): FormattedPlacement {
  const fields = asRecord(node.fields);
  const links: EfFieldLink[] = edges.map((edge) => ({
    type: edge.type,
    dst: edge.dst,
    pin: edge.dstVersionPin,
  }));
  const markdownLinks = edges
    .filter((edge) => pathByNode.has(edge.dst))
    .map((edge) => {
      const target = pathByNode.get(edge.dst) ?? filePath;
      const anchor = anchors.get(edge.dst) ?? slugify(edge.dst);
      return `- ${edge.type} [${edge.dst}](${relativeHref(filePath, target, anchor)})`;
    });
  const formatted = formatter.formatBlock({
    id: node.id,
    anchor: anchors.get(node.id) ?? slugify(node.id),
    version: node.version,
    baseHash: baseHashOf(node),
    title: node.title,
    prose: node.text,
    kind: node.kind,
    status: node.status,
    basis: node.basis,
    owner: node.ownerRole,
    touches: extractTouches(fields),
    bounds: extractNumericBounds(fields),
    links,
    extraFields: fields,
    markdownLinks,
  });
  return { node, ...formatted };
}

function renderMarkdown(
  relativePath: string,
  revision: number,
  allPaths: readonly string[],
  nodes: readonly FormattedPlacement[],
): string {
  const lines = [
    "---",
    `ef_file: ${relativePath.replace(/\.md$/, "")}`,
    `ef_revision: ${String(revision)}`,
    "---",
    `# ${headingFor(relativePath)}`,
    "",
  ];
  const siblings = siblingNote(relativePath, allPaths);
  if (siblings.length > 0) {
    lines.push(siblings, "");
  }
  if (relativePath === "architecture/system.md" || relativePath.startsWith("architecture/system--")) {
    lines.push("[Architecture overview](./overview.mmd)", "");
  }
  lines.push(nodes.map((node) => node.block).join("\n\n"), "");
  return lines.join("\n");
}

function toRecord(formatted: FormattedPlacement): RenderedNode {
  return {
    nodeId: formatted.node.id,
    exportedRev: formatted.node.updatedRev,
    contentSha256: formatted.contentSha256,
    fieldsSha256: formatted.fieldsSha256,
    proseSha256: formatted.proseSha256,
    fieldsYaml: formatted.fieldsYaml,
    prose: formatted.prose,
  };
}

function baseHashOf(node: ViewNode): string {
  if (/^sha256:[0-9a-f]{64}$/.test(node.contentHash)) return node.contentHash;
  return computeNodeContentHash({
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: node.fields ?? {},
  });
}

function relativeHref(fromFile: string, toFile: string, anchor: string): string {
  const fromDir = path.posix.dirname(fromFile);
  let relative = path.posix.relative(fromDir, toFile);
  if (relative.length === 0) relative = path.posix.basename(toFile);
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return `${relative}#${anchor}`;
}

function siblingNote(filePath: string, allPaths: readonly string[]): string {
  const family = filePath.replace(/--\d+\.md$/, ".md");
  const siblings = allPaths
    .filter((candidate) => candidate.endsWith(".md") && candidate.replace(/--\d+\.md$/, ".md") === family)
    .sort(compareText);
  if (siblings.length < 2) return "";
  return `Related shards: ${siblings
    .map((candidate) => `[${path.posix.basename(candidate)}](./${path.posix.basename(candidate)})`)
    .join(", ")}`;
}

function headingFor(relativePath: string): string {
  const base = path.posix.basename(relativePath).replace(/--\d+\.md$/, "").replace(/\.md$/, "");
  if (relativePath === "decisions.md") return "Decisions";
  if (relativePath === "requirements.md") return "Requirements";
  if (relativePath === "rules/cross-cutting.md" || relativePath.startsWith("rules/cross-cutting--")) {
    return "Cross-cutting rules";
  }
  if (relativePath === "architecture/system.md" || relativePath.startsWith("architecture/system--")) {
    return "System architecture";
  }
  if (relativePath.startsWith("architecture/features/")) return `Feature ${base}`;
  if (relativePath.startsWith("architecture/screens/")) return `Screen ${base}`;
  if (relativePath.startsWith("architecture/contracts/")) return `Contract ${base}`;
  if (relativePath.startsWith("features/")) return `Feature ${base}`;
  if (relativePath === "research.md") return "Research";
  if (relativePath === "plans.md") return "Plans";
  if (relativePath === "tasks.md") return "Tasks";
  if (relativePath === "checks.md") return "Checks";
  if (relativePath === "governance.md") return "Governance";
  return base;
}
