import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ensureSearchText, namedQuery } from "./sql.js";
import type { HandoffEvent, NodeFieldPatch, ReadinessPorts } from "./types.js";

const depth = new WeakMap<DatabaseSync, number>();

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withImmediateTransaction<T>(db: DatabaseSync, fn: () => T): T {
  const current = depth.get(db) ?? 0;
  if (current > 0) {
    const save = `readiness_sp_${current}`;
    db.exec(`SAVEPOINT ${save}`);
    depth.set(db, current + 1);
    try {
      const value = fn();
      db.exec(`RELEASE ${save}`);
      depth.set(db, current);
      return value;
    } catch (error) {
      db.exec(`ROLLBACK TO ${save}`);
      db.exec(`RELEASE ${save}`);
      depth.set(db, current);
      throw error;
    }
  }
  db.exec("BEGIN IMMEDIATE");
  depth.set(db, 1);
  try {
    const value = fn();
    db.exec("COMMIT");
    depth.set(db, 0);
    return value;
  } catch (error) {
    depth.set(db, 0);
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new Error(`rollback failed after ${errorText(error)}`, { cause: rollbackError });
    }
    throw error;
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortValue(item));
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, inner] of entries) sorted[key] = sortValue(inner);
    return sorted;
  }
  return value;
}

function hashNode(parts: { kind: string; title: string; text: string; fields: unknown }): string {
  const payload = JSON.stringify({
    kind: parts.kind,
    title: parts.title,
    text: parts.text,
    fields: sortValue(parts.fields),
  });
  return createHash("sha256").update(payload).digest("hex");
}

interface NodeRow {
  version: number;
  kind: string;
  title: string;
  text: string;
  fields: string;
}

function readNode(db: DatabaseSync, nodeId: string): NodeRow {
  const value = db
    .prepare("SELECT version, kind, title, text, fields FROM nodes WHERE id = ?")
    .get(nodeId);
  if (!value || typeof value !== "object") {
    throw new Error(`missing node ${nodeId}`);
  }
  const row = value as Record<string, unknown>;
  const version = row.version;
  if (typeof version !== "number" || typeof row.kind !== "string" || typeof row.title !== "string") {
    throw new Error(`unreadable node ${nodeId}`);
  }
  return {
    version,
    kind: row.kind,
    title: row.title,
    text: typeof row.text === "string" ? row.text : "",
    fields: typeof row.fields === "string" ? row.fields : "{}",
  };
}

export function nextChangeRev(db: DatabaseSync): number {
  const value = db.prepare("SELECT coalesce(max(rev), 0) + 1 AS rev FROM change_sets").get();
  if (!value || typeof value !== "object") throw new Error("rev allocation failed");
  const rev = (value as Record<string, unknown>).rev;
  if (typeof rev !== "number") throw new Error("rev allocation failed");
  return rev;
}

/**
 * Local write port for Task 017. Bumps `nodes.version` by exactly 1 inside the caller's transaction.
 */
export function patchNodeFields(db: DatabaseSync, input: NodeFieldPatch): number {
  ensureSearchText(db);
  const current = readNode(db, input.nodeId);
  const fields = JSON.parse(current.fields) as Record<string, unknown>;
  for (const key of input.removeKeys ?? []) delete fields[key];
  for (const [key, value] of Object.entries(input.patch)) {
    if (value !== undefined) fields[key] = value;
  }
  const rev = nextChangeRev(db);
  const changeSetId = `CS-RDY-${rev}`;
  db.prepare(
    `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
     VALUES (?, ?, 'kernel', 'readiness', ?, ?)`,
  ).run(changeSetId, rev, Date.now(), input.summary);
  const nextFields = JSON.stringify(fields);
  const hash = hashNode({
    kind: current.kind,
    title: current.title,
    text: current.text,
    fields,
  });
  db.prepare(
    `UPDATE nodes
        SET version = ?, fields = ?, content_hash = ?, change_set = ?, updated_rev = ?
      WHERE id = ?`,
  ).run(current.version + 1, nextFields, hash, changeSetId, rev, input.nodeId);
  return rev;
}

export function writeNodeFields(db: DatabaseSync, ports: ReadinessPorts, input: NodeFieldPatch): number {
  if (ports.knowledge) {
    ports.knowledge.patchNodeFields(input);
    return nextChangeRev(db) - 1;
  }
  return patchNodeFields(db, input);
}

export function readWorkItemStatus(db: DatabaseSync, workItemId: string): string {
  const value = db.prepare("SELECT status FROM work_items WHERE id = ?").get(workItemId);
  if (!value || typeof value !== "object") throw new Error(`missing work item ${workItemId}`);
  const status = (value as Record<string, unknown>).status;
  if (typeof status !== "string") throw new Error(`missing work item ${workItemId}`);
  return status;
}

export function setWorkItemStatus(db: DatabaseSync, workItemId: string, status: "discovering" | "ready"): void {
  const current = readWorkItemStatus(db, workItemId);
  if (current === "planned" || current === "done" || current === "abandoned") return;
  if (current === status) return;
  db.prepare("UPDATE work_items SET status = ? WHERE id = ?").run(status, workItemId);
}

export function readFeatureState(db: DatabaseSync, featureId: string): string {
  const value = db.prepare("SELECT fields ->> '$.readinessState' AS readiness_state FROM nodes WHERE id = ?").get(featureId);
  if (!value || typeof value !== "object") return "discovering";
  const state = (value as Record<string, unknown>).readiness_state;
  return typeof state === "string" && state.length > 0 ? state : "discovering";
}

export function appendOutbox(
  db: DatabaseSync,
  event: HandoffEvent & { rev: number | null },
): void {
  db.prepare(
    `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(event.id, event.type, event.subject, event.rev, JSON.stringify(event.payload), Date.now());
  db.prepare(namedQuery("register_delivery")).run({ event_id: event.id, consumer: "ui_projection" });
}

export function insertOutboxPayload(
  db: DatabaseSync,
  input: { id: string; type: string; subject: string; rev: number | null; payload: unknown },
): void {
  db.prepare(
    `INSERT INTO outbox(id, type, subject, rev, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(input.id, input.type, input.subject, input.rev, JSON.stringify(input.payload), Date.now());
  db.prepare(namedQuery("register_delivery")).run({ event_id: input.id, consumer: "ui_projection" });
}
