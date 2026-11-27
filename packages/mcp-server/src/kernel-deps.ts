import os from "node:os";
import path from "node:path";
import { HarnessRunEngine } from "@ef-harness/sandbox";
import { AttemptIsolationHost, type AttemptIsolation } from "@ef-harness/test-env";
import type { ArtifactManager as DbArtifactManager, CasBlobStore, KnowledgeGraphRepo, KnowledgeSearchService as DbKnowledgeSearch, ProjectStateDb } from "@ef-harness/db";
import type { ArtifactKind, ArtifactRetention, CasRetention, NodeRecord } from "@ef-harness/db";
import type { ArtifactManager as CommandArtifactPort, OsCommandSupervisor, SandboxTierSelector } from "@ef-harness/sandbox";
import { SqliteReadSetStore, type ReadSetSql } from "./read-sets.js";
import { readGitChangedPaths, snapshotWorktreeDiff } from "./scope.js";
import type {
  ArtifactLogPage,
  ArtifactManager,
  ArtifactRecord,
  AskOwner,
  AttemptMcpDependencies,
  BlockedReporter,
  CodeLookup,
  DependencyIntentAppender,
  DisputeTest,
  EpochAuthority,
  HarnessRunEngine as McpHarnessRun,
  KnowledgeNode,
  KnowledgeSearchService,
  ProgressTelemetry,
  PullPatternLog,
  SecureDocFetcher,
  SecurityAnomalyLog,
  SnippetBuilder,
  StartService,
  TaskHoldAndSubmissionRepo,
} from "./types.js";

export interface KernelAttemptPorts {
  readonly state: ProjectStateDb;
  readonly graph: KnowledgeGraphRepo;
  readonly search: DbKnowledgeSearch;
  readonly artifacts: DbArtifactManager;
  readonly cas: CasBlobStore;
  readonly projectId: string;
  readonly worktreePath: string;
  readonly epoch: EpochAuthority;
  readonly submissions: TaskHoldAndSubmissionRepo;
  readonly docs: SecureDocFetcher;
  readonly startService: StartService;
  readonly askOwner: AskOwner;
  readonly disputeTest: DisputeTest;
  readonly codeLookup: CodeLookup;
  readonly telemetry: ProgressTelemetry;
  readonly dependencyIntents: DependencyIntentAppender;
  readonly blocked: BlockedReporter;
  readonly pullPatterns: PullPatternLog;
  readonly security: SecurityAnomalyLog;
  readonly isolation?: SandboxTierSelector;
  readonly osJobs?: OsCommandSupervisor;
  readonly snippet?: SnippetBuilder;
  readonly kbPull?: AttemptMcpDependencies["kbPull"];
}

export function ruleMatchesTags(fields: unknown, tags: readonly string[]): boolean {
  const record = asRecord(fields);
  if (record.global === true) return true;
  const set = new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0));
  const anyTags = stringList(record.any);
  const allTags = stringList(record.all);
  if (anyTags !== null && !anyTags.some((tag) => set.has(tag))) return false;
  if (allTags !== null && !allTags.every((tag) => set.has(tag))) return false;
  return true;
}

