import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bindKnowledgeGraph,
  openProjectStateDb,
  type KnowledgeGraphRepo,
  type ProjectStateDb,
} from "@ef-harness/db";
import { FinalAuditError } from "./errors.js";
import type { AuditCheck, LandingSummary, ShardRun } from "./types.js";

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

function parseNodeFields<T>(fieldsText: unknown, label: string): T {
  if (typeof fieldsText !== "string") {
    throw new FinalAuditError("corrupt_checkpoint", `${label} checkpoint is missing JSON fields`);
  }
  try {
    return decode(JSON.parse(fieldsText) as unknown) as T;
  } catch {
    throw new FinalAuditError("corrupt_checkpoint", `${label} checkpoint is not JSON`);
  }
}

interface StoredRunFields {
  readonly recordType: "final_audit_run";
  readonly runId: string;
  readonly projectId: string;
  readonly status: "open" | "complete";
  readonly fixRounds: number;
  readonly createdAt: number;
}

interface StoredPayloadFields<T> {
  readonly recordType: string;
  readonly runId: string;
  readonly payload: T;
  readonly shardId?: string;
  readonly checkId?: string;
}

/**
 * Crash-resumable completion-wave checkpoint persisted in canonical `@ef-harness/db`
 * `ProjectStateDb` (`nodes` + `change_sets` via `KnowledgeGraphRepo`), with zero private SQLite DDL.
 */
export class FinalAuditStore {
  private readonly kg: KnowledgeGraphRepo;

  private constructor(
    readonly stateDb: ProjectStateDb,
    private readonly ownsState: boolean,
    private readonly cleanupDir: string | null,
  ) {
    this.kg = bindKnowledgeGraph(stateDb);
  }

  /** Binds to an already-open caller `ProjectStateDb` (`close()` does not close caller's handle). */
  static fromState(stateDb: ProjectStateDb): FinalAuditStore {
    return new FinalAuditStore(stateDb, false, null);
  }

  /** Opens a dedicated `ProjectStateDb` under `rootDir` (or an isolated temp dir for `:memory:` / omitted). */
  static open(rootDirOrPath?: string, projectId?: string): FinalAuditStore {
    let cleanupDir: string | null = null;
    let rootDir: string;
    if (rootDirOrPath === undefined || rootDirOrPath === ":memory:") {
      cleanupDir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-final-audit-"));
      rootDir = cleanupDir;
    } else {
      rootDir = rootDirOrPath.endsWith(".db") ? path.dirname(rootDirOrPath) : rootDirOrPath;
      fs.mkdirSync(rootDir, { recursive: true });
    }
    const id = projectId ?? `final-audit-${randomUUID()}`;
    const stateDb = openProjectStateDb({ projectId: id, rootDir });
    return new FinalAuditStore(stateDb, true, cleanupDir);
  }

  close(): void {
    if (this.ownsState) {
      this.stateDb.close();
    }
    if (this.cleanupDir !== null) {
      fs.rmSync(this.cleanupDir, { recursive: true, force: true });
    }
  }

  beginRun(projectId: string): string {
    const existing = this.stateDb.writer.get(
      `SELECT id, fields FROM nodes
        WHERE kind = 'plan'
          AND status = 'active'
          AND json_extract(fields, '$.recordType') = 'final_audit_run'
          AND json_extract(fields, '$.projectId') = ?
          AND json_extract(fields, '$.status') = 'open'
        ORDER BY json_extract(fields, '$.createdAt') DESC
        LIMIT 1`,
      [projectId],
    ) as Readonly<Record<string, unknown>> | undefined;
    if (existing) {
      const parsed = parseNodeFields<StoredRunFields>(existing.fields, String(existing.id));
      return parsed.runId;
    }
    const runId = randomUUID();
    const fields: StoredRunFields = {
      recordType: "final_audit_run",
      runId,
      projectId,
      status: "open",
      fixRounds: 0,
      createdAt: Date.now(),
    };
    this.upsertNode(`final-audit:run:${runId}`, `Final Audit Run ${runId}`, fields);
    return runId;
  }

