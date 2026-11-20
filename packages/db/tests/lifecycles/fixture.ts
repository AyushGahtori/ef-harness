import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalStateSqlPath,
  createLifecycleRepo,
  type FeatureDoneEvidenceInput,
  type LifecycleRepo,
  type StateConnection,
} from "../../src/lifecycles/index.js";

export interface HarnessHandle {
  readonly db: DatabaseSync;
  readonly repo: LifecycleRepo;
  close(): void;
}

export interface OutboxEvent {
  readonly id: string;
  readonly type: string;
  readonly subject: string | null;
  readonly rev: number | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly consumers: readonly string[];
}

function searchText(value: string | null): string {
  if (!value) return "";
  const extra = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-./:]+/g, " ");
  return `${value} ${extra}`;
}

export function openLifecycle(): HarnessHandle {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.function("ef_search_text", { deterministic: true }, searchText);
  db.exec(readFileSync(canonicalStateSqlPath(), "utf8"));
  db.prepare(
    "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES ('CS-1', 1, 'kernel', 'test', 0)",
  ).run();
  db.prepare(
    `INSERT INTO project_runtime(id, state, current_wave, paused, updated_rev)
     VALUES (1, 'DISCOVERY', NULL, 0, 0)`,
  ).run();
  const repo = createLifecycleRepo(db as unknown as StateConnection);
  return {
    db,
    repo,
    close() {
      db.close();
    },
  };
}

export function insertChangeSet(db: DatabaseSync, id: string, rev: number): void {
  db.prepare(
    "INSERT INTO change_sets(id, rev, origin, author, created_at) VALUES (?, ?, 'kernel', 'test', 0)",
  ).run(id, rev);
}

export function insertNode(
  db: DatabaseSync,
  id: string,
  kind: string,
  fields: Readonly<Record<string, unknown>> = {},
  title = id,
): void {
  db.prepare(
    `INSERT INTO nodes(id, kind, version, content_hash, title, text, fields, change_set, created_rev, updated_rev)
     VALUES (?, ?, 1, ?, ?, '', ?, 'CS-1', 1, 1)`,
  ).run(id, kind, `h-${id}`, title, JSON.stringify(fields));
}

export function insertEdge(
  db: DatabaseSync,
  src: string,
  type: string,
  dst: string,
  pin: number | null = null,
): void {
  db.prepare(
    `INSERT INTO edges(src, type, dst, dst_version_pin, change_set, valid_from_rev)
     VALUES (?, ?, ?, ?, 'CS-1', 1)`,
  ).run(src, type, dst, pin);
}

export function insertTask(
  db: DatabaseSync,
  task: string,
  feature: string,
  state: string,
  fields: Readonly<Record<string, unknown>>,
): void {
  insertNode(db, task, "task", { feature, ...fields });
  db.prepare(
    `INSERT INTO task_runtime(task, feature, state, level, epoch, updated_rev)
     VALUES (?, ?, ?, 'Mid', 1, 1)`,
  ).run(task, feature, state);
}

export function insertAttempt(db: DatabaseSync, attempt: string, task: string, briefVersion = 1): void {
  db.prepare(
    `INSERT INTO attempts(
       id, task, n, epoch, brief_version, runtime, model, connection, base_commit, state, started_at
     ) VALUES (?, ?, 1, 1, ?, 'own', 'm', 'c', 'abc', 'accepted', 1)`,
  ).run(attempt, task, briefVersion);
}

export function insertCheckResult(
  db: DatabaseSync,
  checkId: string,
  attempt: string,
  status = "pass",
  version = 1,
): void {
  db.prepare(
    `INSERT INTO check_results(check_id, attempt, check_version, artifact_digest, status, recorded_at)
     VALUES (?, ?, ?, 'digest', ?, 10)`,
  ).run(checkId, attempt, version, status);
}

export function insertFeatureRuntime(
  db: DatabaseSync,
  feature: string,
  state: string,
  epoch = 1,
  holder = "author",
): void {
  db.prepare(
    `INSERT INTO feature_runtime(feature, state, wave, integration_holder, epoch, branch, updated_rev)
     VALUES (?, ?, 1, ?, ?, ?, 1)`,
  ).run(feature, state, holder, epoch, `harness/f/${feature}`);
}

export interface GreenFeatureOptions {
  readonly feature?: string;
  readonly screenBearing?: boolean;
  readonly leafState?: string;
  readonly wiringState?: string;
  readonly insertRuntime?: boolean;
  readonly runtimeState?: string;
  readonly epoch?: number;
}

export interface GreenFeatureIds {
  readonly feature: string;
  readonly leaf: string;
  readonly wiring: string;
  readonly spec: string;
  readonly edgeCase: string;
  readonly rule: string;
  readonly specCheck: string;
  readonly journeyCheck: string;
  readonly contract: string;
  readonly attempt: string;
  readonly scope: string;
}

export function greenIds(feature = "F1"): GreenFeatureIds {
  return {
    feature,
    leaf: `${feature}T`,
    wiring: `${feature}W`,
    spec: `${feature}SI`,
    edgeCase: `${feature}EC`,
    rule: `${feature}RU`,
    specCheck: `${feature}CK`,
    journeyCheck: `${feature}J`,
    contract: `${feature}C`,
    attempt: `${feature}A`,
    scope: `src/app/${feature}/`,
  };
}

