import type {
  ArchitecturalConstraint,
  CatalogRuleEntry,
  IntervalClaimInput,
  MaterializedRequirement,
  MatrixCellRecord,
  SemanticPair,
} from "./types.js";

export type NodeLifecycle = "draft" | "active" | "retired" | "superseded";

export type ChangeSetOrigin =
  | "chat"
  | "markdown_edit"
  | "research"
  | "planner"
  | "sweep"
  | "undo"
  | "intake"
  | "kernel"
  | "import";

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

export interface NodeCreate {
  readonly op: "create";
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status?: "draft" | "active";
  readonly ownerRole?: string | null;
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
  readonly id?: string;
  readonly origin: ChangeSetOrigin;
  readonly originRef?: string | null;
  readonly author: string;
  readonly summary?: string | null;
  readonly nodes?: readonly NodeMutation[];
  readonly edges?: readonly EdgeMutation[];
}

export interface CommitChangeSetResult {
  readonly rev: number;
  readonly changeSetId: string;
  readonly noop: boolean;
  readonly idempotent: boolean;
}

/**
 * Narrow port of Task 017 `KnowledgeGraphRepo`.
 * `listNodes` stands in for paging `getSnapshotAsOf` until that repo is on the base.
 * `getEdgesAsOf(rev)` returns the full as-of edge set; the real method is keyset-paged.
 */
export interface KnowledgeGraphPort {
  currentRevision(): number;
  getNode(id: string): NodeRecord | null;
  listNodes(): readonly NodeRecord[];
  getEdgesAsOf(rev: number): readonly EdgeAsOf[];
  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult;
}

export interface ConflictInboxPayload {
  readonly layer: 1 | 2 | 3 | 4 | 5;
  readonly minimalCoreNodeIds: readonly string[];
  readonly plainEnglishConflict: string;
  readonly concreteCounterexample: string;
  readonly resolutionOptions: readonly string[];
  readonly ruleId: string;
}

export interface ConflictInboxItem {
  readonly id: string;
  readonly kind: "conflict";
  readonly status: "open" | "answered" | "superseded" | "dismissed";
  readonly priority: number;
  readonly subject: string;
  readonly payload: ConflictInboxPayload;
  readonly createdAt: number;
  readonly resolvedAt: number | null;
}

/** Local port of `inbox_items` rows whose kind is `conflict`. */
export interface ConflictInboxPort {
  upsertConflict(item: ConflictInboxItem): void;
  resolveConflict(id: string, resolvedAt: number): void;
  listOpenConflicts(): readonly ConflictInboxItem[];
}

/** Local port of Task 075 catalog rules consumed by Layer 1. */
export interface CatalogRuleSource {
  listRules(): readonly CatalogRuleEntry[];
}

/** Local port of Task 079 `MatrixCellPersistenceRepo.listCells`. */
export interface MatrixCellPersistenceRepo {
  listCells(): readonly MatrixCellRecord[];
}

/** Local port of Task 080 `OrderedCellFillerPipeline` materialized requirements. */
export interface OrderedCellFillerPipeline {
  listMaterializedRequirements(): readonly MaterializedRequirement[];
}

/** Model port for `contradiction-check@1`. Tests pass a scripted adapter; no network. */
export interface ContradictionCheckModel {
  checkBatch(pairs: readonly SemanticPair[]): readonly unknown[];
}

export interface ContradictionObserver {
  phase(name: "layer1" | "layer2" | "layer3" | "layer4" | "layer5"): void;
}

export type ContradictionWarning =
  | {
      readonly level: "warning";
      readonly event: "z3_incomplete_timeout";
      readonly timeoutMs: number;
      readonly layer: 2;
      readonly message: string;
    }
  | {
      readonly level: "warning";
      readonly event: "z3_solver_error";
      readonly layer: 2;
      readonly message: string;
    };

export interface ContradictionLogger {
  warn(warning: ContradictionWarning): void;
}

export interface CheckRequest {
  readonly editedNodeId?: string;
  readonly constraints?: readonly ArchitecturalConstraint[];
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readString(record: Record<string, unknown> | null, key: string): string | null {
  if (record === null) return null;
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readStringList(record: Record<string, unknown> | null, key: string): string[] {
  if (record === null) return [];
  const value = record[key];
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim().length > 0) out.push(item);
  }
  return out;
}

export function claimsFromFields(fields: unknown): IntervalClaimInput[] {
  const record = readRecord(fields);
  if (record === null || !Array.isArray(record.claims)) return [];
  const claims: IntervalClaimInput[] = [];
  for (const item of record.claims) {
    const claim = readRecord(item);
    if (claim === null) continue;
    const key = readString(claim, "key");
    const unit = readString(claim, "unit");
    const family = claim.family;
    const bound = claim.bound;
    const amount = claim.amount;
    if (key === null || unit === null || typeof amount !== "number" || !Number.isFinite(amount)) continue;
    if (
      family !== "bytes" &&
      family !== "duration_ms" &&
      family !== "minutes_of_day" &&
      family !== "minor_currency" &&
      family !== "count"
    ) {
      continue;
    }
    if (bound !== "min" && bound !== "max" && bound !== "exact") continue;
    const qualifier = claim.qualifier;
    if (qualifier === "idle" || qualifier === "absolute" || qualifier === "unspecified") {
      claims.push({ key, family, bound, amount, unit, qualifier });
    } else {
      claims.push({ key, family, bound, amount, unit });
    }
  }
  return claims;
}
