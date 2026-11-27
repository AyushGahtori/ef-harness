import { randomUUID } from "node:crypto";
import {
  KnowledgeGraphRepo as DbKnowledgeGraphRepo,
  QueueBusyError,
  bindCoordinatorWriteQueue,
  bindKnowledgeGraph,
  type CoordinatorWriteQueue,
  type ProjectStateDb,
  type WriteTransaction,
} from "@ef-harness/db";
import { parseDecisionFields } from "../core/decision-fields.js";
import { StaleDecisionError } from "../depth/errors.js";
import type {
  ChangeOrigin,
  EdgeRow,
  KnowledgeGraphRepo,
  NodeVersionRow,
  StoredNode,
} from "../depth/knowledge-graph.js";

type SqlCell = string | number | bigint | null | Uint8Array;

/**
 * Depth's graph port on the open project database.
 * Decision and stage nodes commit through `KnowledgeGraphRepo`.
 * Discovery tables commit through `CoordinatorWriteQueue`.
 */
export class ProjectStateDepthGraph implements KnowledgeGraphRepo {
  readonly knowledge: DbKnowledgeGraphRepo;
  readonly queue: CoordinatorWriteQueue;
  private readonly stateDb: ProjectStateDb;

  constructor(stateDb: ProjectStateDb) {
    this.stateDb = stateDb;
    this.knowledge = bindKnowledgeGraph(stateDb);
    this.queue = bindCoordinatorWriteQueue(stateDb, {
      coalesceWindowMs: 0,
      pruneIntervalMs: Number.POSITIVE_INFINITY,
    });
  }

  transaction<T>(work: () => T): T {
    return work();
  }

  close(): void {
    return;
  }

  async drain(): Promise<void> {
    await this.queue.drainAndClose();
  }

  insertChangeSet(input: {
    readonly origin: ChangeOrigin;
    readonly summary: string;
    readonly createdAt: number;
  }): { readonly id: string; readonly rev: number } {
    const id = `cs-discovery-${randomUUID()}`;
    return this.sync("discovery_change_set", { id, origin: input.origin }, (tx) => {
      const current = requiredRow(tx.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get({}));
      const rev = requiredMetaRev(current.value) + 1;
      tx.prepare("UPDATE meta SET value = :rev WHERE key = 'last_rev'").run({ rev: String(rev) });
      tx.prepare(
        `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
         VALUES (:id, :rev, :origin, 'discovery', :created_at, :summary)`,
      ).run({
        id,
        rev,
        origin: input.origin,
        created_at: input.createdAt,
        summary: input.summary,
      });
      return { id, rev };
    });
  }

  insertNode(input: {
    readonly id: string;
    readonly kind: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
  }): void {
    const fields = sharedDecisionFields(input.kind, input.fields);
    this.knowledge.commitChangeSet({
      origin: "chat",
      author: "discovery",
      summary: input.title,
      nodes: [
        {
          op: "create",
          id: input.id,
          kind: input.kind,
          title: input.title,
          text: input.text,
          fields,
          status: "active",
        },
      ],
    });
    this.assertSharedDecision(input.kind, input.id);
  }

  updateNode(input: {
    readonly id: string;
    readonly title: string;
    readonly text: string;
    readonly fields: Record<string, unknown>;
    readonly changeSetId: string;
    readonly rev: number;
    readonly expectedVersion: number;
    readonly status?: string;
  }): void {
    const current = this.knowledge.getNode(input.id);
    if (!current) throw new StaleDecisionError(`node ${input.id} does not exist`);
    if (current.version !== input.expectedVersion) {
      throw new StaleDecisionError(
        `node ${input.id} version is ${String(current.version)}, expected ${String(input.expectedVersion)}`,
      );
    }
    const fields = sharedDecisionFields(current.kind, input.fields);
    const status = nodeStatus(input.status);
    this.knowledge.commitChangeSet({
      origin: "chat",
      author: "discovery",
      summary: input.title,
      reads: [{ target: input.id, version: current.version }],
      nodes: [
        {
          op: "update",
          id: input.id,
          class: "clarifying",
          title: input.title,
          text: input.text,
          fields,
          ...(status === undefined ? {} : { status }),
        },
      ],
    });
    this.assertSharedDecision(current.kind, input.id);
  }

