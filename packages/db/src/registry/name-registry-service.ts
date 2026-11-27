import { createHash } from "node:crypto";
import { toPrefixedSha256 } from "@ef-harness/shared-contracts";
import {
  canonicalizeName,
  canonicalizePrefix,
  namesMatch,
  parseNameList,
  prefixCovers,
  type StoredName,
} from "./canonicalize.js";
import type { RegistryDatabase } from "./database.js";
import {
  CodeNameAuditError,
  DanglingRelationError,
  DuplicateLogicalNameError,
  ForeignPrefixError,
  InvalidNameKindError,
  InvalidPublishInputError,
  PrefixOverlapError,
  RelationsInFieldsError,
  RouteShadowError,
  UnallocatedPrefixError,
  UnknownNodeError,
  WildcardOverlapError,
  type CodeNameAccess,
  type CodeNameAuditFailure,
  type RouteShadowConflict,
  type WildcardOverlapConflict,
} from "./errors.js";
import {
  isNameKind,
  isRouteNameKind,
  isSharedNameOwner,
  isWildcardNameKind,
  type NameKind,
} from "./name-kinds.js";
import { RelationsNormalizer, type NormalizedEdge } from "./relations-normalizer.js";
import {
  detectRouteShadowing,
  type RouteRegistration,
} from "./route-segment-parser.js";
import { relationsInFieldsSql } from "./state-schema.js";
import { asInteger, asNullableText, asText } from "./sql-values.js";
import {
  detectWildcardOverlap,
  type WildcardRegistration,
} from "./wildcard-overlap.js";

export interface NameInput {
  kind: string;
  value: string;
  explicitOrder?: boolean;
}

export interface PublishNodeInput {
  id: string;
  nodeKind: string;
  title: string;
  feature: string;
  text?: string;
  fields?: Readonly<Record<string, unknown>>;
  names?: readonly NameInput[];
}

export interface PublishedNode {
  id: string;
  revision: number;
  version: number;
  names: readonly StoredName[];
  edges: readonly NormalizedEdge[];
}

export interface AllocatedPrefix {
  kind: NameKind;
  prefix: string;
  feature: string;
}

export interface ExtractedCodeName {
  kind: string;
  value: string;
  access?: CodeNameAccess;
  source?: string;
}

export interface CodeNameAuditSuccess {
  ok: true;
  feature: string;
  checked: number;
}

export interface RetiredNode {
  id: string;
  releasedNames: number;
}

interface NameRow {
  kind: NameKind;
  value: string;
  ownerNode: string;
  feature: string | null;
}

interface NodePlan {
  id: string;
  nodeKind: string;
  title: string;
  text: string;
  feature: string;
  names: readonly StoredName[];
  edges: readonly NormalizedEdge[];
  fieldsJson: string;
  previousVersion: number | null;
}

const normalizer = new RelationsNormalizer();

/**
 * Resource-name registry over the trigger-maintained `names` and `name_prefixes` tables.
 * `bindNameRegistry` passes the `ProjectStateDb` writer. `openMemoryStateDb` remains
 * the in-memory schema fixture for tests.
 */
export class NameRegistryService {
  constructor(private readonly db: RegistryDatabase) {}

  allocateFeaturePrefix(input: { kind: string; prefix: string; feature: string }): AllocatedPrefix {
    if (!isNameKind(input.kind)) throw new InvalidNameKindError(input.kind);
    const kind = input.kind;
    const feature = assertToken("feature", input.feature);
    const prefix = canonicalizePrefix(kind, input.prefix);
    const existing = this.prefixRows(kind);
    const same = existing.find((row) => row.prefix === prefix && row.feature === feature);
    if (same) return same;
    const clash = existing.find(
      (row) => row.feature !== feature && prefixesOverlap(kind, row.prefix, prefix),
    );
    if (clash) {
      throw new PrefixOverlapError({
        kind,
        prefix,
        feature,
        existingPrefix: clash.prefix,
        existingFeature: clash.feature,
      });
    }
    this.db
      .prepare("INSERT INTO name_prefixes(kind, prefix, feature) VALUES (?, ?, ?)")
      .run(kind, prefix, feature);
    return { kind, prefix, feature };
  }

  validatePublishedNames(input: PublishNodeInput): void {
    this.assertNames(this.plan(input), false);
  }

  /**
   * Every name a feature registers must sit inside a prefix allocated to that feature.
   * `project_integrator` and `shared` may register names that no feature prefix covers.
   * A name inside another feature's prefix is rejected before commit.
   */
  validateNamePrefixOwnership(input: { feature: string; names: readonly NameInput[] }): void {
    const feature = assertToken("feature", input.feature);
    for (const name of parseNameList(input.names)) {
      this.assertPrefixOwnership(name, feature);
    }
  }

