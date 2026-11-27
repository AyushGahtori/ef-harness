import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bindKnowledgeGraph, blobFilePath, type ProjectStateDb } from "@ef-harness/db";

import { openPlannerState, tempPlannerRoot } from "../state/project-db.js";
import { sha256 } from "./canonical.js";
import { FeaturePlanError } from "./errors.js";
import type { KnowledgeGraphRepoPort, NameRegistryRepoPort } from "./ports.js";
import { EDGE_TYPES, type EdgeType, type HeldBackCase } from "./types.js";

/**
 * Verbatim `relations_in_fields` query from schema/queries.sql.
 * Relations belong in edges. A node must not keep them inside fields.
 */
export const RELATIONS_IN_FIELDS_SQL = `SELECT id FROM nodes
 WHERE status = 'active'
   AND (fields ->> '$.depends_on' IS NOT NULL OR fields ->> '$.implements' IS NOT NULL
        OR fields ->> '$.verifies' IS NOT NULL OR fields ->> '$.consumes' IS NOT NULL)`;

const EXTENDED_RELATIONS_SQL = `SELECT id FROM nodes
 WHERE status = 'active'
   AND (fields ->> '$.touches_entity' IS NOT NULL OR fields ->> '$.belongs_to' IS NOT NULL
        OR fields ->> '$.consumes_contract' IS NOT NULL)`;

const RELATION_FIELD_KEYS = [
  "depends_on",
  "implements",
  "verifies",
  "consumes",
  "touches_entity",
  "belongs_to",
  "consumes_contract",
] as const;

export interface StoredNode {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly status: "draft" | "active" | "retired" | "superseded";
  readonly featureId: string | null;
}

export interface StoredEdge {
  readonly src: string;
  readonly type: string;
  readonly dst: string;
}

export interface StoredHiddenCheck {
  readonly id: string;
  readonly featureId: string;
  readonly requirementId: string;
  readonly diversity: string;
  readonly casBlobId: string;
  readonly sha256: string;
  readonly sealedAt: number;
  readonly contentJson: string;
  readonly status: "sealed" | "superseded";
  readonly encryptedAtRest: boolean;
  readonly exportEncryption: string;
}

interface PendingNode {
  id: string;
  kind: string;
  version: number;
  title: string;
  text: string;
  fields: Record<string, unknown>;
  status: StoredNode["status"];
  featureId: string | null;
  persisted: boolean;
}

interface PendingEdge {
  src: string;
  type: string;
  dst: string;
}

/**
 * Feature graph and sealed checks on the shared `ProjectStateDb`.
 * `touches_entity` is stored as canonical `documents` plus `fields.touched_entities`,
 * because `schema/state.sql` has no `touches_entity` edge type.
 * Sealed bodies live in the CAS file layout, not in node text.
 */
export class FeaturePlanDatabase implements KnowledgeGraphRepoPort, NameRegistryRepoPort {
  private depth = 0;
  private readonly nodes = new Map<string, PendingNode>();
  private readonly addedEdges: PendingEdge[] = [];
  private readonly retiredEdges = new Set<string>();
  private readonly hidden = new Map<string, StoredHiddenCheck>();

  private constructor(
    readonly state: ProjectStateDb,
    readonly path: string,
    private readonly ownsState: boolean,
  ) {}

  static memory(): FeaturePlanDatabase {
    const root = tempPlannerRoot("ef-feature-plan-");
    return new FeaturePlanDatabase(openPlannerState(root), root, true);
  }

  static fromState(state: ProjectStateDb): FeaturePlanDatabase {
    return new FeaturePlanDatabase(state, state.databasePath, false);
  }

  close(): void {
    if (this.ownsState) this.state.close();
  }

  transaction<T>(body: () => T): T {
    if (this.depth > 0) return body();
    this.depth += 1;
    try {
      const value = body();
      this.flush();
      return value;
    } catch (error) {
      this.discard();
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  activeIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const node of this.listNodes()) {
      if (node.status === "active") ids.add(node.id);
    }
    return ids;
  }