  getNode(id: string): StoredNode | null {
    const row = asRecord(this.stateDb.writer.prepare(
      `SELECT id, kind, version, title, text, fields, basis, status, change_set, created_rev, updated_rev
         FROM nodes WHERE id = :id`,
    ).get({ id }));
    return row ? mapNode(row) : null;
  }

  listNodesByKind(kind: string): StoredNode[] {
    return this.stateDb.writer
      .prepare(
        `SELECT id, kind, version, title, text, fields, basis, status, change_set, created_rev, updated_rev
           FROM nodes WHERE kind = :kind AND status = 'active' ORDER BY id`,
      )
      .all({ kind })
      .map((row: unknown) => mapNode(requiredRecord(row)));
  }

  listVersions(id: string): NodeVersionRow[] {
    return this.stateDb.writer
      .prepare(
        `SELECT version, fields, status, valid_from_rev, valid_to_rev
           FROM node_versions WHERE id = :id ORDER BY version`,
      )
      .all({ id })
      .map((row: unknown) => {
        const record = requiredRecord(row);
        const validTo = record.valid_to_rev;
        return {
          version: requiredInt(record, "version"),
          fieldsJson: requiredText(record, "fields"),
          status: requiredText(record, "status"),
          validFromRev: requiredInt(record, "valid_from_rev"),
          validToRev: typeof validTo === "number" || typeof validTo === "bigint" ? Number(validTo) : null,
        };
      });
  }

  insertEdge(input: {
    readonly src: string;
    readonly type: string;
    readonly dst: string;
    readonly changeSetId: string;
    readonly rev: number;
  }): void {
    this.knowledge.commitChangeSet({
      origin: "chat",
      author: "discovery",
      summary: `${input.type} ${input.src}`,
      edges: [{ op: "create", src: input.src, type: input.type, dst: input.dst }],
    });
  }

  listCurrentEdges(type: string, dst: string): EdgeRow[] {
    return this.stateDb.writer
      .prepare(
        `SELECT src, type, dst FROM edges
          WHERE type = :type AND dst = :dst AND valid_to_rev IS NULL
          ORDER BY src`,
      )
      .all({ type, dst })
      .map((row: unknown) => {
        const record = requiredRecord(row);
        return {
          src: requiredText(record, "src"),
          type: requiredText(record, "type"),
          dst: requiredText(record, "dst"),
        };
      });
  }

  insertWorkItem(input: { readonly id: string; readonly title: string; readonly createdAt: number }): void {
    this.sync("discovery_work_item", { id: input.id }, (tx) => {
      tx.prepare(
        `INSERT INTO work_items(id, kind, title, status, created_at)
         VALUES (:id, 'project', :title, 'discovering', :created_at)`,
      ).run({ id: input.id, title: input.title, created_at: input.createdAt });
      return input.id;
    });
  }

