export {
  CodeNameAuditError,
  DanglingRelationError,
  DuplicateLogicalNameError,
  ForeignPrefixError,
  InvalidNameKindError,
  InvalidNameValueError,
  InvalidPublishInputError,
  InvalidRelationError,
  NameRegistryError,
  PrefixOverlapError,
  RelationsInFieldsError,
  RouteShadowError,
  UnallocatedPrefixError,
  UnknownNodeError,
  WildcardOverlapError,
} from "./errors.js";
export type {
  CodeNameAccess,
  CodeNameAuditFailure,
  RouteShadowCode,
  RouteShadowConflict,
  RouteShadowSide,
  WildcardOverlapConflict,
  WildcardOverlapSide,
} from "./errors.js";

export {
  CASE_INSENSITIVE_NAME_KINDS,
  NAME_KINDS,
  ROUTE_NAME_KINDS,
  SHARED_NAME_OWNERS,
  WILDCARD_NAME_KINDS,
  isCaseInsensitiveNameKind,
  isNameKind,
  isRouteNameKind,
  isSharedNameOwner,
  isWildcardNameKind,
} from "./name-kinds.js";
export type { NameKind, RouteNameKind, WildcardNameKind } from "./name-kinds.js";

export { detectRouteShadowing, RouteSegmentParser } from "./route-segment-parser.js";
export type { ParsedRoute, RouteRegistration, RouteSegment } from "./route-segment-parser.js";

export { detectWildcardOverlap } from "./wildcard-overlap.js";
export type { WildcardRegistration } from "./wildcard-overlap.js";

export {
  RELATION_FIELD_TO_EDGE_TYPE,
  RelationsNormalizer,
  normalizeRelations,
} from "./relations-normalizer.js";
export type {
  NormalizedEdge,
  NormalizedRelations,
  RelationEdgeType,
  RelationField,
} from "./relations-normalizer.js";

export { openMemoryStateDb, relationsInFieldsSql } from "./state-schema.js";

export {
  NameRegistryService,
  createNameRegistryService,
} from "./name-registry-service.js";
export type {
  AllocatedPrefix,
  CodeNameAuditSuccess,
  ExtractedCodeName,
  NameInput,
  PublishedNode,
  PublishNodeInput,
  RetiredNode,
} from "./name-registry-service.js";