  hasActiveNode(id: string): boolean {
    return this.getNode(id)?.status === "active";
  }

  relationsInFields(): readonly string[] {
    return this.relationHits(RELATIONS_IN_FIELDS_SQL, ["depends_on", "implements", "verifies", "consumes"]);
  }

  extendedRelationsInFields(): readonly string[] {
    return this.relationHits(EXTENDED_RELATIONS_SQL, ["touches_entity", "belongs_to", "consumes_contract"]);
  }

  upsertNode(node: Omit<StoredNode, "version" | "status"> & { readonly status?: StoredNode["status"] }): void {
    this.touch(() => {
      const current = this.nodes.get(node.id);
      const base = current ?? this.pendingFromPersisted(node.id);
      const fields = withFeature({ ...node.fields }, node.featureId);
      if (current && fields.touched_entities === undefined && current.fields.touched_entities !== undefined) {
        fields.touched_entities = current.fields.touched_entities;
      }
      this.nodes.set(node.id, {
        id: node.id,
        kind: node.kind,
        version: base?.version ?? 1,
        title: node.title,
        text: node.text,
        fields,
        status: node.status ?? base?.status ?? "active",
        featureId: node.featureId,
        persisted: current?.persisted ?? base?.persisted ?? false,
      });
    });
  }

  getNode(id: string): StoredNode | null {
    const pending = this.nodes.get(id);
    if (pending) return toStored(pending);
    return this.readNode(id);
  }

