import { DatabaseSync } from "node:sqlite";

import { HumanStepError } from "./errors.js";
import { HUMAN_STEP_SCHEMA_SQL } from "./schema.js";
import type {
  GraphChangeSet,
  GraphEvidenceInput,
  GraphNodeRef,
  HumanStepQuestionRequest,
  KnowledgeGraphPort,
  SharedQuestionArbiter,
  TaskHoldDraft,
  TaskHoldPort,
} from "./ports.js";

/**
 * Sqlite stand-in for Task 017. Rows live in `human_step_graph_*`, not in
 * `nodes` / `evidence`, so this can share a connection with a future state.db
 * without colliding with the frozen schema. Swap the class for `KnowledgeGraphRepo`.
 */
export class SqliteKnowledgeGraphPort implements KnowledgeGraphPort {
  constructor(private readonly db: DatabaseSync) {}

  allocateEntityId(prefix: string): string {
    if (prefix !== "S-") {
      throw new HumanStepError(
        "entity_prefix",
        `Local graph port allocates S- only. Add prefix ${prefix} to the entity id catalog before use.`,
      );
    }
    const sequence = nextCounter(this.db, "graph");
    return `S-${sequence}`;
  }

  commitChangeSet(proposal: GraphChangeSet): { readonly rev: number; readonly changeSetId: string } {
    const rev = nextCounter(this.db, "rev");
    for (const node of proposal.nodes) {
      this.db
        .prepare(
          `INSERT INTO human_step_graph_nodes(id, kind, version, title, text, fields_json, status)
           VALUES (?, ?, 1, ?, ?, ?, ?)`,
        )
        .run(node.id, node.kind, node.title, node.text, JSON.stringify(node.fields), node.status);
    }
    return { rev, changeSetId: `CS-${rev}` };
  }

  getNode(id: string): GraphNodeRef | null {
    const row = this.db
      .prepare(`SELECT id, kind, version, title FROM human_step_graph_nodes WHERE id = ?`)
      .get(id) as { id: string; kind: string; version: number; title: string } | undefined;
    if (!row) return null;
    return { id: row.id, kind: row.kind, version: row.version, title: row.title };
  }

  recordEvidence(input: GraphEvidenceInput): { readonly id: number } {
    const id = nextCounter(this.db, "evidence");
    this.db
      .prepare(
        `INSERT INTO human_step_graph_evidence(id, node, node_version, source_kind, source_ref, locator_json, quote, verified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.node,
        input.nodeVersion,
        input.sourceKind,
        input.sourceRef,
        JSON.stringify(input.locator),
        input.quote,
        input.verified ? 1 : 0,
      );
    return { id };
  }
}

/**
 * Sqlite stand-in for Task 116 `SharedQuestionArbiter`.
 * Swap `submit` / `retireQuestion` to `submit` / `retireByEdit`.
 */
export class SqliteQuestionArbiter implements SharedQuestionArbiter {
  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {}

  submit(request: HumanStepQuestionRequest): { readonly questionId: string } {
    if (request.kind !== "human_step") {
      throw new HumanStepError("question_kind", "Human-step cards are submitted as human_step");
    }
    const questionId = `Q-${nextCounter(this.db, "question")}`;
    this.db
      .prepare(
        `INSERT INTO human_step_questions(question_id, build_id, waiting_task_id, waiting_role, kind, text, status, answer, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)`,
      )
      .run(questionId, request.buildId, request.waitingTaskId, request.waitingRole, request.kind, request.text, this.now());
    return { questionId };
  }

  retireQuestion(questionId: string, source: string, answer: string): void {
    const updated = this.db
      .prepare(
        `UPDATE human_step_questions SET status = 'retired', answer = ? WHERE question_id = ? AND status = 'open'`,
      )
      .run(`${source}: ${answer}`, questionId);
    if (updated.changes === 0) {
      throw new HumanStepError("question_missing", `No open human-step question ${questionId}`);
    }
  }

  get(questionId: string): { readonly status: string; readonly answer: string | null; readonly kind: string } | null {
    const row = this.db
      .prepare(`SELECT status, answer, kind FROM human_step_questions WHERE question_id = ?`)
      .get(questionId) as { status: string; answer: string | null; kind: string } | undefined;
    return row ?? null;
  }
}

/** Task 021 hold rows stored beside human steps. Reason is `waiting_on_human_step`. */
export class SqliteTaskHoldPort implements TaskHoldPort {
  constructor(private readonly db: DatabaseSync) {}

  placeHold(hold: TaskHoldDraft): void {
    this.db
      .prepare(
        `INSERT INTO task_holds(task, reason, source, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(task, reason, source) DO NOTHING`,
      )
      .run(hold.task, hold.reason, hold.source, hold.createdAt);
  }

  releaseHold(hold: Pick<TaskHoldDraft, "task" | "reason" | "source">): { readonly removed: boolean } {
    const result = this.db
      .prepare(`DELETE FROM task_holds WHERE task = ? AND reason = ? AND source = ?`)
      .run(hold.task, hold.reason, hold.source);
    return { removed: result.changes > 0 };
  }

  listHolds(task?: string): readonly TaskHoldDraft[] {
    const rows = (
      task === undefined
        ? this.db.prepare(`SELECT task, reason, source, created_at FROM task_holds ORDER BY task, reason, source`).all()
        : this.db
            .prepare(`SELECT task, reason, source, created_at FROM task_holds WHERE task = ? ORDER BY reason, source`)
            .all(task)
    ) as unknown as { task: string; reason: string; source: string; created_at: number }[];
    return rows.map((row) => ({
      task: row.task,
      reason: row.reason,
      source: row.source,
      createdAt: row.created_at,
    }));
  }
}

export function openHumanStepDatabase(filename = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec(HUMAN_STEP_SCHEMA_SQL);
  return db;
}

export function withImmediateTransaction<T>(db: DatabaseSync, body: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = body();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      const message = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      if (!/no transaction/i.test(message)) throw rollbackError;
    }
    throw error;
  }
}

export function nextCounter(db: DatabaseSync, name: string): number {
  db.prepare(`INSERT INTO human_step_counter(name, value) VALUES (?, 0) ON CONFLICT(name) DO NOTHING`).run(name);
  db.prepare(`UPDATE human_step_counter SET value = value + 1 WHERE name = ?`).run(name);
  const row = db.prepare(`SELECT value AS n FROM human_step_counter WHERE name = ?`).get(name) as { n: number } | undefined;
  if (!row || !Number.isSafeInteger(row.n)) throw new HumanStepError("counter", `Missing counter ${name}`);
  return row.n;
}
