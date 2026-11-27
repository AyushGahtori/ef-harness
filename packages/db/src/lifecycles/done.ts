import type { StateConnection } from "./connection.js";
import type { FeatureDoneCheckResult, FeatureDoneEvidenceInput } from "./models.js";
import { asInt, asNullableInt, asText, parseJsonObject } from "./rows.js";
import {
  INTEGRATION_REF,
  REQUIREMENT_KINDS_FOR_DONE,
  TASK_SETTLED_STATES,
  type FeatureDoneConditionId,
} from "./states.js";

const SETTLED: ReadonlySet<string> = new Set(TASK_SETTLED_STATES);
const REQUIREMENT_KINDS: ReadonlySet<string> = new Set(REQUIREMENT_KINDS_FOR_DONE);

interface FailedBag {
  readonly ids: FeatureDoneConditionId[];
  readonly blockingCcrIds: string[];
  readonly failingRequirements: string[];
}

function coversScope(scopePrefix: string, auditedPaths: readonly string[]): boolean {
  return auditedPaths.some(
    (audited) => audited === scopePrefix || scopePrefix.startsWith(audited),
  );
}

function isScreenBearing(fieldsText: string, pageRouteCount: number): boolean {
  if (pageRouteCount > 0) return true;
  const fields = parseJsonObject(fieldsText);
  if (!fields) return false;
  if (fields.screen_bearing === true) return true;
  return Array.isArray(fields.screens) && fields.screens.length > 0;
}

/**
 * Deterministic 7-condition `DONE` gate. Reads canonical
 * `requirement_status_recompute` for condition 2. Does not write.
 */
export function evaluateFeatureDoneConditions(
  db: StateConnection,
  requirementStatusSql: string,
  evidence: FeatureDoneEvidenceInput,
): FeatureDoneCheckResult {
  const failed = new Set<FeatureDoneConditionId>();
  const blockingCcrIds: string[] = [];
  const failingRequirements: string[] = [];
  const feature = evidence.feature;

  if (!conditionTasks(db, feature)) failed.add("1");
  for (const requirement of failingRequirementIds(db, requirementStatusSql, feature)) {
    failingRequirements.push(requirement);
  }
  if (failingRequirements.length > 0) failed.add("2");
  if (!conditionStaticAudit(db, feature, evidence)) failed.add("3");
  if (!conditionJourney(db, feature, evidence)) failed.add("4");
  if (!conditionIntegration(db, feature, evidence)) failed.add("5");
  if (!conditionAccessibility(db, feature, evidence)) failed.add("6");
  for (const ccrId of openCcrIds(db, feature)) blockingCcrIds.push(ccrId);
  if (blockingCcrIds.length > 0) failed.add("7");

  const failedConditions = [...failed].sort();
  blockingCcrIds.sort();
  failingRequirements.sort();
  const bag: FailedBag = { ids: failedConditions, blockingCcrIds, failingRequirements };
  return {
    ok: bag.ids.length === 0,
    failedConditions: bag.ids,
    blockingCcrIds: bag.blockingCcrIds,
    failingRequirements: bag.failingRequirements,
  };
}

function conditionTasks(db: StateConnection, feature: string): boolean {
  const tasks = db
    .prepare(
      `SELECT t.task AS task, t.state AS state, n.version AS brief_version
         FROM task_runtime t
         JOIN nodes n ON n.id = t.task
        WHERE t.feature = :feature`,
    )
    .all({ feature });
  if (tasks.length === 0) return false;
  for (const task of tasks) {
    const taskId = asText(task, "task");
    const state = asText(task, "state");
    if (!SETTLED.has(state)) return false;
    if (state !== "MERGED_TO_FEATURE") continue;
    const briefVersion = asInt(task, "brief_version");
    const accepted = db
      .prepare(
        `SELECT 1 AS ok
           FROM attempts
          WHERE task = :task AND state = 'accepted' AND brief_version = :brief
          LIMIT 1`,
      )
      .get({ task: taskId, brief: briefVersion });
    if (!accepted) return false;
    if (!contractsCurrent(db, taskId, briefVersion)) return false;
  }
  return true;
}

