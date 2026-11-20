import type { DatabaseSync } from "node:sqlite";

import { sqlInt, sqlText } from "./graph.js";
import type { ChangeClass, ConflictCard, ContradictionFinding, RevisionBatchRecord } from "./types.js";

export class RevisionHistoryStore {
  constructor(private readonly db: DatabaseSync) {}

  nextId(): string {
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM revision_batches`).get();
    const next = sqlInt(row?.n) + 1;
    return `RB-${next.toString().padStart(6, "0")}`;
  }

  insert(record: RevisionBatchRecord): void {
    this.db
      .prepare(
        `INSERT INTO revision_batches(
           revision_id, trigger_source, change_class, edited_node_ids, impacted_node_ids,
           early_cutoff_node_ids, reverified_passed_ids, rework_task_ids, additive_task_ids,
           hold_task_ids, conflict_card, preview, llm_calls, created_at
         ) VALUES (
           :revision_id, :trigger_source, :change_class, :edited_node_ids, :impacted_node_ids,
           :early_cutoff_node_ids, :reverified_passed_ids, :rework_task_ids, :additive_task_ids,
           :hold_task_ids, :conflict_card, :preview, :llm_calls, :created_at
         )`,
      )
      .run({
        revision_id: record.revisionId,
        trigger_source: record.triggerSource,
        change_class: record.changeClass,
        edited_node_ids: JSON.stringify(record.editedNodeIds),
        impacted_node_ids: JSON.stringify(record.impactedNodeIds),
        early_cutoff_node_ids: JSON.stringify(record.earlyCutoffNodeIds),
        reverified_passed_ids: JSON.stringify(record.reverifiedPassedIds),
        rework_task_ids: JSON.stringify(record.reworkTaskIds),
        additive_task_ids: JSON.stringify(record.additiveTaskIds),
        hold_task_ids: JSON.stringify(record.holdTaskIds),
        conflict_card: record.conflictCard ? JSON.stringify(record.conflictCard) : null,
        preview: record.preview,
        llm_calls: record.llmCalls,
        created_at: record.createdAt,
      });
  }

  get(revisionId: string): RevisionBatchRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM revision_batches WHERE revision_id = :id`)
      .get({ id: revisionId });
    if (!row) return null;
    return {
      revisionId: sqlText(row.revision_id),
      triggerSource: sqlText(row.trigger_source),
      changeClass: asChangeClass(sqlText(row.change_class)),
      editedNodeIds: readStrings(row.edited_node_ids),
      impactedNodeIds: readStrings(row.impacted_node_ids),
      earlyCutoffNodeIds: readStrings(row.early_cutoff_node_ids),
      reverifiedPassedIds: readStrings(row.reverified_passed_ids),
      reworkTaskIds: readStrings(row.rework_task_ids),
      additiveTaskIds: readStrings(row.additive_task_ids),
      holdTaskIds: readStrings(row.hold_task_ids),
      conflictCard: readConflict(row.conflict_card),
      preview: sqlText(row.preview),
      llmCalls: 0,
      createdAt: sqlInt(row.created_at),
    };
  }
}

function asChangeClass(value: string): ChangeClass {
  if (value === "cosmetic" || value === "clarifying" || value === "compatible" || value === "breaking") {
    return value;
  }
  throw new Error(`unknown change class ${value}`);
}

function readStrings(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function readConflict(value: unknown): ConflictCard | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  const contradictions = Array.isArray(record.contradictions)
    ? record.contradictions.filter(isFinding)
    : [];
  return {
    kind: "conflict_card",
    contradictions,
    message: typeof record.message === "string" ? record.message : "",
  };
}

function isFinding(value: unknown): value is ContradictionFinding {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.src === "string" &&
    typeof record.dst === "string" &&
    record.edgeType === "contradicts" &&
    typeof record.summary === "string"
  );
}
