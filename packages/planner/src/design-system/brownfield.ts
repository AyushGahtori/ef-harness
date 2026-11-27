import fs from "node:fs";
import path from "node:path";
import type { DesignKit } from "./types.js";

export interface BrownfieldReport {
  readonly detected: boolean;
  readonly kit: DesignKit;
  readonly signals: readonly string[];
  readonly extractedHex: readonly string[];
  readonly existingPaths: readonly string[];
}

const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

export function detectBrownfield(projectRoot: string): BrownfieldReport {
  if (!fs.existsSync(projectRoot)) {
    return { detected: false, kit: "shadcn", signals: [], extractedHex: [], existingPaths: [] };
  }
  const files = walk(projectRoot);
  const signals: string[] = [];
  const existingPaths = files.map((file) => file.rel);
  const packageJson = files.find((file) => file.rel === "package.json");
  const dependencies = packageJson ? readDependencies(packageJson.contents) : [];
  let kit: DesignKit = "shadcn";
  if (dependencies.some((name) => name.startsWith("@mui/"))) {
    kit = "mui";
    signals.push("dependency:@mui");
  } else if (dependencies.some((name) => name.startsWith("@chakra-ui/"))) {
    kit = "chakra";
    signals.push("dependency:@chakra-ui");
  }
  const hasUi = files.some((file) => file.rel.startsWith("src/components/ui/") || file.rel.startsWith("components/ui/"));
  const hasTailwind = files.some((file) => /(^|\/)tailwind\.config\.(js|ts|mjs|cjs)$/.test(file.rel));
  const hasCssVars = files.some((file) => file.rel.endsWith(".css") && /--[a-z0-9-]+\s*:/i.test(file.contents));
  if (hasUi) {
    signals.push("components:ui");
    if (kit === "shadcn") kit = "local-ui";
  }
  if (hasTailwind || dependencies.includes("tailwindcss")) {
    signals.push("tailwind");
    if (kit === "shadcn") kit = "tailwind";
  }
  if (hasCssVars) signals.push("css-variables");
  const extracted = new Set<string>();
  for (const file of files) {
    if (!file.rel.endsWith(".css") && !/tailwind\.config/.test(file.rel) && file.rel !== "package.json") continue;
    for (const match of file.contents.matchAll(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
      extracted.add(expand(match[0] ?? ""));
    }
  }
  return {
    detected: signals.length > 0,
    kit: signals.length > 0 ? kit : "shadcn",
    signals,
    extractedHex: [...extracted],
    existingPaths,
  };
}

function expand(hex: string): string {
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((channel) => channel + channel).join("") : body;
  return `#${full.toUpperCase()}`;
}

function readDependencies(source: string): string[] {
  try {
    const parsed = JSON.parse(source) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
  } catch {
    return [];
  }
}

function walk(root: string): { rel: string; contents: string }[] {
  const found: { rel: string; contents: string }[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).replaceAll("\\", "/");
      if (entry.name.endsWith(".png") || entry.name.endsWith(".jpg")) continue;
      const stat = fs.statSync(full);
      if (stat.size > 1_000_000) continue;
      found.push({ rel, contents: fs.readFileSync(full, "utf8") });
    }
  };
  visit(root);
  return found;
}
