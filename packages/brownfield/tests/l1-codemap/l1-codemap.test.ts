import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AiderPageRankCalculator,
  CodeIndexDatabase,
  CompactCodeMapQueryService,
  GeneratedAndVendoredFilter,
  WasmTreeSitterIndexer,
  ensureWebTreeSitterInitialized,
  parseStructurally,
  resolveImportSpecifier,
  loadTsPathAliases,
} from "../../src/l1-codemap/index.js";
import { gitInit, seedTsAliasRepo, tempRepo, writeFile } from "./helpers.js";

const cleanup: string[] = [];
afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Windows may briefly retain SQLite WAL handles after close.
    }
  }
});

function track(dir: string): string {
  cleanup.push(dir);
  return dir;
}

describe("l1-codemap", () => {
  it("initializes web-tree-sitter WASM runtime", async () => {
    expect(await ensureWebTreeSitterInitialized()).toBe(true);
  });

  it("parses TS/TSX/Python/Go/SQL and tolerates broken WIP syntax", () => {
    const ts = parseStructurally(
      "src/lib/pdf.ts",
      "export function renderResumePdf(doc: ResumeDoc): Buffer { return Buffer.from(''); }\n",
    );
    expect(ts.symbols.some((s) => s.name === "renderResumePdf")).toBe(true);

    const py = parseStructurally("svc.py", "class User:\n    def list(self):\n        return 1\n");
    expect(py.symbols.map((s) => s.name)).toContain("list");

    const go = parseStructurally("auth.go", "package main\nfunc Serve() {}\n");
    expect(go.symbols[0]?.name).toBe("Serve");

    const sql = parseStructurally("db.sql", "CREATE TABLE users (id TEXT);\n");
    expect(sql.symbols[0]?.kind).toBe("sql_table");

    const wip = parseStructurally("wip.ts", "export function ok() {}\nexport function broken(\n");
    expect(wip.symbols.some((s) => s.name === "ok")).toBe(true);
  });

  it("resolves @/ aliases and barrel re-exports", () => {
    const root = track(tempRepo("alias"));
    seedTsAliasRepo(root);
    const aliases = loadTsPathAliases(root);
    const pdf = resolveImportSpecifier(root, "src/components/pdf-button.tsx", "@/lib/pdf", aliases);
    expect(pdf).toBe("src/lib/pdf.ts");
    const barrel = resolveImportSpecifier(root, "src/app/export/page.tsx", "@/components", aliases);
    expect(barrel).toBe("src/components/index.ts");
  });

  it("excludes generated, vendored, lockfile and minified files", () => {
    const filter = new GeneratedAndVendoredFilter();
    expect(filter.shouldSkip("pnpm-lock.yaml", "lock", 10).skip).toBe(true);
    expect(filter.shouldSkip("vendor/x.min.js", "a", 10).skip).toBe(true);
    expect(filter.shouldSkip("graphql-types.generated.ts", "// @generated\n", 100).skip).toBe(true);
    expect(
      filter.shouldSkip("bundle.js", "x".repeat(5000), 5000).reason,
    ).toBe("minified-single-line");
    expect(filter.shouldSkip("src/ok.ts", "export const ok = 1\n", 20).skip).toBe(false);
  });

  it(
    "indexes into code-index.db with PageRank hubs and query-personalized maps",
    async () => {
    const root = track(tempRepo("index"));
    seedTsAliasRepo(root);
    const commit = gitInit(root);
    const dbPath = path.join(root, ".ef", "code-index.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const indexer = new WasmTreeSitterIndexer();
    await indexer.init();
    const indexed = indexer.index({ repoRoot: root, commitSha: commit, dbPath });
    expect(indexed.indexedFiles).toBeGreaterThanOrEqual(6);
    expect(indexed.skippedFiles).toBeGreaterThanOrEqual(2);

    const query = new CompactCodeMapQueryService({ dbPath, commitSha: commit });
    const top = query.topRankedFiles(5);
    expect(top.length).toBeGreaterThan(0);
    expect(top[0]?.path).toMatch(/src\//);

    const map = query.renderPersonalizedMap({
      query: "Update the resume export PDF margins",
      maxTokens: 2000,
    });
    expect(map.toLowerCase()).toContain("pdf");
    expect(query.tokenCount(map)).toBeLessThanOrEqual(2000);

    const callers = query.findCallers("renderResumePdf");
    expect(callers).toContain("src/components/pdf-button.tsx");
    },
    30_000,
  );

  it("re-indexes only changed files in under 50ms", () => {
    const root = track(tempRepo("incr"));
    const commit = "0000000000000000000000000000000000000001";
    writeFile(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }, null, 2),
    );
    writeFile(root, "src/lib/pdf.ts", "export function renderResumePdf(): Buffer { return Buffer.from(''); }\n");
    writeFile(
      root,
      "src/components/pdf-button.tsx",
      "import { renderResumePdf } from '@/lib/pdf';\nexport function PdfButton() { return renderResumePdf(); }\n",
    );
    const dbPath = path.join(root, "code-index.db");

    const indexer = new WasmTreeSitterIndexer();
    indexer.index({ repoRoot: root, commitSha: commit, dbPath, keepDbOpen: true });

    const durations: number[] = [];
    for (let version = 2; version <= 6; version += 1) {
      writeFile(
        root,
        "src/lib/pdf.ts",
        `export function renderResumePdf(): Buffer { return Buffer.from('v${version}'); }\nexport const version = ${version};\n`,
      );
      durations.push(
        indexer.incrementalIndex({
          repoRoot: root,
          commitSha: commit,
          dbPath,
          changedOnly: ["src/lib/pdf.ts"],
          keepDbOpen: true,
        }).durationMs,
      );
    }
    expect(Math.min(...durations)).toBeLessThan(50);

    indexer.closeAll();
    const db = new CodeIndexDatabase(dbPath);
    const hashRow = db.listCommitFiles(commit).find((r) => r.path === "src/lib/pdf.ts");
    expect(hashRow).toBeTruthy();
    const symbols = db.symbolsForFile(hashRow!.fileHash);
    expect(symbols.some((s) => s.name === "version")).toBe(true);
    db.close();
  });

  it("rebuilds silently when code-index.db is corrupted or deleted", () => {
    const root = track(tempRepo("rebuild"));
    const commit = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const dbPath = path.join(root, ".ef", "code-index.db");
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, "not-a-database", "utf8");

    const db = new CodeIndexDatabase(dbPath);
    expect(db.quickCheck()).toBe(true);
    db.beginCommit(commit);
    db.upsertFile(commit, "src/lib/pdf.ts", "abc", [{ name: "renderResumePdf", kind: "function", line: 1, exported: true }], []);
    db.close();

    const fresh = new CodeIndexDatabase(dbPath);
    fresh.beginCommit(commit);
    fresh.close();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("ranks hub modules highest globally with cyclic imports", () => {
    const calc = new AiderPageRankCalculator();
    const edges = [
      { from: "a.ts", to: "hub.ts", weight: 2 },
      { from: "b.ts", to: "hub.ts", weight: 2 },
      { from: "c.ts", to: "hub.ts", weight: 2 },
      { from: "hub.ts", to: "a.ts", weight: 1 },
      { from: "a.ts", to: "b.ts", weight: 1 },
      { from: "b.ts", to: "a.ts", weight: 1 },
    ];
    const global = calc.computeGlobal(["a.ts", "b.ts", "c.ts", "hub.ts"], edges);
    expect(global.get("hub.ts") ?? 0).toBeGreaterThan(global.get("c.ts") ?? 0);
    const personalized = calc.computePersonalized(["a.ts", "b.ts", "c.ts", "hub.ts"], edges, ["a.ts"]);
    expect(personalized.get("a.ts") ?? 0).toBeGreaterThan(personalized.get("hub.ts") ?? 0);
  });
});