import { AiderPageRankCalculator } from "./aider-pagerank-calculator.js";
import { CodeIndexDatabase } from "./code-index-db.js";
import { renderCompactRepoMap, estimateTokens } from "./repo-map-renderer.js";
import type { ExtractedSymbol, FileRankRow } from "./types.js";

export interface QueryServiceOptions {
  readonly dbPath: string;
  readonly commitSha: string;
}

export interface PersonalizedMapRequest {
  readonly query: string;
  readonly maxTokens: number;
  readonly seedPaths?: readonly string[];
}

export class CompactCodeMapQueryService {
  private readonly dbPath: string;
  private readonly commitSha: string;
  private readonly pagerank = new AiderPageRankCalculator();

  constructor(options: QueryServiceOptions) {
    this.dbPath = options.dbPath;
    this.commitSha = options.commitSha;
  }

  topRankedFiles(limit = 20): FileRankRow[] {
    const db = new CodeIndexDatabase(this.dbPath);
    const rows = db.readFileRanks(this.commitSha).slice(0, limit);
    db.close();
    return rows;
  }

  findImporters(targetPath: string): string[] {
    const db = new CodeIndexDatabase(this.dbPath);
    const rows = db.listCommitFiles(this.commitSha);
    const hashes = new Map(rows.map((r) => [r.fileHash, r.path]));
    const target = rows.find((r) => r.path === targetPath);
    if (!target) {
      db.close();
      return [];
    }
    const symbols = db.symbolsForFile(target.fileHash).map((s) => s.name);
    const importers = new Set<string>();
    for (const name of symbols) {
      for (const ref of db.findRefsByName(name)) {
        const pathForHash = hashes.get(ref.fileHash);
        if (pathForHash && pathForHash !== targetPath) importers.add(pathForHash);
      }
    }
    db.close();
    return [...importers];
  }

  findCallers(symbolName: string): string[] {
    const db = new CodeIndexDatabase(this.dbPath);
    const rows = db.listCommitFiles(this.commitSha);
    const hashes = new Map(rows.map((r) => [r.fileHash, r.path]));
    const out = new Set<string>();
    for (const ref of db.findRefsByName(symbolName)) {
      const p = hashes.get(ref.fileHash);
      if (p) out.add(p);
    }
    db.close();
    return [...out];
  }

  renderPersonalizedMap(request: PersonalizedMapRequest): string {
    const db = new CodeIndexDatabase(this.dbPath);
    const global = db.readFileRanks(this.commitSha);
    const paths = global.map((r) => r.path);
    const seedPaths = request.seedPaths ?? this.inferSeedPaths(request.query, paths);
    const boost = new Map<string, number>();
    for (const row of global) boost.set(row.path, row.score);
    for (const seed of seedPaths) {
      boost.set(seed, (boost.get(seed) ?? 0) * 4);
      const prefix = seed.includes("/") ? seed.slice(0, seed.lastIndexOf("/")) : "";
      for (const row of global) {
        if (prefix && row.path.startsWith(prefix)) {
          boost.set(row.path, (boost.get(row.path) ?? row.score) * 1.5);
        }
      }
    }
    const edges = global.slice(0, -1).flatMap((row, i) => {
      const to = global[i + 1]?.path;
      return to ? [{ from: row.path, to, weight: 0.5 }] : [];
    });
    const scores = this.pagerank.computePersonalized(paths, edges, seedPaths, 4);
    for (const [pathKey, score] of scores) {
      boost.set(pathKey, score * (boost.get(pathKey) ?? 1));
    }
    const ranked = [...boost.entries()]
      .map(([pathKey, score]) => ({ path: pathKey, score }))
      .sort((a, b) => b.score - a.score);

    const symbolLookup = (rel: string): ExtractedSymbol[] => {
      const row = db.listCommitFiles(this.commitSha).find((r) => r.path === rel);
      if (!row) return [];
      return db.symbolsForFile(row.fileHash);
    };

    const text = renderCompactRepoMap(ranked, symbolLookup, request.maxTokens);
    db.close();
    return text;
  }

  renderGlobalMap(maxTokens: number): string {
    const db = new CodeIndexDatabase(this.dbPath);
    const ranked = db.readFileRanks(this.commitSha);
    const symbolLookup = (rel: string): ExtractedSymbol[] => {
      const row = db.listCommitFiles(this.commitSha).find((r) => r.path === rel);
      if (!row) return [];
      return db.symbolsForFile(row.fileHash);
    };
    const text = renderCompactRepoMap(ranked, symbolLookup, maxTokens);
    db.close();
    return text;
  }

  tokenCount(text: string): number {
    return estimateTokens(text);
  }

  private inferSeedPaths(query: string, paths: readonly string[]): string[] {
    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean);
    const seeds: string[] = [];
    for (const rel of paths) {
      const hay = rel.toLowerCase();
      if (tokens.some((t) => hay.includes(t))) seeds.push(rel);
    }
    return seeds.slice(0, 8);
  }
}