  detectRouteShadowing(extra: readonly RouteRegistration[] = []): RouteShadowConflict[] {
    return detectRouteShadowing([...this.loadRoutes(null), ...extra]);
  }

  detectWildcardOverlap(extra: readonly WildcardRegistration[] = []): WildcardOverlapConflict[] {
    return detectWildcardOverlap([...this.loadWildcardNames(null), ...extra]);
  }

  auditCodeNamesAgainstRegistry(input: {
    feature: string;
    names: readonly ExtractedCodeName[];
  }): CodeNameAuditSuccess {
    const feature = assertToken("feature", input.feature);
    const failures: CodeNameAuditFailure[] = [];
    for (const extracted of input.names) {
      if (!isNameKind(extracted.kind)) throw new InvalidNameKindError(extracted.kind);
      const access = normalizeAccess(extracted.access);
      const value = canonicalizeName(extracted.kind, extracted.value);
      const registered = this.findName(extracted.kind, value);
      const label = extracted.source ?? `${extracted.kind} ${value}`;
      if (!registered) {
        failures.push({
          code: "unregistered",
          kind: extracted.kind,
          value,
          feature,
          access,
          ...(extracted.source === undefined ? {} : { source: extracted.source }),
          message: `Unregistered name ${label} is a hard failure for ${feature}.`,
        });
        continue;
      }
      if (registered.feature === feature) continue;
      if (isSharedNameOwner(registered.feature) && access === "read") continue;
      failures.push({
        code: "foreign_owned",
        kind: extracted.kind,
        value,
        feature,
        access,
        ownerNode: registered.ownerNode,
        ...(registered.feature === null ? {} : { ownerFeature: registered.feature }),
        ...(extracted.source === undefined ? {} : { source: extracted.source }),
        message: `${label} is owned by ${registered.feature ?? "unknown"} (${registered.ownerNode}), not ${feature}.`,
      });
    }
    if (failures.length > 0) throw new CodeNameAuditError(failures);
    return { ok: true, feature, checked: input.names.length };
  }

  assertNoRelationsInFields(): void {
    const nodeIds = this.relationNodeIds();
    if (nodeIds.length > 0) throw new RelationsInFieldsError(nodeIds);
  }

  publishNode(input: PublishNodeInput): PublishedNode {
    let plan: NodePlan | undefined;
    try {
      return this.withImmediate(() => {
        plan = this.plan(input);
        this.assertNames(plan, true);
        const revision = this.nextRev();
        const changeSetId = this.insertChangeSet(revision, plan.id);
        const version = this.writeNode(plan, revision, changeSetId);
        this.writeEdges(plan, revision, changeSetId);
        this.assertNoRelationsInFields();
        return { id: plan.id, revision, version, names: plan.names, edges: plan.edges };
      });
    } catch (error) {
      if (plan && isUniqueNameConstraint(error)) {
        throw this.toDuplicate(error, plan.names, plan.id);
      }
      throw error;
    }
  }

  retireNode(id: string): RetiredNode {
    const nodeId = assertToken("id", id);
    return this.withImmediate(() => {
      const row = this.db
        .prepare("SELECT version, status, title, text, fields FROM nodes WHERE id = ?")
        .get(nodeId);
      if (!row) throw new UnknownNodeError(nodeId);
      const releasedNames = this.countNames(nodeId);
      if (asText(row["status"], "status") === "retired") return { id: nodeId, releasedNames: 0 };
      const version = asInteger(row["version"], "version") + 1;
      const revision = this.nextRev();
      const changeSetId = this.insertChangeSet(revision, nodeId);
      const fields = asText(row["fields"], "fields");
      const title = asText(row["title"], "title");
      const text = asText(row["text"], "text");
      const hash = contentHash([nodeId, String(version), title, text, fields, "retired"]);
      const updated = this.db
        .prepare(
          `UPDATE nodes
             SET status = 'retired', version = ?, content_hash = ?, change_set = ?, updated_rev = ?
           WHERE id = ?`,
        )
        .run(version, hash, changeSetId, revision, nodeId);
      if (asInteger(updated.changes, "changes") !== 1) throw new UnknownNodeError(nodeId);
      const remaining = this.countNames(nodeId);
      if (remaining !== 0) {
        throw new Error(`Retiring ${nodeId} left ${String(remaining)} name rows.`);
      }
      return { id: nodeId, releasedNames };
    });
  }

