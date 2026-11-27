import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { registerEfSearchText } from "@ef-harness/db";
import { canonicalAssetAbsolute, splitSearchText as splitCanonicalSearchText } from "@ef-harness/shared-contracts";
import {
  emptyForces,
  type ForceLists,
  type ReadinessCounts,
  type ReadinessPorts,
  type CanonicalReadiness,
} from "./types.js";

const CLASSIFIED = `
WITH scoped AS (
  SELECT
    n.id AS id,
    n.title AS title,
    n.fields AS fields,
    sc.critical AS critical,
    CASE
      WHEN json_extract(n.fields, '$.must_ask') IN (1, '1', 'true') OR sc.critical = 1 THEN 1
      ELSE 0
    END AS must_ask
  FROM scope_criteria sc
  JOIN nodes n ON n.id = sc.decision
  WHERE sc.work_item = :work_item
    AND sc.scope_rev = (SELECT max(scope_rev) FROM discovery_scopes WHERE work_item = :work_item)
    AND (:scope_id IS NULL OR n.fields ->> '$.scopeId' = :scope_id)
),
classed AS (
  SELECT
    scoped.*,
    CASE
      WHEN id IN (SELECT value FROM json_each(:force_conflict)) THEN 'conflict'
      WHEN id IN (SELECT value FROM json_each(:force_pending))
        OR fields ->> '$.basis' = 'proposed'
        OR fields ->> '$.status' = 'pending_verification' THEN 'pending_verification'
      WHEN fields ->> '$.status' = 'settled'
       AND fields ->> '$.basis' IN ('explicit', 'derived', 'delegated', 'defaulted', 'observed') THEN 'settled'
      WHEN fields ->> '$.status' = 'deferred' AND must_ask = 1 THEN 'open'
      WHEN fields ->> '$.status' = 'conflict' THEN 'conflict'
      WHEN fields ->> '$.status' IN ('open', 'asked') THEN 'open'
      WHEN fields ->> '$.status' IN ('deferred', 'partial', 'missing', 'not_applicable') THEN fields ->> '$.status'
      ELSE 'open'
    END AS bucket
  FROM scoped
)
`;

export const READINESS_COUNTS_SQL = `
${CLASSIFIED}
SELECT
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' = 'explicit' THEN 1 ELSE 0 END), 0) AS settled_explicit,
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' = 'derived' THEN 1 ELSE 0 END), 0) AS settled_derived,
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' = 'delegated' THEN 1 ELSE 0 END), 0) AS settled_delegated,
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' = 'defaulted' THEN 1 ELSE 0 END), 0) AS settled_defaulted,
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' = 'observed' THEN 1 ELSE 0 END), 0) AS settled_observed,
  coalesce(sum(CASE WHEN bucket = 'settled' THEN 1 ELSE 0 END), 0) AS settled_total,
  coalesce(sum(CASE WHEN bucket = 'settled' AND fields ->> '$.basis' IN ('delegated', 'defaulted') THEN 1 ELSE 0 END), 0) AS chosen_for_you,
  coalesce(sum(CASE WHEN bucket = 'pending_verification' THEN 1 ELSE 0 END), 0) AS pending_verification,
  coalesce(sum(CASE WHEN bucket = 'open' AND must_ask = 1 THEN 1 ELSE 0 END), 0) AS open_must_ask,
  coalesce(sum(CASE WHEN bucket = 'open' AND must_ask = 0 THEN 1 ELSE 0 END), 0) AS open_standard,
  coalesce(sum(CASE WHEN bucket = 'partial' THEN 1 ELSE 0 END), 0) AS partial,
  coalesce(sum(CASE WHEN bucket = 'missing' THEN 1 ELSE 0 END), 0) AS missing,
  coalesce(sum(CASE WHEN bucket = 'conflict' THEN 1 ELSE 0 END), 0) AS conflict,
  coalesce(sum(CASE WHEN bucket = 'deferred' THEN 1 ELSE 0 END), 0) AS deferred,
  coalesce(sum(CASE WHEN bucket = 'not_applicable' THEN 1 ELSE 0 END), 0) AS not_applicable,
  coalesce(sum(CASE WHEN bucket <> 'not_applicable' THEN 1 ELSE 0 END), 0) AS active_denominator,
  count(*) AS criterion_count,
  coalesce(sum(CASE WHEN bucket IN ('open', 'conflict', 'pending_verification', 'partial', 'missing') THEN 1 ELSE 0 END), 0) AS blocking_count,
  coalesce(sum(CASE WHEN must_ask = 0 AND bucket <> 'not_applicable' THEN 1 ELSE 0 END), 0) AS non_must_ask_pool
FROM classed
`;

