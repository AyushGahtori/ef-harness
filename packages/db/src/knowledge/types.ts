import type { ChangeClass, ChangeSetOrigin, EvidenceSourceKind, NodeStatus, TurnAuthor, UpdateClass } from "./vocab.js";

export type { ChangeClass, ChangeSetOrigin, EvidenceSourceKind, NodeStatus, TurnAuthor, UpdateClass };

export interface NodeVersionRead {
  readonly target: string;
  readonly version: number;
}

export interface EdgeSetVersionRead {
  readonly target: string;
  readonly dir: "in" | "out";
  readonly edgeType: string;
  readonly version: number;
}

export type ChangeSetRead = NodeVersionRead | EdgeSetVersionRead;

export interface NodeCreate {
  readonly op: "create";
  readonly id?: string;
  readonly idPrefix?: string;
  readonly kind: string;
  readonly title: string;
  readonly text?: string;
  readonly fields?: unknown;
  readonly status?: "draft" | "active";
  readonly ownerRole?: string | null;
}

export interface NodeUpdate {
  readonly op: "update";
  readonly id: string;
  readonly class: UpdateClass;
  readonly title?: string;
  readonly text?: string;
  readonly fields?: unknown;
  readonly status?: NodeStatus;
  readonly ownerRole?: string | null;
}

export interface NodeRetire {
  readonly op: "retire";
  readonly id: string;
  readonly status?: "retired" | "superseded";
}

export type NodeMutation = NodeCreate | NodeUpdate | NodeRetire;

export interface EdgeCreate {
  readonly op: "create";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  readonly dstVersionPin?: number | null;
}

export interface EdgeRetire {
  readonly op: "retire";
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export type EdgeMutation = EdgeCreate | EdgeRetire;

export interface ChangeSetProposal {
  readonly id?: string;
  readonly origin: ChangeSetOrigin;
  readonly originRef?: string | null;
  readonly author: string;
  readonly summary?: string | null;
  readonly createdAt?: number;
  readonly reads?: readonly ChangeSetRead[];
  readonly nodes?: readonly NodeMutation[];
  readonly edges?: readonly EdgeMutation[];
}

export interface CommitChangeSetResult {
  readonly rev: number;
  readonly changeSetId: string | null;
  readonly noop: boolean;
  readonly idempotent: boolean;
}

export interface NodeRecord {
  readonly nid: number;
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: NodeStatus;
  readonly feature: string | null;
  readonly basis: string | null;
  readonly ownerRole: string | null;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface NodeAsOf {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly title: string;
  readonly status: NodeStatus;
  readonly text: string;
  readonly fields: unknown;
  readonly contentHash: string;
  readonly validFromRev: number;
  readonly validToRev: number | null;
}

export interface EdgeAsOf {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface EdgePage {
  readonly edges: readonly EdgeAsOf[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface SnapshotPage {
  readonly rev: number;
  readonly nodes: readonly Pick<NodeAsOf, "id" | "version" | "kind" | "title" | "status">[];
  readonly edges: readonly EdgeAsOf[];
  readonly nodesNextCursor: string | null;
  readonly edgesNextCursor: string | null;
  readonly hasMoreNodes: boolean;
  readonly hasMoreEdges: boolean;
  readonly hasMore: boolean;
}

export interface SnapshotQuery {
  readonly nodeAfter?: string;
  readonly edgeAfter?: string;
  readonly limit?: number;
}

export interface EdgePageQuery {
  readonly after?: string;
  readonly limit?: number;
}

export type ImpactPartialReason = "node_cap_exceeded" | "depth_cap" | "time_budget_exceeded";

export interface ImpactNode {
  readonly id: string;
  readonly depth: number;
}

export interface ImpactWalkResult {
  readonly nodes: readonly ImpactNode[];
  readonly partial: boolean;
  readonly reason?: ImpactPartialReason;
  readonly frontier: readonly string[];
  readonly elapsedMs: number;
}

export interface TurnInput {
  readonly id: string;
  readonly author: TurnAuthor;
  readonly target?: string | null;
  readonly text: string;
  readonly audioArtifact?: string | null;
  readonly createdAt?: number;
}

export interface TurnRecord {
  readonly id: string;
  readonly author: TurnAuthor;
  readonly target: string | null;
  readonly text: string;
  readonly audioArtifact: string | null;
  readonly createdAt: number;
}

export interface EvidenceInput {
  readonly node: string;
  readonly nodeVersion: number;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceRef: string;
  readonly sourceHash?: string | null;
  readonly locator: unknown;
  readonly quote: string;
  readonly verified?: boolean;
}

export interface EvidenceRecord {
  readonly id: number;
  readonly node: string;
  readonly nodeVersion: number;
  readonly sourceKind: EvidenceSourceKind;
  readonly sourceRef: string;
  readonly sourceHash: string | null;
  readonly locator: unknown;
  readonly quote: string;
  readonly verified: boolean;
}