export function bindKnowledgeService(graph: KnowledgeGraphRepo, search: DbKnowledgeSearch): KnowledgeSearchService {
  return {
    async currentRevision() {
      return graph.currentRevision();
    },
    async search(input) {
      const kind = typeof input.filters?.kind === "string" ? input.filters.kind : null;
      const page = search.searchNodes(
        kind ? { query: input.query, kinds: [kind], limit: 10 } : { query: input.query, limit: 10 },
      );
      const nodes: KnowledgeNode[] = [];
      for (const hit of page.items) {
        const node = graph.getNode(hit.id);
        if (node) nodes.push(toKnowledgeNode(node));
      }
      return nodes;
    },
    async get(input) {
      if (input.latest || input.version === undefined) {
        const current = graph.getNode(input.id);
        return current ? toKnowledgeNode(current) : null;
      }
      return historicalNode(graph, input.id, input.version);
    },
    async neighbors(input) {
      const source = graph.getNode(input.id);
      if (!source) return null;
      const allowed = input.edgeTypes === undefined ? null : new Set(input.edgeTypes);
      const sets: {
        node: string;
        dir: "in" | "out";
        type: string;
        version: number;
        neighbors: KnowledgeNode[];
      }[] = [];
      for (const dir of ["out", "in"] as const) {
        const grouped = groupEdges(currentEdges(graph, input.id, dir));
        for (const [type, ids] of grouped) {
          if (allowed && !allowed.has(type)) continue;
          const neighbors: KnowledgeNode[] = [];
          for (const id of ids) {
            const node = graph.getNode(id);
            if (node) neighbors.push(toKnowledgeNode(node));
          }
          sets.push({
            node: input.id,
            dir,
            type,
            version: edgeVersion(graph, input.id, dir, type),
            neighbors,
          });
        }
      }
      return { source: toKnowledgeNode(source), sets };
    },
    async contract(input) {
      let resolved: KnowledgeNode | null;
      if (input.latest || input.version === undefined) {
        const current = graph.getNode(input.id);
        resolved = current ? toKnowledgeNode(current) : null;
      } else {
        resolved = historicalNode(graph, input.id, input.version);
      }
      if (!resolved || resolved.kind !== "contract") return null;
      return resolved;
    },
    async why(input) {
      const start = graph.getNode(input.id);
      if (!start) return null;
      const nodes = [toKnowledgeNode(start)];
      const seen = new Set<string>([start.id]);
      for (const item of graph.impactWalk(input.id).nodes) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const node = graph.getNode(item.id);
        if (node) nodes.push(toKnowledgeNode(node));
      }
      return { nodes };
    },
    async listRulesForTags(input) {
      const rules: { id: string; title: string }[] = [];
      let cursor: string | null = null;
      for (let pageNo = 0; pageNo < 20; pageNo += 1) {
        const page = search.listNodesPaginated(
          cursor
            ? { kinds: ["rule"], status: "active", limit: 500, cursor }
            : { kinds: ["rule"], status: "active", limit: 500 },
        );
        for (const item of page.items) {
          const node = graph.getNode(item.id);
          if (!node || node.status !== "active") continue;
          if (!ruleMatchesTags(node.fields, input.tags)) continue;
          rules.push({ id: node.id, title: node.title });
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return rules;
    },
  };
}

export function bindCommandArtifactPort(input: {
  readonly artifacts: DbArtifactManager;
  readonly cas: CasBlobStore;
  readonly state: ProjectStateDb;
}): CommandArtifactPort {
  const remembered = new Map<string, { hash: string; retention: CasRetention }>();
  return {
    async storeArtifact(request) {
      const retention = commandRetention(request.retention);
      const stored = input.artifacts.storeArtifact({
        content: request.body,
        kind: commandKind(request.kind),
        retention,
        owners: [{ ownerKind: "attempt", ownerId: request.attemptId }],
      });
      remembered.set(stored.artifactId, { hash: stored.hash, retention });
      return {
        artifactId: stored.artifactId,
        byteLength: stored.bytes,
        retention,
        seekable: stored.format === "zstd-seekable",
        lineCount: countLines(request.body),
        format: stored.format === "zstd-seekable" ? "zstd-seekable" : "plain",
      };
    },
    async readLogRange(artifactId, startLine, endLine) {
      const page = input.artifacts.readLogRange(artifactId, startLine, endLine);
      return { lines: page.lines, totalLines: page.totalLines, truncated: page.truncated };
    },
    async readRaw(artifactId) {
      const known = remembered.get(artifactId) ?? lookupBlob(input.state, artifactId);
      if (!known) throw new Error(`artifact not found: ${artifactId}`);
      return input.cas.getBlob(known.hash, known.retention);
    },
    async promoteRetention(artifactId) {
      input.state.writer.run("UPDATE artifacts SET retention = 'evidence' WHERE id = ?", [artifactId]);
      const known = remembered.get(artifactId);
      if (known) remembered.set(artifactId, { hash: known.hash, retention: "evidence" });
    },
  };
}

export function bindReadResultArtifacts(input: {
  readonly artifacts: DbArtifactManager;
  readonly cas: CasBlobStore;
  readonly state: ProjectStateDb;
  readonly projectId: string;
}): ArtifactManager {
  return {
    async readResult(lookup) {
      try {
        const located = lookupBlob(input.state, lookup.artifactId);
        if (!located) return null;
        const bytes = await input.cas.getBlob(located.hash, located.retention);
        const content = Buffer.from(bytes).toString("utf8");
        const slices = slicesOf(content);
        const record: ArtifactRecord = {
          id: lookup.artifactId,
          projectId: input.projectId,
          status: located.retention === "evidence" ? "accepted" : "draft",
          kind: located.kind,
          visibility: "visible",
          declared: true,
          content,
          source: lookup.artifactId,
          ...(slices ? { slices } : {}),
        };
        return record;
      } catch {
        return null;
      }
    },
    async readLog(lookup) {
      try {
        if (lookup.query) {
          const found = input.artifacts.queryLogStream(lookup.artifactId, lookup.query, 40);
          return logPage(lookup.artifactId, found.matches.map((match) => match.text).join("\n"));
        }
        const start = lookup.range?.start && lookup.range.start > 0 ? lookup.range.start : 1;
        const end = lookup.range?.end && lookup.range.end >= start ? lookup.range.end : start + 199;
        const page = input.artifacts.readLogRange(lookup.artifactId, start, end);
        return logPage(lookup.artifactId, page.lines.join("\n"));
      } catch {
        return null;
      }
    },
  };
}

export function createKernelAttemptMcpDeps(input: KernelAttemptPorts): AttemptMcpDependencies {
  const commandArtifacts = bindCommandArtifactPort(input);
  const engine = new HarnessRunEngine({
    artifacts: commandArtifacts,
    telemetry: {
      writeProgress() {
        return;
      },
      close() {
        return;
      },
    },
    ...(input.isolation ? { isolation: input.isolation } : {}),
    ...(input.osJobs ? { osJobs: input.osJobs } : {}),
  });
  const isolation = new AttemptIsolationHost({
    projectId: input.projectId,
    rootDir: path.join(os.tmpdir(), "ef-harness-attempt-isolation", input.projectId),
  });
  const deps: AttemptMcpDependencies = {
    epoch: input.epoch,
    knowledge: bindKnowledgeService(input.graph, input.search),
    submissions: input.submissions,
    docs: input.docs,
    runner: adaptRunner(engine, input.worktreePath, isolation),
    artifacts: bindReadResultArtifacts(input),
    startService: adaptStartService(input.startService, isolation),
    askOwner: input.askOwner,
    disputeTest: input.disputeTest,
    codeLookup: input.codeLookup,
    telemetry: input.telemetry,
    dependencyIntents: input.dependencyIntents,
    blocked: input.blocked,
    snapshot: {
      snapshot: (snapshotInput) => snapshotWorktreeDiff(snapshotInput),
    },
    readSets: new SqliteReadSetStore(projectReadSetSql(input.state)),
    pullPatterns: input.pullPatterns,
    security: input.security,
    changedPaths: (worktreePath, baseCommit) => readGitChangedPaths(worktreePath, baseCommit),
    ...(input.snippet ? { snippet: input.snippet } : {}),
    ...(input.kbPull ? { kbPull: input.kbPull } : {}),
  };
  return deps;
}

function adaptRunner(
  engine: HarnessRunEngine,
  worktreePath: string,
  isolation: AttemptIsolationHost,
): McpHarnessRun {
  return {
    async run(commandInput) {
      const attempt = await isolation.ensure(commandInput.attemptId);
      const result = await engine.executeSandboxedCommand({
        attemptId: commandInput.attemptId,
        projectId: commandInput.projectId,
        taskId: commandInput.taskId,
        worktreePath,
        command: commandInput.command,
        ...(commandInput.cwd ? { cwd: commandInput.cwd } : {}),
      });
      return {
        command: commandInput.command,
        cwd: commandInput.cwd ?? worktreePath,
        exitCode: result.exitCode,
        summary: result.summary,
        artifactId: result.artifactId,
        env: attempt.vars,
      };
    },
  };
}

function adaptStartService(inner: StartService, isolation: AttemptIsolationHost): StartService {
  return {
    async startService(request) {
      if (request.name === "oauth" || request.name === "stripe" || request.name === "sqlite") {
        const attempt = await isolation.ensure(request.attemptId);
        return { url: isolatedServiceUrl(request.name, attempt) };
      }
      return inner.startService(request);
    },
  };
}

function isolatedServiceUrl(name: "oauth" | "stripe" | "sqlite", attempt: AttemptIsolation): string {
  if (name === "oauth") return attempt.oauthIssuer;
  if (name === "stripe") return attempt.stripeApiBase;
  return attempt.databaseUrl;
}

function projectReadSetSql(state: ProjectStateDb): ReadSetSql {
  return {
    run(sql, params) {
      state.writer.run(sql, params);
    },
    get(sql, params) {
      return state.writer.get(sql, params);
    },
  };
}

function logPage(artifactId: string, text: string): ArtifactLogPage {
  return {
    artifactId,
    text,
    visibility: "visible",
    kind: "log",
    source: artifactId,
  };
}

function lookupBlob(
  state: ProjectStateDb,
  artifactId: string,
): { hash: string; retention: CasRetention; kind: string } | null {
  const row = state.writer.get("SELECT hash, retention, kind FROM artifacts WHERE id = ?", [artifactId]);
  const hash = rowField(row, "hash");
  if (!hash) return null;
  return {
    hash,
    retention: asCasRetention(rowField(row, "retention")),
    kind: rowField(row, "kind") ?? "log",
  };
}

function commandRetention(retention: "ephemeral" | "evidence" | "diagnostic" | "asset" | "research"): ArtifactRetention {
  if (retention === "research") return "diagnostic";
  return retention;
}

function commandKind(kind: string): ArtifactKind {
  switch (kind) {
    case "log":
    case "trace":
    case "screenshot":
    case "diff":
    case "page":
    case "audio":
    case "source":
    case "asset":
    case "items":
      return kind;
    default:
      return "log";
  }
}

function countLines(body: Buffer): number {
  if (body.length === 0) return 0;
  let lines = 0;
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === 0x0a) lines += 1;
  }
  if (body[body.length - 1] !== 0x0a) lines += 1;
  return lines;
}

