import { createHash } from "node:crypto";

import type { HarnessStateTree, HistoryRecord } from "./types.js";
import { computeCanonicalGraphSha256 } from "./canonical-graph.js";
import { serializeEntity, serializeLease, serializeManifest } from "./yaml-format.js";
import { ENTITY_PATH_PREFIX } from "./types.js";
import { importSecretPatterns } from "./secret-patterns.js";
import { createZipArchive, readZipArchive } from "./zip-archive.js";
import { ZipImportError } from "./errors.js";
import { parseEntity, parseManifest } from "./yaml-format.js";

export interface PortableZipManifest {
  readonly projectId: string;
  readonly canonicalGraphSha256: string;
  readonly archiveSha256: string;
  readonly entryCount: number;
}

export class PortableZipArchiveManager {
  exportFromHarnessState(tree: HarnessStateTree, historyPath: string): { readonly zip: Uint8Array; readonly manifest: PortableZipManifest } {
    const entries: { path: string; content: Uint8Array }[] = [];

    const pushText = (path: string, content: string) => {
      assertNoSecrets(content, path);
      entries.push({ path, content: new TextEncoder().encode(content) });
    };

    pushText("manifest.yaml", serializeManifest(tree.manifest));
    pushText("lease.yaml", serializeLease(tree.lease));
    for (const entity of tree.entities) {
      const prefix = ENTITY_PATH_PREFIX[entity.kind];
      pushText(`${prefix}/${entity.id}.yaml`, serializeEntity(entity));
    }
    if (historyPath && tree.filesByPath[historyPath]) {
      pushText(historyPath, tree.filesByPath[historyPath]);
    }
    for (const [path, content] of Object.entries(tree.sealedChecksByPath)) {
      pushText(path, content);
    }

    entries.sort((left, right) => left.path.localeCompare(right.path));
    const zip = createZipArchive(entries);
    const archiveSha256 = createHash("sha256").update(zip).digest("hex");
    return {
      zip,
      manifest: {
        projectId: tree.manifest.projectId,
        canonicalGraphSha256: tree.manifest.canonicalGraphSha256,
        archiveSha256,
        entryCount: entries.length,
      },
    };
  }

  importToFileMap(zipBytes: Uint8Array): Record<string, string> {
    const decoded = readZipArchive(zipBytes);
    const files: Record<string, string> = {};
    for (const entry of decoded) {
      if (entry.path.includes(".env") || entry.path.startsWith("secrets/")) {
        throw new ZipImportError("secret_leak", `refusing zip import containing secrets path ${entry.path}`);
      }
      const text = new TextDecoder().decode(entry.content);
      assertNoSecrets(text, entry.path);
      files[entry.path] = text;
    }

    const manifestText = files["manifest.yaml"];
    if (!manifestText) {
      throw new ZipImportError("manifest_mismatch", "manifest.yaml missing in .ef-project.zip");
    }
    const manifest = parseManifest(manifestText);

    const entities = [];
    const history: HistoryRecord[] = [];
    for (const path of Object.keys(files)) {
      if (path.startsWith("history/") && path.endsWith(".jsonl")) {
        for (const line of (files[path] ?? "").split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          history.push(JSON.parse(trimmed) as HistoryRecord);
        }
        continue;
      }
      if (!path.endsWith(".yaml")) continue;
      if (path === "manifest.yaml" || path === "lease.yaml") continue;
      const prefix = path.split("/")[0] ?? "";
      const allowed = new Set(Object.values(ENTITY_PATH_PREFIX));
      if (!allowed.has(prefix)) continue;
      entities.push(parseEntity(files[path] ?? "", path));
    }
    entities.sort((left, right) => {
      const byKind = left.kind.localeCompare(right.kind);
      if (byKind !== 0) return byKind;
      return left.id.localeCompare(right.id);
    });
    const computed = computeCanonicalGraphSha256(entities, history);
    if (computed !== manifest.canonicalGraphSha256) {
      throw new ZipImportError(
        "manifest_mismatch",
        `canonicalGraphSha256 mismatch (manifest=${manifest.canonicalGraphSha256}, computed=${computed})`,
      );
    }
    return files;
  }
}

function assertNoSecrets(content: string, label: string): void {
  for (const pattern of importSecretPatterns()) {
    if (pattern.test(content)) {
      throw new ZipImportError("secret_leak", `refusing archive entry containing secret marker in ${label}`);
    }
  }
}