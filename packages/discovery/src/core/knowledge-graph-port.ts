import type { DecisionFields } from "./decision-fields.js";

export type ChangeOrigin =
  | "chat"
  | "markdown_edit"
  | "research"
  | "planner"
  | "sweep"
  | "undo"
  | "intake"
  | "kernel"
  | "import";

export type WorkItemKind = "project" | "change" | "fix" | "feature_request";
export type WorkItemStatus = "discovering" | "ready" | "planned" | "done" | "abandoned";
export type BatchStatus = "open" | "answered" | "superseded";

export interface StoredNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fieldsJson: string;
  readonly changeSetId: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface WorkItemRow {
  readonly id: string;
  readonly kind: WorkItemKind;
  readonly title: string;
  readonly status: WorkItemStatus;
  readonly createdAt: number;
}

export interface ScopeRow {
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly createdRev: number;
  readonly reason: string;
}

export interface ScopeCriterionRow {
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly decisionId: string;
  readonly neededForPlanning: boolean;
  readonly critical: boolean;
}

export interface BatchRow {
  readonly id: string;
  readonly workItemId: string;
  readonly scopeRev: number;
  readonly status: BatchStatus;
  readonly questionIds: readonly string[];
  readonly cursor: number;
  readonly createdAt: number;
}

export interface TurnRow {
  readonly id: string;
  readonly author: "developer" | "harness";
  readonly target: string | null;
  readonly text: string;
  readonly createdAt: number;
}

export interface OperationRow {
  readonly opId: string;
  readonly kind: string;
  readonly requestHash: string;
  readonly resultJson: string;
  readonly committedRev: number | null;
  readonly createdAt: number;
}

export interface NodeInsert {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: DecisionFields | Record<string, unknown>;
  readonly changeSetId: string;
  readonly rev: number;
}

export interface NodeUpdate {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly fields: DecisionFields | Record<string, unknown>;
  readonly changeSetId: string;
  readonly rev: number;
  readonly expectedVersion: number;
}

/**
 * Local port for Task 017 `KnowledgeGraphRepo`.
 * The published db barrel does not export that type on this base.
 * `LocalSqliteKnowledgeGraph` talks to `schema/state.sql` directly.
 */
export interface KnowledgeGraphRepo {
  transaction<T>(work: () => T): T;
  close(): void;
  insertChangeSet(input: {
    id: string;
    origin: ChangeOrigin;
    author: string;
    summary: string;
    createdAt: number;
  }): number;
  insertNode(input: NodeInsert): void;
  updateNode(input: NodeUpdate): void;
  getNode(id: string): StoredNode | null;
  findDecisionByCriterion(workItemId: string, criterionId: string): StoredNode | null;
  findDecisionByQuestionId(questionId: string): StoredNode | null;
  listDecisions(): StoredNode[];
  insertWorkItem(row: WorkItemRow): void;
  listWorkItems(): WorkItemRow[];
  getWorkItem(id: string): WorkItemRow | null;
  insertScope(row: ScopeRow): void;
  listScopes(workItemId: string): ScopeRow[];
  insertScopeCriterion(row: ScopeCriterionRow): void;
  listScopeCriteria(workItemId: string, scopeRev: number): ScopeCriterionRow[];
  insertBatch(row: BatchRow): void;
  getBatch(id: string): BatchRow | null;
  getOpenBatch(workItemId: string): BatchRow | null;
  updateBatch(id: string, patch: { cursor?: number; status?: BatchStatus }): void;
  insertTurn(row: TurnRow): void;
  listTurns(): TurnRow[];
  getTurn(id: string): TurnRow | null;
  countTurns(): number;
  getOperation(opId: string): OperationRow | null;
  insertOperation(row: OperationRow): void;
  countRows(table: "work_items" | "discovery_scopes" | "scope_criteria" | "discovery_batches" | "turns" | "operations" | "nodes"): number;
}
