import fs from "node:fs";
import path from "node:path";
import type {
  CiWorkflowFacts,
  EnvContractVar,
  FrameworkFacts,
  LanguageStats,
  PackageManagerHint,
  SchemaLocation,
  StackDetection,
} from "./types.js";
import type { ScannedFile } from "./types.js";

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

function languageStats(files: readonly ScannedFile[]): LanguageStats[] {
  const map = new Map<string, LanguageStats>();
  for (const file of files) {
    if (file.isBinary) continue;
    const cur = map.get(file.language) ?? { language: file.language, files: 0, bytes: 0 };
    map.set(file.language, {
      language: file.language,
      files: cur.files + 1,
      bytes: cur.bytes + file.bytes,
    });
  }
  return [...map.values()].sort((a, b) => b.bytes - a.bytes);
}

function detectPackageManagers(filePaths: Set<string>): PackageManagerHint[] {
  const hints: PackageManagerHint[] = [];
  const add = (id: PackageManagerHint["id"], evidence: string) => {
    const index = hints.findIndex((h) => h.id === id);
    if (index >= 0) {
      const prev = hints[index]!;
      hints[index] = { id: prev.id, evidence: [...prev.evidence, evidence] };
    } else {
      hints.push({ id, evidence: [evidence] });
    }
  };
  if (filePaths.has("pnpm-lock.yaml")) add("pnpm", "pnpm-lock.yaml");
  if (filePaths.has("pnpm-workspace.yaml")) add("pnpm", "pnpm-workspace.yaml");
  if (filePaths.has("package-lock.json")) add("npm", "package-lock.json");
  if (filePaths.has("yarn.lock")) add("yarn", "yarn.lock");
  if (filePaths.has("bun.lockb")) add("bun", "bun.lockb");
  if (filePaths.has("pyproject.toml")) add("uv", "pyproject.toml");
  if (filePaths.has("poetry.lock")) add("poetry", "poetry.lock");
  if (filePaths.has("requirements.txt")) add("pip", "requirements.txt");
  if (filePaths.has("Cargo.toml")) add("cargo", "Cargo.toml");
  if (filePaths.has("go.mod")) add("go", "go.mod");
  return hints;
}

function detectFrameworks(root: string, filePaths: Set<string>, deps: Set<string>): FrameworkFacts {
  const frameworks: string[] = [];
  const uiKits: string[] = [];
  const orm: string[] = [];
  const testRunners: string[] = [];

  const addDep = (name: string, bucket: string[]) => {
    if (deps.has(name)) bucket.push(name);
  };

  addDep("next", frameworks);
  addDep("react", frameworks);
  addDep("vite", frameworks);
  addDep("@angular/core", frameworks);
  addDep("express", frameworks);
  addDep("fastify", frameworks);
  addDep("hono", frameworks);
  addDep("@nestjs/core", frameworks);
  addDep("fastapi", frameworks);

  addDep("tailwindcss", uiKits);
  addDep("@mui/material", uiKits);
  addDep("@chakra-ui/react", uiKits);
  if (filePaths.has("components.json")) uiKits.push("shadcn/ui");

  addDep("@prisma/client", orm);
  addDep("prisma", orm);
  addDep("drizzle-orm", orm);
  addDep("typeorm", orm);
  addDep("knex", orm);
  addDep("sqlalchemy", orm);

  addDep("vitest", testRunners);
  addDep("jest", testRunners);
  addDep("pytest", testRunners);
  addDep("@playwright/test", testRunners);
  addDep("cypress", testRunners);

  let nextjsRouter: FrameworkFacts["nextjsRouter"];
  const hasApp = filePaths.has("app") || [...filePaths].some((p) => p.startsWith("app/"));
  const hasPages = filePaths.has("pages") || [...filePaths].some((p) => p.startsWith("pages/"));
  if (deps.has("next")) {
    if (hasApp && hasPages) nextjsRouter = "hybrid_app_and_pages";
    else if (hasApp) nextjsRouter = "app";
    else if (hasPages) nextjsRouter = "pages";
  }

  if (!deps.size) {
    const pkg = readText(root, "package.json");
    if (pkg) {
      const json = parseJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(pkg);
      if (json) {
        for (const key of Object.keys(json.dependencies ?? {})) deps.add(key);
        for (const key of Object.keys(json.devDependencies ?? {})) deps.add(key);
      }
    }
  }

  const facts: FrameworkFacts = { frameworks, uiKits, orm, testRunners };
  if (nextjsRouter) return { ...facts, nextjsRouter };
  return facts;
}

