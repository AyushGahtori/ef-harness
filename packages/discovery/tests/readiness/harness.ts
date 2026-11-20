import { DatabaseSync } from "node:sqlite";
import {
  DenominatorDeltaExplainer,
  BoundedDeferralPolicy,
  ReadinessCalculator,
  ReadyForHandoffGate,
  TransitivePrereqChecker,
  openReadinessDatabase,
  patchNodeFields,
} from "../../src/readiness/index.js";

export interface DecisionSeed {
  id: string;
  title: string;
  criterion?: string;
  status: string;
  basis?: string;
  mustAsk?: boolean;
  scopeId?: string;
  scopeLabel?: string;
  critical?: boolean;
  neededForPlanning?: boolean;
  value?: string;
}

export function createDb(): DatabaseSync {
  return openReadinessDatabase();
}

export function services(db: DatabaseSync, ports: ConstructorParameters<typeof ReadinessCalculator>[1] = {}) {
  const calculator = new ReadinessCalculator(db, ports);
  const explainer = new DenominatorDeltaExplainer(db);
  return {
    calculator,
    explainer,
    prereqs: new TransitivePrereqChecker(db, ports),
    deferral: new BoundedDeferralPolicy(db, ports),
    gate: new ReadyForHandoffGate(db, explainer, ports),
  };
}

function nextChange(db: DatabaseSync): { id: string; rev: number } {
  const value = db.prepare("SELECT coalesce(max(rev), 0) + 1 AS rev FROM change_sets").get() as { rev: number };
  const id = `CS-T-${value.rev}`;
  db.prepare(
    "INSERT INTO change_sets(id, rev, origin, author, created_at, summary) VALUES (?, ?, 'planner', 'test', 0, 'seed')",
  ).run(id, value.rev);
  return { id, rev: value.rev };
}

export function seedWorkItem(db: DatabaseSync, workItemId = "W1", title = "Kitchen"): void {
  db.prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES (?, 'project', ?, 'discovering', 0)").run(
    workItemId,
    title,
  );
  const change = nextChange(db);
  db.prepare("INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES (?, 1, ?, 'opening')").run(
    workItemId,
    change.rev,
  );
}

export function addDecision(db: DatabaseSync, workItemId: string, decision: DecisionSeed): void {
  const change = nextChange(db);
  const fields: Record<string, unknown> = {
    criterion: decision.criterion ?? decision.id,
    status: decision.status,
  };
  if (decision.basis !== undefined) fields.basis = decision.basis;
  if (decision.mustAsk === true) fields.must_ask = true;
  if (decision.scopeId !== undefined) fields.scopeId = decision.scopeId;
  if (decision.scopeLabel !== undefined) fields.scopeLabel = decision.scopeLabel;
  if (decision.value !== undefined) fields.value = decision.value;
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, 'decision', 1, ?, ?, '', ?, ?, ?, ?)`,
  ).run(decision.id, `h-${decision.id}-1`, decision.title, JSON.stringify(fields), change.id, change.rev, change.rev);
  db.prepare(
    "INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical) VALUES (?, 1, ?, ?, ?)",
  ).run(workItemId, decision.id, decision.neededForPlanning === false ? 0 : 1, decision.critical ? 1 : 0);
}

export function addDecisions(db: DatabaseSync, workItemId: string, decisions: readonly DecisionSeed[]): void {
  for (const decision of decisions) addDecision(db, workItemId, decision);
}

export function addFeature(
  db: DatabaseSync,
  workItemId: string,
  id: string,
  title: string,
): void {
  const change = nextChange(db);
  const fields = {
    workItem: workItemId,
    readinessState: "discovering",
    scopeId: id,
    scopeLabel: title,
  };
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, 'feature', 1, ?, ?, '', ?, ?, ?, ?)`,
  ).run(id, `h-${id}-1`, title, JSON.stringify(fields), change.id, change.rev, change.rev);
}

export function dependOn(db: DatabaseSync, src: string, dst: string): void {
  const change = nextChange(db);
  db.prepare("INSERT INTO edges(src, type, dst, change_set, valid_from_rev) VALUES (?, 'depends_on', ?, ?, ?)").run(
    src,
    dst,
    change.id,
    change.rev,
  );
}

export function seedSchemaTestR10(db: DatabaseSync): void {
  const change = nextChange(db);
  const insert = db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, 'decision', 1, ?, ?, '', ?, ?, ?, ?)`,
  );
  insert.run("D-1", "h-D-1-1", "Storage engine", JSON.stringify({ status: "settled", basis: "explicit" }), change.id, change.rev, change.rev);
  insert.run("D-2", "h-D-2-1", "Login method", JSON.stringify({ status: "open" }), change.id, change.rev, change.rev);
  insert.run("D-3", "h-D-3-1", "Analytics", JSON.stringify({ status: "open" }), change.id, change.rev, change.rev);
  db.prepare("INSERT INTO work_items(id, kind, title, status, created_at) VALUES ('W1', 'project', 'Kitchen', 'discovering', 0)").run();
  db.prepare("INSERT INTO discovery_scopes(work_item, scope_rev, created_rev, reason) VALUES ('W1', 1, ?, 'opening')").run(change.rev);
  db.prepare(
    "INSERT INTO scope_criteria(work_item, scope_rev, decision, needed_for_planning, critical) VALUES ('W1', 1, 'D-1', 1, 0), ('W1', 1, 'D-2', 1, 1), ('W1', 1, 'D-3', 0, 0)",
  ).run();
}

export function settle(db: DatabaseSync, decisionId: string, basis: string): void {
  patchNodeFields(db, {
    nodeId: decisionId,
    summary: `settle ${decisionId}`,
    patch: { status: "settled", basis },
  });
}

export function markNotApplicable(db: DatabaseSync, decisionId: string): void {
  patchNodeFields(db, {
    nodeId: decisionId,
    summary: `prune ${decisionId}`,
    patch: { status: "not_applicable" },
    removeKeys: ["basis"],
  });
}

export function workItemStatus(db: DatabaseSync, workItemId: string): string {
  const row = db.prepare("SELECT status FROM work_items WHERE id = ?").get(workItemId) as { status: string };
  return row.status;
}

export function featureState(db: DatabaseSync, featureId: string): string {
  const row = db.prepare("SELECT fields ->> '$.readinessState' AS state FROM nodes WHERE id = ?").get(featureId) as {
    state: string | null;
  };
  return row.state ?? "";
}

export function decisionStatus(db: DatabaseSync, decisionId: string): string {
  const row = db.prepare("SELECT fields ->> '$.status' AS status FROM nodes WHERE id = ?").get(decisionId) as {
    status: string;
  };
  return row.status;
}
