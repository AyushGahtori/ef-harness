import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { readComponentCatalog, type CatalogFileEntry } from "./catalog.js";
import { errorCode } from "./errors.js";
import { hashesEqual, sha256Hex } from "./hash.js";
import { assertSafeComponentId, safeChildPath } from "./paths.js";

export const AV_QUARANTINE_CARD =
  "Component missing or blocked by antivirus — Re-verify & Repair";

export type QuarantineReason = "ENOENT" | "EACCES" | "hash_mismatch";

export interface ComponentFileAccess {
  readFile(filePath: string): Buffer;
}

export const nodeComponentFileAccess: ComponentFileAccess = {
  readFile(filePath: string): Buffer {
    return readFileSync(filePath);
  },
};

export interface QuarantineFinding {
  readonly componentId: string;
  readonly relativePath: string;
  readonly reason: QuarantineReason;
  readonly card: typeof AV_QUARANTINE_CARD;
  readonly suggestedFallback: "os-dictation" | null;
}

export interface QuarantineReport {
  readonly ok: boolean;
  readonly card: string | null;
  readonly findings: readonly QuarantineFinding[];
  readonly suggestedFallback: "os-dictation" | null;
}

export interface ComponentRepairSource {
  download(componentId: string): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fallbackFor(componentId: string, relativePath: string): "os-dictation" | null {
  const blob = `${componentId}/${relativePath}`.toLowerCase();
  return blob.includes("whisper") ? "os-dictation" : null;
}

function readFilesJson(filePath: string): readonly CatalogFileEntry[] | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.files)) return null;
    const files: CatalogFileEntry[] = [];
    for (const entry of parsed.files) {
      if (!isRecord(entry) || typeof entry.path !== "string" || typeof entry.sha256 !== "string") return null;
      if (!Number.isSafeInteger(entry.sizeBytes)) return null;
      files.push({
        path: entry.path,
        sha256: entry.sha256,
        sizeBytes: entry.sizeBytes as number,
      });
    }
    return files;
  } catch (error) {
    void error;
    return null;
  }
}

/**
 * Detects antivirus quarantine without spawning the missing binary.
 * A missing, unreadable, or altered file becomes a repair card instead of `spawn ENOENT`.
 */
export class AvQuarantineIntegrityChecker {
  constructor(
    private readonly componentsRoot: string,
    private readonly files: ComponentFileAccess = nodeComponentFileAccess,
  ) {}

  inspect(componentId?: string): QuarantineReport {
    const ids = componentId === undefined ? this.knownIds() : [componentId];
    const findings: QuarantineFinding[] = [];
    for (const id of ids) {
      if (!this.isKnown(id)) continue;
      for (const expected of this.expectations(id)) {
        const finding = this.checkOne(id, expected);
        if (finding) findings.push(finding);
      }
    }
    const suggestedFallback = findings.some((finding) => finding.suggestedFallback === "os-dictation")
      ? "os-dictation"
      : null;
    return {
      ok: findings.length === 0,
      card: findings.length === 0 ? null : AV_QUARANTINE_CARD,
      findings,
      suggestedFallback,
    };
  }

  async repair(componentId: string, downloader: ComponentRepairSource): Promise<QuarantineReport> {
    assertSafeComponentId(componentId);
    await downloader.download(componentId);
    return this.inspect(componentId);
  }

  private knownIds(): string[] {
    const ids = new Set<string>(Object.keys(readComponentCatalog(this.componentsRoot)));
    if (existsSync(this.componentsRoot)) {
      for (const entry of readdirSync(this.componentsRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.name.startsWith("_")) ids.add(entry.name);
      }
    }
    return [...ids].sort();
  }

  private isKnown(componentId: string): boolean {
    if (existsSync(path.join(this.componentsRoot, componentId))) return true;
    return readComponentCatalog(this.componentsRoot)[componentId] !== undefined;
  }

  private expectations(componentId: string): readonly CatalogFileEntry[] {
    const directory = path.join(this.componentsRoot, componentId);
    const installed = readFilesJson(path.join(directory, "files.json"));
    if (installed !== null && installed.length > 0) return installed;
    const catalogued = readComponentCatalog(this.componentsRoot)[componentId];
    if (catalogued !== undefined && catalogued.files.length > 0) return catalogued.files;
    return [{ path: "files.json", sha256: "", sizeBytes: 0 }];
  }

  private checkOne(componentId: string, expected: CatalogFileEntry): QuarantineFinding | null {
    let fullPath: string;
    try {
      fullPath = safeChildPath(path.join(this.componentsRoot, componentId), expected.path);
    } catch (error) {
      void error;
      return this.finding(componentId, expected.path, "hash_mismatch");
    }
    let data: Buffer;
    try {
      data = this.files.readFile(fullPath);
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT") return this.finding(componentId, expected.path, "ENOENT");
      return this.finding(componentId, expected.path, "EACCES");
    }
    if (!hashesEqual(sha256Hex(data), expected.sha256)) {
      return this.finding(componentId, expected.path, "hash_mismatch");
    }
    return null;
  }

  private finding(componentId: string, relativePath: string, reason: QuarantineReason): QuarantineFinding {
    return {
      componentId,
      relativePath,
      reason,
      card: AV_QUARANTINE_CARD,
      suggestedFallback: fallbackFor(componentId, relativePath),
    };
  }
}
