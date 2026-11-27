import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeNodeContentHash, openProjectStateDb, type ProjectStateDb } from "@ef-harness/db";

import { FinalAuditError } from "./errors.js";
import type { AuditCheck, LandingSummary, ShardRun } from "./types.js";

type SqlValue = string | number | bigint | null;
type SqlRow = Record<string, SqlValue>;
type Writer = ProjectStateDb["writer"];

const RECORD_RUN = "final_audit_run";
const RECORD_CHECK = "final_audit_check";
const RECORD_SHARD = "final_audit_shard";
const RECORD_SUMMARY = "final_audit_summary";

function encode(value: unknown): unknown {
  if (typeof value === "bigint") return { $u: value.toString() };
  if (Array.isArray(value)) return value.map((item) => encode(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encode(item);
    return out;
  }
  return value;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => decode(item));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length === 1 && typeof record.$u === "string" && /^\d+$/.test(record.$u)) {
      return BigInt(record.$u);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decode(item);
    return out;
  }
  return value;
}

function toJson(value: unknown): string {
  return JSON.stringify(encode(value));
}

function fromJson<T>(payload: string, label: string): T {
  try {
    return decode(JSON.parse(payload) as unknown) as T;
  } catch {
    throw new FinalAuditError("corrupt_checkpoint", `${label} checkpoint is not JSON`);
  }
}