export function seedGreenFeature(db: DatabaseSync, options: GreenFeatureOptions = {}): GreenFeatureIds {
  const feature = options.feature ?? "F1";
  const ids = greenIds(feature);
  insertNode(db, feature, "feature", {
    feature,
    screen_bearing: options.screenBearing === true,
  });
  insertTask(db, ids.leaf, feature, options.leafState ?? "MERGED_TO_FEATURE", { task_type: "leaf" });
  insertTask(db, ids.wiring, feature, options.wiringState ?? "CANCELLED", { task_type: "wiring" });
  insertNode(db, ids.spec, "spec_item", { feature, risk: "low" });
  insertNode(db, ids.edgeCase, "edge_case", { feature, risk: "low" });
  insertNode(db, ids.rule, "rule", { feature, risk: "low" });
  insertNode(db, ids.specCheck, "check", { feature });
  insertNode(db, `${feature}CE`, "check", { feature });
  insertNode(db, `${feature}CR`, "check", { feature });
  insertNode(db, ids.journeyCheck, "check", { feature, gate: "feature_journey" });
  insertNode(db, ids.contract, "contract", { feature });
  insertNode(db, `${feature}X`, "ccr", { from_feature: feature, status: "closed", target: "entity:orders" });
  insertEdge(db, ids.leaf, "implements", ids.spec);
  insertEdge(db, ids.leaf, "handles_edge_case", ids.edgeCase);
  insertEdge(db, ids.leaf, "obeys", ids.rule);
  insertEdge(db, ids.leaf, "consumes_contract", ids.contract, 1);
  insertEdge(db, ids.specCheck, "verifies", ids.spec);
  insertEdge(db, `${feature}CE`, "verifies", ids.edgeCase);
  insertEdge(db, `${feature}CR`, "verifies", ids.rule);
  insertAttempt(db, ids.attempt, ids.leaf, 1);
  insertCheckResult(db, ids.specCheck, ids.attempt);
  insertCheckResult(db, `${feature}CE`, ids.attempt);
  insertCheckResult(db, `${feature}CR`, ids.attempt);
  insertCheckResult(db, ids.journeyCheck, ids.attempt);
  db.prepare(`INSERT INTO task_scopes(task, path_prefix) VALUES (?, ?)`).run(ids.leaf, ids.scope);
  if (options.insertRuntime !== false) {
    insertFeatureRuntime(db, feature, options.runtimeState ?? "MERGED", options.epoch ?? 1);
  }
  return ids;
}

export function passingEvidence(feature = "F1", regressed: readonly string[] = []): FeatureDoneEvidenceInput {
  const ids = greenIds(feature);
  return {
    feature,
    staticAudit: {
      clean: true,
      integratorCommitsIncluded: true,
      paths: [ids.scope],
    },
    journey: {
      passed: true,
      entryPoint: "/app",
      cleanEnvironment: true,
    },
    integrationMerge: {
      ref: "refs/heads/harness/integration",
      mergeCommit: "abc123",
      earlierDoneRegressionGreen: true,
      regressedFeatureIds: regressed,
    },
    accessibility: {
      seriousFindingIds: [],
    },
  };
}

export function bumpNodeVersion(db: DatabaseSync, id: string): void {
  db.prepare(
    `UPDATE nodes
        SET version = version + 1,
            content_hash = content_hash || '-next',
            updated_rev = updated_rev + 1
      WHERE id = ?`,
  ).run(id);
}

export function readFeatureState(db: DatabaseSync, feature: string): { state: string; epoch: number; wave: number | null; holder: string | null } {
  const row = db
    .prepare(`SELECT state, epoch, wave, integration_holder FROM feature_runtime WHERE feature = ?`)
    .get(feature) as Record<string, string | number | null>;
  return {
    state: String(row.state),
    epoch: Number(row.epoch),
    wave: row.wave === null ? null : Number(row.wave),
    holder: row.integration_holder === null ? null : String(row.integration_holder),
  };
}

export function readProject(db: DatabaseSync): { state: string; currentWave: number | null; paused: number; updatedRev: number } {
  const row = db
    .prepare(`SELECT state, current_wave, paused, updated_rev FROM project_runtime WHERE id = 1`)
    .get() as Record<string, string | number | null>;
  return {
    state: String(row.state),
    currentWave: row.current_wave === null ? null : Number(row.current_wave),
    paused: Number(row.paused),
    updatedRev: Number(row.updated_rev),
  };
}

export function listOutbox(db: DatabaseSync): OutboxEvent[] {
  const rows = db
    .prepare(`SELECT id, type, subject, rev, payload FROM outbox ORDER BY seq`)
    .all() as Array<Record<string, string | number | null>>;
  return rows.map((row) => {
    const id = String(row.id);
    const deliveries = db
      .prepare(`SELECT consumer FROM outbox_deliveries WHERE event_id = ? ORDER BY consumer`)
      .all(id) as Array<Record<string, string>>;
    const parsed: unknown = JSON.parse(String(row.payload));
    const payload =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    return {
      id,
      type: String(row.type),
      subject: row.subject === null ? null : String(row.subject),
      rev: row.rev === null ? null : Number(row.rev),
      payload,
      consumers: deliveries.map((delivery) => String(delivery.consumer)),
    };
  });
}

export function countEvent(db: DatabaseSync, type: string): number {
  const row = db.prepare(`SELECT count(*) AS n FROM outbox WHERE type = ?`).get(type) as { n: number };
  return Number(row.n);
}
