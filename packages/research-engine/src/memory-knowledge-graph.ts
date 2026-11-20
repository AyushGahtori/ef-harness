import type { KnowledgeChangeSet, KnowledgeCommitResult, KnowledgeGraphPort, KnowledgeNodeWrite } from "./ports.js";

/** In-memory stand-in for Task 017 `KnowledgeGraphRepo`. Accepts `informs` until schema/state.sql does. */
export class MemoryKnowledgeGraph implements KnowledgeGraphPort {
  private readonly nodes = new Map<string, KnowledgeNodeWrite>();
  private readonly edges: KnowledgeChangeSet["edges"][number][] = [];
  private rev = 0;

  commitChangeSet(proposal: KnowledgeChangeSet): KnowledgeCommitResult {
    if (proposal.origin !== "research") throw new Error("research facts commit with origin research");
    if (proposal.nodes.length === 0) throw new Error("refusing an empty research change set");
    for (const node of proposal.nodes) {
      if (node.kind !== "research_fact") throw new Error("only research_fact nodes are authoritative");
      if (node.fields.basis !== "observed") throw new Error("unverified findings cannot use basis observed");
      if (node.fields.authoritative !== true) throw new Error("authoritative briefs require authoritative facts");
      if (!node.fields.exactQuote || !node.fields.verifiedBy) {
        throw new Error("observed research facts require a quote and verifiedBy");
      }
    }
    for (const edge of proposal.edges) {
      if (edge.type !== "informs") throw new Error("research facts link with informs edges");
    }
    this.rev += 1;
    for (const node of proposal.nodes) this.nodes.set(node.id, node);
    for (const edge of proposal.edges) this.edges.push(edge);
    return { rev: this.rev, changeSetId: `cs-research-${this.rev}` };
  }

  authoritativeFacts(): readonly KnowledgeNodeWrite[] {
    return [...this.nodes.values()].filter(
      (node) => node.kind === "research_fact" && node.fields.basis === "observed" && node.fields.authoritative,
    );
  }

  informsEdges(): readonly KnowledgeChangeSet["edges"][number][] {
    return this.edges;
  }
}
