import { canonicalizeJson, computeNodeContentHash, formatEntityId, normalizeNfc } from "./canonical.js";
import {
  DanglingReferenceError,
  DuplicateCurrentEdgeError,
  DuplicateLogicalNameError,
  DuplicateNodeIdError,
  EdgeIntervalError,
  EdgeNotCurrentError,
  HistoryDriftError,
  InvalidBasisError,
  InvalidCursorError,
  InvalidProposalError,
  KnowledgeBarrierError,
  KnowledgeGraphError,
  NodeDeletionForbiddenError,
  NodeVersionGuardError,
  StaleReadSetError,
  UnknownNodeError,
  UnknownNodeVersionError,
  type StaleRead,
} from "./errors.js";
import type { QueryCatalog } from "./query-catalog.js";
import type { SqlConnection, SqlRow, SqlStatement, SqlValue } from "./sql.js";
import type {
  ChangeSetProposal,
  ChangeSetRead,
  CommitChangeSetResult,
  EdgeAsOf,
  EdgeCreate,
  EdgeMutation,
  EdgePage,
  EdgePageQuery,
  EdgeRetire,
  EvidenceInput,
  EvidenceRecord,
  ImpactPartialReason,
  ImpactWalkResult,
  NodeAsOf,
  NodeCreate,
  NodeMutation,
  NodeRecord,
  SnapshotPage,
  SnapshotQuery,
  TurnInput,
  TurnRecord,
} from "./types.js";
import {
  SETTLED_BASES,
  isChangeSetOrigin,
  isEdgeType,
  isEvidenceSourceKind,
  isNodeKind,
  isNodeStatus,
  isSettledBasis,
  isTurnAuthor,
  isUpdateClass,
  type ChangeClass,
  type NodeStatus,
} from "./vocab.js";

const IMPACT_NODE_RETURN = 5000;
const IMPACT_PARTIAL_ROWS = 5001;
const IMPACT_MAX_DEPTH = 6;
const IMPACT_TIME_BUDGET_MS = 50;
const PAGE_LIMIT = 500;

interface PlannedNode {
  readonly action: "create" | "replace" | "owner" | "noop";
  readonly id: string;
  readonly kind: string;
  readonly version: number;
  readonly previousVersion: number | null;
  readonly title: string;
  readonly text: string;
  readonly fieldsJson: string;
  readonly status: NodeStatus;
  readonly ownerRole: string | null;
  readonly contentHash: string;
  readonly changeClass: ChangeClass;
}

/**
 * Atomic knowledge-graph writer. `commitChangeSet` always takes its own
 * `BEGIN IMMEDIATE` transaction and never joins a group-commit batch.
 * History rows in `node_versions` are written only by schema triggers.
 */
export class KnowledgeGraphRepo {
  private depth = 0;
  private readonly statements = new Map<string, SqlStatement>();

  constructor(
    readonly connection: SqlConnection,
    private readonly catalog: QueryCatalog,
  ) {}

  close(): void {
    this.statements.clear();
    this.connection.close();
  }

  currentRevision(): number {
    return this.readLastRev();
  }

  commitChangeSet(proposal: ChangeSetProposal): CommitChangeSetResult {
    this.assertProposal(proposal);
    if (this.depth > 0) throw new KnowledgeBarrierError();
    return this.immediate(() => {
      try {
        return this.applyCommit(proposal);
      } catch (error) {
        if (error instanceof KnowledgeGraphError) throw error;
        throw wrapSqlite(error);
      }
    });
  }

  getNode(id: string): NodeRecord | null {
    return this.readNode(id);
  }

  getNodeAsOf(id: string, rev: number): NodeAsOf | null {
    assertRev(rev);
    const found = this.cached(
      "asof-node",
      `SELECT id, version, kind, title, status FROM (${this.catalog.sql("asof_nodes")}) WHERE id = :id`,
    ).get({ rev, id });
    if (!found) return null;
    const version = mustInt(found.version);
    const history = this.cached(
      "node-version",
      `SELECT content_hash, text, fields, valid_from_rev, valid_to_rev
         FROM node_versions WHERE id = :id AND version = :version`,
    ).get({ id, version });
    if (!history) throw new HistoryDriftError(`node_versions is missing ${id}@${String(version)}`);
    return {
      id: mustString(found.id),
      version,
      kind: mustString(found.kind),
      title: mustString(found.title),
      status: mustStatus(found.status),
      text: mustString(history.text),
      fields: parseJson(mustString(history.fields)),
      contentHash: mustString(history.content_hash),
      validFromRev: mustInt(history.valid_from_rev),
      validToRev: history.valid_to_rev == null ? null : mustInt(history.valid_to_rev),
    };
  }

