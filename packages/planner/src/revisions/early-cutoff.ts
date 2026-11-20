import { canonicalFingerprint } from "./fingerprint.js";
import type { RevisionGraph } from "./graph.js";
import type { CutoffHop, EarlyCutoffResult, GraphNode } from "./types.js";

export class EarlyCutoffReverifier {
  constructor(private readonly graph: RevisionGraph) {}

  /**
   * Propagates from edited roots along the SQL impact set.
   * A downstream node whose canonical fingerprint is unchanged is a cutoff:
   * its dependents stay out of the blast radius.
   */
  prune(input: {
    readonly roots: readonly string[];
    readonly walkIds: ReadonlySet<string>;
    readonly upstreamToken: string;
  }): EarlyCutoffResult {
    const impacted: string[] = [];
    const cutoff: string[] = [];
    const hops: CutoffHop[] = [];
    const seen = new Set<string>();
    const queue: string[] = [];

    for (const root of input.roots) {
      if (seen.has(root)) continue;
      seen.add(root);
      impacted.push(root);
      for (const dependent of this.graph.dependents(root)) {
        if (input.walkIds.has(dependent)) queue.push(dependent);
      }
    }

    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined || seen.has(id)) continue;
      seen.add(id);
      const node = this.graph.loadNode(id);
      if (!node || !input.walkIds.has(id)) continue;
      if (isPassenger(node.kind)) {
        impacted.push(id);
        for (const dependent of this.graph.dependents(id)) {
          if (input.walkIds.has(dependent) && !seen.has(dependent)) queue.push(dependent);
        }
        continue;
      }
      const previousFingerprint = canonicalFingerprint(priorSemantic(node));
      const nextFingerprint = canonicalFingerprint(nextSemantic(node, input.upstreamToken));
      const changed = previousFingerprint !== nextFingerprint;
      hops.push({ id, previousFingerprint, nextFingerprint, changed });
      if (!changed) {
        cutoff.push(id);
        continue;
      }
      impacted.push(id);
      for (const dependent of this.graph.dependents(id)) {
        if (input.walkIds.has(dependent) && !seen.has(dependent)) queue.push(dependent);
      }
    }

    return {
      impactedNodeIds: unique(impacted),
      earlyCutoffNodeIds: unique(cutoff).sort(),
      hops,
    };
  }
}

function isPassenger(kind: string): boolean {
  return kind === "task" || kind === "check";
}

function priorSemantic(node: GraphNode): unknown {
  if (node.fields.proseReactive === true) {
    return { canonical: node.fields.canonical ?? null, text: node.text };
  }
  return { canonical: node.fields.canonical ?? null };
}

function nextSemantic(node: GraphNode, upstreamToken: string): unknown {
  if (node.fields.proseReactive === true) {
    return { canonical: node.fields.canonical ?? null, text: node.text, upstreamToken };
  }
  return { canonical: node.fields.canonical ?? null };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
