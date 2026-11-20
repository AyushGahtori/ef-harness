import path from "node:path";
import { pathToFileURL } from "node:url";
import { repositoryRoot } from "./paths.js";
import type { DiagramSpec, SystemSkeleton } from "./types.js";

interface MermaidParseModule {
  parseMermaidDiagram(source: string): Promise<{ diagramType: string }>;
}

let parser: Promise<MermaidParseModule> | null = null;

export async function verifyMermaidSyntax(
  source: string,
): Promise<{ ok: true; diagramType: string } | { ok: false; message: string }> {
  try {
    const parsed = await (await loadParser()).parseMermaidDiagram(source);
    return { ok: true, diagramType: parsed.diagramType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}

/** Quote flowchart labels that contain parentheses, the Mermaid grammar rejection `A[User (Admin)]`. */
export function quoteFlowchartLabels(source: string): string {
  return source.replace(/([A-Za-z][\w-]*)\[([^"\]\n]*)\]/g, (match, id: string, label: string) => {
    if (!label.includes("(") && !label.includes(")")) return match;
    return `${id}["${label.replaceAll('"', "'")}"]`;
  });
}

export function quoteSkeletonDiagrams(skeleton: SystemSkeleton): SystemSkeleton {
  return {
    ...skeleton,
    diagrams: skeleton.diagrams.map((diagram) => quoteDiagram(diagram)),
  };
}

function quoteDiagram(diagram: DiagramSpec): DiagramSpec {
  return { ...diagram, source: quoteFlowchartLabels(diagram.source) };
}

function loadParser(): Promise<MermaidParseModule> {
  if (!parser) {
    const file = path.join(repositoryRoot(), "packages", "planner", "src", "system-arch", "vendor", "mermaid-parse.mjs");
    parser = import(pathToFileURL(file).href) as Promise<MermaidParseModule>;
  }
  return parser;
}
