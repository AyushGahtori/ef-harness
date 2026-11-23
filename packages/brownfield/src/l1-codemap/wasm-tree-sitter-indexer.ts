import fs from "node:fs";
import path from "node:path";
import { GeneratedAndVendoredFilter } from "./generated-and-vendored-filter.js";
import { CodeIndexDatabase } from "./code-index-db.js";
import { sha256Hex } from "./hash.js";
import { parseStructurally } from "./structural-parser.js";
import { loadTsPathAliases, resolveImportSpecifier, type PathAliasMap } from "./tsconfig-paths.js";
import { AiderPageRankCalculator, type GraphEdge } from "./aider-pagerank-calculator.js";
import type { FileIndexRecord, GovernorPort } from "./types.js";
import { ensureWebTreeSitterInitialized } from "./web-tree-sitter-loader.js";

const SOURCE_GLOBS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".sql",
  ".json",
  ".yaml",
  ".yml",
];

export interface IndexOptions {
  readonly repoRoot: string;
  readonly commitSha: string;
  readonly dbPath: string;
  readonly changedOnly?: readonly string[] | undefined;
  readonly batchSize?: number;
  readonly governor?: GovernorPort;
  readonly keepDbOpen?: boolean;
}

export interface IndexResult {
  readonly indexedFiles: number;
  readonly skippedFiles: number;
  readonly durationMs: number;
  readonly wasmReady: boolean;
}

export class WasmTreeSitterIndexer {
  private readonly filter = new GeneratedAndVendoredFilter();
  private readonly pagerank = new AiderPageRankCalculator();
  private readonly openDbs = new Map<string, CodeIndexDatabase>();
  private aliasCache = new Map<string, PathAliasMap>();
  private wasmReady = false;

  async init(): Promise<void> {
    this.wasmReady = await ensureWebTreeSitterInitialized();
  }

  closeAll(): void {
    for (const db of this.openDbs.values()) db.close();
    this.openDbs.clear();
  }

  index(options: IndexOptions): IndexResult {
    const started = performance.now();
    const root = path.resolve(options.repoRoot);
    const governor = options.governor ?? ({ readSignal: () => ({ level: "green" }) } as GovernorPort);
    let aliases = this.aliasCache.get(root);
    if (!aliases) {
      aliases = loadTsPathAliases(root);
      this.aliasCache.set(root, aliases);
    }
    const incremental = Boolean(options.changedOnly && options.changedOnly.length > 0);
    const ownsDb = !this.openDbs.has(options.dbPath);
    const db = this.openDbs.get(options.dbPath) ?? new CodeIndexDatabase(options.dbPath);
    if (ownsDb) this.openDbs.set(options.dbPath, db);
    if (!incremental) {
      db.beginCommit(options.commitSha);
    }
    const targets = incremental
      ? options.changedOnly!.map((p) => p.replaceAll("\\", "/"))
      : walkSourceFiles(root);

    let indexed = 0;
    let skipped = 0;
    const batchSize = options.batchSize ?? 25;
    const edges: GraphEdge[] = [];
    const pathToHash = new Map<string, string>();

    for (let i = 0; i < targets.length; i += 1) {
      if (i > 0 && i % batchSize === 0) {
        const signal = governor.readSignal();
        if (signal.level === "orange" || signal.level === "red") break;
      }
      const rel = targets[i]!;
      const abs = path.join(root, rel);
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      const content = fs.readFileSync(abs, "utf8");
      const decision = this.filter.shouldSkip(rel, content, stat.size);
      if (decision.skip) {
        skipped += 1;
        continue;
      }

      const hash = sha256Hex(content);
      const previous = db.getStoredHash(options.commitSha, rel);
      if (previous === hash && options.changedOnly) {
        pathToHash.set(rel, hash);
        indexed += 1;
        continue;
      }

      const parsed = parseStructurally(rel, content);
      const resolvedRefs = parsed.imports
        .map((spec) => resolveImportSpecifier(root, rel, spec, aliases))
        .filter((p): p is string => Boolean(p));

      const refs = [
        ...parsed.refs,
        ...resolvedRefs.map((target) => ({ name: `import:${target}`, line: 1 })),
      ];
      if (!incremental) {
        for (const target of resolvedRefs) {
          edges.push({ from: rel, to: target, weight: 1 });
        }
      }

      db.upsertFile(options.commitSha, rel, hash, parsed.symbols, refs);
      pathToHash.set(rel, hash);
      indexed += 1;
    }

    if (!incremental || targets.length > 5) {
      const rankEdges = incremental ? loadStoredEdges(db, options.commitSha) : edges;
      const rankNodes = incremental ? db.listIndexedPaths(options.commitSha) : targets;
      const ranked = this.buildRankings(rankNodes, rankEdges);
      db.replaceFileRanks(options.commitSha, ranked);
    }
    if (!incremental) {
      db.finishCommit(options.commitSha, indexed);
    }
    if (!options.keepDbOpen) {
      db.close();
      this.openDbs.delete(options.dbPath);
    }

    return {
      indexedFiles: indexed,
      skippedFiles: skipped,
      durationMs: performance.now() - started,
      wasmReady: this.wasmReady,
    };
  }

  incrementalIndex(options: IndexOptions): IndexResult {
    return this.index({ ...options, changedOnly: options.changedOnly });
  }

  private buildRankings(nodes: readonly string[], edges: GraphEdge[]) {
    const allNodes = [...new Set([...nodes, ...edges.flatMap((e) => [e.from, e.to])])];
    const scores = this.pagerank.computeGlobal(allNodes, edges);
    return [...scores.entries()]
      .map(([filePath, score]) => ({ path: filePath, score }))
      .sort((a, b) => b.score - a.score);
  }

  fileRecord(repoRoot: string, relPath: string): FileIndexRecord | null {
    const abs = path.join(repoRoot, relPath);
    if (!fs.existsSync(abs)) return null;
    const content = fs.readFileSync(abs, "utf8");
    const parsed = parseStructurally(relPath, content);
    const hash = sha256Hex(content);
    const stat = fs.statSync(abs);
    return {
      path: relPath,
      hash,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      symbols: parsed.symbols,
      refs: parsed.refs,
    };
  }
}

function loadStoredEdges(db: CodeIndexDatabase, commitSha: string): GraphEdge[] {
  const edges: GraphEdge[] = [];
  for (const row of db.listCommitFiles(commitSha)) {
    const refs = db.refsForFile(row.fileHash);
    for (const ref of refs) {
      if (!ref.name.startsWith("import:")) continue;
      edges.push({ from: row.path, to: ref.name.slice("import:".length), weight: 1 });
    }
  }
  return edges;
}

function walkSourceFiles(root: string): string[] {
  const out: string[] = [];
  const skip = new Set(["node_modules", ".git", "dist", "build", "coverage", "vendor", "third_party"]);
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = path.relative(root, full).replaceAll("\\", "/");
      const ext = path.extname(rel).toLowerCase();
      if (SOURCE_GLOBS.includes(ext)) out.push(rel);
    }
  };
  walk(root);
  return out;
}
