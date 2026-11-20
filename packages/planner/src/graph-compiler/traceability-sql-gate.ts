import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import type { IndependentOracleAuthorSealer } from "./ports.js";
import type { FiveLayerContradictionEngine } from "./ports.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput, RequirementSensitivity } from "./types.js";

type RequiredQuery =
  | "requirements_without_task"
  | "requirements_without_check"
  | "tasks_without_requirement";

let catalogCache: Map<string, string> | null = null;

export function loadQueryCatalog(sqlText: string): Map<string, string> {
  const catalog = new Map<string, string>();
  let name = "";
  let body: string[] = [];
  const flush = (): void => {
    if (!name) return;
    catalog.set(name, body.join("\n").trim());
    body = [];
  };
  for (const line of sqlText.split(/\r?\n/)) {
    const named = /^-- name:\s*(\S+)/.exec(line);
    if (named) {
      flush();
      name = named[1] ?? "";
      continue;
    }
    if (name) body.push(line);
  }
  flush();
  return catalog;
}

function catalog(): Map<string, string> {
  if (catalogCache) return catalogCache;
  const text = readFileSync(canonicalAssetAbsolute("queriesSql"), "utf8");
  catalogCache = loadQueryCatalog(text);
  return catalogCache;
}

export function canonicalTraceabilityQuery(name: RequiredQuery): string {
  const sql = catalog().get(name);
  if (!sql) throw new Error(`schema/queries.sql is missing named query ${name}`);
  return sql;
}