function contractsCurrent(db: StateConnection, task: string, briefVersion: number): boolean {
  const edges = db
    .prepare(
      `SELECT e.dst AS contract_id, e.dst_version_pin AS pin, c.version AS current_version
         FROM edges e
         JOIN nodes c ON c.id = e.dst AND c.kind = 'contract'
        WHERE e.src = :task
          AND e.type IN ('consumes_contract', 'produces_contract')
          AND e.valid_to_rev IS NULL`,
    )
    .all({ task });
  for (const edge of edges) {
    const contractId = asText(edge, "contract_id");
    const current = asInt(edge, "current_version");
    const pin = asNullableInt(edge, "pin");
    if (pin !== null) {
      if (pin !== current) return false;
      continue;
    }
    const read = db
      .prepare(
        `SELECT 1 AS ok
           FROM read_sets rs
           JOIN attempts a ON a.id = rs.attempt
          WHERE a.task = :task
            AND a.state = 'accepted'
            AND a.brief_version = :brief
            AND rs.node = :contract
            AND rs.version = :version
          LIMIT 1`,
      )
      .get({ task, brief: briefVersion, contract: contractId, version: current });
    if (!read) return false;
  }
  return true;
}

function failingRequirementIds(db: StateConnection, requirementStatusSql: string, feature: string): string[] {
  const linked = db
    .prepare(
      `SELECT r.id AS id, r.kind AS kind
         FROM requirements r
        WHERE r.kind <> 'journey'
          AND (
            r.feature = :feature
            OR EXISTS (
              SELECT 1
                FROM task_requirements tr
                JOIN task_runtime t ON t.task = tr.task_id
               WHERE tr.requirement_id = r.id AND t.feature = :feature
            )
          )`,
    )
    .all({ feature });
  const wanted = new Set<string>();
  for (const row of linked) {
    const kind = asText(row, "kind");
    if (!REQUIREMENT_KINDS.has(kind)) continue;
    wanted.add(asText(row, "id"));
  }
  if (wanted.size === 0) return [];
  const statuses = db.prepare(requirementStatusSql).all({});
  const byId = new Map<string, string>();
  for (const row of statuses) {
    byId.set(asText(row, "requirement"), asText(row, "status"));
  }
  const failing: string[] = [];
  for (const id of wanted) {
    const status = byId.get(id);
    if (status === "passing" || status === "waived") continue;
    failing.push(id);
  }
  return failing;
}

function conditionStaticAudit(db: StateConnection, feature: string, evidence: FeatureDoneEvidenceInput): boolean {
  const audit = evidence.staticAudit;
  if (!audit.clean || !audit.integratorCommitsIncluded || audit.paths.length === 0) return false;
  if (evidence.feature !== feature) return false;
  const scopes = db
    .prepare(
      `SELECT ts.path_prefix AS path_prefix
         FROM task_scopes ts
         JOIN task_runtime t ON t.task = ts.task
        WHERE t.feature = :feature`,
    )
    .all({ feature });
  for (const scope of scopes) {
    if (!coversScope(asText(scope, "path_prefix"), audit.paths)) return false;
  }
  const audits = db
    .prepare(
      `SELECT c.id AS id, c.version AS version
         FROM nodes c
        WHERE c.kind = 'check'
          AND c.status = 'active'
          AND c.feature = :feature
          AND c.fields ->> '$.gate' = 'static_audit'`,
    )
    .all({ feature });
  for (const check of audits) {
    if (!latestCheckPassed(db, asText(check, "id"), asInt(check, "version"))) return false;
  }
  return true;
}

