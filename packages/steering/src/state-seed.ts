import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const KERNEL_TASK_STATES = new Set([
  "DRAFTED",
  "READY",
  "LEASED",
  "CODING",
  "STATIC_AUDIT",
  "CLEAN_VERIFY",
  "ACCEPTED",
  "MERGED_TO_FEATURE",
  "WAITING_INPUT",
  "PARKED",
  "ESCALATED",
  "EXHAUSTED",
  "HUMAN_OWNED",
  "SUPERSEDED",
  "CANCELLED",
]);

export const STEERING_CHANGE_SET = "cs-steering-seed";

/** Spec `VERIFYING` is the schema state `CLEAN_VERIFY`. Other labels stay on the checkpoint row. */
export function kernelTaskState(state: string): string {
  if (KERNEL_TASK_STATES.has(state)) return state;
  if (state === "VERIFYING") return "CLEAN_VERIFY";
  return "CODING";
}

export function ensureSteeringChangeSet(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO change_sets(id, origin, author, created_at, summary)
     VALUES (?, 'kernel', 'steering', 0, 'steering seed')
     ON CONFLICT(id) DO NOTHING`,
  ).run(STEERING_CHANGE_SET);
}

export function ensureTaskNode(db: DatabaseSync, taskId: string, featureId: string, title: string): void {
  ensureSteeringChangeSet(db);
  const hash = createHash("sha256").update(`${taskId}\n${featureId}`).digest("hex");
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
     VALUES (?, 'task', 1, ?, ?, '', ?, 'active', ?, 0, 0)
     ON CONFLICT(id) DO NOTHING`,
  ).run(taskId, hash, title, JSON.stringify({ feature: featureId }), STEERING_CHANGE_SET);
}

export function ensureTaskRuntime(db: DatabaseSync, taskId: string, featureId: string, state: string, title?: string): void {
  ensureTaskNode(db, taskId, featureId, title ?? taskId);
  db.prepare(
    `INSERT INTO task_runtime(task, feature, state, level, epoch, holder_attempt, lease_expires_at, submission_pending, updated_rev)
     VALUES (?, ?, ?, 'm3', 0, NULL, NULL, 0, 1)
     ON CONFLICT(task) DO UPDATE SET feature = excluded.feature, state = excluded.state`,
  ).run(taskId, featureId, kernelTaskState(state));
}
