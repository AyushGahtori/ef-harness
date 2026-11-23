import fs from "node:fs";
import path from "node:path";
import { uniqueVariants } from "./naming-variants.js";
import { classifyLineHit, defaultFileZone, isHistoricalMigrationPath } from "./zone-classifier.js";
import type { ReferenceHit, SafetyZone } from "./types.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".ef"]);

export type InventoryScanOptions = {
  readonly repoRoot: string;
  readonly targetSymbol: string;
  readonly globs?: readonly string[];
  readonly maxFileBytes?: number;
};

export type InventoryScanResult = {
  readonly targetSymbol: string;
  readonly variants: readonly string[];
  readonly hits: readonly ReferenceHit[];
  readonly hitsByZone: Readonly<Record<SafetyZone, readonly ReferenceHit[]>>;
};

function walkFiles(repoRoot: string, maxBytes: number): string[] {
  const out: string[] = [];
  const stack = [repoRoot];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(full);
          if (stat.size <= maxBytes) {
            out.push(full);
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }
  return out.map((f) => path.relative(repoRoot, f).replaceAll("\\", "/"));
}

function lineMatches(line: string, variant: string): boolean {
  if (variant.length < 2) return line.includes(variant);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(variant)}([^A-Za-z0-9_]|$)`);
  if (pattern.test(line)) return true;
  if (variant.includes("_")) {
    return line.includes(variant);
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class VariantExpandedReferenceInventory {
  scan(options: InventoryScanOptions): InventoryScanResult {
    const variants = uniqueVariants(options.targetSymbol);
    const maxBytes = options.maxFileBytes ?? 512_000;
    const files = walkFiles(options.repoRoot, maxBytes);
    const hits: ReferenceHit[] = [];

    for (const rel of files) {
      const full = path.join(options.repoRoot, rel);
      let text: string;
      try {
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue;

      const fileZone = defaultFileZone(rel);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const lineText = lines[i] ?? "";
        for (const variant of variants) {
          if (!lineMatches(lineText, variant)) continue;
          const column = Math.max(0, lineText.indexOf(variant));
          const classified =
            fileZone === "immutable_migration"
              ? { zone: "immutable_migration" as const }
              : classifyLineHit(rel, lineText, variant);
          const hit: ReferenceHit = {
            filePath: rel,
            line: i + 1,
            column,
            matchedText: variant,
            variant,
            zone: classified.zone,
            contextSnippet: lineText.trim().slice(0, 200),
          };
          if (classified.persistedKind) {
            hits.push({ ...hit, persistedKind: classified.persistedKind });
          } else {
            hits.push(hit);
          }
        }
      }
    }

    const hitsByZone: Record<SafetyZone, ReferenceHit[]> = {
      zone1_internal: [],
      zone2_persisted: [],
      immutable_migration: [],
    };
    for (const hit of hits) {
      hitsByZone[hit.zone].push(hit);
    }

    return {
      targetSymbol: options.targetSymbol,
      variants,
      hits,
      hitsByZone,
    };
  }

  /** Blocks codemod writes to immutable migration paths. */
  assertCodemodAllowed(filePath: string): void {
    if (isHistoricalMigrationPath(filePath)) {
      throw new HistoricalMigrationWriteBlockedError(filePath);
    }
  }
}

export class HistoricalMigrationWriteBlockedError extends Error {
  readonly filePath: string;

  constructor(filePath: string) {
    super(`Historical migration file is read-only for sweeps: ${filePath}`);
    this.name = "HistoricalMigrationWriteBlockedError";
    this.filePath = filePath;
  }
}