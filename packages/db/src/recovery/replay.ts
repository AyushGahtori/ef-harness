import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { errorMessage, readLastRev, registerSearchText, writeMeta } from "./sqlite-io.js";
import type {
  ParkedAttempt,
  ReplayedChangeSet,
  ReverificationTask,
  UnrecoveredGap,
} from "./types.js";

const ORIGINS = new Set([
  "chat",
  "markdown_edit",
  "research",
  "planner",
  "sweep",
  "undo",
  "intake",
  "kernel",
  "import",
]);

const TRAILER_NAMES = ["Harness-Task", "Harness-Checks", "Harness-Feature", "Harness-Attempt"] as const;

export interface HarnessTrailers {
  readonly task: string | null;
  readonly checks: readonly string[];
  readonly feature: string | null;
  readonly attempt: string | null;
}

export interface GitCommitRecord {
  readonly sha: string;
  readonly committedAt: number;
  readonly message: string;
}

export interface CheckpointRefRecord {
  readonly ref: string;
  readonly sha: string;
  readonly committedAt: number;
}

export interface HistoryNodeRecord {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly contentHash: string;
  readonly title: string;
  readonly text: string;
  readonly fields: unknown;
  readonly status: string;
  readonly createdRev: number;
  readonly updatedRev: number;
}

export interface HistoryEdgeRecord {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
  readonly changeSetId: string;
  readonly validFromRev: number;
  readonly validToRev: number | null;
  readonly dstVersionPin: number | null;
}

export interface HistoryChangeSetRecord {
  readonly id: string;
  readonly rev: number;
  readonly origin: string;
  readonly originRef: string | null;
  readonly author: string;
  readonly createdAt: number;
  readonly summary: string | null;
  readonly nodes: readonly HistoryNodeRecord[];
  readonly edges: readonly HistoryEdgeRecord[];
  readonly source: string;
}

export interface ReplaySourceAdapter {
  loadKnowledgeChangeSets(input: {
    readonly projectId: string;
    readonly afterRev: number;
    readonly historyDir: string | null;
  }): readonly HistoryChangeSetRecord[];

  findAcceptedCommitsSince(input: {
    readonly projectId: string;
    readonly backupAt: number | null;
    readonly backupSha: string | null;
  }): readonly ReverificationTask[];

  parkInFlightAtCheckpoints(input: {
    readonly projectId: string;
  }): readonly ParkedAttempt[];
}

export interface GitRunnerResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type GitRunner = (args: readonly string[], cwd: string) => GitRunnerResult;

function defaultGitRunner(args: readonly string[], cwd: string): GitRunnerResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function splitChecks(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export function parseHarnessTrailers(message: string): HarnessTrailers {
  let task: string | null = null;
  const checks: string[] = [];
  let feature: string | null = null;
  let attempt: string | null = null;
  for (const line of message.split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line.trim());
    if (!match?.[1] || match[2] === undefined) continue;
    const key = match[1];
    const value = match[2].trim();
    if (!TRAILER_NAMES.includes(key as (typeof TRAILER_NAMES)[number])) continue;
    if (key === "Harness-Task" && value) task = value;
    if (key === "Harness-Feature" && value) feature = value;
    if (key === "Harness-Attempt" && value) attempt = value;
    if (key === "Harness-Checks" && value) checks.push(...splitChecks(value));
  }
  return { task, checks, feature, attempt };
}

export function findAcceptedCommitsSince(
  commits: readonly GitCommitRecord[],
  selector: { readonly backupSha?: string | null; readonly backupAt?: number | null },
): ReverificationTask[] {
  const ordered = [...commits].sort((left, right) => left.committedAt - right.committedAt);
  let start = 0;
  const backupAt = selector.backupAt ?? null;
  if (selector.backupSha) {
    const index = ordered.findIndex((commit) => commit.sha === selector.backupSha);
    if (index >= 0) start = index + 1;
    else if (backupAt !== null) {
      start = ordered.findIndex((commit) => commit.committedAt > backupAt);
      if (start < 0) start = ordered.length;
    }
  } else if (backupAt !== null) {
    start = ordered.findIndex((commit) => commit.committedAt > backupAt);
    if (start < 0) start = ordered.length;
  }
  const tasks: ReverificationTask[] = [];
  for (const commit of ordered.slice(start)) {
    const trailers = parseHarnessTrailers(commit.message);
    if (!trailers.task) continue;
    tasks.push({
      taskId: trailers.task,
      checks: trailers.checks,
      commitSha: commit.sha,
      attemptId: trailers.attempt,
      feature: trailers.feature,
    });
  }
  return tasks;
}