function toKnowledgeNode(record: NodeRecord): KnowledgeNode {
  const fields = asRecord(record.fields);
  return {
    id: record.id,
    kind: record.kind,
    version: record.version,
    contentHash: record.contentHash,
    title: record.title,
    text: record.text,
    fields,
    status: record.status,
    visibility: concealed(fields) ? "held_back" : "visible",
  };
}

function historicalNode(graph: KnowledgeGraphRepo, id: string, version: number): KnowledgeNode | null {
  if (version < 1) return null;
  const row = graph.connection
    .prepare(
      `SELECT kind, version, content_hash, title, text, fields, status
         FROM node_versions WHERE id = :id AND version = :version`,
    )
    .get({ id, version });
  if (!row) return null;
  const fields = asRecord(row.fields);
  return {
    id,
    kind: cellString(row.kind),
    version,
    contentHash: cellString(row.content_hash),
    title: cellString(row.title),
    text: cellString(row.text),
    fields,
    status: asStatus(cellString(row.status)),
    visibility: concealed(fields) ? "held_back" : "visible",
  };
}

function currentEdges(
  graph: KnowledgeGraphRepo,
  id: string,
  dir: "in" | "out",
): { type: string; other: string }[] {
  const sql =
    dir === "out"
      ? `SELECT type, dst AS other FROM edges WHERE src = :id AND valid_to_rev IS NULL ORDER BY type, dst`
      : `SELECT type, src AS other FROM edges WHERE dst = :id AND valid_to_rev IS NULL ORDER BY type, src`;
  return graph.connection
    .prepare(sql)
    .all({ id })
    .flatMap((row) => {
      const type = cellString(row.type);
      const other = cellString(row.other);
      if (!type || !other) return [];
      return [{ type, other }];
    });
}