  getEdgesAsOf(rev: number, query: EdgePageQuery = {}): EdgePage {
    assertRev(rev);
    const limit = clampLimit(query.limit);
    const after = query.after === undefined ? { src: "", type: "", dst: "" } : decodeEdgeCursor(query.after);
    const rows = this.cached(
      "asof-edges-page",
      `SELECT src, type, dst FROM (${this.catalog.sql("asof_edges")})
        WHERE src > :after_src
           OR (src = :after_src AND type > :after_type)
           OR (src = :after_src AND type = :after_type AND dst > :after_dst)
        ORDER BY src, type, dst
        LIMIT :limit`,
    ).all({
      rev,
      after_src: after.src,
      after_type: after.type,
      after_dst: after.dst,
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const edges = rows.slice(0, limit).map(mapEdge);
    const last = edges[edges.length - 1];
    return {
      edges,
      nextCursor: hasMore && last ? encodeEdgeCursor(last) : null,
      hasMore,
    };
  }

  getSnapshotAsOf(rev: number, query: SnapshotQuery = {}): SnapshotPage {
    assertRev(rev);
    const limit = clampLimit(query.limit);
    const nodeAfter = query.nodeAfter === undefined ? "" : decodeCursor(query.nodeAfter);
    const edgeAfter = query.edgeAfter === undefined ? { src: "", type: "", dst: "" } : decodeEdgeCursor(query.edgeAfter);
    const nodeRows = this.cached(
      "asof-nodes-page",
      `SELECT id, version, kind, title, status FROM (${this.catalog.sql("asof_nodes")})
        WHERE id > :after_id
        ORDER BY id
        LIMIT :limit`,
    ).all({ rev, after_id: nodeAfter, limit: limit + 1 });
    const edgeRows = this.cached(
      "asof-edges-page",
      `SELECT src, type, dst FROM (${this.catalog.sql("asof_edges")})
        WHERE src > :after_src
           OR (src = :after_src AND type > :after_type)
           OR (src = :after_src AND type = :after_type AND dst > :after_dst)
        ORDER BY src, type, dst
        LIMIT :limit`,
    ).all({
      rev,
      after_src: edgeAfter.src,
      after_type: edgeAfter.type,
      after_dst: edgeAfter.dst,
      limit: limit + 1,
    });
    const hasMoreNodes = nodeRows.length > limit;
    const hasMoreEdges = edgeRows.length > limit;
    const nodes = nodeRows.slice(0, limit).map((row) => ({
      id: mustString(row.id),
      version: mustInt(row.version),
      kind: mustString(row.kind),
      title: mustString(row.title),
      status: mustStatus(row.status),
    }));
    const edges = edgeRows.slice(0, limit).map(mapEdge);
    const lastNode = nodes[nodes.length - 1];
    const lastEdge = edges[edges.length - 1];
    return {
      rev,
      nodes,
      edges,
      nodesNextCursor: hasMoreNodes && lastNode ? encodeCursor(lastNode.id) : null,
      edgesNextCursor: hasMoreEdges && lastEdge ? encodeEdgeCursor(lastEdge) : null,
      hasMoreNodes,
      hasMoreEdges,
      hasMore: hasMoreNodes || hasMoreEdges,
    };
  }

  impactWalk(startId: string, maxDepth = IMPACT_MAX_DEPTH): ImpactWalkResult {
    if (!Number.isSafeInteger(maxDepth)) {
      throw new InvalidProposalError("impact depth must be an integer");
    }
    const depth = Math.min(IMPACT_MAX_DEPTH, Math.max(0, maxDepth));
    const started = performance.now();
    const rows = this.catalog.all("impact_walk", { start: startId, max_depth: depth });
    const elapsedMs = performance.now() - started;
    const sorted = rows
      .map((row) => ({ id: mustString(row.id), depth: mustInt(row.depth) }))
      .sort((left, right) => left.depth - right.depth || compareText(left.id, right.id));
    const hitNodeCap = sorted.length >= IMPACT_PARTIAL_ROWS;
    const nodes = hitNodeCap ? sorted.slice(0, IMPACT_NODE_RETURN) : sorted;
    let reason: ImpactPartialReason | undefined;
    let frontier: string[] = [];
    if (hitNodeCap) {
      reason = "node_cap_exceeded";
      frontier = this.missingInbound(nodes.map((node) => node.id));
    } else {
      const boundary = nodes.filter((node) => node.depth === depth).map((node) => node.id);
      if (boundary.length > 0) {
        const included = new Set(nodes.map((node) => node.id));
        frontier = this.missingInbound(boundary).filter((id) => !included.has(id));
        if (frontier.length > 0) reason = "depth_cap";
      }
      if (!reason && elapsedMs > IMPACT_TIME_BUDGET_MS) reason = "time_budget_exceeded";
    }
    const result: ImpactWalkResult = {
      nodes,
      partial: reason !== undefined,
      frontier,
      elapsedMs,
    };
    if (reason) return { ...result, reason };
    return result;
  }

  allocateEntityId(prefix: string): string {
    formatEntityId(prefix, 1);
    return this.immediate(() => this.allocateInside(prefix));
  }

  recordTurn(input: TurnInput): TurnRecord {
    if (!isTurnAuthor(input.author)) throw new InvalidProposalError("turn author must be developer or harness");
    if (!input.id) throw new InvalidProposalError("turn id is required");
    const createdAt = input.createdAt ?? Date.now();
    assertTimestamp(createdAt);
    const record: TurnRecord = {
      id: input.id,
      author: input.author,
      target: input.target ?? null,
      text: normalizeNfc(input.text),
      audioArtifact: input.audioArtifact == null ? null : normalizeNfc(input.audioArtifact),
      createdAt,
    };
    this.immediate(() => {
      this.connection
        .prepare(
          `INSERT INTO turns(id, author, target, text, audio_artifact, redacted, created_at)
           VALUES (:id, :author, :target, :text, :audio_artifact, 0, :created_at)`,
        )
        .run({
          id: record.id,
          author: record.author,
          target: record.target,
          text: record.text,
          audio_artifact: record.audioArtifact,
          created_at: record.createdAt,
        });
    });
    return record;
  }

  recordEvidence(input: EvidenceInput): EvidenceRecord {
    if (!isEvidenceSourceKind(input.sourceKind)) {
      throw new InvalidProposalError("evidence source_kind is not valid");
    }
    if (!Number.isSafeInteger(input.nodeVersion) || input.nodeVersion < 1) {
      throw new InvalidProposalError("evidence nodeVersion must be an integer >= 1");
    }
    const quote = normalizeNfc(input.quote);
    const locatorValue = normalizeNfc(input.locator);
    const locator = canonicalizeJson(locatorValue);
    const sourceRef = normalizeNfc(input.sourceRef);
    const sourceHash = input.sourceHash == null ? null : normalizeNfc(input.sourceHash);
    const verified = input.verified === true ? 1 : 0;
    const id = this.immediate(() => {
      const version = this.connection
        .prepare("SELECT 1 AS ok FROM node_versions WHERE id = :id AND version = :version")
        .get({ id: input.node, version: input.nodeVersion });
      if (!version) throw new UnknownNodeVersionError(input.node, input.nodeVersion);
      const inserted = this.connection
        .prepare(
          `INSERT INTO evidence(node, node_version, source_kind, source_ref, source_hash, locator, quote, verified)
           VALUES (:node, :node_version, :source_kind, :source_ref, :source_hash, :locator, :quote, :verified)`,
        )
        .run({
          node: input.node,
          node_version: input.nodeVersion,
          source_kind: input.sourceKind,
          source_ref: sourceRef,
          source_hash: sourceHash,
          locator,
          quote,
          verified,
        });
      return inserted.lastInsertRowid;
    });
    return {
      id,
      node: input.node,
      nodeVersion: input.nodeVersion,
      sourceKind: input.sourceKind,
      sourceRef,
      sourceHash,
      locator: locatorValue,
      quote,
      verified: verified === 1,
    };
  }

  exportDirtyNodes(lastRev: number): readonly string[] {
    return this.getDirtyNodesSince(lastRev);
  }

  getDirtyNodesSince(lastRev: number): readonly string[] {
    assertRev(lastRev);
    const rows = this.catalog.all("export_dirty_nodes", { last_rev: lastRev });
    const ids = new Set<string>();
    for (const row of rows) {
      const id = row.id ?? row.src;
      ids.add(mustString(id));
    }
    return [...ids].sort(compareText);
  }

  getEdgeSetVersion(nodeId: string, dir: "in" | "out", edgeType: string): number {
    if (dir !== "in" && dir !== "out") throw new InvalidProposalError("edge direction must be in or out");
    if (!isEdgeType(edgeType)) throw new InvalidProposalError(`unknown edge type ${edgeType}`);
    const row = this.connection
      .prepare(
        "SELECT version FROM edge_set_versions WHERE node = :node AND dir = :dir AND type = :type",
      )
      .get({ node: nodeId, dir, type: edgeType });
    if (!row) return 0;
    return mustInt(row.version);
  }

  private applyCommit(proposal: ChangeSetProposal): CommitChangeSetResult {
    if (proposal.id) {
      const existing = this.connection.prepare("SELECT rev FROM change_sets WHERE id = :id").get({ id: proposal.id });
      if (existing?.rev != null) {
        return {
          rev: mustInt(existing.rev),
          changeSetId: proposal.id,
          noop: false,
          idempotent: true,
        };
      }
    }
    const reads = proposal.reads ?? [];
    const stale = this.staleReads(reads);
    if (stale.length > 0) throw new StaleReadSetError(stale);
    const planned = (proposal.nodes ?? []).map((node) => this.planNode(node));
    const material = planned.some((node) => node.action !== "noop") || (proposal.edges ?? []).length > 0;
    if (!material) {
      return { rev: this.readLastRev(), changeSetId: null, noop: true, idempotent: false };
    }
    const rev = this.readLastRev() + 1;
    const changeSetId = proposal.id ?? this.allocateInside("CS-");
    const createdAt = proposal.createdAt ?? Date.now();
    this.cached(
      "insert-change-set",
      `INSERT INTO change_sets(id, rev, origin, origin_ref, author, created_at, summary)
       VALUES (:id, :rev, :origin, :origin_ref, :author, :created_at, :summary)`,
    ).run({
      id: changeSetId,
      rev,
      origin: proposal.origin,
      origin_ref: optionalText(proposal.originRef),
      author: normalizeNfc(proposal.author),
      created_at: createdAt,
      summary: optionalText(proposal.summary),
    });
    this.insertReads(changeSetId, reads);
    for (const node of planned) this.applyNode(node, changeSetId, rev);
    for (const edge of proposal.edges ?? []) {
      if (edge.op === "retire") this.retireEdge(edge, rev);
    }
    for (const edge of proposal.edges ?? []) {
      if (edge.op === "create") this.createEdge(edge, changeSetId, rev);
    }
    const bumped = this.cached("bump-rev", "UPDATE meta SET value = :rev WHERE key = 'last_rev'").run({
      rev: String(rev),
    });
    if (bumped.changes !== 1) throw new InvalidProposalError("meta.last_rev is missing");
    return { rev, changeSetId, noop: false, idempotent: false };
  }

  private planNode(mutation: NodeMutation): PlannedNode {
    if (mutation.op === "create") return this.planCreate(mutation);
    const current = this.readNode(mutation.id);
    if (!current) throw new UnknownNodeError(mutation.id);
    if (mutation.op === "retire") {
      return this.planReplacement(current, {
        title: current.title,
        text: current.text,
        fields: current.fields,
        status: mutation.status ?? "retired",
        ownerRole: current.ownerRole,
        changeClass: "retired",
      });
    }
    const status = mutation.status ?? current.status;
    const changeClass: ChangeClass = status === "retired" || status === "superseded" ? "retired" : mutation.class;
    return this.planReplacement(current, {
      title: mutation.title === undefined ? current.title : mutation.title,
      text: mutation.text === undefined ? current.text : mutation.text,
      fields: mutation.fields === undefined ? current.fields : mutation.fields,
      status,
      ownerRole: mutation.ownerRole === undefined ? current.ownerRole : mutation.ownerRole,
      changeClass,
    });
  }

  private planCreate(mutation: NodeCreate): PlannedNode {
    const id = mutation.id ?? this.allocateInside(requiredPrefix(mutation.idPrefix));
    const title = normalizeNfc(mutation.title);
    const text = normalizeNfc(mutation.text ?? "");
    const fields = normalizeNfc(mutation.fields === undefined ? {} : mutation.fields);
    this.assertBasis(fields);
    const status = mutation.status ?? "active";
    return {
      action: "create",
      id,
      kind: mutation.kind,
      version: 1,
      previousVersion: null,
      title,
      text,
      fieldsJson: canonicalizeJson(fields),
      status,
      ownerRole: optionalStoredText(mutation.ownerRole),
      contentHash: computeNodeContentHash({ kind: mutation.kind, title, text, fields }),
      changeClass: "created",
    };
  }

  private planReplacement(
    current: NodeRecord,
    next: {
      readonly title: string;
      readonly text: string;
      readonly fields: unknown;
      readonly status: NodeStatus;
      readonly ownerRole: string | null;
      readonly changeClass: ChangeClass;
    },
  ): PlannedNode {
    const title = normalizeNfc(next.title);
    const text = normalizeNfc(next.text);
    const fields = normalizeNfc(next.fields);
    this.assertBasis(fields);
    const contentHash = computeNodeContentHash({ kind: current.kind, title, text, fields });
    const ownerRole = next.ownerRole === null ? null : normalizeNfc(next.ownerRole);
    const sameContent = contentHash === current.contentHash && next.status === current.status;
    return {
      action: sameContent ? (ownerRole === current.ownerRole ? "noop" : "owner") : "replace",
      id: current.id,
      kind: current.kind,
      version: sameContent ? current.version : current.version + 1,
      previousVersion: current.version,
      title,
      text,
      fieldsJson: canonicalizeJson(fields),
      status: next.status,
      ownerRole,
      contentHash,
      changeClass: next.changeClass,
    };
  }

  private applyNode(node: PlannedNode, changeSetId: string, rev: number): void {
    if (node.action === "noop") return;
    if (node.action === "owner") {
      const updated = this.cached(
        "owner-role",
        "UPDATE nodes SET owner_role = :owner_role WHERE id = :id AND version = :version",
      ).run({ owner_role: node.ownerRole, id: node.id, version: node.version });
      if (updated.changes !== 1) throw new UnknownNodeError(node.id);
      return;
    }
    if (node.action === "create") {
      this.cached(
        "insert-node",
        `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, owner_role, change_set, created_rev, updated_rev)
         VALUES (:id, :kind, :version, :content_hash, :title, :text, :fields, :status, :owner_role, :change_set, :rev, :rev)`,
      ).run({
        id: node.id,
        kind: node.kind,
        version: node.version,
        content_hash: node.contentHash,
        title: node.title,
        text: node.text,
        fields: node.fieldsJson,
        status: node.status,
        owner_role: node.ownerRole,
        change_set: changeSetId,
        rev,
      });
    } else {
      const updated = this.cached(
        "update-node",
        `UPDATE nodes
            SET version = :version, content_hash = :content_hash, title = :title, text = :text,
                fields = :fields, status = :status, owner_role = :owner_role,
                change_set = :change_set, updated_rev = :rev
          WHERE id = :id AND version = :previous_version`,
      ).run({
        id: node.id,
        version: node.version,
        previous_version: node.previousVersion,
        content_hash: node.contentHash,
        title: node.title,
        text: node.text,
        fields: node.fieldsJson,
        status: node.status,
        owner_role: node.ownerRole,
        change_set: changeSetId,
        rev,
      });
      if (updated.changes !== 1) throw new UnknownNodeError(node.id);
    }
    this.cached(
      "insert-node-change",
      `INSERT INTO node_changes(change_set, id, old_version, new_version, class)
       VALUES (:change_set, :id, :old_version, :new_version, :class)`,
    ).run({
      change_set: changeSetId,
      id: node.id,
      old_version: node.previousVersion,
      new_version: node.version,
      class: node.changeClass,
    });
  }

  private createEdge(edge: EdgeCreate, changeSetId: string, rev: number): void {
    this.cached(
      "insert-edge",
      `INSERT INTO edges(src, type, dst, dst_version_pin, change_set, valid_from_rev)
       VALUES (:src, :type, :dst, :dst_version_pin, :change_set, :rev)`,
    ).run({
      src: edge.src,
      type: edge.type,
      dst: edge.dst,
      dst_version_pin: edge.dstVersionPin ?? null,
      change_set: changeSetId,
      rev,
    });
  }

  private retireEdge(edge: EdgeRetire, rev: number): void {
    const updated = this.cached(
      "retire-edge",
      `UPDATE edges SET valid_to_rev = :rev
        WHERE src = :src AND type = :type AND dst = :dst AND valid_to_rev IS NULL`,
    ).run({ rev, src: edge.src, type: edge.type, dst: edge.dst });
    if (updated.changes !== 1) {
      throw new EdgeNotCurrentError(`no current edge ${edge.src} -${edge.type}-> ${edge.dst}`);
    }
  }

  private insertReads(changeSetId: string, reads: readonly ChangeSetRead[]): void {
    const statement = this.cached(
      "insert-read",
      `INSERT INTO change_set_reads(change_set, target, dir, edge_type, version)
       VALUES (:change_set, :target, :dir, :edge_type, :version)`,
    );
    for (const read of reads) {
      if ("dir" in read) {
        statement.run({
          change_set: changeSetId,
          target: read.target,
          dir: read.dir,
          edge_type: read.edgeType,
          version: read.version,
        });
      } else {
        statement.run({
          change_set: changeSetId,
          target: read.target,
          dir: "",
          edge_type: "",
          version: read.version,
        });
      }
    }
  }

  private staleReads(reads: readonly ChangeSetRead[]): StaleRead[] {
    if (reads.length === 0) return [];
    const payload = JSON.stringify(
      reads.map((read) =>
        "dir" in read
          ? { id: read.target, dir: read.dir, type: read.edgeType, v: read.version }
          : { id: read.target, v: read.version },
      ),
    );
    return this.catalog.all("validate_change_set_reads", { reads: payload }).map(mapStale);
  }

  private missingInbound(included: readonly string[]): string[] {
    if (included.length === 0) return [];
    const rows = this.cached(
      "missing-inbound",
      `SELECT DISTINCT e.src AS id
         FROM edges e
         JOIN edge_types t ON t.type = e.type AND t.invalidates = 1
        WHERE e.valid_to_rev IS NULL
          AND e.dst IN (SELECT value FROM json_each(:included))
          AND e.src NOT IN (SELECT value FROM json_each(:included))
        ORDER BY e.src`,
    ).all({ included: JSON.stringify(included) });
    return rows.map((row) => mustString(row.id));
  }

  private allocateInside(prefix: string): string {
    const row = this.catalog.get("allocate_id", { prefix });
    if (!row) throw new InvalidProposalError(`allocate_id returned no row for ${prefix}`);
    return formatEntityId(prefix, mustInt(row.n));
  }

  private readLastRev(): number {
    const row = this.connection.prepare("SELECT value FROM meta WHERE key = 'last_rev'").get();
    if (!row) return 0;
    return mustInt(row.value);
  }

  private readNode(id: string): NodeRecord | null {
    const row = this.cached(
      "select-node",
      `SELECT nid, id, kind, version, content_hash, title, text, fields, status, feature, basis,
              owner_role, change_set, created_rev, updated_rev
         FROM nodes WHERE id = :id`,
    ).get({ id });
    if (!row) return null;
    return {
      nid: mustInt(row.nid),
      id: mustString(row.id),
      kind: mustString(row.kind),
      version: mustInt(row.version),
      contentHash: mustString(row.content_hash),
      title: mustString(row.title),
      text: mustString(row.text),
      fields: parseJson(mustString(row.fields)),
      status: mustStatus(row.status),
      feature: row.feature == null ? null : mustString(row.feature),
      basis: row.basis == null ? null : mustString(row.basis),
      ownerRole: row.owner_role == null ? null : mustString(row.owner_role),
      changeSetId: mustString(row.change_set),
      createdRev: mustInt(row.created_rev),
      updatedRev: mustInt(row.updated_rev),
    };
  }

  private assertProposal(proposal: ChangeSetProposal): void {
    if (!isChangeSetOrigin(proposal.origin)) throw new InvalidProposalError("unknown change set origin");
    if (typeof proposal.author !== "string" || proposal.author.length === 0) {
      throw new InvalidProposalError("author is required");
    }
    if (proposal.createdAt !== undefined) assertTimestamp(proposal.createdAt);
    if (proposal.id !== undefined && proposal.id.length === 0) throw new InvalidProposalError("change set id is empty");
    const reads = proposal.reads ?? [];
    const seenReads = new Set<string>();
    for (const read of reads) this.assertRead(read, seenReads);
    const seenNodes = new Set<string>();
    for (const node of proposal.nodes ?? []) {
      this.assertNode(node, seenNodes);
    }
    const seenEdges = new Set<string>();
    for (const edge of proposal.edges ?? []) this.assertEdge(edge, seenEdges);
  }

  private assertRead(read: ChangeSetRead, seen: Set<string>): void {
    if (typeof read.target !== "string" || read.target.length === 0) {
      throw new InvalidProposalError("read target is required");
    }
    if (!Number.isSafeInteger(read.version) || read.version < 0) {
      throw new InvalidProposalError("read version must be an integer >= 0");
    }
    const key = "dir" in read ? `${read.target}\0${read.dir}\0${read.edgeType}` : `${read.target}\0\0`;
    if (seen.has(key)) throw new InvalidProposalError(`duplicate read ${read.target}`);
    seen.add(key);
    if ("dir" in read) {
      if (read.dir !== "in" && read.dir !== "out") throw new InvalidProposalError("edge read dir must be in or out");
      if (!isEdgeType(read.edgeType)) throw new InvalidProposalError(`unknown edge type ${read.edgeType}`);
    }
  }

  private assertNode(node: NodeMutation, seen: Set<string>): void {
    if (node.op === "create") {
      if (!isNodeKind(node.kind)) throw new InvalidProposalError(`unknown node kind ${node.kind}`);
      if (typeof node.title !== "string") throw new InvalidProposalError("node title is required");
      if (node.id !== undefined && node.id.length === 0) throw new InvalidProposalError("node id is empty");
      if (node.id === undefined && (node.idPrefix === undefined || node.idPrefix.length === 0)) {
        throw new InvalidProposalError("node create requires id or idPrefix");
      }
      if (node.status !== undefined && node.status !== "draft" && node.status !== "active") {
        throw new InvalidProposalError("new nodes are draft or active; retire them in a later revision");
      }
      if (node.fields !== undefined && !isJsonObject(node.fields)) {
        throw new InvalidProposalError("node fields must be a JSON object");
      }
      this.assertBasis(node.fields === undefined ? {} : node.fields);
      const key = node.id ?? `prefix:${node.idPrefix ?? ""}:${String(seen.size)}`;
      if (node.id) {
        if (seen.has(node.id)) throw new InvalidProposalError(`duplicate node mutation ${node.id}`);
        seen.add(node.id);
      } else {
        seen.add(key);
      }
      return;
    }
    if (!node.id) throw new InvalidProposalError("node id is required");
    if (seen.has(node.id)) throw new InvalidProposalError(`duplicate node mutation ${node.id}`);
    seen.add(node.id);
    if (node.op === "update") {
      if (!isUpdateClass(node.class)) throw new InvalidProposalError("update class is not a content class");
      if (node.status !== undefined && !isNodeStatus(node.status)) throw new InvalidProposalError("unknown node status");
      if (node.fields !== undefined && !isJsonObject(node.fields)) {
        throw new InvalidProposalError("node fields must be a JSON object");
      }
      if (node.fields !== undefined) this.assertBasis(node.fields);
      return;
    }
    if (node.status !== undefined && node.status !== "retired" && node.status !== "superseded") {
      throw new InvalidProposalError("retire status must be retired or superseded");
    }
  }

  private assertEdge(edge: EdgeMutation, seen: Set<string>): void {
    if (!edge.src || !edge.dst) throw new InvalidProposalError("edge src and dst are required");
    if (!isEdgeType(edge.type)) throw new InvalidProposalError(`unknown edge type ${edge.type}`);
    const key = `${edge.op}\0${edge.src}\0${edge.type}\0${edge.dst}`;
    if (seen.has(key)) throw new InvalidProposalError(`duplicate edge ${edge.src} -${edge.type}-> ${edge.dst}`);
    seen.add(key);
    if (edge.op === "create" && edge.dstVersionPin != null) {
      if (!Number.isSafeInteger(edge.dstVersionPin) || edge.dstVersionPin < 1) {
        throw new InvalidProposalError("dstVersionPin must be an integer >= 1");
      }
    }
  }

  private assertBasis(fields: unknown): void {
    if (!isJsonObject(fields) || !Object.prototype.hasOwnProperty.call(fields, "basis")) return;
    const basis = fields.basis;
    if (typeof basis !== "string" || !isSettledBasis(basis)) {
      throw new InvalidBasisError(`fields.basis must be one of ${SETTLED_BASES.join(", ")}`);
    }
  }

  private immediate<T>(run: () => T): T {
    if (this.depth > 0) return run();
    try {
      this.connection.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isOpenTransaction(error)) throw new KnowledgeBarrierError();
      throw error;
    }
    this.depth = 1;
    try {
      const value = run();
      this.connection.exec("COMMIT");
      return value;
    } catch (error) {
      this.rollbackQuietly();
      throw error;
    } finally {
      this.depth = 0;
    }
  }

  private rollbackQuietly(): void {
    try {
      this.connection.exec("ROLLBACK");
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (!/transaction/i.test(message)) throw error;
    }
  }

  private cached(key: string, sql: string): SqlStatement {
    const existing = this.statements.get(key);
    if (existing) return existing;
    const statement = this.connection.prepare(sql);
    this.statements.set(key, statement);
    return statement;
  }
}

function mapStale(row: SqlRow): StaleRead {
  const target = mustString(row.target);
  const readVersion = mustInt(row.read_version);
  const currentVersion = row.current_version == null ? null : mustInt(row.current_version);
  if (row.dir === "in" || row.dir === "out") {
    return {
      target,
      dir: row.dir,
      edgeType: mustString(row.edge_type),
      readVersion,
      currentVersion,
    };
  }
  return { target, readVersion, currentVersion };
}

function mapEdge(row: SqlRow): EdgeAsOf {
  return { src: mustString(row.src), type: mustString(row.type), dst: mustString(row.dst) };
}

function wrapSqlite(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("node change requires version + 1")) return new NodeVersionGuardError(message);
  if (message.includes("nodes are retired, never deleted")) return new NodeDeletionForbiddenError(message);
  if (/basis/i.test(message) && /CHECK/i.test(message)) return new InvalidBasisError(message);
  if (/valid_to_rev/i.test(message) && /CHECK/i.test(message)) return new EdgeIntervalError(message);
  if (/UNIQUE constraint failed: nodes/i.test(message)) return new DuplicateNodeIdError(message);
  if (/UNIQUE constraint failed: edges/i.test(message)) return new DuplicateCurrentEdgeError(message);
  if (/UNIQUE constraint failed: names/i.test(message)) return new DuplicateLogicalNameError(message);
  if (/FOREIGN KEY constraint failed/i.test(message)) return new DanglingReferenceError(message);
  return error instanceof Error ? error : new KnowledgeGraphError("sqlite", message);
}

function optionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return normalizeNfc(value);
}

function optionalStoredText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return normalizeNfc(value);
}

function requiredPrefix(prefix: string | undefined): string {
  if (!prefix) throw new InvalidProposalError("node create requires id or idPrefix");
  formatEntityId(prefix, 1);
  return prefix;
}

function assertRev(rev: number): void {
  if (!Number.isSafeInteger(rev) || rev < 0) throw new InvalidProposalError("rev must be a non-negative integer");
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidProposalError("timestamps must be non-negative integers");
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return PAGE_LIMIT;
  if (!Number.isSafeInteger(limit)) throw new InvalidProposalError("limit must be an integer");
  if (limit < 1) return 1;
  if (limit > PAGE_LIMIT) return PAGE_LIMIT;
  return limit;
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new InvalidCursorError("malformed cursor");
  const text = Buffer.from(cursor, "base64url").toString("utf8");
  if (!text) throw new InvalidCursorError("malformed cursor");
  return text;
}

function encodeEdgeCursor(edge: EdgeAsOf): string {
  return encodeCursor(JSON.stringify([edge.src, edge.type, edge.dst]));
}

function decodeEdgeCursor(cursor: string): { src: string; type: string; dst: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeCursor(cursor));
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error;
    throw new InvalidCursorError("malformed edge cursor");
  }
  if (!Array.isArray(parsed) || parsed.length !== 3) throw new InvalidCursorError("malformed edge cursor");
  const src = parsed[0];
  const type = parsed[1];
  const dst = parsed[2];
  if (typeof src !== "string" || typeof type !== "string" || typeof dst !== "string") {
    throw new InvalidCursorError("malformed edge cursor");
  }
  return { src, type, dst };
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

function mustStatus(value: SqlValue | undefined): NodeStatus {
  const status = mustString(value);
  if (!isNodeStatus(status)) throw new HistoryDriftError(`unknown node status ${status}`);
  return status;
}

function mustString(value: SqlValue | undefined): string {
  if (typeof value !== "string") throw new InvalidProposalError(`expected text, received ${typeof value}`);
  return value;
}

function mustInt(value: SqlValue | undefined): number {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new InvalidProposalError("integer out of range");
    return number;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) return number;
  }
  throw new InvalidProposalError(`expected integer, received ${String(value)}`);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function isOpenTransaction(error: unknown): boolean {
  return error instanceof Error && /transaction/i.test(error.message);
}
