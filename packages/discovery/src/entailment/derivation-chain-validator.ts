import type { InferenceRuleCatalog } from "./catalog.js";
import {
  CostlyDerivationError,
  CyclicDerivationError,
  RuleNotAllowlistedError,
  UngroundedDerivationError,
  UnsettledPremiseError,
} from "./errors.js";
import { type KnowledgeGraphPort, readDecision } from "./graph-port.js";
import { isGroundedRootBasis, type CitedExcerpt, type DerivationProposal } from "./types.js";

/**
 * Structural gate that runs before `entailment-checker@1`.
 * A bad rule, a cycle, an unsettled premise, or an ungrounded root never spends a model call.
 */
export class DerivationChainValidator {
  constructor(
    private readonly graph: KnowledgeGraphPort,
    private readonly catalog: InferenceRuleCatalog,
  ) {}

  validate(proposal: DerivationProposal, alsoPending: readonly DerivationProposal[] = []): void {
    if (proposal.costly || proposal.reversibility === "hard" || proposal.mustAsk) {
      throw new CostlyDerivationError(proposal.criterion);
    }
    const allowed = this.catalog.allowedRules(proposal.criterion);
    if (!allowed.includes(proposal.rule)) {
      throw new RuleNotAllowlistedError(proposal.criterion, proposal.rule);
    }
    if (hasAssistantParaphrase(proposal.evidence)) {
      throw new UngroundedDerivationError(proposal.decisionId, "assistant_paraphrase");
    }
    const cycle = this.findCycle(proposal, alsoPending);
    if (cycle) throw new CyclicDerivationError(cycle);
    for (const premiseId of proposal.premises) {
      this.assertSettledPremise(premiseId);
    }
    const visiting = new Set<string>();
    for (const premiseId of proposal.premises) {
      this.assertGrounded(premiseId, visiting);
    }
  }

  private findCycle(
    proposal: DerivationProposal,
    alsoPending: readonly DerivationProposal[],
  ): readonly string[] | null {
    const pending = new Map<string, readonly string[]>();
    for (const item of [...alsoPending, proposal]) {
      pending.set(item.decisionId, item.premises);
    }
    const stored = new Map<string, string[]>();
    for (const edge of this.graph.getEdgesAsOf(this.graph.currentRevision()).edges) {
      if (edge.type !== "derived_from") continue;
      const list = stored.get(edge.src) ?? [];
      list.push(edge.dst);
      stored.set(edge.src, list);
    }
    const nexts = (id: string): readonly string[] => pending.get(id) ?? stored.get(id) ?? [];
    return detectCycle(proposal.decisionId, nexts);
  }

  private assertSettledPremise(premiseId: string): void {
    const node = this.graph.getNode(premiseId);
    if (!node) throw new UnsettledPremiseError(premiseId, "missing");
    const fields = readDecision(node);
    if (!fields) throw new UnsettledPremiseError(premiseId, "unsettled");
    if (node.status === "superseded") throw new UnsettledPremiseError(premiseId, "superseded");
    if (fields.retracted || node.status === "retired") throw new UnsettledPremiseError(premiseId, "retracted");
    if (node.status !== "active" || fields.status !== "settled" || fields.basis === null) {
      throw new UnsettledPremiseError(premiseId, "unsettled");
    }
  }

  private assertGrounded(nodeId: string, visiting: Set<string>): void {
    if (visiting.has(nodeId)) {
      throw new CyclicDerivationError([...visiting, nodeId]);
    }
    const node = this.graph.getNode(nodeId);
    if (!node) throw new UnsettledPremiseError(nodeId, "missing");
    const fields = readDecision(node);
    if (!fields || fields.status !== "settled" || fields.basis === null || node.status !== "active") {
      throw new UnsettledPremiseError(nodeId, "unsettled");
    }
    if (fields.retracted) throw new UnsettledPremiseError(nodeId, "retracted");
    if (hasAssistantParaphrase(fields.evidence)) {
      throw new UngroundedDerivationError(nodeId, "assistant_paraphrase");
    }
    if (isGroundedRootBasis(fields.basis)) return;
    if (fields.basis !== "derived") {
      throw new UngroundedDerivationError(nodeId, "disallowed_basis");
    }
    const premises = currentPremiseIds(this.graph, nodeId);
    if (premises.length === 0) throw new UngroundedDerivationError(nodeId, "unrooted");
    visiting.add(nodeId);
    for (const premiseId of premises) {
      this.assertGrounded(premiseId, visiting);
    }
    visiting.delete(nodeId);
  }
}

export function currentPremiseIds(graph: KnowledgeGraphPort, decisionId: string): string[] {
  const ids: string[] = [];
  for (const edge of graph.getEdgesAsOf(graph.currentRevision()).edges) {
    if (edge.type === "derived_from" && edge.src === decisionId) ids.push(edge.dst);
  }
  return ids;
}

export function hasAssistantParaphrase(evidence: readonly CitedExcerpt[]): boolean {
  return evidence.some((excerpt) => excerpt.author === "harness");
}

function detectCycle(start: string, nexts: (id: string) => readonly string[]): readonly string[] | null {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const seen = new Set<string>();
  const visit = (id: string): readonly string[] | null => {
    if (onStack.has(id)) {
      const at = stack.indexOf(id);
      return [...stack.slice(at), id];
    }
    if (seen.has(id)) return null;
    seen.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of nexts(id)) {
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    onStack.delete(id);
    return null;
  };
  return visit(start);
}