  listNodes(): StoredNode[] {
    const merged = new Map<string, StoredNode>();
    for (const node of this.readNodes()) merged.set(node.id, node);
    for (const pending of this.nodes.values()) merged.set(pending.id, toStored(pending));
    return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  deleteOutgoing(src: string): void {
    this.touch(() => {
      for (const edge of this.readEdges()) {
        if (edge.src === src) this.retiredEdges.add(edgeKey(edge));
      }
      for (let index = this.addedEdges.length - 1; index >= 0; index -= 1) {
        const edge = this.addedEdges[index];
        if (edge && edge.src === src) this.addedEdges.splice(index, 1);
      }
    });
  }

  insertEdge(edge: { readonly src: string; readonly type: EdgeType; readonly dst: string }): void {
    if (!EDGE_TYPES.includes(edge.type)) {
      throw new FeaturePlanError("invalid_relation", `Edge type ${edge.type} is not canonical`, { type: edge.type });
    }
    this.touch(() => {
      const storedType = edge.type === "touches_entity" ? "documents" : edge.type;
      if (edge.type === "touches_entity") this.noteTouch(edge.src, edge.dst);
      const stored = { src: edge.src, type: storedType, dst: edge.dst };
      const signature = edgeKey(stored);
      const alreadyStored = this.readEdges().some((item) => edgeKey(item) === signature);
      if (alreadyStored) {
        this.retiredEdges.delete(signature);
        return;
      }
      this.retiredEdges.delete(signature);
      if (!this.addedEdges.some((item) => edgeKey(item) === signature)) this.addedEdges.push(stored);
    });
  }

  listEdges(): StoredEdge[] {
    const merged = new Map<string, PendingEdge>();
    for (const edge of this.readEdges()) {
      const key = edgeKey(edge);
      if (this.retiredEdges.has(key)) continue;
      merged.set(key, edge);
    }
    for (const edge of this.addedEdges) merged.set(edgeKey(edge), edge);
    return [...merged.values()]
      .map((edge) => ({ src: edge.src, type: this.logicalType(edge), dst: edge.dst }))
      .sort((left, right) => left.src.localeCompare(right.src) || left.type.localeCompare(right.type) || left.dst.localeCompare(right.dst));
  }

  upsertHidden(check: HeldBackCase, featureId: string, sealedAt: number): StoredHiddenCheck {
    let stored: StoredHiddenCheck | null = null;
    this.touch(() => {
      const contentJson = JSON.stringify(check);
      const digest = sha256(contentJson);
      const requirementId = check.requirementIds[0];
      if (!requirementId) {
        throw new FeaturePlanError("invalid_relation", `Hidden check ${check.checkId} has no requirement`, {
          checkId: check.checkId,
        });
      }
      stored = {
        id: check.checkId,
        featureId,
        requirementId,
        diversity: check.diversity,
        casBlobId: `sha256:${digest}`,
        sha256: digest,
        sealedAt,
        contentJson,
        status: "sealed",
        encryptedAtRest: false,
        exportEncryption: "age-x25519",
      };
      this.hidden.set(check.checkId, stored);
      const current = this.nodes.get(check.checkId) ?? this.pendingFromPersisted(check.checkId);
      const fields = {
        ...(current?.fields ?? {}),
        visibility: "held_back",
        sealed: true,
        diversity: check.diversity,
        requirement_id: requirementId,
        sealed_at: sealedAt,
        cas: `sha256:${digest}`,
        hidden_status: "sealed",
        feature: featureId,
      };
      this.nodes.set(check.checkId, {
        id: check.checkId,
        kind: "check",
        version: current?.version ?? 1,
        title: current?.title ?? "Sealed check",
        text: "",
        fields,
        status: "active",
        featureId,
        persisted: current?.persisted ?? false,
      });
    });
    if (!stored) throw new FeaturePlanError("oracle_lint", `Failed to store hidden check ${check.checkId}`);
    return stored;
  }

  getHidden(id: string): StoredHiddenCheck | null {
    const pending = this.hidden.get(id);
    if (pending) return pending;
    const node = this.getNode(id);
    if (!node) return null;
    return hiddenFromNode(node, this.readCasBytes(node));
  }

  listHidden(featureId?: string): StoredHiddenCheck[] {
    const merged = new Map<string, StoredHiddenCheck>();
    for (const node of this.readNodes()) {
      const row = hiddenFromNode(node, this.readCasBytes(node));
      if (row) merged.set(row.id, row);
    }
    for (const row of this.hidden.values()) merged.set(row.id, row);
    return [...merged.values()]
      .filter((row) => featureId === undefined || row.featureId === featureId)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  readCas(id: string): string | null {
    const row = this.getHidden(id);
    return row?.contentJson ?? null;
  }

  private touch(body: () => void): void {
    if (this.depth > 0) {
      body();
      return;
    }
    this.depth += 1;
    try {
      body();
      this.flush();
    } catch (error) {
      this.discard();
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  private flush(): void {
    if (this.nodes.size === 0 && this.addedEdges.length === 0 && this.retiredEdges.size === 0) return;
    for (const row of this.hidden.values()) this.writeCas(row);
    const repo = bindKnowledgeGraph(this.state);
    const nodeMutations = [...this.nodes.values()].map((node) =>
      node.persisted
        ? {
            op: "update" as const,
            id: node.id,
            class: "compatible" as const,
            title: node.title,
            text: node.text,
            fields: node.fields,
            status: node.status,
          }
        : {
            op: "create" as const,
            id: node.id,
            kind: node.kind,
            title: node.title,
            text: node.text,
            fields: node.fields,
            status: node.status === "retired" || node.status === "superseded" ? ("active" as const) : node.status,
          },
    );
    const edgeMutations = [
      ...[...this.retiredEdges].map((key) => {
        const [src, type, dst] = key.split("\u0000");
        return { op: "retire" as const, src: src ?? "", type: type ?? "", dst: dst ?? "" };
      }),
      ...this.addedEdges.map((edge) => ({ op: "create" as const, src: edge.src, type: edge.type, dst: edge.dst })),
    ].filter((edge) => edge.src.length > 0 && edge.dst.length > 0 && edge.type.length > 0);
    const committed = repo.commitChangeSet({
      origin: "planner",
      author: "feature-planner@1",
      summary: "feature plan",
      nodes: nodeMutations,
      edges: edgeMutations,
    });
    this.writeRuntime(committed.rev);
    this.writeArtifacts();
    this.discard();
  }

  private writeRuntime(rev: number): void {
    const writer = this.state.writer;
    writer.transaction(() => {
      for (const node of this.readNodes()) {
        if (node.kind === "feature") {
          writer.run(
            `INSERT INTO feature_runtime(feature, state, epoch, updated_rev)
             VALUES (?, 'PLANNED', 0, ?)
             ON CONFLICT(feature) DO NOTHING`,
            [node.id, rev],
          );
        }
        if (node.kind === "task" && node.featureId) {
          const level = typeof node.fields.level === "string" ? node.fields.level : "Junior";
          writer.run(
            `INSERT INTO task_runtime(task, feature, state, level, epoch, submission_pending, updated_rev)
             VALUES (?, ?, 'DRAFTED', ?, 0, 0, ?)
             ON CONFLICT(task) DO NOTHING`,
            [node.id, node.featureId, level, rev],
          );
          const scopes = writeScopes(node.fields);
          for (const prefix of scopes) {
            writer.run(
              `INSERT INTO task_scopes(task, path_prefix) VALUES (?, ?) ON CONFLICT(task, path_prefix) DO NOTHING`,
              [node.id, prefix],
            );
          }
        }
      }
    });
  }

  private writeArtifacts(): void {
    const writer = this.state.writer;
    writer.transaction(() => {
      for (const row of this.listHidden()) {
        const artifactId = `ART-${row.id}`;
        const existing = writer.get("SELECT id FROM artifacts WHERE id = ?", [artifactId]);
        if (existing) continue;
        writer.run(
          `INSERT INTO artifacts(id, hash, kind, bytes, mime, retention, created_at)
           VALUES (?, ?, 'source', ?, 'application/json', 'evidence', ?)`,
          [artifactId, row.casBlobId, Buffer.byteLength(row.contentJson), row.sealedAt],
        );
        writer.run(
          `INSERT INTO artifact_refs(artifact, owner_kind, owner_id) VALUES (?, 'check', ?)`,
          [artifactId, row.id],
        );
      }
    });
  }

  private writeCas(row: StoredHiddenCheck): void {
    const file = blobFilePath(this.casRoot(), row.sha256, "raw");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, row.contentJson, "utf8");
  }

  private readCasBytes(node: StoredNode): string | null {
    const cas = node.fields.cas;
    if (typeof cas !== "string") return null;
    const digest = cas.startsWith("sha256:") ? cas.slice("sha256:".length) : cas;
    if (!/^[0-9a-f]{64}$/.test(digest)) return null;
    const file = blobFilePath(this.casRoot(), digest, "raw");
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }

  private casRoot(): string {
    return path.join(path.dirname(this.state.databasePath), "cas");
  }

  private discard(): void {
    this.nodes.clear();
    this.addedEdges.length = 0;
    this.retiredEdges.clear();
    this.hidden.clear();
  }

  private noteTouch(src: string, dst: string): void {
    const pending = this.nodes.get(src) ?? this.pendingFromPersisted(src);
    if (!pending) return;
    const current = Array.isArray(pending.fields.touched_entities)
      ? pending.fields.touched_entities.filter((item): item is string => typeof item === "string")
      : [];
    if (!current.includes(dst)) pending.fields.touched_entities = [...current, dst];
    this.nodes.set(src, pending);
  }

  private logicalType(edge: PendingEdge): string {
    if (edge.type !== "documents") return edge.type;
    const node = this.getNode(edge.src);
    const touches = node?.fields.touched_entities;
    if (Array.isArray(touches) && touches.includes(edge.dst)) return "touches_entity";
    return edge.type;
  }

  private pendingFromPersisted(id: string): PendingNode | null {
    const stored = this.readNode(id);
    if (!stored) return null;
    return {
      id: stored.id,
      kind: stored.kind,
      version: stored.version + 1,
      title: stored.title,
      text: stored.text,
      fields: { ...stored.fields },
      status: stored.status,
      featureId: stored.featureId,
      persisted: true,
    };
  }

  private relationHits(sql: string, keys: readonly string[]): string[] {
    const hits = new Set<string>();
    for (const row of this.state.writer.all(sql)) {
      if (!isRecord(row) || typeof row.id !== "string") continue;
      if (this.nodes.has(row.id)) continue;
      hits.add(row.id);
    }
    for (const node of this.nodes.values()) {
      if (node.status !== "active") continue;
      if (keys.some((key) => node.fields[key] !== undefined && (RELATION_FIELD_KEYS as readonly string[]).includes(key))) {
        hits.add(node.id);
      }
    }
    return [...hits].sort((left, right) => left.localeCompare(right));
  }

  private readNode(id: string): StoredNode | null {
    const row = this.state.writer.get(
      "SELECT id, kind, version, title, text, fields, status, feature FROM nodes WHERE id = ?",
      [id],
    );
    return isRecord(row) ? mapNode(row) : null;
  }

  private readNodes(): StoredNode[] {
    return this.state.writer
      .all("SELECT id, kind, version, title, text, fields, status, feature FROM nodes ORDER BY id")
      .filter(isRecord)
      .map((row) => mapNode(row));
  }

  private readEdges(): PendingEdge[] {
    return this.state.writer
      .all("SELECT src, type, dst FROM edges WHERE valid_to_rev IS NULL ORDER BY src, type, dst")
      .filter(isRecord)
      .map((row) => ({
        src: String(row.src),
        type: String(row.type),
        dst: String(row.dst),
      }));
  }
}

function withFeature(fields: Record<string, unknown>, featureId: string | null): Record<string, unknown> {
  if (!featureId) return fields;
  if (fields.feature === undefined) fields.feature = featureId;
  return fields;
}

function toStored(node: PendingNode): StoredNode {
  return {
    id: node.id,
    kind: node.kind,
    version: node.version,
    title: node.title,
    text: node.text,
    fields: node.fields,
    status: node.status,
    featureId: node.featureId,
  };
}

function mapNode(row: Record<string, unknown>): StoredNode {
  const status = row.status;
  const storedStatus: StoredNode["status"] =
    status === "draft" || status === "active" || status === "retired" || status === "superseded" ? status : "active";
  return {
    id: String(row.id),
    kind: String(row.kind),
    version: typeof row.version === "number" ? row.version : Number(row.version),
    title: String(row.title),
    text: typeof row.text === "string" ? row.text : "",
    fields: parseFields(row.fields),
    status: storedStatus,
    featureId: typeof row.feature === "string" ? row.feature : null,
  };
}

function parseFields(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return {};
  const parsed = JSON.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function hiddenFromNode(node: StoredNode, bytes: string | null): StoredHiddenCheck | null {
  if (node.kind !== "check") return null;
  if (node.fields.visibility !== "held_back" && node.fields.sealed !== true) return null;
  const cas = typeof node.fields.cas === "string" ? node.fields.cas : "";
  const digest = cas.startsWith("sha256:") ? cas.slice("sha256:".length) : "";
  const featureId = typeof node.fields.feature === "string" ? node.fields.feature : (node.featureId ?? "");
  const requirementId = typeof node.fields.requirement_id === "string" ? node.fields.requirement_id : "";
  const diversity = typeof node.fields.diversity === "string" ? node.fields.diversity : "";
  const sealedAt = typeof node.fields.sealed_at === "number" ? node.fields.sealed_at : 0;
  const status = node.fields.hidden_status === "superseded" ? "superseded" : "sealed";
  if (!bytes) return null;
  return {
    id: node.id,
    featureId,
    requirementId,
    diversity,
    casBlobId: cas,
    sha256: digest,
    sealedAt,
    contentJson: bytes,
    status,
    encryptedAtRest: false,
    exportEncryption: "age-x25519",
  };
}

function writeScopes(fields: Readonly<Record<string, unknown>>): string[] {
  const raw = fields.write_scope;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string").map((scope) => scope.replace(/\/\*\*$/, "").replace(/\/$/, ""));
}

function edgeKey(edge: PendingEdge): string {
  return `${edge.src}\u0000${edge.type}\u0000${edge.dst}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
