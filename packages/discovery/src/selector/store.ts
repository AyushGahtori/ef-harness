import type { AskUpdate, DiscoveryBatchRecord } from "./types.js";

export interface DiscoveryBatchStore {
  insert(record: DiscoveryBatchRecord): void;
  get(id: string): DiscoveryBatchRecord | null;
}

/**
 * `scope_criteria` in schema/state.sql has no ask_count or last_asked_turn column.
 * This ledger is keyed by the scope_criteria primary key (work item, scope rev, decision).
 */
export class ScopeCriterionAskLedger {
  private readonly rows = new Map<string, { askCount: number; lastAskedTurn: number }>();

  apply(workItemId: string, scopeRev: number, updates: readonly AskUpdate[]): void {
    for (const update of updates) {
      this.rows.set(key(workItemId, scopeRev, update.decisionId), {
        askCount: update.askCount,
        lastAskedTurn: update.lastAskedTurn,
      });
    }
  }

  read(
    workItemId: string,
    scopeRev: number,
    decisionId: string,
  ): { askCount: number; lastAskedTurn: number | null } {
    const row = this.rows.get(key(workItemId, scopeRev, decisionId));
    if (row === undefined) return { askCount: 0, lastAskedTurn: null };
    return row;
  }
}

export class InMemoryDiscoveryBatchStore implements DiscoveryBatchStore {
  private readonly rows = new Map<string, string>();

  insert(record: DiscoveryBatchRecord): void {
    if (this.rows.has(record.id)) {
      throw new Error(`discovery batch ${record.id} already exists`);
    }
    this.rows.set(record.id, record.questionsJson);
  }

  get(id: string): DiscoveryBatchRecord | null {
    const json = this.rows.get(id);
    if (json === undefined) return null;
    const parsed = JSON.parse(json) as SerializedBatch;
    return {
      id: parsed.id,
      workItemId: parsed.work_item,
      scopeRev: parsed.scope_rev,
      status: parsed.status,
      questionIds: parsed.question_ids,
      questionsJson: json,
      snapshot: parsed.snapshot,
      splitCard: parsed.split_card,
      diagnostics: parsed.diagnostics,
      cursor: parsed.cursor,
      createdAt: parsed.created_at,
      catalogVersion: parsed.catalog_version,
      askUpdates: parsed.ask_updates,
    };
  }

  json(id: string): string | null {
    return this.rows.get(id) ?? null;
  }
}

export const INSERT_DISCOVERY_BATCH_SQL =
  "INSERT INTO discovery_batches (id, work_item, scope_rev, status, questions, cursor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)";

export function discoveryBatchInsertParams(
  record: DiscoveryBatchRecord,
): readonly [string, string, number, "open", string, number, number] {
  return [
    record.id,
    record.workItemId,
    record.scopeRev,
    record.status,
    record.questionsJson,
    record.cursor,
    record.createdAt,
  ];
}

export function discoveryBatchQuestionsJson(
  record: Pick<
    DiscoveryBatchRecord,
    | "id"
    | "workItemId"
    | "scopeRev"
    | "status"
    | "cursor"
    | "createdAt"
    | "questionIds"
    | "snapshot"
    | "splitCard"
    | "diagnostics"
    | "catalogVersion"
    | "askUpdates"
  >,
): string {
  const body: SerializedBatch = {
    id: record.id,
    work_item: record.workItemId,
    scope_rev: record.scopeRev,
    status: record.status,
    cursor: record.cursor,
    created_at: record.createdAt,
    question_ids: record.questionIds,
    snapshot: record.snapshot,
    split_card: record.splitCard,
    diagnostics: record.diagnostics,
    catalog_version: record.catalogVersion,
    ask_updates: record.askUpdates,
  };
  return JSON.stringify(body);
}

interface SerializedBatch {
  id: string;
  work_item: string;
  scope_rev: number;
  status: "open";
  cursor: number;
  created_at: number;
  question_ids: DiscoveryBatchRecord["questionIds"];
  snapshot: DiscoveryBatchRecord["snapshot"];
  split_card: DiscoveryBatchRecord["splitCard"];
  diagnostics: DiscoveryBatchRecord["diagnostics"];
  catalog_version: string;
  ask_updates: DiscoveryBatchRecord["askUpdates"];
}

function key(workItemId: string, scopeRev: number, decisionId: string): string {
  return `${workItemId}\t${scopeRev}\t${decisionId}`;
}