function conditionJourney(db: StateConnection, feature: string, evidence: FeatureDoneEvidenceInput): boolean {
  const journey = evidence.journey;
  if (!journey.passed || !journey.cleanEnvironment || journey.entryPoint.trim().length === 0) return false;
  if (evidence.feature !== feature) return false;
  const checks = db
    .prepare(
      `SELECT c.id AS id, c.version AS version
         FROM nodes c
        WHERE c.kind = 'check'
          AND c.status = 'active'
          AND c.feature = :feature
          AND c.fields ->> '$.gate' = 'feature_journey'`,
    )
    .all({ feature });
  if (checks.length === 0) return false;
  for (const check of checks) {
    if (!latestCheckPassed(db, asText(check, "id"), asInt(check, "version"))) return false;
  }
  return true;
}

function latestCheckPassed(db: StateConnection, checkId: string, version: number): boolean {
  const row = db
    .prepare(
      `SELECT cr.status AS status
         FROM check_results cr
        WHERE cr.check_id = :check AND cr.check_version = :version
        ORDER BY cr.recorded_at DESC
        LIMIT 1`,
    )
    .get({ check: checkId, version });
  return row !== undefined && asText(row, "status") === "pass";
}

function conditionIntegration(db: StateConnection, feature: string, evidence: FeatureDoneEvidenceInput): boolean {
  const merge = evidence.integrationMerge;
  if (evidence.feature !== feature) return false;
  if (merge.ref !== INTEGRATION_REF) return false;
  if (merge.mergeCommit.trim().length === 0) return false;
  if (merge.earlierDoneRegressionGreen !== true) return false;
  const earlier = db
    .prepare(
      `SELECT feature
         FROM feature_runtime
        WHERE state = 'DONE' AND feature <> :feature`,
    )
    .all({ feature });
  const regressed = new Set(merge.regressedFeatureIds);
  for (const row of earlier) {
    if (!regressed.has(asText(row, "feature"))) return false;
  }
  return true;
}

function conditionAccessibility(db: StateConnection, feature: string, evidence: FeatureDoneEvidenceInput): boolean {
  if (evidence.feature !== feature) return false;
  const node = db.prepare(`SELECT fields FROM nodes WHERE id = :feature AND kind = 'feature'`).get({ feature });
  const routes = db
    .prepare(`SELECT count(*) AS n FROM names WHERE feature = :feature AND kind = 'page_route'`)
    .get({ feature });
  const screenBearing = node !== undefined && isScreenBearing(asText(node, "fields"), routes ? asInt(routes, "n") : 0);
  if (!screenBearing) return true;
  return evidence.accessibility.seriousFindingIds.length === 0;
}

function openCcrIds(db: StateConnection, feature: string): string[] {
  const rows = db
    .prepare(
      `SELECT n.id AS id, n.fields AS fields, n.feature AS feature
         FROM nodes n
        WHERE n.kind = 'ccr' AND n.status = 'active'`,
    )
    .all({});
  const ids: string[] = [];
  for (const row of rows) {
    const fields = parseJsonObject(asText(row, "fields"));
    if (!fields || fields.status !== "open") continue;
    const id = asText(row, "id");
    const featureField = asNullableTextOrGenerated(row.feature);
    if (
      fields.from_feature === feature ||
      fields.to_feature === feature ||
      fields.target === feature ||
      fields.target === `feature:${feature}` ||
      featureField === feature ||
      ccrEdgeTouches(db, id, feature)
    ) {
      ids.push(id);
    }
  }
  return ids;
}

function asNullableTextOrGenerated(value: string | number | bigint | Uint8Array | null | undefined): string | null {
  if (typeof value === "string") return value;
  return null;
}

function ccrEdgeTouches(db: StateConnection, ccrId: string, feature: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
         FROM edges e
        WHERE e.valid_to_rev IS NULL
          AND ((e.src = :ccr AND e.dst = :feature) OR (e.src = :feature AND e.dst = :ccr))
        LIMIT 1`,
    )
    .get({ ccr: ccrId, feature });
  return row !== undefined;
}