function collectDeps(root: string, packageJsonPaths: readonly string[]): Set<string> {
  const deps = new Set<string>();
  for (const rel of packageJsonPaths) {
    const text = readText(root, rel);
    if (!text) continue;
    const json = parseJson<{ dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(text);
    if (!json) continue;
    for (const key of Object.keys(json.dependencies ?? {})) deps.add(key);
    for (const key of Object.keys(json.devDependencies ?? {})) deps.add(key);
  }
  return deps;
}

function parseEnvExample(text: string, source: EnvContractVar["source"]): EnvContractVar[] {
  const vars: EnvContractVar[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    const name = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).trim();
    if (name) vars.push({ name, source });
  }
  return vars;
}

function parseWorkflowYaml(text: string): CiWorkflowFacts {
  const jobs: string[] = [];
  const nodeVersions: string[] = [];
  let runsOnUbuntu = false;
  const jobMatches = text.matchAll(/^\s{2}([A-Za-z0-9_-]+):\s*$/gm);
  for (const match of jobMatches) jobs.push(match[1] ?? "");
  if (/ubuntu-latest/i.test(text)) runsOnUbuntu = true;
  const nodeMatches = text.matchAll(/node-version:\s*['"]?([^\s'"]+)/gi);
  for (const match of nodeMatches) nodeVersions.push(match[1] ?? "");
  return { path: "", jobs, nodeVersions, runsOnUbuntu };
}

export class StackAndFrameworkDetector {
  detect(root: string, files: readonly ScannedFile[]): StackDetection {
    const relSet = new Set(files.map((f) => f.path));
    const packageJsonPaths = files.filter((f) => f.path.endsWith("package.json")).map((f) => f.path);
    const deps = collectDeps(root, packageJsonPaths);

    const scripts: { path: string; scripts: Readonly<Record<string, string>> }[] = [];
    for (const rel of packageJsonPaths) {
      const text = readText(root, rel);
      if (!text) continue;
      const json = parseJson<{ scripts?: Record<string, string> }>(text);
      if (json?.scripts) scripts.push({ path: rel, scripts: json.scripts });
    }

    const ciWorkflows: CiWorkflowFacts[] = [];
    for (const file of files) {
      if (!file.path.startsWith(".github/workflows/") || !file.path.endsWith(".yml")) continue;
      const text = readText(root, file.path);
      if (!text) continue;
      const parsed = parseWorkflowYaml(text);
      ciWorkflows.push({ ...parsed, path: file.path });
    }

    const schemaLocations: SchemaLocation[] = [];
    for (const file of files) {
      if (file.path.endsWith("schema.prisma")) schemaLocations.push({ kind: "prisma", path: file.path });
      if (file.path.includes("drizzle/") && file.path.endsWith(".ts")) {
        schemaLocations.push({ kind: "drizzle", path: file.path });
      }
      if (file.path.includes("migrations/") && file.path.endsWith(".sql")) {
        schemaLocations.push({ kind: "sql_migrations", path: file.path });
      }
      if (file.path.includes("schema/") && file.path.endsWith(".sql")) {
        schemaLocations.push({ kind: "sql_migrations", path: file.path });
      }
      if (file.path.endsWith("openapi.yaml") || file.path.endsWith("openapi.json")) {
        schemaLocations.push({ kind: "openapi", path: file.path });
      }
    }

    const envContract: EnvContractVar[] = [];
    for (const name of [".env.example", ".env.sample"]) {
      if (!relSet.has(name)) continue;
      const text = readText(root, name);
      if (text) envContract.push(...parseEnvExample(text, name as ".env.example" | ".env.sample"));
    }
    for (const file of files) {
      if (file.isBinary || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) continue;
      const text = readText(root, file.path);
      if (!text) continue;
      const matches = text.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g);
      for (const match of matches) {
        const varName = match[1];
        if (varName && !envContract.some((v) => v.name === varName)) {
          envContract.push({ name: varName, source: "source_ref" });
        }
      }
    }

    const dockerfiles = files
      .filter((f) => f.path === "Dockerfile" || f.path.startsWith("docker-compose"))
      .map((f) => f.path);

    const ciLinuxCaseSensitive = ciWorkflows.some((w) => w.runsOnUbuntu);

    return {
      languages: languageStats(files),
      packageManagers: detectPackageManagers(relSet),
      frameworks: detectFrameworks(root, relSet, deps),
      scripts,
      ciWorkflows,
      schemaLocations,
      envContract,
      dockerfiles,
      ciLinuxCaseSensitive,
    };
  }
}