import { DatabaseSync } from "node:sqlite";

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

const MIGRATION = `
CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL CHECK (json_valid(fields)),
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired', 'superseded')),
  feature TEXT
) STRICT;

CREATE TABLE edges (
  src TEXT NOT NULL REFERENCES nodes(id),
  type TEXT NOT NULL,
  dst TEXT NOT NULL REFERENCES nodes(id),
  PRIMARY KEY (src, type, dst)
) STRICT;

CREATE TABLE hidden_checks (
  id TEXT PRIMARY KEY,
  feature_id TEXT NOT NULL,
  requirement_id TEXT NOT NULL,
  diversity TEXT NOT NULL,
  cas_blob_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  sealed_at INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sealed', 'superseded')),
  encrypted_at_rest INTEGER NOT NULL DEFAULT 0 CHECK (encrypted_at_rest IN (0, 1)),
  export_encryption TEXT NOT NULL DEFAULT 'age-x25519'
) STRICT;

CREATE TABLE cas_blobs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  bytes TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility = 'sealed')
) STRICT;
`;

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

interface NodeRow {
  id: string;
  kind: string;
  version: number;
  title: string;
  text: string;
  fields: string;
  status: StoredNode["status"];
  feature: string | null;
}

interface HiddenRow {
  id: string;
  feature_id: string;
  requirement_id: string;
  diversity: string;
  cas_blob_id: string;
  sha256: string;
  sealed_at: number;
  content_json: string;
  status: "sealed" | "superseded";
  encrypted_at_rest: number;
  export_encryption: string;
}

/**
 * In-process state.db projection for nodes, edges, hidden_checks, and CAS.
 * `hidden_checks` is not in the frozen schema yet; the handoff records that table.
 */
export class FeaturePlanDatabase implements KnowledgeGraphRepoPort, NameRegistryRepoPort {
  private depth = 0;

  private constructor(
    private readonly db: DatabaseSync,
    readonly path: string,
  ) {}

  static memory(): FeaturePlanDatabase {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(MIGRATION);
    return new FeaturePlanDatabase(db, ":memory:");
  }

  transaction<T>(body: () => T): T {
    if (this.depth > 0) return body();
    this.depth += 1;
    let opened = false;
    try {
      this.db.exec("BEGIN");
      opened = true;
      const value = body();
      this.db.exec("COMMIT");
      opened = false;
      return value;
    } catch (error) {
      if (opened) this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth -= 1;
    }
  }

  activeIds(): ReadonlySet<string> {
    const rows = this.db.prepare("SELECT id FROM nodes WHERE status = 'active'").all() as { id: string }[];
    return new Set(rows.map((row) => row.id));
  }

  hasActiveNode(id: string): boolean {
    const row = this.db.prepare("SELECT id FROM nodes WHERE id = ? AND status = 'active'").get(id) as
      | { id: string }
      | undefined;
    return row !== undefined;
  }

