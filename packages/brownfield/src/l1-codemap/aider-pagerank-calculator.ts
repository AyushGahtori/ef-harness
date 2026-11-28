export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly weight?: number;
}

export interface PageRankOptions {
  readonly damping?: number;
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly seedPaths?: readonly string[];
  readonly seedBoost?: number;
}

export class AiderPageRankCalculator {
  readonly damping: number;
  readonly maxIterations: number;
  readonly tolerance: number;

  constructor(options?: { readonly damping?: number; readonly maxIterations?: number }) {
    this.damping = options?.damping ?? 0.85;
    this.maxIterations = options?.maxIterations ?? 30;
    this.tolerance = 1e-6;
  }

  computeGlobal(nodes: readonly string[], edges: readonly GraphEdge[]): Map<string, number> {
    return this.compute(nodes, edges, {});
  }

  computePersonalized(
    nodes: readonly string[],
    edges: readonly GraphEdge[],
    seedPaths: readonly string[],
    seedBoost = 4,
  ): Map<string, number> {
    return this.compute(nodes, edges, { seedPaths, seedBoost });
  }

  private compute(
    nodes: readonly string[],
    edges: readonly GraphEdge[],
    options: PageRankOptions,
  ): Map<string, number> {
    const index = new Map<string, number>();
    nodes.forEach((node, i) => index.set(node, i));
    const n = nodes.length;
    if (n === 0) return new Map();

    const outWeight = new Float64Array(n);
    const outList: number[][] = Array.from({ length: n }, () => []);
    const inList: Array<Array<{ from: number; weight: number }>> = Array.from({ length: n }, () => []);

    for (const edge of edges) {
      const from = index.get(edge.from);
      const to = index.get(edge.to);
      if (from === undefined || to === undefined) continue;
      const weight = edge.weight ?? 1;
      outWeight[from]! += weight;
      outList[from]!.push(to);
      inList[to]!.push({ from, weight });
    }

    const scores = new Float64Array(n).fill(1 / n);
    const teleport = new Float64Array(n).fill(1 / n);

    if (options.seedPaths && options.seedPaths.length > 0) {
      teleport.fill(0);
      const boost = options.seedBoost ?? 4;
      let seeds = 0;
      for (const path of options.seedPaths) {
        const idx = index.get(path);
        if (idx !== undefined) {
          teleport[idx]! += boost;
          seeds += 1;
        }
      }
      if (seeds > 0) {
        let sum = 0;
        for (let i = 0; i < n; i += 1) sum += teleport[i]!;
        for (let i = 0; i < n; i += 1) teleport[i]! /= sum;
      } else {
        teleport.fill(1 / n);
      }
    }

    for (let iter = 0; iter < this.maxIterations; iter += 1) {
      const next = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        let incoming = 0;
        const inbound = inList[i] ?? [];
        for (const edge of inbound) {
          const denom = outWeight[edge.from] || 1;
          incoming += (scores[edge.from]! / denom) * edge.weight;
        }
        next[i] = (1 - this.damping) * teleport[i]! + this.damping * incoming;
      }
      let delta = 0;
      for (let i = 0; i < n; i += 1) delta += Math.abs(next[i]! - scores[i]!);
      scores.set(next);
      if (delta < this.tolerance) break;
    }

    const out = new Map<string, number>();
    nodes.forEach((node, i) => out.set(node, scores[i] ?? 0));
    return out;
  }
}