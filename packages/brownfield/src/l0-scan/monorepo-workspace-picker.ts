import fs from "node:fs";
import path from "node:path";
import type { MonorepoFacts, ScopePickerOption, WorkspaceEdge, WorkspacePackage } from "./types.js";

function readText(root: string, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function globPackagesFromYaml(text: string): string[] {
  const paths: string[] = [];
  const match = text.match(/packages:\s*\n((?:\s+-\s+.+\n?)+)/);
  if (!match?.[1]) return paths;
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s*-\s+['"]?([^'"]+)['"]?\s*$/.exec(line);
    if (item?.[1]) paths.push(item[1]);
  }
  return paths;
}

function resolveWorkspaceGlobs(root: string, globs: readonly string[]): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];
  const seen = new Set<string>();

  const addPackageAt = (relDir: string) => {
  const rel = relDir.replaceAll("\\", "/");
    if (seen.has(rel)) return;
    const pkgPath = path.join(root, rel, "package.json");
    if (!fs.existsSync(pkgPath)) return;
    const json = parseJson<{ name?: string; private?: boolean }>(fs.readFileSync(pkgPath, "utf8"));
    if (!json?.name) return;
    seen.add(rel);
    packages.push({
      name: json.name,
      path: rel,
      private: json.private === true,
    });
  };

  for (const pattern of globs) {
    const normalized = pattern.replaceAll("\\", "/");
    if (normalized.endsWith("/*")) {
      const parent = normalized.slice(0, -2);
      const fullParent = path.join(root, parent);
      if (!fs.existsSync(fullParent)) continue;
      for (const entry of fs.readdirSync(fullParent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        addPackageAt(path.posix.join(parent, entry.name));
      }
      continue;
    }
    addPackageAt(normalized);
  }
  return packages;
}

function computeInternalEdges(root: string, packages: readonly WorkspacePackage[]): WorkspaceEdge[] {
  const byName = new Map(packages.map((p) => [p.name, p]));
  const edges: WorkspaceEdge[] = [];
  for (const pkg of packages) {
    const text = readText(root, path.posix.join(pkg.path, "package.json"));
    if (!text) continue;
    const json = parseJson<{ dependencies?: Record<string, string> }>(text);
    if (!json?.dependencies) continue;
    for (const [dep, spec] of Object.entries(json.dependencies)) {
      if (!byName.has(dep)) continue;
      if (spec.startsWith("workspace:") || spec === "*" || spec.startsWith("link:")) {
        edges.push({ from: pkg.name, to: dep });
      }
    }
  }
  return edges;
}

export class MonorepoWorkspacePicker {
  detect(root: string, filePaths: readonly string[]): MonorepoFacts {
    const set = new Set(filePaths);
    let tool: MonorepoFacts["tool"] = "none";
    let globs: string[] = [];

    if (set.has("pnpm-workspace.yaml")) {
      tool = "pnpm";
      const text = readText(root, "pnpm-workspace.yaml");
      if (text) globs = globPackagesFromYaml(text);
    } else if (set.has("package.json")) {
      const rootPkg = readText(root, "package.json");
      const json = rootPkg ? parseJson<{ workspaces?: string[] | { packages?: string[] } }>(rootPkg) : null;
      const ws = json?.workspaces;
      if (Array.isArray(ws)) {
        tool = "npm";
        globs = ws;
      } else if (ws && Array.isArray(ws.packages)) {
        tool = "yarn";
        globs = ws.packages;
      }
    }
    if (set.has("turbo.json") && tool === "none") tool = "turbo";
    if (set.has("nx.json") && tool === "none") tool = "nx";
    if (set.has("Cargo.toml")) {
      const cargo = readText(root, "Cargo.toml");
      if (cargo?.includes("[workspace]")) tool = "cargo";
    }

    const packages = globs.length > 0 ? resolveWorkspaceGlobs(root, globs) : [];
    const edges = computeInternalEdges(root, packages);

    return {
      isMonorepo: packages.length > 1,
      tool,
      packages,
      internalEdges: edges,
    };
  }

  buildScopePicker(facts: MonorepoFacts, selected: readonly string[]): ScopePickerOption[] {
    if (!facts.isMonorepo) return [];
    const depMap = new Map<string, Set<string>>();
    for (const edge of facts.internalEdges) {
      const set = depMap.get(edge.from) ?? new Set<string>();
      set.add(edge.to);
      depMap.set(edge.from, set);
    }
    const targets = selected.length > 0 ? selected : facts.packages.map((p) => p.name);
    return targets.flatMap((name) => {
      const pkg = facts.packages.find((p) => p.name === name);
      if (!pkg) return [];
      const deps = [...(depMap.get(name) ?? [])].filter((d) => !targets.includes(d));
      return [
        {
          packageName: pkg.name,
          packagePath: pkg.path,
          includedReadOnlyDeps: deps,
        },
      ];
    });
  }
}