function groupEdges(hits: readonly { type: string; other: string }[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const hit of hits) {
    const list = grouped.get(hit.type) ?? [];
    list.push(hit.other);
    grouped.set(hit.type, list);
  }
  return grouped;
}

function edgeVersion(graph: KnowledgeGraphRepo, nodeId: string, dir: "in" | "out", type: string): number {
  const row = graph.connection
    .prepare("SELECT version FROM edge_set_versions WHERE node = :node AND dir = :dir AND type = :type")
    .get({ node: nodeId, dir, type });
  if (!row) return 0;
  const version = row.version;
  return typeof version === "number" ? version : Number(version);
}

function asStatus(value: string): KnowledgeNode["status"] {
  if (value === "draft" || value === "retired" || value === "superseded") return value;
  return "active";
}

function concealed(fields: Record<string, unknown>): boolean {
  if (
    fields.visibility === "held_back" ||
    fields.visibility === "hidden" ||
    fields.visibility === "sealed" ||
    fields.visibility === "oracle_only" ||
    fields.visibility === "sealed_oracle"
  ) {
    return true;
  }
  return fields.held_back === true || fields.sealed === true || fields.sealed_oracle === true || fields.hidden_check === true;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch (error) {
      if (error instanceof SyntaxError) return {};
      throw error;
    }
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) record[key] = Reflect.get(value, key);
  return record;
}

function stringList(value: unknown): string[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return null;
  const tags: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) tags.push(item.trim());
  }
  return tags;
}

function cellString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return "";
}

function rowField(row: unknown, key: string): string | null {
  if (typeof row !== "object" || row === null) return null;
  const value = Reflect.get(row, key);
  return typeof value === "string" ? value : null;
}

function asCasRetention(value: string | null): CasRetention {
  if (value === "evidence" || value === "diagnostic" || value === "asset") return value;
  return "ephemeral";
}

function slicesOf(content: string): Record<string, string> | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null || !("slices" in parsed)) return null;
    const slices = Reflect.get(parsed, "slices");
    if (typeof slices !== "object" || slices === null || Array.isArray(slices)) return null;
    const out: Record<string, string> = {};
    for (const key of Object.keys(slices)) {
      const value = Reflect.get(slices, key);
      if (typeof value === "string") out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