const BLOCKER_SQL = `
${CLASSIFIED}
SELECT
  id,
  title,
  coalesce(fields ->> '$.criterion', id) AS criterion_id,
  coalesce(fields ->> '$.scopeId', '') AS scope_id,
  bucket,
  must_ask
FROM classed
WHERE bucket IN ('open', 'conflict', 'pending_verification', 'partial', 'missing')
ORDER BY id
`;

const ACTIVE_SQL = `
${CLASSIFIED}
SELECT
  id,
  coalesce(fields ->> '$.scopeId', '') AS scope_id,
  coalesce(fields ->> '$.scopeLabel', fields ->> '$.scopeId', 'items') AS label
FROM classed
WHERE bucket <> 'not_applicable'
ORDER BY id
`;

const DECISION_IDS_SQL = `
${CLASSIFIED}
SELECT id FROM classed ORDER BY id
`;

const ONE_SQL = `
${CLASSIFIED}
SELECT
  id,
  title,
  coalesce(fields ->> '$.criterion', id) AS criterion_id,
  coalesce(fields ->> '$.scopeId', '') AS scope_id,
  bucket,
  must_ask,
  fields ->> '$.status' AS stored_status,
  fields ->> '$.deferred_reason' AS deferred_reason,
  fields ->> '$.revisit_wave' AS revisit_wave
FROM classed
WHERE id = :decision_id
`;

const DEFERRED_SQL = `
${CLASSIFIED}
SELECT
  id,
  title,
  coalesce(fields ->> '$.criterion', id) AS criterion_id,
  coalesce(fields ->> '$.scopeId', '') AS scope_id,
  bucket,
  must_ask,
  fields ->> '$.status' AS stored_status,
  coalesce(fields ->> '$.deferred_reason', '') AS deferred_reason,
  coalesce(fields ->> '$.revisit_wave', '') AS revisit_wave
FROM classed
WHERE bucket = 'deferred'
ORDER BY id
`;

export interface ClassedCriterion {
  id: string;
  title: string;
  criterionId: string;
  scopeId: string;
  bucket: string;
  mustAsk: boolean;
  storedStatus: string;
  deferredReason: string;
  revisitWave: string;
}

export interface ActiveCriterion {
  id: string;
  scopeId: string;
  label: string;
}

interface SqlRow {
  [key: string]: string | number | bigint | null | undefined;
}

let queryCatalog: Map<string, string> | undefined;

export function splitSearchText(value: unknown): string {
  return splitCanonicalSearchText(value);
}

export function ensureSearchText(db: DatabaseSync): void {
  try {
    db.prepare("SELECT ef_search_text('ok') AS t").get();
  } catch {
    registerEfSearchText(db);
  }
}

export function openReadinessDatabase(filename = ":memory:"): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  ensureSearchText(db);
  db.exec(fs.readFileSync(canonicalAssetAbsolute("stateSql"), "utf8"));
  return db;
}