function isRow(value: unknown): value is SqlRow {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textCell(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function stableId(prefix: string, parts: readonly string[]): string {
  const digest = createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

/** Completion-wave checkpoints stored as `comment` nodes on `ProjectStateDb`. */
export class FinalAuditStore {
  private revCounter: number;

  private constructor(
    private readonly state: ProjectStateDb,
    private readonly writer: Writer,
  ) {
    const row = this.one("SELECT COALESCE(MAX(rev), 0) AS n FROM change_sets");
    this.revCounter = row ? Number(row.n) : 0;
  }

  static open(filename = ":memory:"): FinalAuditStore {
    const root = filename === ":memory:" ? mkdtempSync(path.join(tmpdir(), "ef-final-audit-")) : path.dirname(filename);
    mkdirSync(root, { recursive: true });
    const projectId = `a${createHash("sha256").update(root).digest("hex").slice(0, 24)}`;
    const state = openProjectStateDb({ projectId, rootDir: root });
    return new FinalAuditStore(state, state.writer);
  }

  close(): void {
    this.state.close();
  }

  beginRun(projectId: string): string {
    const existing = this.one(
      `SELECT id FROM nodes
        WHERE kind = 'comment' AND status = 'active'
          AND json_extract(fields, '$.record') = ?
          AND json_extract(fields, '$.projectId') = ?
          AND json_extract(fields, '$.status') = 'open'
        ORDER BY json_extract(fields, '$.createdAt') DESC
        LIMIT 1`,
      RECORD_RUN,
      projectId,
    );
    if (existing) return textCell(existing, "id");
    const runId = stableId("FA-RUN", [randomUUID()]);
    const fields = {
      record: RECORD_RUN,
      projectId,
      status: "open",
      fixRounds: 0,
      createdAt: Date.now(),
    };
    this.insertComment(runId, projectId, "", fields);
    return runId;
  }

  completeRun(runId: string, fixRounds: number): void {
    this.patchRun(runId, { status: "complete", fixRounds });
  }

  readFixRounds(runId: string): number {
    const row = this.one(
      "SELECT json_extract(fields, '$.fixRounds') AS n FROM nodes WHERE id = ? AND status = 'active'",
      runId,
    );
    if (!row || row.n === null) return 0;
    return Number(row.n);
  }

  saveFixRounds(runId: string, fixRounds: number): void {
    this.patchRun(runId, { fixRounds });
  }

  readCheck(runId: string, checkId: string): AuditCheck | null {
    const row = this.one(
      `SELECT text FROM nodes
        WHERE kind = 'comment' AND status = 'active'
          AND json_extract(fields, '$.record') = ?
          AND json_extract(fields, '$.runId') = ?
          AND json_extract(fields, '$.checkId') = ?`,
      RECORD_CHECK,
      runId,
      checkId,
    );
    if (!row) return null;
    return fromJson<AuditCheck>(textCell(row, "text"), checkId);
  }

  saveCheck(runId: string, check: AuditCheck): void {
    const id = stableId("FA-CHK", [runId, check.id]);
    const fields = { record: RECORD_CHECK, runId, checkId: check.id };
    this.upsertComment(id, check.id, toJson(check), fields);
  }

  readShard(runId: string, shardId: string): ShardRun | null {
    const row = this.one(
      `SELECT text FROM nodes
        WHERE kind = 'comment' AND status = 'active'
          AND json_extract(fields, '$.record') = ?
          AND json_extract(fields, '$.runId') = ?
          AND json_extract(fields, '$.shardId') = ?`,
      RECORD_SHARD,
      runId,
      shardId,
    );
    if (!row) return null;
    return fromJson<ShardRun>(textCell(row, "text"), shardId);
  }

  saveShard(runId: string, run: ShardRun): void {
    const id = stableId("FA-SHARD", [runId, run.shard.id]);
    const fields = { record: RECORD_SHARD, runId, shardId: run.shard.id };
    this.upsertComment(id, run.shard.id, toJson(run), fields);
  }

  listShardIds(runId: string): string[] {
    return this.all(
      `SELECT json_extract(fields, '$.shardId') AS shard_id
         FROM nodes
        WHERE kind = 'comment' AND status = 'active'
          AND json_extract(fields, '$.record') = ?
          AND json_extract(fields, '$.runId') = ?
        ORDER BY json_extract(fields, '$.shardId')`,
      RECORD_SHARD,
      runId,
    ).map((row) => textCell(row, "shard_id"));
  }

  saveSummary(runId: string, summary: LandingSummary): void {
    const id = stableId("FA-SUM", [runId]);
    const fields = { record: RECORD_SUMMARY, runId };
    this.upsertComment(id, runId, toJson(summary), fields);
  }

  readSummary(runId: string): LandingSummary | null {
    const row = this.one(
      `SELECT text FROM nodes
        WHERE kind = 'comment' AND status = 'active'
          AND json_extract(fields, '$.record') = ?
          AND json_extract(fields, '$.runId') = ?`,
      RECORD_SUMMARY,
      runId,
    );
    if (!row) return null;
    return fromJson<LandingSummary>(textCell(row, "text"), "summary");
  }

  private patchRun(runId: string, patch: { status?: string; fixRounds?: number }): void {
    const row = this.one("SELECT title, text, fields, version FROM nodes WHERE id = ?", runId);
    if (!row) return;
    const parsed: unknown = JSON.parse(textCell(row, "fields"));
    const fields = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...parsed } : {};
    if (patch.status !== undefined) Reflect.set(fields, "status", patch.status);
    if (patch.fixRounds !== undefined) Reflect.set(fields, "fixRounds", patch.fixRounds);
    this.rewriteComment(runId, textCell(row, "title"), textCell(row, "text"), fields, Number(row.version));
  }

  private upsertComment(id: string, title: string, text: string, fields: unknown): void {
    const existing = this.one("SELECT version FROM nodes WHERE id = ?", id);
    if (!existing) {
      this.insertComment(id, title, text, fields);
      return;
    }
    this.rewriteComment(id, title, text, fields, Number(existing.version));
  }

  private insertComment(id: string, title: string, text: string, fields: unknown): void {
    const rev = this.changeSet(`final audit ${id}`);
    const hash = computeNodeContentHash({ kind: "comment", title, text, fields });
    this.run(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
       VALUES (?, 'comment', 1, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      hash,
      title,
      text,
      JSON.stringify(fields),
      `CS-${rev}`,
      rev,
      rev,
    );
  }

  private rewriteComment(id: string, title: string, text: string, fields: unknown, version: number): void {
    const rev = this.changeSet(`final audit ${id}`);
    const next = version + 1;
    const hash = computeNodeContentHash({ kind: "comment", title, text, fields });
    this.run(
      `UPDATE nodes
          SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, change_set = ?, updated_rev = ?
        WHERE id = ?`,
      next,
      hash,
      title,
      text,
      JSON.stringify(fields),
      `CS-${rev}`,
      rev,
      id,
    );
  }

  private changeSet(summary: string): number {
    this.revCounter += 1;
    const rev = this.revCounter;
    this.run(
      `INSERT INTO change_sets(id, rev, origin, author, created_at, summary)
       VALUES (?, ?, 'kernel', 'final-audit', ?, ?)`,
      `CS-${rev}`,
      rev,
      rev,
      summary,
    );
    return rev;
  }

  private run(sql: string, ...params: SqlValue[]): void {
    this.writer.run(sql, params);
  }

  private one(sql: string, ...params: SqlValue[]): SqlRow | null {
    const row = this.writer.get(sql, params);
    return isRow(row) ? row : null;
  }

  private all(sql: string, ...params: SqlValue[]): SqlRow[] {
    return this.writer.all(sql, params).flatMap((row: unknown) => (isRow(row) ? [row] : []));
  }
}
