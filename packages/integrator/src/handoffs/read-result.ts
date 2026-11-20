import { READ_RESULT_MAX_BYTES, SUMMARY_PREVIEW_MAX_BYTES } from "./constants.js";
import { HandoffDatabase } from "./database.js";
import { RangeLimitError, SchemaValidationError } from "./errors.js";
import { canonicalJson, isJsonObject, truncateUtf8, type JsonValue } from "./json.js";
import type { CasBlobStorePort } from "./ports.js";
import type {
  GraphEdge,
  HandoffArtifact,
  ReadResult,
  ReadResultCaller,
  ReadResultManifest,
  ReadResultRange,
} from "./types.js";

const NOT_FOUND = { ok: false, code: "NOT_FOUND" } as const;

export class ReadResultToolHandler {
  constructor(
    private readonly db: HandoffDatabase,
    private readonly cas: CasBlobStorePort,
  ) {}

  read(caller: ReadResultCaller, args: Readonly<Record<string, unknown>>): ReadResult {
    const parsed = parseReadArgs(args);
    const artifact = this.db.getArtifact(parsed.handoffId);
    if (!artifact || artifact.artifactType === "sealed_oracle" || !authorized(this.db.listEdges(), caller, artifact)) {
      return { ok: NOT_FOUND.ok, code: NOT_FOUND.code };
    }
    const manifest = toManifest(artifact);
    if (parsed.range === undefined) {
      const full = canonicalJson(artifact.summary);
      const preview = truncateUtf8(full, SUMMARY_PREVIEW_MAX_BYTES);
      const summary: JsonValue = preview.truncated ? preview.text : artifact.summary;
      return {
        ok: true,
        mode: "summary",
        manifest,
        summary,
        summaryBytes: Buffer.byteLength(preview.text),
        truncated: preview.truncated,
      };
    }
    const range = parsed.range;
    assertRange(range);
    const bytes = this.cas.getBlob(artifact.blobSha256, "evidence");
    const start = Math.min(range.offset, bytes.byteLength);
    const end = Math.min(start + range.limit, bytes.byteLength);
    return {
      ok: true,
      mode: "range",
      manifest,
      offset: range.offset,
      limit: range.limit,
      returned: end - start,
      bytes: bytes.slice(start, end),
    };
  }
}

export function notFoundResult(): ReadResult {
  return { ok: false, code: "NOT_FOUND" };
}

function toManifest(artifact: HandoffArtifact): ReadResultManifest {
  return {
    handoffId: artifact.handoffId,
    artifactType: artifact.artifactType,
    pinnedBaseCommitSha: artifact.pinnedBaseCommitSha,
    pinnedSliceSha256: artifact.pinnedSliceSha256,
    schemaVersion: artifact.schemaVersion,
    blobSha256: artifact.blobSha256,
    blobBytes: artifact.blobBytes,
    supersededBy: artifact.supersededBy,
    supersedes: artifact.supersedes,
  };
}

function authorized(edges: readonly GraphEdge[], caller: ReadResultCaller, artifact: HandoffArtifact): boolean {
  if (caller.taskId === artifact.toTaskId || caller.role === artifact.toRole) return true;
  if (caller.taskId === artifact.fromTaskId || caller.role === artifact.fromRole) return true;
  const goals = new Set([artifact.fromTaskId, artifact.fromRole, artifact.handoffId, artifact.toTaskId, artifact.toRole]);
  return reaches(edges, [caller.taskId, caller.role], goals);
}

function reaches(edges: readonly GraphEdge[], starts: readonly string[], goals: ReadonlySet<string>): boolean {
  const adjacent = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "depends_on") continue;
    const list = adjacent.get(edge.fromNode) ?? [];
    list.push(edge.toNode);
    adjacent.set(edge.fromNode, list);
  }
  const seen = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined || seen.has(node)) continue;
    seen.add(node);
    if (goals.has(node)) return true;
    for (const next of adjacent.get(node) ?? []) queue.push(next);
  }
  return false;
}

interface ParsedRead {
  readonly handoffId: string;
  readonly range?: ReadResultRange;
}

function parseReadArgs(args: Readonly<Record<string, unknown>>): ParsedRead {
  const keys = Object.keys(args);
  for (const key of keys) {
    if (key !== "handoff_id" && key !== "range") {
      throw new SchemaValidationError(`unexpected harness.read_result field ${key}.`);
    }
  }
  const handoffId = args["handoff_id"];
  if (typeof handoffId !== "string" || handoffId.trim().length === 0) {
    throw new SchemaValidationError("handoff_id is required.");
  }
  if (!("range" in args) || args["range"] === undefined) return { handoffId };
  const range = args["range"];
  if (!isPlain(range)) throw new SchemaValidationError("range must be an object.");
  const rangeKeys = Object.keys(range);
  for (const key of rangeKeys) {
    if (key !== "offset" && key !== "limit") throw new SchemaValidationError(`unexpected range field ${key}.`);
  }
  const offset = range["offset"];
  const limit = range["limit"];
  if (typeof offset !== "number" || typeof limit !== "number") {
    throw new SchemaValidationError("range offset and limit must be numbers.");
  }
  return { handoffId, range: { offset, limit } };
}

function assertRange(range: ReadResultRange): void {
  if (!Number.isInteger(range.offset) || range.offset < 0) {
    throw new SchemaValidationError("range offset must be a non-negative integer.");
  }
  if (!Number.isInteger(range.limit) || range.limit < 1) {
    throw new SchemaValidationError("range limit must be a positive integer.");
  }
  if (range.limit > READ_RESULT_MAX_BYTES) throw new RangeLimitError(range.limit, READ_RESULT_MAX_BYTES);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return isJsonObject(value) || (typeof value === "object" && value !== null && !Array.isArray(value));
}
