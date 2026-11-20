import { writeDecision } from "./commit-decision.js";
import { currentPremiseIds, hasAssistantParaphrase } from "./derivation-chain-validator.js";
import { type KnowledgeGraphPort, readDecision } from "./graph-port.js";
import { isGroundedRootBasis, type DecisionFields } from "./types.js";

export interface ReopenEffect {
  readonly id: string;
  readonly action: "reopened" | "preserved_explicit" | "preserved_other_premise";
  readonly criterion: string;
}

export interface SupersessionReport {
  readonly premiseId: string;
  readonly effects: readonly ReopenEffect[];
}

/**
 * Walks only current `derived_from` edges from a superseded or retracted premise.
 * A dependent with no surviving support reopens. Independent explicit evidence
 * re-anchors that dependent to `explicit`. Unrelated decisions are not loaded
 * into the change set.
 */
export class PremiseSupersessionReopener {
  constructor(private readonly graph: KnowledgeGraphPort) {}

  supersede(premiseId: string, cause: "superseded" | "retracted"): SupersessionReport {
    this.retirePremise(premiseId, cause);
    return this.reopenDependents(premiseId);
  }

  reopenDependents(premiseId: string): SupersessionReport {
    const edges = this.graph.getEdgesAsOf(this.graph.currentRevision()).edges.filter((edge) => edge.type === "derived_from");
    const dependents = new Map<string, string[]>();
    const premisesOf = new Map<string, string[]>();
    for (const edge of edges) {
      const children = dependents.get(edge.dst) ?? [];
      children.push(edge.src);
      dependents.set(edge.dst, children);
      const premises = premisesOf.get(edge.src) ?? [];
      premises.push(edge.dst);
      premisesOf.set(edge.src, premises);
    }
    const affected: string[] = [];
    const seen = new Set<string>();
    const queue = [...(dependents.get(premiseId) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift();
      if (!id || seen.has(id) || id === premiseId) continue;
      seen.add(id);
      affected.push(id);
      for (const child of dependents.get(id) ?? []) queue.push(child);
    }
    const dead = new Set<string>([premiseId]);
    const pending = new Set(affected);
    const effects: ReopenEffect[] = [];
    let guard = 0;
    while (pending.size > 0 && guard <= affected.length) {
      guard += 1;
      let progressed = false;
      for (const id of [...pending]) {
        const premises = premisesOf.get(id) ?? currentPremiseIds(this.graph, id);
        if (premises.some((premise) => pending.has(premise))) continue;
        pending.delete(id);
        progressed = true;
        const effect = this.apply(id, premises, dead);
        if (effect.action === "reopened") dead.add(id);
        effects.push(effect);
      }
      if (!progressed) {
        for (const id of [...pending]) {
          pending.delete(id);
          dead.add(id);
          effects.push(this.apply(id, premisesOf.get(id) ?? [], dead));
        }
      }
    }
    return { premiseId, effects };
  }

  private retirePremise(premiseId: string, cause: "superseded" | "retracted"): void {
    const node = this.graph.getNode(premiseId);
    const fields = node ? readDecision(node) : null;
    if (!node || !fields) return;
    const retired: DecisionFields = {
      ...fields,
      status: "open",
      basis: null,
      retracted: cause === "retracted" ? true : fields.retracted,
      entailmentVerdict: null,
      entailmentReason: cause === "retracted" ? "premise retracted" : "premise superseded",
    };
    writeDecision(this.graph, {
      id: premiseId,
      kind: node.kind,
      title: node.title,
      text: node.text,
      fields: retired,
      nodeStatus: "superseded",
      edges: [],
      retireEdges: currentPremiseIds(this.graph, premiseId).map((dst) => ({ type: "derived_from", dst })),
      summary: `Supersede ${premiseId}`,
    });
  }

  private apply(id: string, premises: readonly string[], dead: ReadonlySet<string>): ReopenEffect {
    const node = this.graph.getNode(id);
    const fields = node ? readDecision(node) : null;
    if (!node || !fields) {
      return { id, action: "reopened", criterion: id };
    }
    const explicit = independentExplicit(fields);
    const surviving = premises.filter((premiseId) => !dead.has(premiseId) && this.stillSupports(premiseId));
    if (explicit) {
      const reanchored: DecisionFields = {
        ...fields,
        status: "settled",
        basis: "explicit",
        rule: null,
        premises: [],
        retracted: false,
        entailmentVerdict: "establishes",
        entailmentReason: "Re-anchored to surviving explicit user evidence",
      };
      writeDecision(this.graph, {
        id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        fields: reanchored,
        nodeStatus: "active",
        edges: [],
        retireEdges: premises.map((dst) => ({ type: "derived_from", dst })),
        summary: `Re-anchor ${id} to explicit evidence`,
      });
      return { id, action: "preserved_explicit", criterion: fields.criterion };
    }
    if (surviving.length > 0) {
      const kept: DecisionFields = {
        ...fields,
        status: "settled",
        basis: "derived",
        premises: surviving,
        retracted: false,
      };
      writeDecision(this.graph, {
        id,
        kind: node.kind,
        title: node.title,
        text: node.text,
        fields: kept,
        nodeStatus: "active",
        edges: [],
        retireEdges: premises.filter((dst) => !surviving.includes(dst)).map((dst) => ({ type: "derived_from", dst })),
        summary: `Drop dead premises from ${id}`,
      });
      return { id, action: "preserved_other_premise", criterion: fields.criterion };
    }
    const reopened: DecisionFields = {
      ...fields,
      status: "open",
      basis: null,
      rule: null,
      premises: [],
      entailmentVerdict: null,
      entailmentReason: "Support disappeared",
    };
    writeDecision(this.graph, {
      id,
      kind: node.kind,
      title: node.title,
      text: node.text,
      fields: reopened,
      nodeStatus: "active",
      edges: [],
      retireEdges: premises.map((dst) => ({ type: "derived_from", dst })),
      summary: `Reopen ${id}`,
    });
    return { id, action: "reopened", criterion: fields.criterion };
  }

  private stillSupports(premiseId: string): boolean {
    const node = this.graph.getNode(premiseId);
    const fields = node ? readDecision(node) : null;
    if (!node || !fields) return false;
    if (node.status !== "active" || fields.status !== "settled" || fields.retracted || fields.basis === null) {
      return false;
    }
    if (hasAssistantParaphrase(fields.evidence)) return false;
    if (isGroundedRootBasis(fields.basis)) return true;
    return fields.basis === "derived";
  }
}

function independentExplicit(fields: DecisionFields): boolean {
  return fields.evidence.some(
    (excerpt) =>
      excerpt.support === "explicit_value" &&
      excerpt.author === "developer" &&
      !excerpt.retracted &&
      !excerpt.superseded &&
      excerpt.quote.trim().length > 0,
  );
}