export function selectNewestCheckpointParks(
  refs: readonly CheckpointRefRecord[],
): ParkedAttempt[] {
  const newest = new Map<string, ParkedAttempt & { committedAt: number }>();
  for (const ref of refs) {
    if (!ref.ref.startsWith("refs/harness/checkpoints/")) continue;
    const parts = ref.ref.slice("refs/harness/checkpoints/".length).split("/").filter(Boolean);
    const taskId = parts[0] ?? "";
    const attemptId = parts[1] ?? parts[0] ?? "";
    if (!taskId || !attemptId) continue;
    const current = newest.get(taskId);
    if (current && current.committedAt >= ref.committedAt) continue;
    newest.set(taskId, {
      taskId,
      attemptId,
      checkpointRef: ref.ref,
      sha: ref.sha,
      committedAt: ref.committedAt,
    });
  }
  return [...newest.values()]
    .sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map((parked) => ({
      taskId: parked.taskId,
      attemptId: parked.attemptId,
      checkpointRef: parked.checkpointRef,
      sha: parked.sha,
    }));
}

function parseNode(value: unknown, rev: number): HistoryNodeRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const kind = asString(record.kind);
  const version = asNumber(record.version);
  const contentHash = asString(record.contentHash) ?? asString(record.content_hash);
  const title = asString(record.title);
  if (!id || !kind || version === null || !contentHash || title === null) return null;
  const fields = record.fields === undefined ? {} : record.fields;
  return {
    id,
    kind,
    version,
    contentHash,
    title,
    text: asString(record.text) ?? "",
    fields,
    status: asString(record.status) ?? "active",
    createdRev: asNumber(record.createdRev) ?? asNumber(record.created_rev) ?? rev,
    updatedRev: asNumber(record.updatedRev) ?? asNumber(record.updated_rev) ?? rev,
  };
}

function parseEdge(value: unknown, changeSetId: string, rev: number): HistoryEdgeRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const src = asString(record.src);
  const type = asString(record.type);
  const dst = asString(record.dst);
  if (!src || !type || !dst) return null;
  return {
    src,
    type,
    dst,
    changeSetId: asString(record.changeSetId) ?? asString(record.change_set) ?? changeSetId,
    validFromRev: asNumber(record.validFromRev) ?? asNumber(record.valid_from_rev) ?? rev,
    validToRev: asNumber(record.validToRev) ?? asNumber(record.valid_to_rev),
    dstVersionPin: asNumber(record.dstVersionPin) ?? asNumber(record.dst_version_pin),
  };
}

export function parseHistoryLine(line: string, source: string): HistoryChangeSetRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (!record) return null;
  const changeSet = asRecord(record.changeSet) ?? asRecord(record.change_set);
  const rev = asNumber(record.rev) ?? asNumber(changeSet?.rev);
  const id =
    asString(record.changeSetId) ??
    asString(record.id) ??
    asString(changeSet?.id) ??
    (rev === null ? null : `rev-${rev}`);
  if (rev === null || !id) return null;
  const originRaw = asString(record.origin) ?? asString(changeSet?.origin) ?? "import";
  const nodes = Array.isArray(record.nodes)
    ? record.nodes
        .map((node) => parseNode(node, rev))
        .filter((node): node is HistoryNodeRecord => node !== null)
    : [];
  const edges = Array.isArray(record.edges)
    ? record.edges
        .map((edge) => parseEdge(edge, id, rev))
        .filter((edge): edge is HistoryEdgeRecord => edge !== null)
    : [];
  return {
    id,
    rev,
    origin: ORIGINS.has(originRaw) ? originRaw : "import",
    originRef: asString(record.originRef) ?? asString(changeSet?.origin_ref),
    author: asString(record.author) ?? asString(changeSet?.author) ?? "replay",
    createdAt: asNumber(record.createdAt) ?? asNumber(changeSet?.created_at) ?? 0,
    summary: asString(record.summary) ?? asString(changeSet?.summary),
    nodes,
    edges,
    source,
  };
}

