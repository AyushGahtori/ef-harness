import type { DiffTouchPort } from "./ports.js";
import {
  checkIdsFromFields,
  parseNodeFields,
  resolveRuleScope,
  scopeMatches,
} from "./rule-scope.js";
import { asRecord, asStringArray, readRowString, type SqlDatabase } from "./sql.js";

export interface CoverageCheck {
  readonly checkId: string;
  readonly fromDiffRuleIds: readonly string[];
  readonly plannedRuleIds: readonly string[];
  readonly linked: boolean;
}

export interface InScopeRule {
  readonly ruleId: string;
  readonly checkIds: readonly string[];
  readonly fromDiff: boolean;
}

export interface CoveragePlan {
  readonly plannedTouches: readonly string[];
  readonly detectedTouches: readonly string[];
  readonly unexpectedTouches: readonly string[];
  readonly checks: readonly CoverageCheck[];
  readonly rules: readonly InScopeRule[];
}

interface RuleRow {
  readonly id: string;
  readonly fields: string;
}

export function loadCoveragePlan(
  db: SqlDatabase,
  task: string,
  diffTouches: DiffTouchPort,
  payload: unknown,
  commitSha: string | null,
  attempt: string,
): CoveragePlan {
  const plannedTouches = readPlannedTouches(db, task);
  const detectedTouches = diffTouches.detectTouches({
    task,
    attempt,
    commitSha,
    payload,
  });
  const planned = new Set(plannedTouches);
  const unexpectedTouches = detectedTouches.filter((tag) => !planned.has(tag));
  const effective = new Set<string>([...plannedTouches, ...detectedTouches]);

  const linked = new Map<string, true>();
  const linkedRows = db
    .prepare(
      `SELECT DISTINCT c.check_id AS check_id
         FROM task_requirements tr
         JOIN check_requirements c ON c.requirement_id = tr.requirement_id
        WHERE tr.task_id = :task
          AND NOT EXISTS (
            SELECT 1 FROM waivers w WHERE w.requirement_id = tr.requirement_id
          )`,
    )
    .all({ task });
  for (const row of linkedRows) {
    linked.set(readRowString(row, "check_id"), true);
  }

  const rules = db
    .prepare(
      `SELECT id, fields FROM nodes WHERE kind = 'rule' AND status = 'active' ORDER BY id`,
    )
    .all()
    .map((row) => ({ id: readRowString(row, "id"), fields: readRowString(row, "fields") }));

  const inScope: InScopeRule[] = [];
  const byCheck = new Map<
    string,
    { fromDiffRuleIds: string[]; plannedRuleIds: string[]; linked: boolean }
  >();

  const ensure = (checkId: string): { fromDiffRuleIds: string[]; plannedRuleIds: string[]; linked: boolean } => {
    const existing = byCheck.get(checkId);
    if (existing) return existing;
    const created = { fromDiffRuleIds: [], plannedRuleIds: [], linked: linked.has(checkId) };
    byCheck.set(checkId, created);
    return created;
  };

  for (const checkId of linked.keys()) {
    ensure(checkId).linked = true;
  }

  for (const rule of rules) {
    const fields = parseNodeFields(rule.fields);
    const scope = resolveRuleScope(rule.id, fields);
    if (!scope) continue;
    const matchesEffective = scopeMatches(scope, effective);
    if (!matchesEffective) continue;
    const matchesPlanned = scopeMatches(scope, planned);
    const fromDiff = !matchesPlanned;
    const checkIds = uniqueCheckIds(db, rule, fields);
    inScope.push({ ruleId: rule.id, checkIds, fromDiff });
    for (const checkId of checkIds) {
      const slot = ensure(checkId);
      if (fromDiff) slot.fromDiffRuleIds.push(rule.id);
      else slot.plannedRuleIds.push(rule.id);
    }
    if (checkIds.length === 0 && fromDiff) {
      const placeholder = rule.id;
      const slot = ensure(placeholder);
      slot.fromDiffRuleIds.push(rule.id);
    }
  }

  const checks = [...byCheck.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([checkId, slot]) => ({
      checkId,
      fromDiffRuleIds: slot.fromDiffRuleIds,
      plannedRuleIds: slot.plannedRuleIds,
      linked: slot.linked,
    }));

  return {
    plannedTouches,
    detectedTouches,
    unexpectedTouches,
    checks,
    rules: inScope,
  };
}

export function currentCheckIds(plan: CoveragePlan): string[] {
  return plan.checks.map((check) => check.checkId);
}

function readPlannedTouches(db: SqlDatabase, task: string): string[] {
  const row = db.prepare(`SELECT fields FROM nodes WHERE id = :task`).get({ task });
  if (!row) return [];
  const record = asRecord(parseNodeFields(readRowString(row, "fields")));
  const touches = asStringArray(record?.touches);
  const inherited = asStringArray(record?.inherited_touches);
  return [...new Set([...touches, ...inherited])];
}

function uniqueCheckIds(db: SqlDatabase, rule: RuleRow, fields: unknown): string[] {
  const ids = new Set<string>(checkIdsFromFields(fields));
  const linked = db
    .prepare(`SELECT check_id FROM check_requirements WHERE requirement_id = :rule`)
    .all({ rule: rule.id });
  for (const row of linked) {
    ids.add(readRowString(row, "check_id"));
  }
  return [...ids].sort();
}
