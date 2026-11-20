import { isRecord, type Json } from "./types.js";

export interface MemoryNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: Json;
  readonly status: "draft" | "active" | "retired" | "superseded";
  readonly basis: string | null;
}

export interface EvidenceRecord {
  readonly node: string;
  readonly nodeVersion: number;
  readonly sourceKind: "turn" | "source" | "repo" | "research";
  readonly sourceRef: string;
  readonly sourceHash: string | null;
  readonly locator: Json;
  readonly quote: string;
  readonly verified: boolean;
}

export interface NodeCreate {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: Json;
  readonly status?: MemoryNode["status"];
}

export interface NodeUpdate {
  readonly op: "update";
  readonly id: string;
  readonly title?: string;
  readonly text?: string;
  readonly fields?: Json;
  readonly status?: MemoryNode["status"];
}

export interface ChangeSetProposal {
  readonly origin: "chat" | "markdown_edit" | "research" | "planner" | "sweep" | "undo" | "intake" | "kernel" | "import";
  readonly originRef?: string;
  readonly author: string;
  readonly summary?: string;
  readonly nodes?: readonly (NodeCreate | NodeUpdate)[];
}

export interface CommitChangeSetResult {
  readonly rev: number;
  readonly noop: boolean;
}

export interface EvidenceInput {
  readonly node: string;
  readonly nodeVersion: number;
  readonly sourceKind: EvidenceRecord["sourceKind"];
  readonly sourceRef: string;
  readonly sourceHash?: string;
  readonly locator: Json;
  readonly quote: string;
  readonly verified: boolean;
}

/**
 * Methods the pipeline uses from Task 017 `KnowledgeGraphRepo`.
 * `InMemoryKnowledgeGraph` is the local stand-in.
 */
export interface KnowledgeGraphPort {
  allocateEntityId(prefix: string): string;
  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult;
  getNode(id: string): MemoryNode | null;
  recordEvidence(input: EvidenceInput): void;
  listNodes(): readonly MemoryNode[];
  listEvidence(): readonly EvidenceRecord[];
}

function basisOf(fields: Json): string | null {
  if (!isRecord(fields)) return null;
  const basis = fields.basis;
  return typeof basis === "string" ? basis : null;
}

export class InMemoryKnowledgeGraph implements KnowledgeGraphPort {
  private readonly nodes = new Map<string, MemoryNode>();
  private readonly evidence: EvidenceRecord[] = [];
  private readonly sequences = new Map<string, number>();
  private rev = 0;

  allocateEntityId(prefix: string): string {
    const next = (this.sequences.get(prefix) ?? 0) + 1;
    this.sequences.set(prefix, next);
    return `${prefix}-${next}`;
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult {
    const nodes = proposal.nodes ?? [];
    if (nodes.length === 0) return { rev: this.rev, noop: true };
    this.rev += 1;
    for (const node of nodes) {
      if (node.op === "create") {
        this.nodes.set(node.id, {
          id: node.id,
          kind: node.kind,
          version: 1,
          title: node.title,
          text: node.text,
          fields: node.fields,
          status: node.status ?? "active",
          basis: basisOf(node.fields),
        });
      } else {
        const current = this.nodes.get(node.id);
        if (!current) continue;
        const fields = node.fields ?? current.fields;
        this.nodes.set(node.id, {
          ...current,
          version: current.version + 1,
          title: node.title ?? current.title,
          text: node.text ?? current.text,
          fields,
          status: node.status ?? current.status,
          basis: basisOf(fields),
        });
      }
    }
    return { rev: this.rev, noop: false };
  }

  getNode(id: string): MemoryNode | null {
    return this.nodes.get(id) ?? null;
  }

  recordEvidence(input: EvidenceInput): void {
    this.evidence.push({
      node: input.node,
      nodeVersion: input.nodeVersion,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      sourceHash: input.sourceHash ?? null,
      locator: input.locator,
      quote: input.quote,
      verified: input.verified,
    });
  }

  listNodes(): readonly MemoryNode[] {
    return [...this.nodes.values()];
  }

  listEvidence(): readonly EvidenceRecord[] {
    return this.evidence;
  }
}