export function namedQuery(name: string): string {
  if (!queryCatalog) {
    queryCatalog = parseQueryCatalog(fs.readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8"));
  }
  const sql = queryCatalog.get(name);
  if (!sql) {
    throw new Error(`missing named query ${name}`);
  }
  return sql;
}

function parseQueryCatalog(text: string): Map<string, string> {
  const catalog = new Map<string, string>();
  for (const block of text.split(/^-- name: /m).slice(1)) {
    const [name, ...rest] = block.split("\n");
    const sql = rest
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
      .replace(/;\s*$/, "");
    catalog.set((name ?? "").trim(), sql);
  }
  return catalog;
}

function asRow(value: unknown): SqlRow {
  if (!value || typeof value !== "object") {
    throw new Error("expected a SQL row");
  }
  return value as SqlRow;
}

function cellNumber(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`expected a number for ${key}`);
}

function cellString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (value == null) return "";
  throw new Error(`expected a string for ${key}`);
}

export interface TallyArgs {
  workItemId: string;
  scopeId: string | null;
  forces: ForceLists;
}

function bindScope(args: TallyArgs, decisionId?: string): Record<string, string | null> {
  const params: Record<string, string | null> = {
    work_item: args.workItemId,
    scope_id: args.scopeId,
    force_pending: args.forces.pending,
    force_conflict: args.forces.conflict,
  };
  if (decisionId !== undefined) params.decision_id = decisionId;
  return params;
}

export function collectForces(
  db: DatabaseSync,
  ports: ReadinessPorts,
  workItemId: string,
  scopeId: string | null,
): ForceLists {
  const entailment = ports.entailment;
  if (!entailment) return emptyForces();
  const rows = db
    .prepare(DECISION_IDS_SQL)
    .all(bindScope({ workItemId, scopeId, forces: emptyForces() }));
  const pending: string[] = [];
  const conflict: string[] = [];
  for (const value of rows) {
    const id = cellString(asRow(value), "id");
    let verdict: ReturnType<typeof entailment.verdict>;
    try {
      verdict = entailment.verdict(id);
    } catch {
      pending.push(id);
      continue;
    }
    if (verdict === "pending" || verdict === "unavailable") pending.push(id);
    else if (verdict === "contradicts") conflict.push(id);
  }
  return { pending: JSON.stringify(pending), conflict: JSON.stringify(conflict) };
}

export function queryCounts(db: DatabaseSync, args: TallyArgs): ReadinessCounts {
  const row = asRow(db.prepare(READINESS_COUNTS_SQL).get(bindScope(args)));
  return {
    settledExplicit: cellNumber(row, "settled_explicit"),
    settledDerived: cellNumber(row, "settled_derived"),
    settledDelegated: cellNumber(row, "settled_delegated"),
    settledDefaulted: cellNumber(row, "settled_defaulted"),
    settledObserved: cellNumber(row, "settled_observed"),
    pendingVerification: cellNumber(row, "pending_verification"),
    openMustAsk: cellNumber(row, "open_must_ask"),
    openStandard: cellNumber(row, "open_standard"),
    partial: cellNumber(row, "partial"),
    missing: cellNumber(row, "missing"),
    conflict: cellNumber(row, "conflict"),
    deferred: cellNumber(row, "deferred"),
    notApplicable: cellNumber(row, "not_applicable"),
    activeDenominator: cellNumber(row, "active_denominator"),
    settledTotal: cellNumber(row, "settled_total"),
    chosenForYou: cellNumber(row, "chosen_for_you"),
    criterionCount: cellNumber(row, "criterion_count"),
    blockingCount: cellNumber(row, "blocking_count"),
    nonMustAskPool: cellNumber(row, "non_must_ask_pool"),
  };
}

export function queryCanonical(db: DatabaseSync, workItemId: string): CanonicalReadiness {
  const row = asRow(db.prepare(namedQuery("readiness")).get({ work_item: workItemId }));
  return {
    planningTotal: cellNumber(row, "planning_total"),
    planningSettled: cellNumber(row, "planning_settled"),
    overallTotal: cellNumber(row, "overall_total"),
    overallSettled: cellNumber(row, "overall_settled"),
    criticalOpen: cellNumber(row, "critical_open"),
  };
}

