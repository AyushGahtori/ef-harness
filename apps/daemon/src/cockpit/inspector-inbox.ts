import fs from "node:fs";
import path from "node:path";
import { SeekableLogReader, type GlobalBrokerDb, type ProjectStateDb } from "@ef-harness/db";
import { humanSteps, WindowsDpapiSecretsVault } from "@ef-harness/governor";
import { KnowledgePacketSlicer, type SliceGraph, type SliceNode } from "@ef-harness/planner";
import { questionArbiter } from "@ef-harness/steering";

import type { SqlDb } from "../bootstrap/databases.js";

const MAX_CHUNK = 64 * 1024;

export class InspectorInboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectorInboxError";
  }
}

export interface InspectorInboxContext {
  readonly state: SqlDb;
  readonly project: ProjectStateDb;
  readonly broker: GlobalBrokerDb;
  readonly profileDir: string;
  readonly diffFile: string;
  readonly diffHunks: readonly {
    readonly index: number;
    readonly header: string;
    readonly lines: readonly { readonly kind: string; readonly text: string }[];
  }[];
}

export function fetchDiffRange(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const attemptId = text(params, "attemptId");
  const filePath = text(params, "filePath");
  const hunkOffset = integer(params, "hunkOffset");
  const limit = integer(params, "limit");
  if (filePath !== ctx.diffFile) throw new InspectorInboxError("diff file not found");
  const selected = ctx.diffHunks.filter((hunk) => hunk.index >= hunkOffset).slice(0, Math.max(0, limit));
  const hunks = selected.map((hunk) => ({
    index: hunk.index,
    header: hunk.header,
    oldStart: 1,
    newStart: 1,
    lines: hunk.lines.map((line) => line.text),
  }));
  const bytes = Buffer.from(JSON.stringify(hunks), "utf8");
  return {
    attemptId,
    filePath,
    hunkOffset,
    limit,
    bytesRead: Math.min(bytes.byteLength, MAX_CHUNK),
    hunks,
    channel: bytes.byteLength > MAX_CHUNK ? 1 : 0,
  };
}

export function fetchLogChunk(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const artifactId = text(params, "artifactId");
  const byteOffset = integer(params, "byteOffset");
  const limit = Math.min(integer(params, "limit"), MAX_CHUNK);
  const stored = readArtifact(ctx, artifactId);
  const slice = stored.subarray(byteOffset, byteOffset + limit);
  return {
    artifactId,
    byteOffset,
    bytes: Buffer.from(slice).toString("base64"),
    totalBytes: stored.byteLength,
    archived: true,
    channel: 1,
  };
}

export function fetchScreenshot(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const artifactId = text(params, "artifactId");
  const byteOffset = integer(params, "byteOffset");
  const limit = Math.min(integer(params, "limit"), MAX_CHUNK);
  const stored = readArtifact(ctx, artifactId);
  const slice = stored.subarray(byteOffset, byteOffset + limit);
  return {
    artifactId,
    bytes: Buffer.from(slice).toString("base64"),
    totalBytes: stored.byteLength,
    channel: 1,
  };
}

export function locateLineWindow(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const artifactId = text(params, "artifactId");
  const startLine = integer(params, "startLine");
  const maxLines = integer(params, "maxLines");
  const maxBytes = Math.min(integer(params, "maxBytes"), MAX_CHUNK);
  const stored = readArtifact(ctx, artifactId);
  const reader = new SeekableLogReader();
  const endLine = startLine + Math.max(0, maxLines) - 1;
  const read = reader.readRange({
    stored,
    format: "raw",
    index: null,
    startLine,
    endLine,
  });
  let bytes = 0;
  const kept: string[] = [];
  for (const line of read.lines) {
    const next = Buffer.byteLength(`${line}\n`, "utf8");
    if (kept.length > 0 && bytes + next > maxBytes) break;
    if (next > maxBytes && kept.length === 0) {
      kept.push(line.slice(0, maxBytes));
      bytes = maxBytes;
      break;
    }
    kept.push(line);
    bytes += next;
  }
  const prefix =
    startLine <= 1
      ? null
      : reader.readRange({
          stored,
          format: "raw",
          index: null,
          startLine: 1,
          endLine: startLine - 1,
        });
  const byteOffset = prefix ? Buffer.byteLength(`${prefix.lines.join("\n")}\n`, "utf8") : 0;
  return {
    artifactId,
    byteOffset,
    byteLength: bytes,
    startLine,
    endLine: startLine + Math.max(0, kept.length - 1),
    totalLines: read.totalLines,
    totalBytes: stored.byteLength,
    archived: true,
    framesDecompressed: read.framesDecompressed,
    lines: kept,
  };
}

export function sliceForTask(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const taskId = text(params, "taskId");
  const graph = graphForTask(ctx.state, taskId);
  const compiled = new KnowledgePacketSlicer().compile(graph, {
    project: { projectId: "m1", stackOverview: taskId, universalRules: [] },
  });
  return {
    taskId,
    text: compiled.text,
    sliceSha256: compiled.manifest.sliceSha256,
    level: compiled.level,
  };
}

