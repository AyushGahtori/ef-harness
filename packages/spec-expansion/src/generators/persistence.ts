import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { type CollapsedMatrices, type UniversalRule } from "./collapse.js";
import { asJsonValue, jcs } from "./jcs.js";
import { MATRIX_IDS, type GenerationRun, type MatrixId, type RawMatrixCell, type SettledProjectGraph } from "./types.js";

export interface PersistedRecord {
  readonly id: string;
  readonly kind: string;
  readonly status: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly contentHash: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface PersistStats {
  readonly insertedCellIds: readonly string[];
  readonly preservedCellIds: readonly string[];
}

export interface ListedMatrixCell {
  readonly id: string;
  readonly matrixId: MatrixId;
  readonly axisA: string;
  readonly axisB: string;
  readonly status: "filled" | "open" | "not_applicable";
  readonly text: string;
}

interface NodeRow {
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly title: string;
  readonly text: string;
  readonly fields: string;
  readonly content_hash: string;
  readonly status: string;
}

const MANIFEST_ID = "matrix-manifest";

function isMatrixId(value: unknown): value is MatrixId {
  return typeof value === "string" && (MATRIX_IDS as readonly string[]).includes(value);
}

function matchesWorkItem(fields: Record<string, unknown>, workItemId: string): boolean {
  return fields.work_item === workItemId || fields.workItemId === workItemId;
}

function schemaPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../../../schema/state.sql"),
    path.resolve(here, "../../../schema/state.sql"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error("schema/state.sql was not found from the matrix persistence repo");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentHash(input: {
  readonly kind: string;
  readonly title: string;
  readonly text: string;
  readonly fields: string;
}): string {
  return sha256(
    jcs({
      fields: asJsonValue(JSON.parse(input.fields)),
      kind: input.kind,
      text: input.text,
      title: input.title,
    }),
  );
}

function searchText(value: unknown): string {
  return String(value ?? "")
    .replace(/[A-Z]+/g, (chunk) => ` ${chunk.toLowerCase()}`)
    .replace(/[_\-./:]+/g, " ")
    .toLowerCase();
}

/**
 * Persists matrix groups, collapsed universal rules, and exception/open cells
 * in state.db. `expands` is not seeded in schema/state.sql yet (Task 010
 * parity owns that lookup). The repo inserts the edge type at runtime so
 * traceability edges can be written without editing the frozen schema file.
 */
export class MatrixCellPersistenceRepo {
  private constructor(private readonly db: DatabaseSync) {}

  static openMemory(): MatrixCellPersistenceRepo {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.function("ef_search_text", (value: unknown) => searchText(value));
    db.exec(fs.readFileSync(schemaPath(), "utf8"));
    db.exec("INSERT OR IGNORE INTO edge_types(type, invalidates) VALUES ('expands', 1)");
    return new MatrixCellPersistenceRepo(db);
  }

  persist(graph: SettledProjectGraph, run: GenerationRun, collapsed: CollapsedMatrices): PersistStats {
    const prior = this.readManifest();
    const inserted: string[] = [];
    const preserved: string[] = [];
    const nextIds = run.rawCells.map((cell) => cell.id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changeSetId = this.nextChangeSetId("persist-matrix");
      const rev = this.nextRev();
      this.insertChangeSet(changeSetId, rev, "persist matrix cells");
      this.ensureOrigins(graph, changeSetId, rev);
      this.ensureGroups(run, changeSetId, rev);
      for (const rule of collapsed.rules) this.ensureRule(rule, graph, changeSetId, rev);
      for (const cell of collapsed.exceptions) this.ensureCell(cell, graph, changeSetId, rev);
      if (prior) {
        const priorSet = new Set(prior);
        for (const id of prior) {
          if (nextIds.includes(id)) preserved.push(id);
        }
        for (const cell of run.rawCells) {
          if (priorSet.has(cell.id)) continue;
          this.ensureCell(cell, graph, changeSetId, rev);
          inserted.push(cell.id);
        }
      }
      const manifestIds = [...new Set([...prior ?? [], ...nextIds])].sort();
      this.writeManifest(manifestIds, changeSetId, rev, prior !== null);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    inserted.sort();
    preserved.sort();
    return { insertedCellIds: inserted, preservedCellIds: preserved };
  }

  markFilled(
    cellId: string,
    fill: { readonly basis: "explicit"; readonly text: string },
    graph: SettledProjectGraph,
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const changeSetId = this.nextChangeSetId("fill-cell");
      const rev = this.nextRev();
      this.insertChangeSet(changeSetId, rev, `fill ${cellId}`);
      const existing = this.readNode(cellId);
      const fields = {
        ...(existing ? (JSON.parse(existing.fields) as Record<string, unknown>) : {}),
        basis: "explicit",
        record_type: "matrix_cell",
        fill,
      };
      const payload = {
        kind: "spec_item",
        title: existing?.title ?? cellId,
        text: fill.text,
        fields: JSON.stringify(fields),
        status: "active",
      };
      if (!existing) {
        this.insertNode(cellId, payload, changeSetId, rev, 1);
        this.ensureExpands(cellId, graph, changeSetId, rev);
      } else {
        this.updateNode(cellId, payload, changeSetId, rev, existing.version + 1);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  readRecord(id: string): PersistedRecord | null {
    const row = this.readNode(id);
    if (!row) return null;
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      version: row.version,
      title: row.title,
      text: row.text,
      contentHash: row.content_hash,
      fields: JSON.parse(row.fields) as Record<string, unknown>,
    };
  }

  listRequirementViewIds(): readonly string[] {
    const rows = this.db.prepare("SELECT id FROM requirements ORDER BY id").all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  listCells(workItemId?: string): readonly ListedMatrixCell[] {
    const rows = this.db
      .prepare(
        `SELECT id, text, status, fields FROM nodes
          WHERE json_extract(fields, '$.record_type') = 'matrix_cell'
          ORDER BY id`,
      )
      .all() as { id: string; text: string; status: string; fields: string }[];
    const cells: ListedMatrixCell[] = [];
    for (const row of rows) {
      const fields = JSON.parse(row.fields) as Record<string, unknown>;
      if (workItemId !== undefined && !matchesWorkItem(fields, workItemId)) continue;
      const matrixId = fields.matrixId;
      const axisA = fields.axisA;
      const axisB = fields.axisB;
      if (!isMatrixId(matrixId) || typeof axisA !== "string" || typeof axisB !== "string") continue;
      const notApplicable = fields.notApplicable === true;
      const status = notApplicable ? "not_applicable" : row.status === "active" ? "filled" : "open";
      cells.push({ id: row.id, matrixId, axisA, axisB, status, text: row.text });
    }
    return cells;
  }

  expandEdges(src: string): readonly { readonly type: string; readonly dst: string }[] {
    return this.db
      .prepare(
        "SELECT type, dst FROM edges WHERE src = ? AND valid_to_rev IS NULL ORDER BY type, dst",
      )
      .all(src) as { type: string; dst: string }[];
  }

  private readManifest(): string[] | null {
    const row = this.readNode(MANIFEST_ID);
    if (!row) return null;
    const fields = JSON.parse(row.fields) as { cellIds?: unknown };
    if (!Array.isArray(fields.cellIds)) return [];
    return fields.cellIds.filter((id): id is string => typeof id === "string");
  }

  private writeManifest(cellIds: readonly string[], changeSetId: string, rev: number, exists: boolean): void {
    const fields = JSON.stringify({
      record_type: "matrix_manifest",
      cellIds,
    });
    const payload = {
      kind: "source",
      title: "Matrix cell manifest",
      text: `${cellIds.length} canonical cell ids`,
      fields,
      status: "active",
    };
    if (!exists) {
      this.insertNode(MANIFEST_ID, payload, changeSetId, rev, 1);
      return;
    }
    const current = this.readNode(MANIFEST_ID);
    if (!current) throw new Error("matrix manifest disappeared");
    if (current.fields === fields) return;
    this.updateNode(MANIFEST_ID, payload, changeSetId, rev, current.version + 1);
  }

  private ensureOrigins(graph: SettledProjectGraph, changeSetId: string, rev: number): void {
    for (const node of graph.nodes) {
      if (this.readNode(node.nodeId)) continue;
      const kind = node.kind === "feature" ? "feature" : "decision";
      const fields = JSON.stringify({
        basis: "explicit",
        axis_kind: node.kind,
        feature: node.featureId,
        title_snapshot: node.title,
      });
      this.insertNode(
        node.nodeId,
        {
          kind,
          title: node.title,
          text: node.title,
          fields,
          status: "active",
        },
        changeSetId,
        rev,
        1,
      );
    }
  }

  private ensureGroups(run: GenerationRun, changeSetId: string, rev: number): void {
    for (const decision of run.applicability) {
      const id = `matrix:${decision.matrixId}`;
      if (this.readNode(id)) continue;
      this.insertNode(
        id,
        {
          kind: "source",
          title: decision.matrixId,
          text: decision.skippedReason ?? decision.narrowed ?? "active",
          fields: JSON.stringify({
            record_type: "matrix_group",
            matrixId: decision.matrixId,
            active: decision.active,
            skippedReason: decision.skippedReason,
            narrowed: decision.narrowed,
          }),
          status: "active",
        },
        changeSetId,
        rev,
        1,
      );
    }
  }

  private ensureRule(
    rule: UniversalRule,
    graph: SettledProjectGraph,
    changeSetId: string,
    rev: number,
  ): void {
    if (this.readNode(rule.id)) return;
    this.insertNode(
      rule.id,
      {
        kind: "rule",
        title: rule.text,
        text: rule.text,
        fields: JSON.stringify({
          basis: "derived",
          record_type: "universal_rule",
          matrixId: rule.matrixId,
          scopeKey: rule.scopeKey,
          signature: rule.signature,
          outcome: rule.outcome,
          reason: rule.reason,
          coveredCount: rule.coveredCount,
        }),
        status: "active",
      },
      changeSetId,
      rev,
      1,
    );
    this.linkExpands(rule.id, rule.domainNodeIds, graph, changeSetId, rev);
  }

  private ensureCell(
    cell: RawMatrixCell,
    graph: SettledProjectGraph,
    changeSetId: string,
    rev: number,
  ): void {
    if (this.readNode(cell.id)) return;
    this.insertNode(
      cell.id,
      {
        kind: "spec_item",
        title: `${cell.matrixId} ${cell.outcome}`,
        text: cell.reason ?? cell.outcome,
        fields: JSON.stringify({
          record_type: "matrix_cell",
          matrixId: cell.matrixId,
          axisA: cell.axisA,
          axisB: cell.axisB,
          outcome: cell.outcome,
          reason: cell.reason,
          notApplicable: cell.notApplicable,
          signature: cell.signature,
        }),
        status: "draft",
      },
      changeSetId,
      rev,
      1,
    );
    this.linkExpands(cell.id, cell.domainNodeIds, graph, changeSetId, rev);
  }

  private linkExpands(
    src: string,
    domainNodeIds: readonly string[],
    graph: SettledProjectGraph,
    changeSetId: string,
    rev: number,
  ): void {
    const featureIds = new Set(
      graph.nodes.filter((node) => node.kind === "feature").map((node) => node.nodeId),
    );
    const targets = new Set<string>([...domainNodeIds, ...featureIds]);
    for (const dst of targets) {
      if (!this.readNode(dst)) continue;
      this.insertEdge(src, dst, changeSetId, rev);
    }
  }

  private ensureExpands(src: string, graph: SettledProjectGraph, changeSetId: string, rev: number): void {
    const feature = graph.nodes.find((node) => node.kind === "feature");
    if (feature) this.insertEdge(src, feature.nodeId, changeSetId, rev);
  }

  private insertEdge(src: string, dst: string, changeSetId: string, rev: number): void {
    const existing = this.db
      .prepare(
        "SELECT 1 AS ok FROM edges WHERE src = ? AND type = 'expands' AND dst = ? AND valid_to_rev IS NULL",
      )
      .get(src, dst) as { ok: number } | undefined;
    if (existing) return;
    this.db
      .prepare(
        `INSERT INTO edges(src, type, dst, dst_version_pin, change_set, valid_from_rev, valid_to_rev)
         VALUES (?, 'expands', ?, 1, ?, ?, NULL)`,
      )
      .run(src, dst, changeSetId, rev);
  }

  private insertNode(
    id: string,
    payload: { kind: string; title: string; text: string; fields: string; status: string },
    changeSetId: string,
    rev: number,
    version: number,
  ): void {
    const hash = contentHash(payload);
    this.db
      .prepare(
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      )
      .run(
        id,
        payload.kind,
        version,
        hash,
        payload.title,
        payload.text,
        payload.fields,
        payload.status,
        changeSetId,
        rev,
        rev,
      );
    this.db
      .prepare(
        `INSERT INTO node_changes(change_set, id, old_version, new_version, class)
         VALUES (?, ?, NULL, ?, 'created')`,
      )
      .run(changeSetId, id, version);
  }

  private updateNode(
    id: string,
    payload: { kind: string; title: string; text: string; fields: string; status: string },
    changeSetId: string,
    rev: number,
    version: number,
  ): void {
    const hash = contentHash(payload);
    const current = this.readNode(id);
    this.db
      .prepare(
        `UPDATE nodes
            SET version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = ?, change_set = ?, updated_rev = ?
          WHERE id = ?`,
      )
      .run(
        version,
        hash,
        payload.title,
        payload.text,
        payload.fields,
        payload.status,
        changeSetId,
        rev,
        id,
      );
    this.db
      .prepare(
        `INSERT INTO node_changes(change_set, id, old_version, new_version, class)
         VALUES (?, ?, ?, ?, 'compatible')`,
      )
      .run(changeSetId, id, current?.version ?? null, version);
  }

  private readNode(id: string): NodeRow | null {
    const row = this.db
      .prepare(
        "SELECT id, kind, version, title, text, fields, content_hash, status FROM nodes WHERE id = ?",
      )
      .get(id) as NodeRow | undefined;
    return row ?? null;
  }

  private nextRev(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM change_sets").get() as {
      rev: number;
    };
    return row.rev + 1;
  }

  private nextChangeSetId(prefix: string): string {
    const rev = this.nextRev();
    return `cs-${prefix}-${rev}`;
  }

  private insertChangeSet(id: string, rev: number, summary: string): void {
    this.db
      .prepare(
        `INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
         VALUES (?, ?, 'kernel', NULL, 'spec-expansion', 0, ?)`,
      )
      .run(id, rev, summary);
  }
}