  completeRun(runId: string, fixRounds: number): void {
    const current = this.readRunNode(runId);
    if (!current) return;
    this.upsertNode(`final-audit:run:${runId}`, `Final Audit Run ${runId}`, {
      ...current,
      status: "complete",
      fixRounds,
    });
  }

  readFixRounds(runId: string): number {
    return this.readRunNode(runId)?.fixRounds ?? 0;
  }

  saveFixRounds(runId: string, fixRounds: number): void {
    const current = this.readRunNode(runId);
    if (!current) return;
    this.upsertNode(`final-audit:run:${runId}`, `Final Audit Run ${runId}`, {
      ...current,
      fixRounds,
    });
  }

  readCheck(runId: string, checkId: string): AuditCheck | null {
    const fields = this.readJsonNode<StoredPayloadFields<AuditCheck>>(
      `final-audit:check:${runId}:${checkId}`,
      checkId,
    );
    return fields?.payload ?? null;
  }

  saveCheck(runId: string, check: AuditCheck): void {
    this.upsertNode(`final-audit:check:${runId}:${check.id}`, `Final Audit Check ${check.id}`, {
      recordType: "final_audit_check",
      runId,
      checkId: check.id,
      payload: encode(check),
    });
  }

  readShard(runId: string, shardId: string): ShardRun | null {
    const fields = this.readJsonNode<StoredPayloadFields<ShardRun>>(
      `final-audit:shard:${runId}:${shardId}`,
      shardId,
    );
    return fields?.payload ?? null;
  }

  saveShard(runId: string, run: ShardRun): void {
    this.upsertNode(`final-audit:shard:${runId}:${run.shard.id}`, `Final Audit Shard ${run.shard.id}`, {
      recordType: "final_audit_shard",
      runId,
      shardId: run.shard.id,
      payload: encode(run),
    });
  }

  listShardIds(runId: string): string[] {
    const rows = this.stateDb.writer.all(
      `SELECT json_extract(fields, '$.shardId') AS shard_id
         FROM nodes
        WHERE kind = 'plan'
          AND status = 'active'
          AND json_extract(fields, '$.recordType') = 'final_audit_shard'
          AND json_extract(fields, '$.runId') = ?
        ORDER BY shard_id`,
      [runId],
    ) as Readonly<Record<string, unknown>>[];
    return rows
      .map((row) => row.shard_id)
      .filter((value): value is string => typeof value === "string");
  }

  saveSummary(runId: string, summary: LandingSummary): void {
    this.upsertNode(`final-audit:summary:${runId}`, `Final Audit Summary ${runId}`, {
      recordType: "final_audit_summary",
      runId,
      payload: encode(summary),
    });
  }

  readSummary(runId: string): LandingSummary | null {
    const fields = this.readJsonNode<StoredPayloadFields<LandingSummary>>(
      `final-audit:summary:${runId}`,
      "summary",
    );
    return fields?.payload ?? null;
  }

  private readRunNode(runId: string): StoredRunFields | null {
    return this.readJsonNode<StoredRunFields>(`final-audit:run:${runId}`, runId);
  }

  private readJsonNode<T>(id: string, label: string): T | null {
    const row = this.stateDb.writer.get(
      `SELECT fields FROM nodes WHERE id = ? AND status = 'active'`,
      [id],
    ) as Readonly<Record<string, unknown>> | undefined;
    if (!row) return null;
    return parseNodeFields<T>(row.fields, label);
  }

  private upsertNode(id: string, title: string, fields: unknown): void {
    const encoded = encode(fields);
    const existing = this.kg.getNode(id);
    if (existing) {
      this.kg.commitChangeSet({
        origin: "kernel",
        author: "final-audit",
        summary: title,
        reads: [{ target: id, version: existing.version }],
        nodes: [
          {
            op: "update",
            id,
            class: "compatible",
            title,
            fields: encoded,
          },
        ],
      });
      return;
    }
    this.kg.commitChangeSet({
      origin: "kernel",
      author: "final-audit",
      summary: title,
      nodes: [
        {
          op: "create",
          id,
          kind: "plan",
          title,
          status: "active",
          fields: encoded,
        },
      ],
    });
  }
}