  relationsInFields(): readonly string[] {
    const rows = this.db.prepare(RELATIONS_IN_FIELDS_SQL).all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  extendedRelationsInFields(): readonly string[] {
    const rows = this.db.prepare(EXTENDED_RELATIONS_SQL).all() as { id: string }[];
    return rows.map((row) => row.id);
  }

  upsertNode(node: Omit<StoredNode, "version" | "status"> & { readonly status?: StoredNode["status"] }): void {
    const fields = JSON.stringify(node.fields);
    const status = node.status ?? "active";
    this.db
      .prepare(
        `INSERT INTO nodes (id, kind, version, title, text, fields, status, feature)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           version = nodes.version + 1,
           kind = excluded.kind,
           title = excluded.title,
           text = excluded.text,
           fields = excluded.fields,
           status = excluded.status,
           feature = excluded.feature`,
      )
      .run(node.id, node.kind, node.title, node.text, fields, status, node.featureId);
  }

  getNode(id: string): StoredNode | null {
    const row = this.db.prepare("SELECT id, kind, version, title, text, fields, status, feature FROM nodes WHERE id = ?").get(id) as
      | NodeRow
      | undefined;
    return row ? mapNode(row) : null;
  }

  listNodes(): StoredNode[] {
    const rows = this.db
      .prepare("SELECT id, kind, version, title, text, fields, status, feature FROM nodes ORDER BY id")
      .all() as unknown as NodeRow[];
    return rows.map((row) => mapNode(row));
  }

  deleteOutgoing(src: string): void {
    this.db.prepare("DELETE FROM edges WHERE src = ?").run(src);
  }

  insertEdge(edge: { readonly src: string; readonly type: EdgeType; readonly dst: string }): void {
    if (!EDGE_TYPES.includes(edge.type)) {
      throw new FeaturePlanError("invalid_relation", `Edge type ${edge.type} is not canonical`, { type: edge.type });
    }
    this.db.prepare("INSERT INTO edges (src, type, dst) VALUES (?, ?, ?)").run(edge.src, edge.type, edge.dst);
  }

  listEdges(): StoredEdge[] {
    return this.db.prepare("SELECT src, type, dst FROM edges ORDER BY src, type, dst").all() as unknown as StoredEdge[];
  }

  upsertHidden(check: HeldBackCase, featureId: string, sealedAt: number): StoredHiddenCheck {
    const contentJson = JSON.stringify(check);
    const digest = sha256(contentJson);
    const casBlobId = `cas-${digest.slice(0, 32)}`;
    const requirementId = check.requirementIds[0];
    if (!requirementId) {
      throw new FeaturePlanError("invalid_relation", `Hidden check ${check.checkId} has no requirement`, {
        checkId: check.checkId,
      });
    }
    this.db
      .prepare(
        `INSERT INTO cas_blobs (id, sha256, bytes, visibility)
         VALUES (?, ?, ?, 'sealed')
         ON CONFLICT(id) DO UPDATE SET sha256 = excluded.sha256, bytes = excluded.bytes`,
      )
      .run(casBlobId, digest, contentJson);
    this.db
      .prepare(
        `INSERT INTO hidden_checks (
           id, feature_id, requirement_id, diversity, cas_blob_id, sha256, sealed_at, content_json, status, encrypted_at_rest, export_encryption
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sealed', 0, 'age-x25519')
         ON CONFLICT(id) DO UPDATE SET
           cas_blob_id = excluded.cas_blob_id,
           sha256 = excluded.sha256,
           sealed_at = excluded.sealed_at,
           content_json = excluded.content_json,
           status = 'sealed',
           diversity = excluded.diversity`,
      )
      .run(check.checkId, featureId, requirementId, check.diversity, casBlobId, digest, sealedAt, contentJson);
    const stored = this.getHidden(check.checkId);
    if (!stored) {
      throw new FeaturePlanError("oracle_lint", `Failed to store hidden check ${check.checkId}`);
    }
    return stored;
  }

  getHidden(id: string): StoredHiddenCheck | null {
    const row = this.db.prepare("SELECT * FROM hidden_checks WHERE id = ?").get(id) as HiddenRow | undefined;
    return row ? mapHidden(row) : null;
  }

  listHidden(featureId?: string): StoredHiddenCheck[] {
    const rows = featureId
      ? (this.db.prepare("SELECT * FROM hidden_checks WHERE feature_id = ? ORDER BY id").all(featureId) as unknown as HiddenRow[])
      : (this.db.prepare("SELECT * FROM hidden_checks ORDER BY id").all() as unknown as HiddenRow[]);
    return rows.map((row) => mapHidden(row));
  }

  readCas(id: string): string | null {
    const row = this.db.prepare("SELECT bytes FROM cas_blobs WHERE id = ?").get(id) as { bytes: string } | undefined;
    return row?.bytes ?? null;
  }
}

function mapNode(row: NodeRow): StoredNode {
  return {
    id: row.id,
    kind: row.kind,
    version: row.version,
    title: row.title,
    text: row.text,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    status: row.status,
    featureId: row.feature,
  };
}

function mapHidden(row: HiddenRow): StoredHiddenCheck {
  return {
    id: row.id,
    featureId: row.feature_id,
    requirementId: row.requirement_id,
    diversity: row.diversity,
    casBlobId: row.cas_blob_id,
    sha256: row.sha256,
    sealedAt: row.sealed_at,
    contentJson: row.content_json,
    status: row.status,
    encryptedAtRest: row.encrypted_at_rest === 1,
    exportEncryption: row.export_encryption,
  };
}