  private plan(input: PublishNodeInput): NodePlan {
    const id = assertToken("id", input.id);
    const feature = assertToken("feature", input.feature);
    const nodeKind = assertToken("nodeKind", input.nodeKind);
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      throw new InvalidPublishInputError("title must not be empty");
    }
    const source: Record<string, unknown> = { ...(input.fields ?? {}) };
    if ("feature" in source && source["feature"] !== feature) {
      throw new InvalidPublishInputError("fields.feature does not match the publishing feature");
    }
    source["feature"] = feature;
    if (input.names !== undefined) source["names"] = input.names.map((name) => ({ ...name }));
    const normalized = normalizer.normalize(source);
    const names = parseNameList(normalized.fields["names"]);
    const stored: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(normalized.fields)) {
      if (key === "names") continue;
      stored[key] = value;
    }
    if (names.length > 0) stored["names"] = names.map(toJsonName);
    const existing = this.db.prepare("SELECT version FROM nodes WHERE id = ?").get(id);
    return {
      id,
      nodeKind,
      title: input.title.trim(),
      text: input.text ?? "",
      feature,
      names,
      edges: normalized.edges,
      fieldsJson: JSON.stringify(stored),
      previousVersion: existing ? asInteger(existing["version"], "version") : null,
    };
  }

  private assertNames(plan: NodePlan, deferExactDuplicates: boolean): void {
    const seen = new Set<string>();
    for (const name of plan.names) {
      const key = `${name.kind}\u0000${name.value}`;
      if (seen.has(key)) throw new DuplicateLogicalNameError(name.kind, name.value, plan.id, plan.id);
      seen.add(key);
      const existing = this.findName(name.kind, name.value);
      if (existing && existing.ownerNode !== plan.id) {
        const exactStoredValue = existing.value === name.value;
        if (!exactStoredValue || !deferExactDuplicates) {
          throw new DuplicateLogicalNameError(name.kind, name.value, existing.ownerNode, plan.id);
        }
      }
    }
    this.validateNamePrefixOwnership({ feature: plan.feature, names: plan.names });
    this.assertRouteShadows(plan);
    this.assertWildcardOverlaps(plan);
    this.assertRelationTargets(plan);
  }

  private assertPrefixOwnership(name: StoredName, feature: string): void {
    const covering = this.prefixRows(name.kind).filter((row) => prefixCovers(name.kind, row.prefix, name.value));
    const foreign = covering
      .filter((row) => row.feature !== feature)
      .sort((left, right) => right.prefix.length - left.prefix.length);
    const mostSpecific = foreign[0];
    if (mostSpecific) {
      throw new ForeignPrefixError({
        kind: name.kind,
        value: name.value,
        feature,
        prefix: mostSpecific.prefix,
        prefixFeature: mostSpecific.feature,
      });
    }
    if (isSharedNameOwner(feature)) return;
    if (!covering.some((row) => row.feature === feature)) {
      throw new UnallocatedPrefixError(name.kind, name.value, feature);
    }
  }

  private assertRouteShadows(plan: NodePlan): void {
    const proposed = routeRegistrations(plan);
    if (proposed.length === 0) return;
    const conflicts = detectRouteShadowing([...this.loadRoutes(plan.id), ...proposed]).filter(
      (conflict) =>
        (conflict.left.ownerNode === plan.id || conflict.right.ownerNode === plan.id) &&
        conflict.left.canonical !== conflict.right.canonical,
    );
    if (conflicts.length > 0) throw new RouteShadowError(conflicts);
  }

  private assertWildcardOverlaps(plan: NodePlan): void {
    const proposed = wildcardRegistrations(plan);
    if (proposed.length === 0) return;
    const conflicts = detectWildcardOverlap([...this.loadWildcardNames(plan.id), ...proposed]).filter(
      (conflict) =>
        (conflict.left.ownerNode === plan.id || conflict.right.ownerNode === plan.id) &&
        conflict.left.value !== conflict.right.value,
    );
    if (conflicts.length > 0) throw new WildcardOverlapError(conflicts);
  }

  private assertRelationTargets(plan: NodePlan): void {
    for (const edge of plan.edges) {
      if (edge.dst === plan.id) continue;
      if (!this.nodeExists(edge.dst)) throw new DanglingRelationError(plan.id, edge.field, edge.dst);
    }
  }

  private writeNode(plan: NodePlan, revision: number, changeSetId: string): number {
    const version = (plan.previousVersion ?? 0) + 1;
    const hash = contentHash([
      plan.id,
      String(version),
      plan.title,
      plan.text,
      plan.fieldsJson,
      "active",
    ]);
    if (plan.previousVersion === null) {
      this.db
        .prepare(
          `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, status, change_set, created_rev, updated_rev)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .run(
          plan.id,
          plan.nodeKind,
          version,
          hash,
          plan.title,
          plan.text,
          plan.fieldsJson,
          changeSetId,
          revision,
          revision,
        );
      return version;
    }
    const updated = this.db
      .prepare(
        `UPDATE nodes
           SET kind = ?, version = ?, content_hash = ?, title = ?, text = ?, fields = ?, status = 'active',
               change_set = ?, updated_rev = ?
         WHERE id = ?`,
      )
      .run(
        plan.nodeKind,
        version,
        hash,
        plan.title,
        plan.text,
        plan.fieldsJson,
        changeSetId,
        revision,
        plan.id,
      );
    if (asInteger(updated.changes, "changes") !== 1) throw new UnknownNodeError(plan.id);
    return version;
  }

  private writeEdges(plan: NodePlan, revision: number, changeSetId: string): void {
    for (const edge of plan.edges) {
      if (!this.nodeExists(edge.dst)) throw new DanglingRelationError(plan.id, edge.field, edge.dst);
      const current = this.db
        .prepare(
          "SELECT src FROM edges WHERE src = ? AND type = ? AND dst = ? AND valid_to_rev IS NULL",
        )
        .get(plan.id, edge.type, edge.dst);
      if (current) continue;
      this.db
        .prepare(
          "INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, ?, ?, ?, ?)",
        )
        .run(plan.id, edge.type, edge.dst, changeSetId, revision);
    }
  }

  private findName(kind: NameKind, canonical: string): NameRow | undefined {
    const rows = this.db
      .prepare("SELECT kind, value, owner_node, feature FROM names WHERE kind = ?")
      .all(kind);
    for (const row of rows) {
      const value = asText(row["value"], "value");
      if (!namesMatch(kind, value, canonical)) continue;
      const storedKind = asText(row["kind"], "kind");
      if (!isNameKind(storedKind)) continue;
      return {
        kind: storedKind,
        value,
        ownerNode: asText(row["owner_node"], "owner_node"),
        feature: asNullableText(row["feature"]),
      };
    }
    return undefined;
  }

  private prefixRows(kind: NameKind): AllocatedPrefix[] {
    return this.db
      .prepare("SELECT kind, prefix, feature FROM name_prefixes WHERE kind = ?")
      .all(kind)
      .flatMap((row) => {
        const storedKind = asText(row["kind"], "kind");
        if (!isNameKind(storedKind)) return [];
        return [
          {
            kind: storedKind,
            prefix: asText(row["prefix"], "prefix"),
            feature: asText(row["feature"], "feature"),
          },
        ];
      });
  }

  private loadRoutes(exceptOwner: string | null): RouteRegistration[] {
    const rows = this.db
      .prepare(
        `SELECT n.kind AS kind, n.value AS value, n.owner_node AS owner_node, n.feature AS feature, nodes.fields AS fields
         FROM names n
         JOIN nodes ON nodes.id = n.owner_node
         WHERE n.kind IN ('http_route', 'page_route') AND nodes.status = 'active'`,
      )
      .all();
    const routes: RouteRegistration[] = [];
    for (const row of rows) {
      const ownerNode = asText(row["owner_node"], "owner_node");
      if (exceptOwner !== null && ownerNode === exceptOwner) continue;
      const kind = asText(row["kind"], "kind");
      if (!isRouteNameKind(kind)) continue;
      const value = asText(row["value"], "value");
      const registration: RouteRegistration = {
        kind,
        value,
        feature: asNullableText(row["feature"]) ?? "unassigned",
        ownerNode,
      };
      if (explicitOrderFromFields(asText(row["fields"], "fields"), kind, value)) {
        registration.explicitOrder = true;
      }
      routes.push(registration);
    }
    return routes;
  }

  private loadWildcardNames(exceptOwner: string | null): WildcardRegistration[] {
    const rows = this.db
      .prepare(
        `SELECT kind, value, owner_node, feature FROM names
         WHERE kind IN ('cache_prefix', 'permission', 'i18n_namespace')`,
      )
      .all();
    const entries: WildcardRegistration[] = [];
    for (const row of rows) {
      const ownerNode = asText(row["owner_node"], "owner_node");
      if (exceptOwner !== null && ownerNode === exceptOwner) continue;
      const kind = asText(row["kind"], "kind");
      if (!isWildcardNameKind(kind)) continue;
      entries.push({
        kind,
        value: asText(row["value"], "value"),
        feature: asNullableText(row["feature"]) ?? "unassigned",
        ownerNode,
      });
    }
    return entries;
  }

  private relationNodeIds(): string[] {
    return this.db
      .prepare(relationsInFieldsSql())
      .all()
      .map((row) => asText(row["id"], "id"));
  }

  private nodeExists(id: string): boolean {
    return this.db.prepare("SELECT id FROM nodes WHERE id = ?").get(id) !== undefined;
  }

  private countNames(ownerNode: string): number {
    const row = this.db.prepare("SELECT count(*) AS c FROM names WHERE owner_node = ?").get(ownerNode);
    return asInteger(row?.["c"], "names");
  }

  private nextRev(): number {
    const row = this.db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM change_sets").get();
    return asInteger(row?.["rev"], "rev") + 1;
  }

  private insertChangeSet(revision: number, nodeId: string): string {
    const id = `NR-${String(revision)}-${nodeId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    this.db
      .prepare(
        "INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES (?, ?, 'kernel', 'name-registry', ?, ?)",
      )
      .run(id, revision, Date.now(), `Publish ${nodeId}`);
    return id;
  }

  private toDuplicate(error: Error, names: readonly StoredName[], attemptedOwner: string): DuplicateLogicalNameError {
    for (const name of names) {
      const existing = this.findName(name.kind, name.value);
      if (existing && existing.ownerNode !== attemptedOwner) {
        return new DuplicateLogicalNameError(name.kind, name.value, existing.ownerNode, attemptedOwner, error);
      }
    }
    const first = names[0];
    return new DuplicateLogicalNameError(
      first?.kind ?? "unknown",
      first?.value ?? "",
      attemptedOwner,
      attemptedOwner,
      error,
    );
  }

  private withImmediate<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = body();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  private rollback(): void {
    try {
      this.db.exec("ROLLBACK");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no transaction is active/i.test(message)) {
        throw error instanceof Error ? error : new Error(message);
      }
    }
  }
}

export function createNameRegistryService(db: RegistryDatabase): NameRegistryService {
  return new NameRegistryService(db);
}

function prefixesOverlap(kind: NameKind, left: string, right: string): boolean {
  return prefixCovers(kind, left, right) || prefixCovers(kind, right, left);
}

function routeRegistrations(plan: NodePlan): RouteRegistration[] {
  const routes: RouteRegistration[] = [];
  for (const name of plan.names) {
    if (!isRouteNameKind(name.kind)) continue;
    const registration: RouteRegistration = {
      kind: name.kind,
      value: name.value,
      feature: plan.feature,
      ownerNode: plan.id,
    };
    if (name.explicitOrder === true) registration.explicitOrder = true;
    routes.push(registration);
  }
  return routes;
}

function wildcardRegistrations(plan: NodePlan): WildcardRegistration[] {
  const entries: WildcardRegistration[] = [];
  for (const name of plan.names) {
    if (!isWildcardNameKind(name.kind)) continue;
    entries.push({
      kind: name.kind,
      value: name.value,
      feature: plan.feature,
      ownerNode: plan.id,
    });
  }
  return entries;
}

function toJsonName(name: StoredName): Record<string, unknown> {
  const json: Record<string, unknown> = { kind: name.kind, value: name.value };
  if (name.explicitOrder === true) json["explicitOrder"] = true;
  return json;
}

function explicitOrderFromFields(fieldsJson: string, kind: string, value: string): boolean {
  try {
    const parsed = JSON.parse(fieldsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const names = (parsed as Record<string, unknown>)["names"];
    if (!Array.isArray(names)) return false;
    return names.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const record = entry as Record<string, unknown>;
      return record["kind"] === kind && record["value"] === value && record["explicitOrder"] === true;
    });
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
}

function contentHash(parts: readonly string[]): string {
  const bare = createHash("sha256").update(parts.join("\u001e")).digest("hex");
  return toPrefixedSha256(bare);
}

function assertToken(label: string, value: string): string {
  if (typeof value !== "string" || value.length === 0 || /\s/.test(value)) {
    throw new InvalidPublishInputError(`${label} must be a non-empty token`);
  }
  return value;
}

function normalizeAccess(value: string | undefined): CodeNameAccess {
  if (value === undefined || value === "read") return "read";
  if (value === "write" || value === "define") return value;
  throw new InvalidPublishInputError(`Unsupported name access ${JSON.stringify(value)}`);
}

function isUniqueNameConstraint(error: unknown): error is Error {
  return (
    error instanceof Error && error.message.includes("UNIQUE constraint failed: names.kind, names.value")
  );
}
