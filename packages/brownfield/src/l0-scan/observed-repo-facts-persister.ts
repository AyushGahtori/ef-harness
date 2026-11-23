import type { KnowledgeGraphRepoPort, StateMetaStore } from "./knowledge-graph-port.js";
import type { L0ScanResult, L0SnapshotCache } from "./types.js";

const META_HASH = "l0_snapshot_hash";
const META_HEAD = "l0_snapshot_head_sha";
const META_CACHE = "l0_snapshot_cache_json";

export class ObservedRepoFactsPersister {
  constructor(
    private readonly graph: KnowledgeGraphRepoPort,
    private readonly meta: StateMetaStore,
  ) {}

  computeSnapshotHash(headSha: string | null, dirtyMtimes: readonly number[]): string {
    const dirty = dirtyMtimes.slice().sort((a, b) => a - b).join(",");
    return `${headSha ?? "no-head"}|${dirty}`;
  }

  rememberedHeadSha(): string | null {
    return this.meta.get(META_HEAD);
  }

  tryFastLoad(headSha: string | null, dirtyMtimes: readonly number[]): L0ScanResult | null {
    const hash = this.computeSnapshotHash(headSha, dirtyMtimes);
    return this.loadCached(hash);
  }

  loadCached(hash: string): L0ScanResult | null {
    const storedHash = this.meta.get(META_HASH);
    if (storedHash !== hash) return null;
    const raw = this.meta.get(META_CACHE);
    if (!raw) return null;
    try {
      const cache = JSON.parse(raw) as L0SnapshotCache;
      return cache.result;
    } catch {
      return null;
    }
  }

  saveCache(hash: string, result: L0ScanResult): void {
    const entry: L0SnapshotCache = {
      l0SnapshotHash: hash,
      savedAtMs: Date.now(),
      result,
    };
    this.meta.set(META_HASH, hash);
    if (result.headSha) this.meta.set(META_HEAD, result.headSha);
    this.meta.set(META_CACHE, JSON.stringify(entry));
  }

  persistObservedFacts(result: L0ScanResult): void {
    this.graph.upsertObservedNode({
      id: "brownfield:l0:stack",
      kind: "research_fact",
      title: "L0 stack detection",
      text: result.stack.frameworks.frameworks.join(", ") || "unknown",
      fields: { basis: "observed", stack: result.stack },
    });
    this.graph.upsertObservedNode({
      id: "brownfield:l0:monorepo",
      kind: "research_fact",
      title: "L0 monorepo layout",
      text: result.monorepo.isMonorepo ? result.monorepo.tool : "single-package",
      fields: { basis: "observed", monorepo: result.monorepo },
    });
    this.graph.upsertObservedNode({
      id: "brownfield:l0:churn",
      kind: "research_fact",
      title: "L0 git churn hotspots",
      text: result.churn.churnAvailable ? `${result.churn.hotspotFiles.length} hotspots` : "unavailable",
      fields: { basis: "observed", churn: result.churn },
    });
    this.graph.upsertObservedNode({
      id: "brownfield:l0:docs",
      kind: "research_fact",
      title: "L0 documentation inventory",
      text: `${result.docs.length} docs`,
      fields: { basis: "observed", docs: result.docs },
    });
  }
}