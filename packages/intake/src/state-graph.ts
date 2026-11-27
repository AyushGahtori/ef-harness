import {
  bindKnowledgeGraph,
  type ChangeSetProposal as DbChangeSetProposal,
  type EvidenceInput as DbEvidenceInput,
  type KnowledgeGraphRepo,
  type NodeCreate as DbNodeCreate,
  type ProjectStateDb,
} from "@ef-harness/db";
import { parseEvidenceLocator } from "./evidence-locator.js";
import type {
  ChangeSetProposal,
  CommitChangeSetResult,
  EvidenceInput,
  EvidenceRecord,
  KnowledgeGraphPort,
  MemoryNode,
} from "./extraction/graph.js";
import { isRecord, type Json } from "./extraction/types.js";

const PREFIX_MAP: Readonly<Record<string, string>> = {
  ENT: "SRC-",
  CON: "C-",
  SI: "SI-",
  D: "D-",
  R: "R",
};

/**
 * `KnowledgeGraphPort` bound to the open `ProjectStateDb` writer.
 * Closing the port does not close that database.
 */
export class ProjectKnowledgeGraph implements KnowledgeGraphPort {
  private readonly repo: KnowledgeGraphRepo;
  private readonly evidence: EvidenceRecord[] = [];

  constructor(stateDb: ProjectStateDb) {
    this.repo = bindKnowledgeGraph(stateDb);
  }

  allocateEntityId(prefix: string): string {
    return this.repo.allocateEntityId(PREFIX_MAP[prefix] ?? prefix);
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult {
    const committed = this.repo.commitChangeSet(toDbProposal(proposal));
    return { rev: committed.rev, noop: committed.noop };
  }

  getNode(id: string): MemoryNode | null {
    const node = this.repo.getNode(id);
    if (!node) return null;
    const fields = asJson(node.fields);
    return {
      id: node.id,
      kind: node.kind,
      version: node.version,
      title: node.title,
      text: node.text,
      fields,
      status: node.status,
      basis: node.basis,
    };
  }

  recordEvidence(input: EvidenceInput): void {
    const locator = parseEvidenceLocator(input.locator);
    const request: DbEvidenceInput = {
      node: input.node,
      nodeVersion: input.nodeVersion,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef,
      locator,
      quote: input.quote,
      verified: input.verified,
      ...(input.sourceHash !== undefined ? { sourceHash: input.sourceHash } : {}),
    };
    const recorded = this.repo.recordEvidence(request);
    this.evidence.push({
      node: recorded.node,
      nodeVersion: recorded.nodeVersion,
      sourceKind: recorded.sourceKind,
      sourceRef: recorded.sourceRef,
      sourceHash: recorded.sourceHash,
      locator: asJson(recorded.locator),
      quote: recorded.quote,
      verified: recorded.verified,
    });
  }

  listNodes(): readonly MemoryNode[] {
    const snapshot = this.repo.getSnapshotAsOf(this.repo.currentRevision(), { limit: 500 });
    const nodes: MemoryNode[] = [];
    for (const row of snapshot.nodes) {
      const node = this.getNode(row.id);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  listEvidence(): readonly EvidenceRecord[] {
    return this.evidence;
  }
}

function toDbProposal(proposal: ChangeSetProposal): DbChangeSetProposal {
  return {
    origin: proposal.origin,
    author: proposal.author,
    ...(proposal.originRef !== undefined ? { originRef: proposal.originRef } : {}),
    ...(proposal.summary !== undefined ? { summary: proposal.summary } : {}),
    ...(proposal.nodes !== undefined ? { nodes: proposal.nodes.map(toDbNode) } : {}),
  };
}

function toDbNode(node: NonNullable<ChangeSetProposal["nodes"]>[number]): DbNodeCreate {
  if (node.op !== "create") {
    throw new Error("ProjectStateDb intake commits create nodes. Updates stay on a later revision.");
  }
  if (node.status !== undefined && node.status !== "draft" && node.status !== "active") {
    throw new Error("ProjectStateDb creates draft or active nodes. Retire them in a later revision.");
  }
  return {
    op: "create",
    id: node.id,
    kind: node.kind,
    title: node.title,
    text: node.text,
    fields: node.fields,
    ...(node.status !== undefined ? { status: node.status } : {}),
  };
}

function asJson(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => asJson(item));
  if (isRecord(value)) {
    const copy: Record<string, Json> = {};
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child !== undefined) copy[key] = asJson(child);
    }
    return copy;
  }
  throw new Error("Knowledge graph value is not JSON");
}
