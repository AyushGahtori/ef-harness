import type { DatabaseSync } from "node:sqlite";
import type { InvariantFailure, InvariantReport } from "./types.js";
import {
  asText,
  foreignKeyViolations,
  namedQuery,
  runPragmaCheck,
} from "./sqlite-io.js";

const LOOKUP_SEEDS: Readonly<Record<string, readonly string[]>> = {
  node_kinds: [
    "decision",
    "spec_item",
    "edge_case",
    "rule",
    "journey",
    "contract",
    "arch_node",
    "research_fact",
    "plan",
    "feature",
    "task",
    "check",
    "waiver",
    "ccr",
    "source",
    "asset",
    "comment",
  ],
  edge_types: [
    "implements",
    "verifies",
    "consumes_contract",
    "produces_contract",
    "obeys",
    "handles_edge_case",
    "derived_from",
    "depends_on",
    "waives",
    "belongs_to",
    "documents",
    "cites",
    "comments_on",
    "supersedes",
  ],
  task_states: [
    "DRAFTED",
    "READY",
    "LEASED",
    "CODING",
    "STATIC_AUDIT",
    "CLEAN_VERIFY",
    "ACCEPTED",
    "MERGED_TO_FEATURE",
    "WAITING_INPUT",
    "PARKED",
    "ESCALATED",
    "EXHAUSTED",
    "HUMAN_OWNED",
    "SUPERSEDED",
    "CANCELLED",
  ],
  currencies: ["usd"],
  feature_states: [
    "PLANNED",
    "JIT_READY",
    "IN_WAVE",
    "LEAVES_MERGED",
    "WIRED",
    "JOURNEY_PASSED",
    "QUEUED_FOR_MERGE",
    "MERGED",
    "DONE",
    "BLOCKED",
    "REOPENED",
    "DEFERRED",
    "ABANDONED",
  ],
  project_states: [
    "DISCOVERY",
    "SPEC_COMPLETE",
    "UPFRONT_DOCS",
    "PREVIEW",
    "PHASE0",
    "WAVES",
    "COMPLETION",
    "READY_TO_LAND",
    "LANDED",
    "SHIPPING",
  ],
};

const NODES_VERSION_GUARD = `
SELECT n.id AS id
  FROM nodes n
 WHERE n.version < 1
    OR NOT EXISTS (
         SELECT 1 FROM node_versions v
          WHERE v.id = n.id AND v.version = n.version AND v.valid_to_rev IS NULL
       )
    OR EXISTS (
         SELECT 1 FROM node_versions v
          WHERE v.id = n.id AND v.version > n.version
       )
    OR (SELECT count(*) FROM node_versions v WHERE v.id = n.id) <> n.version
`;

const REQUIREMENT_ROLLUP = `
SELECT coalesce(a.feature, b.feature) AS feature
  FROM rollup_feature_requirements a
  FULL OUTER JOIN (
    SELECT coalesce(feature, '') AS feature, status, count(*) AS n
      FROM requirement_status
     GROUP BY coalesce(feature, ''), status
  ) b ON a.feature = b.feature AND a.status = b.status
 WHERE coalesce(a.n, 0) <> coalesce(b.n, 0)
`;

function failure(name: string, detail: string): InvariantFailure {
  return { name, detail };
}

function queryOrFail(db: DatabaseSync, name: string, sql: string): InvariantFailure | null {
  try {
    const rows = db.prepare(sql).all();
    if (rows.length === 0) return null;
    const sample = rows
      .slice(0, 5)
      .map((row) => JSON.stringify(row))
      .join("; ");
    return failure(name, `${rows.length} violating row(s): ${sample}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure(name, message);
  }
}

function checkLookups(db: DatabaseSync): InvariantFailure | null {
  const missing: string[] = [];
  for (const [table, seeds] of Object.entries(LOOKUP_SEEDS)) {
    let present: Set<string>;
    try {
      const key =
        table === "currencies"
          ? "code"
          : table === "node_kinds"
            ? "kind"
            : table === "edge_types"
              ? "type"
              : "state";
      const rows = db.prepare(`SELECT ${key} AS id FROM ${table}`).all();
      present = new Set(rows.map((row) => asText(row.id)).filter((id): id is string => id !== null));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      missing.push(`${table} unreadable (${message})`);
      continue;
    }
    for (const seed of seeds) {
      if (!present.has(seed)) missing.push(`${table}:${seed}`);
    }
  }
  if (missing.length === 0) return null;
  return failure("lookup_tables", missing.slice(0, 12).join(", "));
}

function checkVersionGuard(db: DatabaseSync): InvariantFailure | null {
  try {
    const trigger = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name = 'nodes_version_guard'")
      .get();
    if (!trigger) {
      return failure("nodes_version_guard", "trigger nodes_version_guard is missing");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failure("nodes_version_guard", message);
  }
  return queryOrFail(db, "nodes_version_guard", NODES_VERSION_GUARD);
}

/**
 * Full schema invariant suite. Salvage is accepted only when every check passes.
 * quick_check alone is not enough: foreign keys, rollup recount, and the
 * nodes_version_guard domain check can still reject the file.
 */
export function evaluateSchemaInvariants(db: DatabaseSync): InvariantReport {
  const failures: InvariantFailure[] = [];
  const lookups = checkLookups(db);
  if (lookups) failures.push(lookups);

  try {
    const quick = runPragmaCheck(db, "quick_check");
    if (!quick.ok) {
      failures.push(failure("quick_check", quick.messages.join("; ") || "quick_check failed"));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(failure("quick_check", message));
  }

  try {
    const violations = foreignKeyViolations(db);
    if (violations.length > 0) {
      failures.push(failure("foreign_keys", violations.slice(0, 8).join("; ")));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(failure("foreign_keys", message));
  }

  const rollup = queryOrFail(db, "rollup_recount", namedQuery("rollup_drift"));
  if (rollup) failures.push(rollup);
  const requirementRollup = queryOrFail(db, "rollup_recount", REQUIREMENT_ROLLUP);
  if (requirementRollup) failures.push(requirementRollup);

  const outbox = queryOrFail(db, "outbox_without_deliveries", namedQuery("outbox_without_deliveries"));
  if (outbox) failures.push(outbox);

  const relations = queryOrFail(db, "relations_in_fields", namedQuery("relations_in_fields"));
  if (relations) failures.push(relations);

  const versions = checkVersionGuard(db);
  if (versions) failures.push(versions);

  return { ok: failures.length === 0, failures };
}
