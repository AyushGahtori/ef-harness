import fs from "node:fs";
import path from "node:path";
import { asPrefixedSha256 } from "../views-shared/digest.js";
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(full, "utf8")) as unknown;
  } catch {
    return emptyManifest();
  }
  if (!isRecord(parsed)) return emptyManifest();
  if (Array.isArray(parsed.fileRecords) && Array.isArray(parsed.nodes)) {
    return { files: parsed.fileRecords.filter(isFileRecord), nodes: parsed.nodes.filter(isNodeRecord) };
  }
  if (Array.isArray(parsed.files) && Array.isArray(parsed.nodes)) {
    return { files: parsed.files.filter(isFileRecord), nodes: parsed.nodes.filter(isNodeRecord) };
  }
  if (Array.isArray(parsed.records)) return manifestFromExportRecords(parsed.records, parsed.exportedAt);
  if (isRecord(parsed.files)) return manifestFromCanonicalFiles(parsed.files, parsed.exportedAt);
  return emptyManifest();
}

export function saveManifest(viewsRoot: string, manifest: ViewManifest): void {
  fs.mkdirSync(viewsRoot, { recursive: true });
  const files: Record<string, { sha256: string; nodeIds: readonly string[] }> = {};
  let exportedAt = 0;
  for (const file of manifest.files) {
    files[file.filePath] = { sha256: asPrefixedSha256(file.contentSha256), nodeIds: [...file.nodeIds] };
    if (file.exportedAt > exportedAt) exportedAt = file.exportedAt;
  }
  const body = {
    schemaVersion: 1,
    exportedAt,
    files,
    fileRecords: manifest.files,
    nodes: manifest.nodes,
  };
  fs.writeFileSync(manifestPath(viewsRoot), `${JSON.stringify(body, null, 2)}\n`, "utf8");
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

function manifestFromExportRecords(records: readonly unknown[], exportedAt: unknown): ViewManifest {
  const nodeIds = new Map<string, string[]>();
  const nodes: ManifestNodeRecord[] = [];
  const fileHashes = new Map<string, { contentSha256: string; exportedRev: number; exportedAt: number }>();
  for (const entry of records) {
    if (!isRecord(entry) || typeof entry.filePath !== "string" || typeof entry.nodeId !== "string") continue;
    const filePath = normalizeViewPath(entry.filePath);
    const stamp = epochNumber(entry.exportedAt, exportedAt);
    const exportedRev = typeof entry.exportedRev === "number" && Number.isFinite(entry.exportedRev) ? entry.exportedRev : 0;
    if (entry.nodeId === "") {
      if (typeof entry.contentSha256 === "string") {
        fileHashes.set(filePath, { contentSha256: entry.contentSha256, exportedRev, exportedAt: stamp });
      }
      continue;
    }
    const ids = nodeIds.get(filePath) ?? [];
    ids.push(entry.nodeId);
    nodeIds.set(filePath, ids);
    const baseHash = typeof entry.baseHash === "string" && entry.baseHash.length > 0 ? entry.baseHash : "";
    const contentSha256 = baseHash.length > 0 ? baseHash : typeof entry.contentSha256 === "string" ? entry.contentSha256 : "";
    nodes.push({
      filePath,
      nodeId: entry.nodeId,
      exportedRev,
      nodeVersion: exportedRev,
      contentSha256,
      fieldsSha256: typeof entry.fieldsSha256 === "string" ? entry.fieldsSha256 : "",
      proseSha256: typeof entry.proseSha256 === "string" ? entry.proseSha256 : "",
      exportedAt: stamp,
    });
  }
  const files: ManifestFileRecord[] = [];
  const paths = [...new Set([...fileHashes.keys(), ...nodeIds.keys()])].sort();
  for (const filePath of paths) {
    const file = fileHashes.get(filePath);
    const ids = nodeIds.get(filePath) ?? [];
    files.push({
      filePath,
      contentSha256: file?.contentSha256 ?? "",
      exportedAt: file?.exportedAt ?? epochNumber(exportedAt, 0),
      exportedRev: file?.exportedRev ?? 0,
      featureId: null,
      efFile: filePath.replace(/\.md$/, ""),
      title: filePath,
      nodeIds: ids,
    });
  }
  return { files, nodes };
}

function manifestFromCanonicalFiles(files: Record<string, unknown>, exportedAt: unknown): ViewManifest {
  const stamp = epochNumber(exportedAt, 0);
  const records: ManifestFileRecord[] = [];
  for (const filePath of Object.keys(files).sort()) {
    const entry = files[filePath];
    if (!isRecord(entry) || typeof entry.sha256 !== "string" || !Array.isArray(entry.nodeIds)) continue;
    const nodeIds = entry.nodeIds.filter((id): id is string => typeof id === "string");
    records.push({
      filePath: normalizeViewPath(filePath),
      contentSha256: entry.sha256,
      exportedAt: stamp,
      exportedRev: 0,
      featureId: null,
      efFile: normalizeViewPath(filePath).replace(/\.md$/, ""),
      title: filePath,
      nodeIds,
    });
  }
  return { files: records, nodes: [] };
}

function epochNumber(value: unknown, fallback: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof fallback === "number" && Number.isFinite(fallback)) return fallback;
  return 0;
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
