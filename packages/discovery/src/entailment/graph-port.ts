import { createHash } from "node:crypto";
import {
  isDecisionStatus,
  isReversibility,
  isSettledBasis,
  type CitedExcerpt,
  type DecisionFields,
  type JsonValue,
  type MetricVerdict,
  type NodeLifecycle,
} from "./types.js";

/**
 * Narrow port matching the Task 017 `KnowledgeGraphRepo` methods this task calls:
 * `currentRevision`, `getNode`, `getEdgesAsOf`, and `commitChangeSet`.
 * `InMemoryKnowledgeGraph` is the local stand-in. Integration injects the real repo.
 * Derivation links are temporal `edges(type = 'derived_from')`, not only `fields`.
 */
export interface NodeRecord {
  readonly nid: number;
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: NodeLifecycle;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly ownerRole: string | null;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface EdgeAsOf {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface NodeVersionRead {
  readonly target: string;
  readonly version: number;
}

export interface NodeCreate {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status?: "draft" | "active";
}

export interface NodeUpdate {
  readonly op: "update";
  readonly id: string;
  readonly class: "cosmetic" | "clarifying" | "compatible" | "breaking";
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: NodeLifecycle;
}

export type NodeMutation = NodeCreate | NodeUpdate;

export interface EdgeCreate {
  readonly op: "create";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface EdgeRetire {
  readonly op: "retire";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export type EdgeMutation = EdgeCreate | EdgeRetire;

export interface ChangeSetProposal {
  readonly origin: "chat" | "kernel";
  readonly author: string;
  readonly summary: string;
  readonly reads?: readonly NodeVersionRead[];
  readonly nodes?: readonly NodeMutation[];
  readonly edges?: readonly EdgeMutation[];
}

export interface CommitChangeSetResult {
  readonly rev: number;
  readonly changeSetId: string;
  readonly noop: boolean;
  readonly idempotent: boolean;
}

export interface KnowledgeGraphPort {
  currentRevision(): number;
  getNode(id: string): NodeRecord | null;
  getEdgesAsOf(rev: number): { readonly edges: readonly EdgeAsOf[] };
  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult;
}

interface StoredNode {
  nid: number;
  id: string;
  kind: string;
  version: number;
  contentHash: string;
  title: string;
  text: string;
  fields: unknown;
  status: NodeLifecycle;
  feature: string | null;
  basis: string | null;
  ownerRole: null;
  changeSetId: string;
  createdRev: number;
  updatedRev: number;
}

export interface NodeHistoryRecord {
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: NodeLifecycle;
  readonly validFromRev: number;
  readonly validToRev: number | null;
}

interface StoredEdge {
  src: string;
  type: string;
  dst: string;
  changeSetId: string;
  validFromRev: number;
  validToRev: number | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function hashContent(payload: unknown): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isJsonValue(item));
}

function isMetricVerdict(value: unknown): value is MetricVerdict {
  return value === "establishes" || value === "contradicts" || value === "leaves_open" || value === "unavailable";
}

function parseExcerpt(value: unknown): CitedExcerpt | null {
  if (!isRecord(value)) return null;
  if (typeof value.turnId !== "string" || (value.author !== "developer" && value.author !== "harness")) return null;
  if (value.support !== "explicit_value" && value.support !== "cited_for_derivation") return null;
  if (typeof value.quote !== "string" || typeof value.surroundingParagraph !== "string") return null;
  if (typeof value.start !== "number" || typeof value.end !== "number") return null;
  if (typeof value.retracted !== "boolean" || typeof value.superseded !== "boolean") return null;
  if (typeof value.lowConfidence !== "boolean") return null;
  if (
    value.valueKind !== "time" &&
    value.valueKind !== "amount" &&
    value.valueKind !== "count" &&
    value.valueKind !== "behavioral_name" &&
    value.valueKind !== "other"
  ) {
    return null;
  }
  return {
    turnId: value.turnId,
    author: value.author,
    support: value.support,
    quote: value.quote,
    surroundingParagraph: value.surroundingParagraph,
    start: value.start,
    end: value.end,
    retracted: value.retracted,
    superseded: value.superseded,
    lowConfidence: value.lowConfidence,
    valueKind: value.valueKind,
  };
}

export function parseDecisionFields(value: unknown): DecisionFields | null {
  if (!isRecord(value)) return null;
  if (typeof value.criterion !== "string" || !isDecisionStatus(value.status)) return null;
  if (!isJsonValue(value.value)) return null;
  if (value.basis !== null && !isSettledBasis(value.basis)) return null;
  if (value.rule !== null && typeof value.rule !== "string") return null;
  if (!Array.isArray(value.premises) || value.premises.some((item) => typeof item !== "string")) return null;
  if (!Array.isArray(value.evidence)) return null;
  const evidence: CitedExcerpt[] = [];
  for (const item of value.evidence) {
    const excerpt = parseExcerpt(item);
    if (!excerpt) return null;
    evidence.push(excerpt);
  }
  if (typeof value.retracted !== "boolean") return null;
  if (value.feature !== null && typeof value.feature !== "string") return null;
  if (typeof value.costly !== "boolean" || !isReversibility(value.reversibility) || typeof value.mustAsk !== "boolean") {
    return null;
  }
  if (typeof value.criterionKind !== "string") return null;
  if (value.release !== "current" && value.release !== "later") return null;
  if (value.changeSummary !== null && typeof value.changeSummary !== "string") return null;
  if (value.entailmentVerdict !== null && !isMetricVerdict(value.entailmentVerdict)) return null;
  if (value.entailmentReason !== null && typeof value.entailmentReason !== "string") return null;
  return {
    criterion: value.criterion,
    status: value.status,
    value: value.value,
    basis: value.basis,
    rule: value.rule,
    premises: value.premises,
    evidence,
    retracted: value.retracted,
    feature: value.feature,
    costly: value.costly,
    reversibility: value.reversibility,
    mustAsk: value.mustAsk,
    criterionKind: value.criterionKind,
    release: value.release,
    changeSummary: value.changeSummary,
    entailmentVerdict: value.entailmentVerdict,
    entailmentReason: value.entailmentReason,
  };
}

export function readDecision(node: NodeRecord): DecisionFields | null {
  return parseDecisionFields(node.fields);
}

function featureOf(fields: unknown): string | null {
  const parsed = parseDecisionFields(fields);
  return parsed?.feature ?? null;
}

function basisOf(fields: unknown): string | null {
  const parsed = parseDecisionFields(fields);
  return parsed?.basis ?? null;
}

export class InMemoryKnowledgeGraph implements KnowledgeGraphPort {
  private revision = 0;
  private nextNid = 1;
  private nextChange = 1;
  private readonly nodes = new Map<string, StoredNode>();
  private readonly versions = new Map<string, NodeHistoryRecord[]>();
  private readonly edges: StoredEdge[] = [];
  readonly committedChangeSets: ChangeSetProposal[] = [];

  currentRevision(): number {
    return this.revision;
  }

  getNode(id: string): NodeRecord | null {
    const node = this.nodes.get(id);
    if (!node) return null;
    return clone(node);
  }

  getEdgesAsOf(rev: number): { readonly edges: readonly EdgeAsOf[] } {
    const edges = this.edges
      .filter((edge) => edge.validFromRev <= rev && (edge.validToRev === null || edge.validToRev > rev))
      .map((edge) => ({ src: edge.src, type: edge.type, dst: edge.dst }));
    return { edges };
  }

  history(id: string): readonly NodeHistoryRecord[] {
    const past = this.versions.get(id) ?? [];
    const current = this.nodes.get(id);
    const all = current
      ? [
          ...past,
          {
            version: current.version,
            title: current.title,
            text: current.text,
            fields: current.fields,
            status: current.status,
            validFromRev: current.updatedRev,
            validToRev: null,
          },
        ]
      : past;
    return clone(all);
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult {
    const snapshot = clone(proposal);
    this.revision += 1;
    const rev = this.revision;
    const changeSetId = `cs-${this.nextChange}`;
    this.nextChange += 1;
    for (const mutation of snapshot.nodes ?? []) {
      this.applyNode(mutation, rev, changeSetId);
    }
    for (const mutation of snapshot.edges ?? []) {
      this.applyEdge(mutation, rev, changeSetId);
    }
    this.committedChangeSets.push(snapshot);
    return { rev, changeSetId, noop: false, idempotent: false };
  }

  private applyNode(mutation: NodeMutation, rev: number, changeSetId: string): void {
    if (mutation.op === "create") {
      if (this.nodes.has(mutation.id)) {
        throw new Error(`node ${mutation.id} already exists`);
      }
      const node: StoredNode = {
        nid: this.nextNid,
        id: mutation.id,
        kind: mutation.kind,
        version: 1,
        contentHash: hashContent({
          kind: mutation.kind,
          title: mutation.title,
          text: mutation.text,
          fields: mutation.fields,
        }),
        title: mutation.title,
        text: mutation.text,
        fields: clone(mutation.fields),
        status: mutation.status ?? "active",
        feature: featureOf(mutation.fields),
        basis: basisOf(mutation.fields),
        ownerRole: null,
        changeSetId,
        createdRev: rev,
        updatedRev: rev,
      };
      this.nextNid += 1;
      this.nodes.set(mutation.id, node);
      return;
    }
    const existing = this.nodes.get(mutation.id);
    if (!existing) throw new Error(`node ${mutation.id} is missing`);
    const prior = this.versions.get(mutation.id) ?? [];
    prior.push({
      version: existing.version,
      title: existing.title,
      text: existing.text,
      fields: clone(existing.fields),
      status: existing.status,
      validFromRev: existing.updatedRev,
      validToRev: rev,
    });
    this.versions.set(mutation.id, prior);
    existing.version += 1;
    existing.title = mutation.title;
    existing.text = mutation.text;
    existing.fields = clone(mutation.fields);
    existing.status = mutation.status;
    existing.feature = featureOf(mutation.fields);
    existing.basis = basisOf(mutation.fields);
    existing.contentHash = hashContent({
      kind: existing.kind,
      title: existing.title,
      text: existing.text,
      fields: existing.fields,
    });
    existing.changeSetId = changeSetId;
    existing.updatedRev = rev;
  }

  private applyEdge(mutation: EdgeMutation, rev: number, changeSetId: string): void {
    if (!this.nodes.has(mutation.src) || !this.nodes.has(mutation.dst)) {
      throw new Error(`edge ${mutation.src} -> ${mutation.dst} is missing an endpoint`);
    }
    if (mutation.op === "retire") {
      const current = this.edges.find(
        (edge) =>
          edge.src === mutation.src &&
          edge.type === mutation.type &&
          edge.dst === mutation.dst &&
          edge.validToRev === null,
      );
      if (current) current.validToRev = rev;
      return;
    }
    const already = this.edges.some(
      (edge) =>
        edge.src === mutation.src &&
        edge.type === mutation.type &&
        edge.dst === mutation.dst &&
        edge.validToRev === null,
    );
    if (already) return;
    this.edges.push({
      src: mutation.src,
      type: mutation.type,
      dst: mutation.dst,
      changeSetId,
      validFromRev: rev,
      validToRev: null,
    });
  }
}
