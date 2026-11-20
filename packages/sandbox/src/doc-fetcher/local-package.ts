import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { PathTraversalError } from "./errors.js";
import { parsePackageSpec } from "./policy.js";

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const README_NAMES = ["README.md", "README.markdown", "README.txt", "README"] as const;
const MAX_DECLARATION_FILES = 20;
const MAX_DECLARATION_CHARS = 64 * 1024;
const MAX_README_CHARS = 128 * 1024;

export interface LocalPackageFile {
  readonly relativePath: string;
  readonly text: string;
}

export interface LocalPackageSource {
  readonly name: string;
  readonly version: string;
  readonly packageJson: {
    readonly name: string;
    readonly version: string;
    readonly exports: unknown;
  };
  readonly readme: string | null;
  readonly declarationFiles: readonly LocalPackageFile[];
  readonly rootDir: string;
}

export interface LocalPackageOptions {
  readonly nodeModulesRoots?: readonly string[];
  readonly pnpmStoreDir?: string;
}

export function readInstalledPackage(spec: string, options: LocalPackageOptions = {}): LocalPackageSource | null {
  const trimmed = spec.trim();
  if (looksLikeTraversal(trimmed)) throw new PathTraversalError(trimmed);
  const parsed = parsePackageSpec(trimmed);
  if (!parsed) return null;
  assertSafePackageName(parsed.name);
  for (const root of options.nodeModulesRoots ?? []) {
    const found = searchProjectRoot(root, parsed.name, parsed.version);
    if (found) return found;
  }
  if (options.pnpmStoreDir) return searchStore(options.pnpmStoreDir, parsed.name, parsed.version);
  return null;
}

export function renderLocalPackage(source: LocalPackageSource): string {
  const parts = [
    `# ${source.name}@${source.version}`,
    "",
    "## package.json exports",
    "",
    "```json",
    JSON.stringify(source.packageJson.exports, null, 2),
    "```",
    "",
  ];
  if (source.readme !== null) parts.push("## README", "", source.readme, "");
  for (const file of source.declarationFiles) {
    parts.push(`## ${file.relativePath}`, "", "```ts", file.text, "```", "");
  }
  return parts.join("\n");
}

export function assertSafePackageName(name: string): void {
  if (looksLikeTraversal(name) || !PACKAGE_NAME.test(name)) throw new PathTraversalError(name);
}

function looksLikeTraversal(value: string): boolean {
  return (
    value !== value.trim() ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("\0") ||
    path.isAbsolute(value)
  );
}

function searchProjectRoot(root: string, name: string, version: string): LocalPackageSource | null {
  const direct = loadIfMatch(path.join(root, "node_modules", ...name.split("/")), root, name, version);
  if (direct) return direct;
  const pnpmDir = path.join(root, "node_modules", ".pnpm");
  if (!existsSync(pnpmDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(pnpmDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!pnpmEntryMatches(entry, name, version)) continue;
    const candidate = path.join(pnpmDir, entry, "node_modules", ...name.split("/"));
    const found = loadIfMatch(candidate, root, name, version);
    if (found) return found;
  }
  return null;
}

function searchStore(storeDir: string, name: string, version: string): LocalPackageSource | null {
  const nameDir = path.join(storeDir, ...name.split("/"));
  const folders = [path.join(storeDir, "v3", ...name.split("/")), nameDir];
  for (const folder of folders) {
    if (!existsSync(folder)) continue;
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!versionsMatch(entry, version)) continue;
      const found = loadIfMatch(path.join(folder, entry), storeDir, name, version);
      if (found) return found;
    }
  }
  return null;
}

function pnpmEntryMatches(entry: string, name: string, version: string): boolean {
  const key = `${name.replace("/", "+")}@`;
  if (!entry.startsWith(key)) return false;
  const folderVersion = entry.slice(key.length).split("_")[0] ?? "";
  return versionsMatch(folderVersion, version);
}

function loadIfMatch(dir: string, root: string, expectedName: string, requested: string): LocalPackageSource | null {
  const manifestPath = path.join(dir, "package.json");
  if (!existsSync(manifestPath)) return null;
  let realDir: string;
  let realRoot: string;
  try {
    realDir = realpathSync(dir);
    realRoot = realpathSync(root);
  } catch {
    return null;
  }
  if (!contained(realRoot, realDir)) throw new PathTraversalError(expectedName);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    return null;
  }
  if (!isManifest(parsed) || parsed.name !== expectedName || !versionsMatch(parsed.version, requested)) return null;
  return {
    name: parsed.name,
    version: parsed.version,
    packageJson: {
      name: parsed.name,
      version: parsed.version,
      exports: parsed.exports ?? null,
    },
    readme: readReadme(realDir),
    declarationFiles: readDeclarations(realDir, parsed),
    rootDir: realDir,
  };
}

function versionsMatch(installed: string, requested: string): boolean {
  if (installed === requested) return true;
  const requestedParts = requested.split("-")[0]?.split(".") ?? [];
  const installedParts = installed.split("-")[0]?.split(".") ?? [];
  if (requestedParts.length !== 2) return false;
  return installedParts[0] === requestedParts[0] && installedParts[1] === requestedParts[1];
}

function contained(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly exports?: unknown;
  readonly types?: unknown;
  readonly typings?: unknown;
}

function isManifest(value: unknown): value is Manifest {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.version === "string";
}

function readReadme(root: string): string | null {
  for (const name of README_NAMES) {
    const file = resolveInside(root, name);
    if (!file) continue;
    return readFileSync(file, "utf8").slice(0, MAX_README_CHARS);
  }
  return null;
}

function readDeclarations(root: string, manifest: Manifest): LocalPackageFile[] {
  const relativePaths = new Set<string>();
  if (typeof manifest.types === "string") relativePaths.add(manifest.types);
  if (typeof manifest.typings === "string") relativePaths.add(manifest.typings);
  collectExportTypes(manifest.exports, relativePaths);
  if (existsSync(path.join(root, "index.d.ts"))) relativePaths.add("index.d.ts");
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".d.ts")) relativePaths.add(entry.name);
    }
  } catch {
    return [];
  }
  const files: LocalPackageFile[] = [];
  for (const relativePath of relativePaths) {
    if (files.length >= MAX_DECLARATION_FILES) break;
    const file = resolveInside(root, relativePath);
    if (!file) continue;
    files.push({
      relativePath: path.relative(root, file).replaceAll("\\", "/"),
      text: readFileSync(file, "utf8").slice(0, MAX_DECLARATION_CHARS),
    });
  }
  return files;
}

function collectExportTypes(value: unknown, into: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectExportTypes(item, into);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.types === "string") into.add(record.types);
  if (typeof record.typings === "string") into.add(record.typings);
  for (const [key, child] of Object.entries(record)) {
    if (key === "types" || key === "typings") continue;
    if (child && typeof child === "object") collectExportTypes(child, into);
  }
}

function resolveInside(root: string, relativePath: string): string | null {
  if (path.isAbsolute(relativePath)) return null;
  const pieces = relativePath.replaceAll("\\", "/").split("/");
  if (pieces.some((piece) => piece === "..")) return null;
  const full = path.resolve(root, relativePath);
  if (!contained(root, full) || !existsSync(full)) return null;
  try {
    if (!statSync(full).isFile()) return null;
    const realFile = realpathSync(full);
    const realRoot = realpathSync(root);
    if (!contained(realRoot, realFile)) return null;
    return realFile;
  } catch {
    return null;
  }
}
