import fs from "node:fs";
import path from "node:path";
import { fileHash, renderViewFile } from "./markers.js";
import type { GraphNode, KnowledgeGraphRepo, ManifestFileRecord, ManifestNodeRecord, ViewManifest } from "./types.js";

export const MANIFEST_NAME = ".manifest.json";

export function manifestPath(viewsRoot: string): string {
  return path.join(viewsRoot, MANIFEST_NAME);
}

export function emptyManifest(): ViewManifest {
  return { files: [], nodes: [] };
}

export function loadManifest(viewsRoot: string): ViewManifest {
  const full = manifestPath(viewsRoot);
  if (!fs.existsSync(full)) return emptyManifest();
  const parsed: unknown = JSON.parse(fs.readFileSync(full, "utf8"));
  if (!isRecord(parsed) || !Array.isArray(parsed.files) || !Array.isArray(parsed.nodes)) return emptyManifest();
  return {
    files: parsed.files.filter(isFileRecord),
    nodes: parsed.nodes.filter(isNodeRecord),
  };
}

export function saveManifest(viewsRoot: string, manifest: ViewManifest): void {
  fs.mkdirSync(viewsRoot, { recursive: true });
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(manifestPath(viewsRoot), body, "utf8");
}

export interface ViewFilePlan {
  readonly filePath: string;
  readonly featureId: string | null;
  readonly efFile: string;
  readonly title: string;
  readonly nodeIds: readonly string[];
}

/** Local stand-in for Task 085 `KnowledgeViewExporter`. Swap at integration. */
export function writeCanonicalViews(input: {
  readonly graph: KnowledgeGraphRepo;
  readonly viewsRoot: string;
  readonly files: readonly ViewFilePlan[];
  readonly exportedAt: number;
  readonly previous?: ViewManifest;
}): ViewManifest {
  const files: ManifestFileRecord[] = [];
  const nodes: ManifestNodeRecord[] = [];
  const revision = input.graph.currentRevision();
  fs.mkdirSync(input.viewsRoot, { recursive: true });
  for (const file of input.files) {
    const graphNodes: GraphNode[] = [];
    for (const nodeId of file.nodeIds) {
      const node = input.graph.getNode(nodeId);
      if (!node || node.status === "retired" || node.status === "superseded") continue;
      graphNodes.push(node);
    }
    graphNodes.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rendered = renderViewFile({
      efFile: file.efFile,
      featureId: file.featureId,
      efRevision: revision,
      title: file.title,
      nodes: graphNodes,
    });
    const absolute = viewFilePath(input.viewsRoot, file.filePath);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, rendered.text, "utf8");
    const contentSha256 = fileHash(rendered.text);
    files.push({
      filePath: normalizeViewPath(file.filePath),
      contentSha256,
      exportedAt: input.exportedAt,
      exportedRev: revision,
      featureId: file.featureId,
      efFile: file.efFile,
      title: file.title,
      nodeIds: graphNodes.map((node) => node.id),
    });
    graphNodes.forEach((node, index) => {
      const block = rendered.blocks[index];
      if (!block) return;
      nodes.push({
        filePath: normalizeViewPath(file.filePath),
        nodeId: node.id,
        exportedRev: revision,
        nodeVersion: node.version,
        contentSha256: block.baseHash,
        fieldsSha256: block.fieldsSha256,
        proseSha256: block.proseSha256,
        exportedAt: input.exportedAt,
      });
    });
  }
  const replaced = new Set(files.map((file) => file.filePath));
  const previous = input.previous ?? emptyManifest();
  const manifest: ViewManifest = {
    files: [...previous.files.filter((file) => !replaced.has(file.filePath)), ...files].sort((left, right) =>
      left.filePath < right.filePath ? -1 : left.filePath > right.filePath ? 1 : 0,
    ),
    nodes: [...previous.nodes.filter((node) => !replaced.has(node.filePath)), ...nodes].sort((left, right) =>
      left.filePath === right.filePath
        ? left.nodeId < right.nodeId
          ? -1
          : left.nodeId > right.nodeId
            ? 1
            : 0
        : left.filePath < right.filePath
          ? -1
          : 1,
    ),
  };
  saveManifest(input.viewsRoot, manifest);
  return manifest;
}

export function plansFromManifest(manifest: ViewManifest): ViewFilePlan[] {
  return manifest.files.map((file) => ({
    filePath: file.filePath,
    featureId: file.featureId,
    efFile: file.efFile,
    title: file.title,
    nodeIds: file.nodeIds,
  }));
}

export function viewFilePath(viewsRoot: string, filePath: string): string {
  const relative = normalizeViewPath(filePath).replace(/^\.harness\/views\//, "");
  return path.join(viewsRoot, ...relative.split("/"));
}

export function normalizeViewPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFileRecord(value: unknown): value is ManifestFileRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.filePath === "string" &&
    typeof value.contentSha256 === "string" &&
    typeof value.exportedAt === "number" &&
    typeof value.exportedRev === "number" &&
    (value.featureId === null || typeof value.featureId === "string") &&
    typeof value.efFile === "string" &&
    typeof value.title === "string" &&
    Array.isArray(value.nodeIds) &&
    value.nodeIds.every((id) => typeof id === "string")
  );
}

function isNodeRecord(value: unknown): value is ManifestNodeRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.filePath === "string" &&
    typeof value.nodeId === "string" &&
    typeof value.exportedRev === "number" &&
    typeof value.nodeVersion === "number" &&
    typeof value.contentSha256 === "string" &&
    typeof value.fieldsSha256 === "string" &&
    typeof value.proseSha256 === "string" &&
    typeof value.exportedAt === "number"
  );
}
