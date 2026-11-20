export class KnowledgeGraphError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface StaleNodeRead {
  readonly target: string;
  readonly readVersion: number;
  readonly currentVersion: number | null;
}

export interface StaleEdgeRead {
  readonly target: string;
  readonly dir: "in" | "out";
  readonly edgeType: string;
  readonly readVersion: number;
  readonly currentVersion: number | null;
}

export type StaleRead = StaleNodeRead | StaleEdgeRead;

export class StaleReadSetError extends KnowledgeGraphError {
  readonly entries: readonly StaleRead[];

  constructor(entries: readonly StaleRead[]) {
    const detail = entries
      .map((entry) => {
        const where = "dir" in entry ? ` ${entry.dir} ${entry.edgeType}` : "";
        return `${entry.target}${where} read ${String(entry.readVersion)} current ${String(entry.currentVersion)}`;
      })
      .join("; ");
    super("stale_read_set", `stale read set: ${detail}`);
    this.entries = entries;
  }
}

export class KnowledgeBarrierError extends KnowledgeGraphError {
  constructor(message = "commitChangeSet runs alone inside BEGIN IMMEDIATE and cannot join a group-commit batch") {
    super("knowledge_barrier", message);
  }
}

export class InvalidBasisError extends KnowledgeGraphError {
  constructor(message: string) {
    super("invalid_basis", message);
  }
}

export class InvalidProposalError extends KnowledgeGraphError {
  constructor(message: string) {
    super("invalid_proposal", message);
  }
}

export class EntityIdError extends KnowledgeGraphError {
  constructor(message: string) {
    super("invalid_entity_id", message);
  }
}

export class CanonicalizationError extends KnowledgeGraphError {
  constructor(code: string, message: string) {
    super(code, message);
  }
}

export class NodeVersionGuardError extends KnowledgeGraphError {
  constructor(message: string) {
    super("node_version_guard", message);
  }
}

export class NodeDeletionForbiddenError extends KnowledgeGraphError {
  constructor(message: string) {
    super("nodes_no_delete", message);
  }
}

export class DanglingReferenceError extends KnowledgeGraphError {
  constructor(message: string) {
    super("dangling_reference", message);
  }
}

export class DuplicateNodeIdError extends KnowledgeGraphError {
  constructor(message: string) {
    super("duplicate_node_id", message);
  }
}

export class DuplicateCurrentEdgeError extends KnowledgeGraphError {
  constructor(message: string) {
    super("duplicate_current_edge", message);
  }
}

export class DuplicateLogicalNameError extends KnowledgeGraphError {
  constructor(message: string) {
    super("duplicate_logical_name", message);
  }
}

export class EdgeNotCurrentError extends KnowledgeGraphError {
  constructor(message: string) {
    super("edge_not_current", message);
  }
}

export class EdgeIntervalError extends KnowledgeGraphError {
  constructor(message: string) {
    super("edge_interval", message);
  }
}

export class UnknownNodeError extends KnowledgeGraphError {
  constructor(id: string) {
    super("unknown_node", `unknown node ${id}`);
  }
}

export class UnknownNodeVersionError extends KnowledgeGraphError {
  constructor(id: string, version: number) {
    super("unknown_node_version", `node ${id} has no version ${String(version)}`);
  }
}

export class QueryCatalogError extends KnowledgeGraphError {
  constructor(message: string) {
    super("query_catalog", message);
  }
}

export class InvalidCursorError extends KnowledgeGraphError {
  constructor(message: string) {
    super("invalid_cursor", message);
  }
}

export class HistoryDriftError extends KnowledgeGraphError {
  constructor(message: string) {
    super("history_drift", message);
  }
}
