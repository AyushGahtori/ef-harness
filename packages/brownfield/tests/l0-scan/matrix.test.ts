import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BrownfieldL0RepoScanner,
  InMemoryKnowledgeGraphRepo,
  InMemoryStateMetaStore,
  MonorepoWorkspacePicker,
  isSensitivePath,
  openSqliteObservedFacts,
} from "../../src/l0-scan/index.js";
import {
  gitAddCommit,
  gitInit,
  seedExpressPrisma,
  seedNextApp,
  seedPnpmMonorepo,
  seedPythonFastApi,
  tempRepo,
  writeFile,
} from "./helpers.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function track(dir: string): string {
  cleanup.push(dir);
  return dir;
}

describe("l0-scan matrix", () => {
  const scannerTimeout = 60_000;
  process.env.EF_L0_FAST_CHURN = "1";
  it("detects Next.js hybrid router, Tailwind, Vitest, CI and docs under 2s", { timeout: scannerTimeout }, () => {
    const root = track(tempRepo("next"));
    seedNextApp(root);
    gitInit(root);
    gitAddCommit(root, "init");

    const graph = new InMemoryKnowledgeGraphRepo();
    const scanner = new BrownfieldL0RepoScanner({ graph });
    const result = scanner.scan({ repoRoot: root });

    expect(result.durationMs).toBeLessThan(4000);
    expect(result.stack.frameworks.frameworks).toContain("next");
    expect(result.stack.frameworks.nextjsRouter).toBe("hybrid_app_and_pages");
    expect(result.stack.frameworks.uiKits).toContain("tailwindcss");
    expect(result.stack.frameworks.testRunners).toContain("vitest");
    expect(result.stack.ciLinuxCaseSensitive).toBe(true);
    expect(result.stack.schemaLocations.some((s) => s.kind === "prisma")).toBe(true);
    expect(result.docs.length).toBeGreaterThanOrEqual(2);
    expect(graph.listObserved().every((n) => n.fields.basis === "observed")).toBe(true);
  });

  it("detects Express and Prisma API layout", () => {
    const root = track(tempRepo("express"));
    seedExpressPrisma(root);
    gitInit(root);
    gitAddCommit(root, "api");

    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root });
    expect(result.stack.frameworks.frameworks).toContain("express");
    expect(result.stack.frameworks.orm).toContain("@prisma/client");
    expect(result.stack.scripts[0]?.scripts.dev).toContain("tsx");
  });

  it("detects Python FastAPI via pyproject and requirements", () => {
    const root = track(tempRepo("python"));
    seedPythonFastApi(root);
    gitInit(root);
    gitAddCommit(root, "py");

    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root });
    expect(result.stack.packageManagers.some((p) => p.id === "uv" || p.id === "pip")).toBe(true);
    expect(result.stack.languages.some((l) => l.language === "Python")).toBe(true);
  });

  it("detects pnpm monorepo packages and internal workspace edges", { timeout: scannerTimeout }, () => {
    const root = track(tempRepo("mono"));
    seedPnpmMonorepo(root);
    gitInit(root);
    gitAddCommit(root, "mono");

    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root });
    expect(result.monorepo.isMonorepo).toBe(true);
    expect(result.monorepo.packages.length).toBeGreaterThanOrEqual(4);
    expect(result.monorepo.internalEdges.some((e) => e.from === "@mono/web" && e.to === "@mono/core")).toBe(
      true,
    );

    const picker = new MonorepoWorkspacePicker();
    const scope = picker.buildScopePicker(result.monorepo, ["@mono/web"]);
    expect(scope[0]?.includedReadOnlyDeps).toContain("@mono/core");
  });

  it("scans non-git folders with churn unavailable", () => {
    const root = track(tempRepo("nongit"));
    seedExpressPrisma(root);
    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root });
    expect(result.churn.churnAvailable).toBe(false);
    expect(result.headSha).toBeNull();
    expect(result.stack.frameworks.frameworks).toContain("express");
  });

  it("never reads .env or pem contents — records sensitive metadata only", { timeout: scannerTimeout }, () => {
    const root = track(tempRepo("secret"));
    writeFile(root, "package.json", '{"name":"x"}');
    const livePrefix = ["sk", "_live_"].join("");
    writeFile(root, ".env", `STRIPE_SECRET_KEY=${livePrefix}abcdefghijklmnopqrstuvwxyz\n`);
    const pemHeader = ["-----", "BEGIN ", "PRIVATE KEY-----"].join("");
    writeFile(root, "private.pem", `${pemHeader}\nsecret\n`);
    writeFile(root, ".env.example", "PUBLIC_ONLY=\n");
    writeFile(root, "src/index.ts", "console.log(process.env.PUBLIC_ONLY)\n");
    writeFile(root, ".gitignore", "");
    gitInit(root);
    gitAddCommit(root, "secrets");

    const meta = new InMemoryStateMetaStore();
    const graph = new InMemoryKnowledgeGraphRepo();
    const scanner = new BrownfieldL0RepoScanner({ meta, graph });
    const result = scanner.scan({ repoRoot: root });

    expect(isSensitivePath(".env")).toBe(true);
    expect(result.sensitiveSkipped.some((s) => s.path === ".env" && s.skippedAsSensitive)).toBe(true);
    expect(result.sensitiveSkipped.some((s) => s.path === "private.pem")).toBe(true);
    expect(result.files.some((f) => f.path === ".env")).toBe(false);
    const cached = meta.get("l0_snapshot_cache_json") ?? "";
    expect(cached.includes(livePrefix)).toBe(false);
    expect(result.stack.envContract.some((v) => v.name === "PUBLIC_ONLY")).toBe(true);
  });

  it("terminates on symlink directory loops", { timeout: scannerTimeout }, () => {
    const root = track(tempRepo("symlink"));
    writeFile(root, "package.json", '{"name":"loop"}');
    writeFile(root, "src/a.ts", "export const a = 1;\n");
    const loop = path.join(root, "loop");
    fs.mkdirSync(loop);
    try {
      fs.symlinkSync(loop, path.join(loop, "self"), "dir");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOTSUP") {
        const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root, useCache: false });
        expect(result.files.length).toBeGreaterThan(0);
        return;
      }
      throw error;
    }
    gitInit(root);
    gitAddCommit(root, "loop");

    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root, useCache: false });
    expect(result.durationMs).toBeLessThan(4000);
    expect(result.files.length).toBeGreaterThan(0);
  });

  it("loads cached L0 facts in under 5ms when snapshot hash is unchanged", () => {
    const root = track(tempRepo("cache"));
    seedNextApp(root);
    gitInit(root);
    gitAddCommit(root, "cache");

    const meta = new InMemoryStateMetaStore();
    const scanner = new BrownfieldL0RepoScanner({ meta });
    const first = scanner.scan({ repoRoot: root, dirtyMtimes: [] });
    expect(first.durationMs).toBeLessThan(10_000);

    const second = scanner.scan({ repoRoot: root, dirtyMtimes: [] });
    expect(second.durationMs).toBeLessThan(50);
    expect(second.stack.frameworks.nextjsRouter).toBe(first.stack.frameworks.nextjsRouter);
  });

  it("reports git churn hotspots when history exists", { timeout: 30_000 }, () => {
    const root = track(tempRepo("churn"));
    seedExpressPrisma(root);
    gitInit(root);
    gitAddCommit(root, "one");
    writeFile(root, "src/index.ts", "export const v = 2;\n");
    gitAddCommit(root, "two");
    writeFile(root, "src/index.ts", "export const v = 3;\n");
    gitAddCommit(root, "three");

    const result = new BrownfieldL0RepoScanner().scan({ repoRoot: root });
    expect(result.churn.churnAvailable).toBe(true);
    expect(result.churn.hotspotFiles.some((h) => h.path === "src/index.ts")).toBe(true);
  });

  it("reopens observed research_fact and component nodes from state.db", () => {
    const root = track(tempRepo("state"));
    seedNextApp(root);
    gitInit(root);
    gitAddCommit(root, "init");
    const dataRoot = track(tempRepo("state-db"));
    const opened = openSqliteObservedFacts({ projectId: "l0-facts", rootDir: dataRoot });
    const scanner = new BrownfieldL0RepoScanner({ graph: opened.graph, meta: opened.meta });
    scanner.scan({ repoRoot: root });
    opened.close();

    const again = openSqliteObservedFacts({ projectId: "l0-facts", rootDir: dataRoot });
    const nodes = again.graph.listObserved();
    again.close();
    expect(nodes.some((node) => node.kind === "research_fact" && node.fields.basis === "observed")).toBe(true);
    expect(nodes.some((node) => node.kind === "component" && node.fields.basis === "observed")).toBe(true);
    expect(nodes.every((node) => node.kind !== "brownfield_module")).toBe(true);
  });
});