export function queryBlockers(db: DatabaseSync, args: TallyArgs): ClassedCriterion[] {
  return db
    .prepare(BLOCKER_SQL)
    .all(bindScope(args))
    .map((value) => mapClassed(asRow(value), false));
}

export function queryActiveCriteria(db: DatabaseSync, args: TallyArgs): ActiveCriterion[] {
  return db
    .prepare(ACTIVE_SQL)
    .all(bindScope(args))
    .map((value) => {
      const row = asRow(value);
      return {
        id: cellString(row, "id"),
        scopeId: cellString(row, "scope_id"),
        label: cellString(row, "label"),
      };
    });
}

export function queryOneCriterion(
  db: DatabaseSync,
  args: TallyArgs,
  decisionId: string,
): ClassedCriterion | null {
  const value = db.prepare(ONE_SQL).get(bindScope(args, decisionId));
  if (!value) return null;
  return mapClassed(asRow(value), true);
}

export function queryDeferred(db: DatabaseSync, args: TallyArgs): ClassedCriterion[] {
  return db
    .prepare(DEFERRED_SQL)
    .all(bindScope(args))
    .map((value) => mapClassed(asRow(value), true));
}

function mapClassed(row: SqlRow, withDeferral: boolean): ClassedCriterion {
  return {
    id: cellString(row, "id"),
    title: cellString(row, "title"),
    criterionId: cellString(row, "criterion_id"),
    scopeId: cellString(row, "scope_id"),
    bucket: cellString(row, "bucket"),
    mustAsk: cellNumber(row, "must_ask") === 1,
    storedStatus: withDeferral ? cellString(row, "stored_status") : "",
    deferredReason: withDeferral ? cellString(row, "deferred_reason") : "",
    revisitWave: withDeferral ? cellString(row, "revisit_wave") : "",
  };
}

export function listFeatureIds(db: DatabaseSync, workItemId: string): string[] {
  return db
    .prepare(
      `SELECT id FROM nodes
        WHERE kind = 'feature' AND status = 'active' AND fields ->> '$.workItem' = ?
        ORDER BY nid`,
    )
    .all(workItemId)
    .map((value) => cellString(asRow(value), "id"));
}

export function ancestorScopeIds(db: DatabaseSync, scopeId: string): string[] {
  return db
    .prepare(
      `WITH RECURSIVE anc(id) AS (
         SELECT e.dst
           FROM edges e
           JOIN nodes n ON n.id = e.dst AND n.kind = 'feature'
          WHERE e.src = :scope_id
            AND e.type = 'depends_on'
            AND e.valid_to_rev IS NULL
         UNION
         SELECT e.dst
           FROM edges e
           JOIN nodes n ON n.id = e.dst AND n.kind = 'feature'
           JOIN anc ON anc.id = e.src
          WHERE e.type = 'depends_on'
            AND e.valid_to_rev IS NULL
       )
       SELECT id FROM anc ORDER BY id`,
    )
    .all({ scope_id: scopeId })
    .map((value) => cellString(asRow(value), "id"));
}

export function dependentScopeTitles(db: DatabaseSync, decisionId: string): string[] {
  return db
    .prepare(
      `SELECT f.title AS title
         FROM edges e
         JOIN nodes f ON f.id = e.src AND f.kind = 'feature' AND f.status = 'active'
        WHERE e.dst = :decision_id
          AND e.type = 'depends_on'
          AND e.valid_to_rev IS NULL
          AND coalesce(f.fields ->> '$.readinessState', 'discovering') NOT IN ('deferred', 'not_applicable')
        ORDER BY f.nid`,
    )
    .all({ decision_id: decisionId })
    .map((value) => cellString(asRow(value), "title"));
}

export function sqlNumber(
  db: DatabaseSync,
  sql: string,
  params: Record<string, string | number | null>,
  key: string,
): number {
  return cellNumber(asRow(db.prepare(sql).get(params)), key);
}
