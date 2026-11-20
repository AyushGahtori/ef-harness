/**
 * Closed logical-name kinds from Task 010.
 * `packages/shared-contracts` on this branch does not export the vocabulary yet,
 * so the registry keeps the same tuple Task 010 is required to publish.
 */
export const NAME_KINDS = [
  "http_route",
  "page_route",
  "db_table",
  "db_column",
  "db_index",
  "db_constraint",
  "env_var",
  "storage_key",
  "cookie_name",
  "cache_prefix",
  "event",
  "queue",
  "job",
  "permission",
  "feature_flag",
  "i18n_namespace",
  "cli_command",
] as const;

export type NameKind = (typeof NAME_KINDS)[number];

export const ROUTE_NAME_KINDS = ["http_route", "page_route"] as const;
export type RouteNameKind = (typeof ROUTE_NAME_KINDS)[number];

export const WILDCARD_NAME_KINDS = ["cache_prefix", "permission", "i18n_namespace"] as const;
export type WildcardNameKind = (typeof WILDCARD_NAME_KINDS)[number];

/** HTTP routes, page routes, SQL identifiers, and Windows environment variables. */
export const CASE_INSENSITIVE_NAME_KINDS = [
  "http_route",
  "page_route",
  "db_table",
  "db_column",
  "db_index",
  "db_constraint",
  "env_var",
] as const;

/** Shared names are registered to the project integrator, not to a feature. */
export const SHARED_NAME_OWNERS = ["project_integrator", "shared"] as const;

const NAME_KIND_SET: ReadonlySet<string> = new Set(NAME_KINDS);
const ROUTE_KIND_SET: ReadonlySet<string> = new Set(ROUTE_NAME_KINDS);
const WILDCARD_KIND_SET: ReadonlySet<string> = new Set(WILDCARD_NAME_KINDS);
const CASE_INSENSITIVE_SET: ReadonlySet<string> = new Set(CASE_INSENSITIVE_NAME_KINDS);

export function isNameKind(value: string): value is NameKind {
  return NAME_KIND_SET.has(value);
}

export function isRouteNameKind(value: string): value is RouteNameKind {
  return ROUTE_KIND_SET.has(value);
}

export function isWildcardNameKind(value: string): value is WildcardNameKind {
  return WILDCARD_KIND_SET.has(value);
}

export function isCaseInsensitiveNameKind(kind: string): boolean {
  return CASE_INSENSITIVE_SET.has(kind);
}

export function isSharedNameOwner(feature: string | null | undefined): boolean {
  return feature === "project_integrator" || feature === "shared";
}
