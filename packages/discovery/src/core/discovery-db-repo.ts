import { randomUUID } from "node:crypto";
import { decisionValueCredit, parseDecisionFields, type DecisionFields } from "./decision-fields.js";
import { DiscoveryStateError } from "./errors.js";
import type {
  BatchRow,
  BatchStatus,
  ChangeOrigin,
  KnowledgeGraphRepo,
  OperationRow,
  ScopeCriterionRow,
  ScopeRow,
  StoredNode,
  TurnRow,
  WorkItemKind,
  WorkItemRow,
} from "./knowledge-graph-port.js";

export interface DecisionRecord {
  readonly id: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: DecisionFields;
  readonly credit: 0 | 1;
}

export interface ScopeSnapshot {
  readonly scope: ScopeRow;
  readonly criteria: readonly ScopeCriterionRow[];
}

/**
 * Persists discovery tables and decision nodes through a `KnowledgeGraphRepo` port.
 * Every multi-row write shares one immediate transaction.
 */
export class DiscoveryDbRepo {
  constructor(
    readonly graph: KnowledgeGraphRepo,
    private readonly now: () => number = () => Date.now(),
  ) {}

  transaction<T>(work: () => T): T {
    return this.graph.transaction(work);
  }

  close(): void {
    this.graph.close();
  }

  allocateChangeSet(input: {
    origin: ChangeOrigin;
    author: string;
    summary: string;
  }): { id: string; rev: number } {
    const id = `cs-${randomUUID()}`;
    const rev = this.graph.insertChangeSet({
      id,
      origin: input.origin,
      author: input.author,
      summary: input.summary,
      createdAt: this.now(),
    });
    return { id, rev };
  }

  insertWorkItem(row: WorkItemRow): void {
    this.graph.insertWorkItem(row);
  }

  listWorkItems(): WorkItemRow[] {
    return this.graph.listWorkItems();
  }

  getWorkItem(id: string): WorkItemRow | null {
    return this.graph.getWorkItem(id);
  }

  insertDecision(input: {
    id: string;
    title: string;
    text: string;
    fields: DecisionFields;
    changeSetId: string;
    rev: number;
  }): DecisionRecord {
    this.graph.insertNode({
      id: input.id,
      kind: "decision",
      title: input.title,
      text: input.text,
      fields: input.fields,
      changeSetId: input.changeSetId,
      rev: input.rev,
    });
    const stored = this.graph.getNode(input.id);
    if (!stored) throw new DiscoveryStateError(`decision ${input.id} was not stored`);
    return toDecision(stored);
  }

  updateDecision(input: {
    id: string;
    title: string;
    text: string;
    fields: DecisionFields;
    changeSetId: string;
    rev: number;
    expectedVersion: number;
  }): DecisionRecord {
    this.graph.updateNode({
      id: input.id,
      title: input.title,
      text: input.text,
      fields: input.fields,
      changeSetId: input.changeSetId,
      rev: input.rev,
      expectedVersion: input.expectedVersion,
    });
    const stored = this.graph.getNode(input.id);
    if (!stored) throw new DiscoveryStateError(`decision ${input.id} disappeared`);
    return toDecision(stored);
  }

  getDecision(id: string): DecisionRecord | null {
    const node = this.graph.getNode(id);
    return node && node.kind === "decision" ? toDecision(node) : null;
  }

  findDecisionByCriterion(workItemId: string, criterionId: string): DecisionRecord | null {
    const node = this.graph.findDecisionByCriterion(workItemId, criterionId);
    return node ? toDecision(node) : null;
  }

  findDecisionByQuestionId(questionId: string): DecisionRecord | null {
    const node = this.graph.findDecisionByQuestionId(questionId);
    return node ? toDecision(node) : null;
  }

  listDecisions(): DecisionRecord[] {
    return this.graph.listDecisions().map((node) => toDecision(node));
  }

  listScopes(workItemId: string): ScopeRow[] {
    return this.graph.listScopes(workItemId);
  }

  latestScope(workItemId: string): ScopeSnapshot | null {
    const scopes = this.graph.listScopes(workItemId);
    const scope = scopes[scopes.length - 1];
    if (!scope) return null;
    return {
      scope,
      criteria: this.graph.listScopeCriteria(workItemId, scope.scopeRev),
    };
  }

  listScopeSnapshots(workItemId: string): ScopeSnapshot[] {
    return this.graph.listScopes(workItemId).map((scope) => ({
      scope,
      criteria: this.graph.listScopeCriteria(workItemId, scope.scopeRev),
    }));
  }

  insertScope(row: ScopeRow): void {
    this.graph.insertScope(row);
  }

  insertScopeCriterion(row: ScopeCriterionRow): void {
    this.graph.insertScopeCriterion(row);
  }

  insertBatch(row: BatchRow): void {
    this.graph.insertBatch(row);
  }

  getBatch(id: string): BatchRow | null {
    return this.graph.getBatch(id);
  }

  getOpenBatch(workItemId: string): BatchRow | null {
    return this.graph.getOpenBatch(workItemId);
  }

  updateBatch(id: string, patch: { cursor?: number; status?: BatchStatus }): void {
    this.graph.updateBatch(id, patch);
  }

  insertTurn(row: TurnRow): void {
    this.graph.insertTurn(row);
  }

  listTurns(): TurnRow[] {
    return this.graph.listTurns();
  }

  getTurn(id: string): TurnRow | null {
    return this.graph.getTurn(id);
  }

  countTurns(): number {
    return this.graph.countTurns();
  }

  getOperation(opId: string): OperationRow | null {
    return this.graph.getOperation(opId);
  }

  insertOperation(row: OperationRow): void {
    this.graph.insertOperation(row);
  }

  counts(table: Parameters<KnowledgeGraphRepo["countRows"]>[0]): number {
    return this.graph.countRows(table);
  }
}

export function toDecision(node: StoredNode): DecisionRecord {
  const fields = parseDecisionFields(JSON.parse(node.fieldsJson) as unknown);
  return {
    id: node.id,
    version: node.version,
    title: node.title,
    text: node.text,
    fields,
    credit: decisionValueCredit(fields),
  };
}

export function isWorkItemKind(value: string): value is WorkItemKind {
  return (
    value === "project" || value === "change" || value === "fix" || value === "feature_request"
  );
}