export function readHistoryChangeSets(
  historyDir: string,
  afterRev: number,
): HistoryChangeSetRecord[] {
  if (!fs.existsSync(historyDir)) return [];
  const files = fs
    .readdirSync(historyDir)
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const changes: HistoryChangeSetRecord[] = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(historyDir, file), "utf8");
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.trim()) continue;
      const parsed = parseHistoryLine(line, `${file}:${index + 1}`);
      if (parsed && parsed.rev > afterRev) changes.push(parsed);
    }
  }
  changes.sort((left, right) => left.rev - right.rev || left.id.localeCompare(right.id));
  return changes;
}

function parseGitLog(stdout: string): GitCommitRecord[] {
  const commits: GitCommitRecord[] = [];
  for (const block of stdout.split("\x1e")) {
    if (!block.trim()) continue;
    const [sha, seconds, message] = block.split("\x1f");
    if (!sha || !seconds || message === undefined) continue;
    const committedSeconds = Number(seconds);
    if (!Number.isFinite(committedSeconds)) continue;
    commits.push({
      sha: sha.trim(),
      committedAt: committedSeconds * 1000,
      message,
    });
  }
  return commits;
}

function parseCheckpointLines(stdout: string): CheckpointRefRecord[] {
  const refs: CheckpointRefRecord[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ref, sha, seconds] = line.split("\x1f");
    if (!ref || !sha || !seconds) continue;
    const committedSeconds = Number(seconds);
    if (!Number.isFinite(committedSeconds)) continue;
    refs.push({ ref, sha, committedAt: committedSeconds * 1000 });
  }
  return refs;
}

export interface FilesystemReplayOptions {
  readonly historyDir?: string | null;
  readonly repoDir?: string | null;
  readonly commits?: readonly GitCommitRecord[];
  readonly checkpoints?: readonly CheckpointRefRecord[];
  readonly git?: GitRunner;
}

export class FilesystemReplaySourceAdapter implements ReplaySourceAdapter {
  readonly warnings: string[] = [];
  private readonly historyDir: string | null;
  private readonly repoDir: string | null;
  private readonly commits: readonly GitCommitRecord[] | null;
  private readonly checkpoints: readonly CheckpointRefRecord[] | null;
  private readonly git: GitRunner;

  constructor(options: FilesystemReplayOptions = {}) {
    this.historyDir = options.historyDir ?? null;
    this.repoDir = options.repoDir ?? null;
    this.commits = options.commits ?? null;
    this.checkpoints = options.checkpoints ?? null;
    this.git = options.git ?? defaultGitRunner;
  }

  loadKnowledgeChangeSets(input: {
    readonly projectId: string;
    readonly afterRev: number;
    readonly historyDir: string | null;
  }): readonly HistoryChangeSetRecord[] {
    const dir = input.historyDir ?? this.historyDir;
    if (!dir) return [];
    return readHistoryChangeSets(dir, input.afterRev);
  }

  findAcceptedCommitsSince(input: {
    readonly projectId: string;
    readonly backupAt: number | null;
    readonly backupSha: string | null;
  }): readonly ReverificationTask[] {
    if (this.commits) {
      return findAcceptedCommitsSince(this.commits, {
        backupSha: input.backupSha,
        backupAt: input.backupAt,
      });
    }
    if (!this.repoDir) return [];
    const range = input.backupSha ? `${input.backupSha}..HEAD` : "HEAD";
    const result = this.git(
      ["log", "--reverse", `--format=%H%x1f%ct%x1f%B%x1e`, range],
      this.repoDir,
    );
    if (result.status !== 0) {
      this.warnings.push(`Git trailer lookup failed: ${result.stderr.trim() || "git log failed"}`);
      return [];
    }
    return findAcceptedCommitsSince(parseGitLog(result.stdout), {
      backupSha: null,
      backupAt: input.backupSha ? null : input.backupAt,
    });
  }