export function readResult(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const handoffId = text(params, "handoffId");
  const taskId = typeof params.taskId === "string" ? params.taskId : "";
  const role = typeof params.role === "string" ? params.role : "";
  const row = ctx.state
    .prepare(
      `SELECT handoff_id, from_role, to_role, from_task_id, to_task_id, artifact_type,
              pinned_base_commit_sha, pinned_slice_sha256, schema_version, summary_json,
              blob_sha256, blob_bytes, superseded_by
         FROM handoff_artifacts WHERE handoff_id = ?`,
    )
    .get(handoffId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, code: "NOT_FOUND" };
  const fromTask = String(row.from_task_id ?? "");
  const toTask = String(row.to_task_id ?? "");
  const fromRole = String(row.from_role ?? "");
  const toRole = String(row.to_role ?? "");
  const allowed = taskId === fromTask || taskId === toTask || role === fromRole || role === toRole;
  if (!allowed) return { ok: false, code: "NOT_FOUND" };
  return {
    ok: true,
    mode: "summary",
    manifest: {
      handoffId: String(row.handoff_id),
      artifactType: String(row.artifact_type),
      pinnedBaseCommitSha: String(row.pinned_base_commit_sha),
      pinnedSliceSha256: String(row.pinned_slice_sha256),
      schemaVersion: Number(row.schema_version),
      blobSha256: String(row.blob_sha256),
      blobBytes: Number(row.blob_bytes),
      supersededBy: row.superseded_by === null || row.superseded_by === undefined ? null : String(row.superseded_by),
    },
    summary: String(row.summary_json ?? ""),
  };
}

export function reconcileQuestion(ctx: InspectorInboxContext, params: Record<string, unknown>): unknown {
  const questionId = text(params, "questionId");
  const optionsVersion = integer(params, "optionsVersion");
  const optionId = typeof params.optionId === "string" ? params.optionId : undefined;
  const replyText = typeof params.text === "string" ? params.text : undefined;
  const telemetryPath = path.join(ctx.profileDir, "reconcile-telemetry.db");
  const runtime = questionArbiter.openQuestionArbiter({
    stateDbPath: ctx.project.databasePath,
    telemetryDbPath: telemetryPath,
  });
  try {
    return runtime.reconciler.receive(questionId, {
      optionsVersion,
      ...(optionId === undefined ? {} : { optionId }),
      ...(replyText === undefined ? {} : { text: replyText }),
    });
  } finally {
    runtime.close();
  }
}

export async function storeSecret(ctx: InspectorInboxContext, params: Record<string, unknown>): Promise<unknown> {
  const projectId = text(params, "projectId");
  const envScope = text(params, "envScope");
  const name = text(params, "name");
  const value = text(params, "value");
  if (envScope !== "test" && envScope !== "dev" && envScope !== "staging" && envScope !== "prod") {
    throw new InspectorInboxError("envScope must be test, dev, staging, or prod");
  }
  const vault = new WindowsDpapiSecretsVault({
    global: ctx.broker,
    state: ctx.project,
    vaultDir: path.join(ctx.profileDir, "vault"),
  });
  const metadata = await vault.storeSecret({ projectId, envScope, name, value });
  return { ok: true, secretId: metadata.secretId };
}

export async function runProbe(ctx: InspectorInboxContext, params: Record<string, unknown>): Promise<unknown> {
  const stepId = text(params, "stepId");
  const steps = new humanSteps.HumanStepRuntime({ database: ctx.project });
  const result = await steps.registry.checkAgain(stepId);
  return {
    outcome: result.outcome,
    diagnosis: result.diagnosis,
    code: result.code,
    badge: result.outcome === "pass" ? "Verified" : "Attested",
  };
}

function graphForTask(state: SqlDb, taskId: string): SliceGraph {
  const row = state
    .prepare(
      "SELECT id, kind, version, content_hash, title, text, status, fields FROM nodes WHERE id = ?",
    )
    .get(taskId) as Record<string, unknown> | undefined;
  if (!row) throw new InspectorInboxError(`missing task node ${taskId}`);
  const node: SliceNode = {
    id: String(row.id),
    kind: String(row.kind),
    version: Number(row.version),
    contentHash: String(row.content_hash),
    title: String(row.title),
    text: String(row.text ?? ""),
    status: String(row.status ?? "active"),
    fields: parseFields(row.fields),
  };
  return {
    taskId,
    nodes: [node],
    edges: [],
    writeScope: [],
    readScope: [],
    moduleCards: [],
    level: "mid",
    featureId: null,
    baseBranch: "harness/integration",
    baseCommit: "pinned",
    epoch: 1,
  };
}

function parseFields(value: unknown): Record<string, string> {
  if (typeof value !== "string" || value.length === 0) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const fields: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === "string") fields[key] = item;
  }
  return fields;
}

function readArtifact(ctx: InspectorInboxContext, artifactId: string): Buffer {
  if (!/^[A-Za-z0-9._:-]+$/.test(artifactId)) throw new InspectorInboxError("invalid artifact id");
  const file = path.join(ctx.profileDir, "artifacts", artifactId);
  if (!fs.existsSync(file)) throw new InspectorInboxError(`artifact ${artifactId} is not loaded`);
  return fs.readFileSync(file);
}

function text(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new InspectorInboxError(`${key} is required`);
  }
  return value;
}

function integer(params: Record<string, unknown>, key: string): number {
  const value = params[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InspectorInboxError(`${key} must be a non-negative integer`);
  }
  return value;
}