function column(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

export interface TraceabilityReport {
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly unverifiedRequirements: readonly string[];
  readonly unimplementedRequirements: readonly string[];
  readonly orphanTasks: readonly string[];
  readonly executedQueries: readonly { readonly name: string; readonly sql: string }[];
}

export class TraceabilitySqlGate {
  check(
    input: CompilationInput,
    engine: FiveLayerContradictionEngine,
    sealer: IndependentOracleAuthorSealer,
  ): TraceabilityReport {
    const executed: { name: string; sql: string }[] = [];
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE requirements (id TEXT PRIMARY KEY, feature_id TEXT NOT NULL);
        CREATE TABLE task_requirements (task_id TEXT NOT NULL, requirement_id TEXT NOT NULL);
        CREATE TABLE check_requirements (check_id TEXT NOT NULL, requirement_id TEXT NOT NULL);
        CREATE TABLE waivers (requirement_id TEXT PRIMARY KEY);
        CREATE TABLE task_runtime (task TEXT PRIMARY KEY);
        CREATE TABLE contradiction_edges (src TEXT NOT NULL, dst TEXT NOT NULL, resolved INTEGER NOT NULL, PRIMARY KEY (src, dst));
        CREATE TABLE must_ask_criteria (id TEXT PRIMARY KEY, blocking INTEGER NOT NULL, settled INTEGER NOT NULL);
        CREATE TABLE active_features (id TEXT PRIMARY KEY);
        CREATE TABLE sealed_feature_checks (feature_id TEXT NOT NULL, check_id TEXT NOT NULL);
        CREATE TABLE sensitive_requirements (id TEXT PRIMARY KEY, sensitivity TEXT NOT NULL);
        CREATE TABLE sealed_check_requirements (requirement_id TEXT NOT NULL, check_id TEXT NOT NULL);
        CREATE INDEX task_requirements_requirement ON task_requirements(requirement_id);
        CREATE INDEX task_requirements_task ON task_requirements(task_id);
        CREATE INDEX check_requirements_requirement ON check_requirements(requirement_id);
      `);

      const insertRequirement = database.prepare(
        "INSERT OR IGNORE INTO requirements(id, feature_id) VALUES (?, ?)",
      );
      const insertCoverage = database.prepare(
        "INSERT INTO task_requirements(task_id, requirement_id) VALUES (?, ?)",
      );
      const insertCheck = database.prepare(
        "INSERT INTO check_requirements(check_id, requirement_id) VALUES (?, ?)",
      );
      const insertWaiver = database.prepare("INSERT OR IGNORE INTO waivers(requirement_id) VALUES (?)");
      const insertTask = database.prepare("INSERT OR IGNORE INTO task_runtime(task) VALUES (?)");
      const insertContradiction = database.prepare(
        "INSERT OR IGNORE INTO contradiction_edges(src, dst, resolved) VALUES (?, ?, ?)",
      );
      const insertMustAsk = database.prepare(
        "INSERT OR IGNORE INTO must_ask_criteria(id, blocking, settled) VALUES (?, ?, ?)",
      );
      const insertFeature = database.prepare("INSERT OR IGNORE INTO active_features(id) VALUES (?)");
      const insertSealedFeature = database.prepare(
        "INSERT INTO sealed_feature_checks(feature_id, check_id) VALUES (?, ?)",
      );
      const insertSensitive = database.prepare(
        "INSERT INTO sensitive_requirements(id, sensitivity) VALUES (?, ?)",
      );
      const insertSealedRequirement = database.prepare(
        "INSERT INTO sealed_check_requirements(requirement_id, check_id) VALUES (?, ?)",
      );
      database.exec("BEGIN");
      const activeRequirements = input.requirements.filter((requirement) => requirement.active);
      for (const requirement of activeRequirements) {
        insertRequirement.run(requirement.id, requirement.featureId);
        const sensitive = requirement.sensitivities.length > 0;
        const lowRiskWaiver =
          requirement.waived &&
          requirement.risk === "low" &&
          !sensitive &&
          requirement.waiverApprovedBy !== null &&
          requirement.waiverApprovedBy.trim() !== "";
        if (lowRiskWaiver) insertWaiver.run(requirement.id);
        for (const sensitivity of requirement.sensitivities) {
          insertSensitive.run(`${requirement.id}:${sensitivity}`, sensitivity);
        }
      }
      for (const task of input.tasks) {
        insertTask.run(task.id);
        for (const requirementId of task.implements) insertCoverage.run(task.id, requirementId);
        for (const requirementId of task.obeys) insertCoverage.run(task.id, requirementId);
        for (const requirementId of task.handlesEdgeCases) insertCoverage.run(task.id, requirementId);
      }
      const checksByFeature = new Map<string, string[]>();
      for (const check of input.checks) {
        if (check.visibility === "sealed") {
          const list = checksByFeature.get(check.featureId) ?? [];
          list.push(check.id);
          checksByFeature.set(check.featureId, list);
        }
        for (const requirementId of check.requirementIds) {
          insertCheck.run(check.id, requirementId);
          if (check.visibility === "sealed") insertSealedRequirement.run(requirementId, check.id);
        }
      }
      for (const feature of input.features) {
        if (!feature.active) continue;
        insertFeature.run(feature.id);
        const sealed = new Set<string>(checksByFeature.get(feature.id) ?? []);
        for (const checkId of sealer.sealedCheckIds(input, feature.id)) sealed.add(checkId);
        for (const checkId of sealed) insertSealedFeature.run(feature.id, checkId);
      }
      for (const edge of input.contradictions) {
        insertContradiction.run(edge.src, edge.dst, edge.resolved ? 1 : 0);
      }
      for (const edge of engine.unresolvedContradictions(input)) {
        insertContradiction.run(edge.src, edge.dst, 0);
      }
      for (const criterion of input.mustAsk) {
        insertMustAsk.run(criterion.id, criterion.blocking ? 1 : 0, criterion.settled ? 1 : 0);
      }
      database.exec("COMMIT");

      const diagnostics: CompilationDiagnostic[] = [];
      const sqlUnimplemented = this.ids(database, "requirements_without_task", "id", executed);
      const implemented = new Set(input.tasks.flatMap((task) => task.implements));
      const waived = new Set(
        activeRequirements.filter((requirement) => requirement.waived && requirement.risk === "low").map((requirement) => requirement.id),
      );
      const missingImplements = activeRequirements
        .map((requirement) => requirement.id)
        .filter((id) => !implemented.has(id) && !waived.has(id));
      const unimplemented = [...new Set([...sqlUnimplemented, ...missingImplements])].sort((a, b) =>
        a.localeCompare(b),
      );
      const unverified = this.ids(database, "requirements_without_check", "id", executed);
      const orphans = this.ids(database, "tasks_without_requirement", "task", executed);
      if (unimplemented.length > 0) {
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "unimplemented_requirement",
            message: `Active requirements lack an implements task: ${unimplemented.join(", ")}.`,
            requirementIds: unimplemented,
          }),
        );
      }
      if (unverified.length > 0) {
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "unverified_requirement",
            message: `Active requirements lack a verifies check: ${unverified.join(", ")}.`,
            requirementIds: unverified,
            details: { unverified_requirements: unverified },
          }),
        );
      }
      if (orphans.length > 0) {
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "orphan_task",
            message: `Tasks lack a requirement: ${orphans.join(", ")}.`,
            taskIds: orphans,
          }),
        );
      }
      const contradictions = database
        .prepare("SELECT src, dst FROM contradiction_edges WHERE resolved = 0 ORDER BY src, dst")
        .all() as Record<string, unknown>[];
      for (const row of contradictions) {
        const src = column(row, "src");
        const dst = column(row, "dst");
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "unresolved_contradiction",
            message: `Unresolved contradicts edge ${src} -> ${dst} blocks graph compilation.`,
            requirementIds: [src, dst].filter((id) => id !== ""),
            details: { src, dst },
          }),
        );
      }
      const mustAsk = database
        .prepare(
          "SELECT id FROM must_ask_criteria WHERE blocking = 1 AND settled = 0 ORDER BY id",
        )
        .all() as Record<string, unknown>[];
      const unsettled = mustAsk.map((row) => column(row, "id")).filter((id) => id !== "");
      if (unsettled.length > 0) {
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "unsettled_must_ask",
            message: `Blocking must_ask criteria are unsettled: ${unsettled.join(", ")}.`,
            details: { criteria: unsettled },
          }),
        );
      }
      const missingFeatures = database
        .prepare(
          `SELECT f.id FROM active_features f
            WHERE NOT EXISTS (SELECT 1 FROM sealed_feature_checks s WHERE s.feature_id = f.id)
            ORDER BY f.id`,
        )
        .all() as Record<string, unknown>[];
      const featureIds = missingFeatures.map((row) => column(row, "id")).filter((id) => id !== "");
      if (featureIds.length > 0) {
        diagnostics.push(
          diagnostic({
            pass: 5,
            code: "missing_feature_sealed_check",
            message: `Features lack Step 3b sealed checks: ${featureIds.join(", ")}.`,
            featureIds,
          }),
        );
      }
      const sensitiveRows = database
        .prepare(
          `SELECT r.id, r.sensitivity FROM sensitive_requirements r
            WHERE NOT EXISTS (
              SELECT 1 FROM sealed_check_requirements s
               WHERE s.requirement_id = substr(r.id, 1, instr(r.id, ':') - 1)
            )
            ORDER BY r.id`,
        )
        .all() as Record<string, unknown>[];
      for (const row of sensitiveRows) {
        const compound = column(row, "id");
        const sensitivity = column(row, "sensitivity") as RequirementSensitivity;
        const requirementId = compound.slice(0, compound.lastIndexOf(":"));
        const code =
          sensitivity === "auth"
            ? "missing_sealed_auth_check"
            : sensitivity === "payments"
              ? "missing_sealed_payments_check"
              : "missing_sealed_pii_check";
        diagnostics.push(
          diagnostic({
            pass: 5,
            code,
            message: `Requirement ${requirementId} handles ${sensitivity} and has no sealed verifies check.`,
            requirementIds: [requirementId],
            details: { sensitivity },
          }),
        );
      }
      return {
        diagnostics,
        unverifiedRequirements: unverified,
        unimplementedRequirements: unimplemented,
        orphanTasks: orphans,
        executedQueries: executed,
      };
    } finally {
      database.close();
    }
  }

  private ids(
    database: DatabaseSync,
    name: RequiredQuery,
    columnName: string,
    executed: { name: string; sql: string }[],
  ): string[] {
    const sql = canonicalTraceabilityQuery(name);
    executed.push({ name, sql });
    const rows = database.prepare(sql).all() as Record<string, unknown>[];
    return rows
      .map((row) => column(row, columnName))
      .filter((id) => id !== "")
      .sort((a, b) => a.localeCompare(b));
  }
}

new DatabaseSync(":memory:").close();
