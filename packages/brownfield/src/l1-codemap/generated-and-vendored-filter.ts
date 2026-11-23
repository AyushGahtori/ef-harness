import path from "node:path";

const GENERATED_MARKERS = [
  /^\/\/ @generated\b/m,
  /^\/\* DO NOT EDIT \*\//m,
  /\.generated\.ts$/i,
  /\.g\.dart$/i,
  /_pb\.ts$/i,
];

const SKIP_SUFFIX = [
  ".min.js",
  ".min.mjs",
  ".map",
];

const SKIP_BASENAMES = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

const SKIP_DIR_PARTS = new Set([
  "vendor",
  "third_party",
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
]);

const PRISMA_CLIENT = /(?:^|[\\/])prisma[\\/]client(?:[\\/]|$)/i;

export interface FilterDecision {
  readonly skip: boolean;
  readonly reason?: string;
}

export class GeneratedAndVendoredFilter {
  readonly maxSourceBytes: number;

  constructor(options?: { readonly maxSourceBytes?: number }) {
    this.maxSourceBytes = options?.maxSourceBytes ?? 1_048_576;
  }

  shouldSkip(relPath: string, content: string | undefined, sizeBytes: number): FilterDecision {
    const normalized = relPath.replaceAll("\\", "/");

    if (SKIP_BASENAMES.has(path.basename(normalized))) {
      return { skip: true, reason: "lockfile" };
    }
    for (const suffix of SKIP_SUFFIX) {
      if (normalized.endsWith(suffix)) {
        return { skip: true, reason: "minified-or-map" };
      }
    }
    if (PRISMA_CLIENT.test(normalized)) {
      return { skip: true, reason: "prisma-client" };
    }
    const parts = normalized.split("/");
    if (parts.some((p) => SKIP_DIR_PARTS.has(p))) {
      return { skip: true, reason: "vendored-dir" };
    }
    if (sizeBytes > this.maxSourceBytes) {
      return { skip: true, reason: "oversized" };
    }
    if (content !== undefined) {
      if (content.includes("\n") === false && content.length > 4_000) {
        return { skip: true, reason: "minified-single-line" };
      }
      for (const pattern of GENERATED_MARKERS) {
        if (pattern.test(normalized) || pattern.test(content)) {
          return { skip: true, reason: "generated" };
        }
      }
    }
    return { skip: false };
  }
}