  insertScope(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly createdRev: number;
    readonly reason: string;
  }): void {
    this.sync("discovery_scope", { workItemId: input.workItemId, scopeRev: input.scopeRev }, (tx) => {
      tx.prepare(
        `INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason)
         VALUES (:work_item, :scope_rev, :created_rev, :reason)`,
      ).run({
        work_item: input.workItemId,
        scope_rev: input.scopeRev,
        created_rev: input.createdRev,
        reason: input.reason,
      });
      return input.scopeRev;
    });
  }

  insertScopeCriterion(input: {
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly decisionId: string;
    readonly neededForPlanning: boolean;
    readonly critical: boolean;
  }): void {
    this.sync(
      "discovery_scope_criterion",
      { workItemId: input.workItemId, decisionId: input.decisionId, scopeRev: input.scopeRev },
      (tx) => {
        tx.prepare(
          `INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical)
           VALUES (:work_item, :scope_rev, :decision, :needed_for_planning, :critical)`,
        ).run({
          work_item: input.workItemId,
          scope_rev: input.scopeRev,
          decision: input.decisionId,
          needed_for_planning: input.neededForPlanning ? 1 : 0,
          critical: input.critical ? 1 : 0,
        });
        return input.decisionId;
      },
    );
  }

  latestScope(workItemId: string): { readonly scopeRev: number; readonly reason: string } | null {
    const row = asRecord(
      this.stateDb.writer
        .prepare(
          `SELECT scope_rev, reason FROM discovery_scopes
            WHERE work_item = :work_item
            ORDER BY scope_rev DESC
            LIMIT 1`,
        )
        .get({ work_item: workItemId }),
    );
    if (!row) return null;
    return { scopeRev: requiredInt(row, "scope_rev"), reason: requiredText(row, "reason") };
  }

  insertTurn(input: { readonly id: string; readonly text: string; readonly createdAt: number }): void {
    this.sync("discovery_turn", { id: input.id }, (tx) => {
      tx.prepare(
        `INSERT INTO turns(id, author, target, text, redacted, created_at)
         VALUES (:id, 'developer', NULL, :text, 0, :created_at)`,
      ).run({ id: input.id, text: input.text, created_at: input.createdAt });
      return input.id;
    });
  }

  insertBatch(input: {
    readonly id: string;
    readonly workItemId: string;
    readonly scopeRev: number;
    readonly questionsJson: string;
    readonly cursor: number;
    readonly createdAt: number;
  }): void {
    this.sync("discovery_batch", { id: input.id, workItemId: input.workItemId }, (tx) => {
      tx.prepare(
        `INSERT INTO discovery_batches(id, work_item, scope_rev, status, questions, cursor, created_at)
         VALUES (:id, :work_item, :scope_rev, 'open', :questions, :cursor, :created_at)`,
      ).run({
        id: input.id,
        work_item: input.workItemId,
        scope_rev: input.scopeRev,
        questions: input.questionsJson,
        cursor: input.cursor,
        created_at: input.createdAt,
      });
      return input.id;
    });
  }

  readBatchJson(id: string): string | null {
    const row = asRecord(
      this.stateDb.writer.prepare("SELECT questions FROM discovery_batches WHERE id = :id").get({ id }),
    );
    if (!row) return null;
    return requiredText(row, "questions");
  }

  private sync<T>(kind: string, request: unknown, execute: (tx: WriteTransaction) => T): T {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return this.queue.submitOperationSync({
          opId: `discovery-${randomUUID()}`,
          kind,
          request,
          priority: "interactive",
          execute,
        }).result;
      } catch (error) {
        last = error;
        if (!(error instanceof QueueBusyError) || attempt === 2) throw error;
      }
    }
    throw last instanceof Error ? last : new Error("discovery write was not accepted");
  }

  private assertSharedDecision(kind: string, id: string): void {
    if (kind !== "decision") return;
    const stored = this.getNode(id);
    if (!stored) throw new Error(`decision ${id} was not stored`);
    parseDecisionFields(JSON.parse(stored.fieldsJson));
  }
}

export function sharedDecisionFields(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  if (kind !== "decision") return fields;
  const next: Record<string, unknown> = { ...fields };
  if (typeof next.criterion === "string") next.criterionId = next.criterion;
  if (typeof next.work_item === "string") {
    next.scopeId = next.work_item;
    next.scope_id = next.work_item;
    if (typeof next.groupId !== "string") next.groupId = next.work_item;
  }
  if (typeof next.domain === "string") next.groupId = next.domain;
  if (next.status === "settled" && typeof next.value === "string" && next.value.length > 0) {
    next.selectedOptionId = next.value;
  }
  return next;
}

function nodeStatus(value: string | undefined): "draft" | "active" | "retired" | "superseded" | undefined {
  if (value === "draft" || value === "active" || value === "retired" || value === "superseded") return value;
  return undefined;
}

function mapNode(row: Record<string, unknown>): StoredNode {
  const basis = row.basis;
  return {
    id: requiredText(row, "id"),
    kind: requiredText(row, "kind"),
    version: requiredInt(row, "version"),
    title: requiredText(row, "title"),
    text: requiredText(row, "text"),
    fieldsJson: requiredText(row, "fields"),
    basis: typeof basis === "string" ? basis : null,
    status: requiredText(row, "status"),
    changeSetId: requiredText(row, "change_set"),
    createdRev: requiredInt(row, "created_rev"),
    updatedRev: requiredInt(row, "updated_rev"),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  return requiredRecord(value);
}

function requiredRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("SQLite row was not an object");
  }
  return value as Record<string, SqlCell | undefined>;
}

function requiredRow(value: unknown): Record<string, unknown> {
  const row = asRecord(value);
  if (!row) throw new Error("SQLite row was missing");
  return row;
}

function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new Error(`expected text ${key}`);
}

function requiredMetaRev(value: unknown): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("meta.last_rev is not an integer");
  }
  return Number(value);
}

function requiredInt(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected integer ${key}`);
}
