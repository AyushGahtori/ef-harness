import { compareText } from "./canonical-hash.js";
import type { ViewEdge, ViewNode } from "./knowledge-graph-port.js";

export function renderMermaid(
  fileId: string,
  revision: number,
  nodes: readonly ViewNode[],
  edges: readonly ViewEdge[],
): string {
  const lines = [`%% ef_file: ${fileId}`, `%% ef_revision: ${String(revision)}`, "flowchart LR"];
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const sorted = [...nodes].sort((left, right) => compareText(left.id, right.id));
  for (const node of sorted) {
    let mermaidId = mermaidSafe(node.id);
    if (used.has(mermaidId)) {
      let suffix = 2;
      while (used.has(`${mermaidId}_${String(suffix)}`)) suffix += 1;
      mermaidId = `${mermaidId}_${String(suffix)}`;
    }
    used.add(mermaidId);
    ids.set(node.id, mermaidId);
    lines.push(`  ${mermaidId}["${escapeMermaid(node.id)} ${escapeMermaid(node.title)}"]`);
  }
  const present = new Set(nodes.map((node) => node.id));
  const sortedEdges = edges
    .filter((edge) => edge.validToRev === null && present.has(edge.src) && present.has(edge.dst))
    .sort(
      (left, right) =>
        compareText(left.src, right.src) || compareText(left.type, right.type) || compareText(left.dst, right.dst),
    );
  for (const edge of sortedEdges) {
    const src = ids.get(edge.src);
    const dst = ids.get(edge.dst);
    if (!src || !dst) continue;
    lines.push(`  ${src} -->|${escapeMermaid(edge.type)}| ${dst}`);
  }
  return `${lines.join("\n")}\n`;
}

function mermaidSafe(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  const base = cleaned.length > 0 ? cleaned : "n";
  return /^[A-Za-z]/.test(base) ? base : `n_${base}`;
}

function escapeMermaid(text: string): string {
  return text
    .replaceAll("\\", "/")
    .replaceAll('"', "'")
    .replaceAll("|", "/")
    .replaceAll("[", "(")
    .replaceAll("]", ")")
    .replaceAll("\n", " ")
    .replaceAll("\r", " ");
}