  parkInFlightAtCheckpoints(): readonly ParkedAttempt[] {
    if (this.checkpoints) return selectNewestCheckpointParks(this.checkpoints);
    if (!this.repoDir) return [];
    const result = this.git(
      [
        "for-each-ref",
        `--format=%(refname)%x1f%(objectname)%x1f%(creatordate:unix)`,
        "refs/harness/checkpoints",
      ],
      this.repoDir,
    );
    if (result.status !== 0) {
      this.warnings.push(
        `Checkpoint lookup failed: ${result.stderr.trim() || "git for-each-ref failed"}`,
      );
      return [];
    }
    return selectNewestCheckpointParks(parseCheckpointLines(result.stdout));
  }
}

function jsonText(value: unknown): string {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value;
    } catch {
      return JSON.stringify(value);
    }
  }
  return JSON.stringify(value ?? {});
}

function applyChangeSet(db: DatabaseSync, change: HistoryChangeSetRecord): ReplayedChangeSet {
  registerSearchText(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      change.id,
      change.rev,
      change.origin,
      change.originRef,
      change.author,
      change.createdAt,
      change.summary,
    );
    const insertNode = db.prepare(
      `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const updateNode = db.prepare(
      `UPDATE nodes
          SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?,
              change_set = ?, updated_rev = ?
        WHERE id = ?`,
    );
    const findNode = db.prepare("SELECT version FROM nodes WHERE id = ?");
    for (const node of change.nodes) {
      const existing = findNode.get(node.id);
      if (!existing) {
        insertNode.run(
          node.id,
          node.kind,
          node.version,
          node.contentHash,
          node.title,
          node.text,
          jsonText(node.fields),
          node.status,
          change.id,
          node.createdRev,
          node.updatedRev,
        );
      } else {
        updateNode.run(
          node.version,
          node.contentHash,
          node.title,
          node.text,
          jsonText(node.fields),
          node.status,
          change.id,
          node.updatedRev,
          node.id,
        );
      }
    }
    const insertEdge = db.prepare(
      `INSERT INTO edges(src, type, dst, dst_version_pin, change_set, valid_from_rev, valid_to_rev)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(src, type, dst, valid_from_rev) DO NOTHING`,
    );
    for (const edge of change.edges) {
      insertEdge.run(
        edge.src,
        edge.type,
        edge.dst,
        edge.dstVersionPin,
        edge.changeSetId,
        edge.validFromRev,
        edge.validToRev,
      );
    }
    const current = readLastRev(db) ?? 0;
    if (change.rev > current) writeMeta(db, "last_rev", String(change.rev));
    db.exec("COMMIT");
    return {
      changeSetId: change.id,
      rev: change.rev,
      applied: true,
      detail: change.source,
    };
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    return {
      changeSetId: change.id,
      rev: change.rev,
      applied: false,
      detail: errorMessage(error),
    };
  }
}

export interface ReplayResult {
  readonly changeSets: readonly ReplayedChangeSet[];
  readonly tasks: readonly ReverificationTask[];
  readonly parked: readonly ParkedAttempt[];
  readonly gaps: readonly UnrecoveredGap[];
}

export function replayPostBackupState(input: {
  readonly db: DatabaseSync;
  readonly projectId: string;
  readonly afterRev: number;
  readonly backupAt: number | null;
  readonly backupSha: string | null;
  readonly historyDir: string | null;
  readonly adapter: ReplaySourceAdapter;
}): ReplayResult {
  const loaded = input.adapter.loadKnowledgeChangeSets({
    projectId: input.projectId,
    afterRev: input.afterRev,
    historyDir: input.historyDir,
  });
  const changeSets = loaded
    .filter((change) => change.rev > input.afterRev)
    .map((change) => applyChangeSet(input.db, change));
  const tasks = input.adapter.findAcceptedCommitsSince({
    projectId: input.projectId,
    backupAt: input.backupAt,
    backupSha: input.backupSha,
  });
  const parked = input.adapter.parkInFlightAtCheckpoints({ projectId: input.projectId });
  const gaps: UnrecoveredGap[] = [];
  for (const change of changeSets) {
    if (change.applied) continue;
    gaps.push({
      kind: "knowledge",
      estimated: false,
      detail: `Change set ${change.changeSetId} at rev ${change.rev} was not applied: ${change.detail}`,
      window: null,
    });
  }
  if (input.adapter instanceof FilesystemReplaySourceAdapter) {
    for (const warning of input.adapter.warnings) {
      gaps.push({ kind: "git", estimated: false, detail: warning, window: null });
    }
  }
  return { changeSets, tasks, parked, gaps };
}
