import { loadQueryCatalog } from "./query-catalog.js";
import { KnowledgeGraphRepo } from "./repo.js";
import { openStateConnection, readQueriesSql, type OpenStateConnectionOptions } from "./sql.js";

export { canonicalizeJson, computeNodeContentHash, formatEntityId, normalizeNfc, splitSearchText } from "./canonical.js";
export {
  CanonicalizationError,
  DanglingReferenceError,
  DuplicateCurrentEdgeError,
  DuplicateLogicalNameError,
  DuplicateNodeIdError,
  EdgeIntervalError,
  EdgeNotCurrentError,
  EntityIdError,
  HistoryDriftError,
  InvalidBasisError,
  InvalidCursorError,
  InvalidProposalError,
  KnowledgeBarrierError,
  KnowledgeGraphError,
  NodeDeletionForbiddenError,
  NodeVersionGuardError,
  QueryCatalogError,
  StaleReadSetError,
  UnknownNodeError,
  UnknownNodeVersionError,
} from "./errors.js";
export type { StaleEdgeRead, StaleNodeRead, StaleRead } from "./errors.js";
export { loadQueryCatalog, parseQueryCatalog } from "./query-catalog.js";
export type { QueryCatalog } from "./query-catalog.js";
export { bindKnowledgeGraph } from "./project-bind.js";
export { KnowledgeGraphRepo } from "./repo.js";
export { openStateConnection, readQueriesSql } from "./sql.js";
export type { OpenStateConnectionOptions, SqlConnection, SqlRow, SqlStatement, SqlValue } from "./sql.js";
export type {
  ChangeSetProposal,
  ChangeSetRead,
  CommitChangeSetResult,
  EdgeAsOf,
  EdgeCreate,
  EdgeMutation,
  EdgePage,
  EdgePageQuery,
  EdgeRetire,
  EdgeSetVersionRead,
  EvidenceInput,
  EvidenceRecord,
  ImpactNode,
  ImpactPartialReason,
  ImpactWalkResult,
  NodeAsOf,
  NodeCreate,
  NodeMutation,
  NodeRecord,
  NodeRetire,
  NodeUpdate,
  NodeVersionRead,
  SnapshotPage,
  SnapshotQuery,
  TurnInput,
  TurnRecord,
} from "./types.js";
export {
  CHANGE_CLASSES,
  CHANGE_SET_ORIGINS,
  EDGE_TYPES,
  ADDITIVE_NODE_KINDS,
  NODE_KINDS,
  NODE_STATUSES,
  SETTLED_BASES,
} from "./vocab.js";
export type {
  AdditiveNodeKind,
  ChangeClass,
  ChangeSetOrigin,
  EdgeTypeName,
  NodeKindName,
  NodeStatus,
  SettledBasis,
} from "./vocab.js";

export function openKnowledgeGraph(options: OpenStateConnectionOptions = {}): KnowledgeGraphRepo {
  const connection = openStateConnection(options);
  const catalog = loadQueryCatalog(connection, readQueriesSql());
  return new KnowledgeGraphRepo(connection, catalog);
}
