import { readFileSync } from "node:fs";
import { canonicalAssetAbsolute } from "@ef-harness/shared-contracts";
import type { IndependentOracleAuthorSealer } from "./ports.js";
import type { FiveLayerContradictionEngine } from "./ports.js";
import { diagnostic } from "./types.js";
import type { CompilationDiagnostic, CompilationInput } from "./types.js";

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
    const activeRequirements = input.requirements.filter((requirement) => requirement.active);
    const diagnostics: CompilationDiagnostic[] = [];
    const coveredByTask = new Set(
      input.tasks.flatMap((task) => [...task.implements, ...task.obeys, ...task.handlesEdgeCases]),
    );
    const coveredByCheck = new Set(input.checks.flatMap((check) => check.requirementIds));
    const sqlWaived = new Set(
      activeRequirements.filter((requirement) => sqlWaiver(requirement)).map((requirement) => requirement.id),
    );
    const sqlUnimplemented = this.namedIds(
      "requirements_without_task",
      activeRequirements
        .map((requirement) => requirement.id)
        .filter((id) => !coveredByTask.has(id) && !sqlWaived.has(id)),
      executed,
    );
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
    const unverified = this.namedIds(
      "requirements_without_check",
      activeRequirements
        .map((requirement) => requirement.id)
        .filter((id) => !coveredByCheck.has(id) && !sqlWaived.has(id)),
      executed,
    );
    const orphans = this.namedIds(
      "tasks_without_requirement",
      input.tasks
        .filter((task) => task.implements.length + task.obeys.length + task.handlesEdgeCases.length === 0)
        .map((task) => task.id),
      executed,
    );
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
      const contradictions = [
        ...input.contradictions.filter((edge) => !edge.resolved),
        ...engine.unresolvedContradictions(input),
      ];
      const seenContradictions = new Set<string>();
      for (const edge of contradictions) {
        const key = `${edge.src}\u0000${edge.dst}`;
        if (seenContradictions.has(key)) continue;
        seenContradictions.add(key);
        const src = edge.src;
        const dst = edge.dst;
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
      const unsettled = input.mustAsk
        .filter((criterion) => criterion.blocking && !criterion.settled)
        .map((criterion) => criterion.id)
        .sort((left, right) => left.localeCompare(right));
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
      const featureIds = input.features
        .filter((feature) => feature.active)
        .map((feature) => feature.id)
        .filter((featureId) => {
          const sealed = new Set(
            input.checks.filter((check) => check.featureId === featureId && check.visibility === "sealed").map((check) => check.id),
          );
          for (const checkId of sealer.sealedCheckIds(input, featureId)) sealed.add(checkId);
          return sealed.size === 0;
        })
        .sort((left, right) => left.localeCompare(right));
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
      for (const requirement of activeRequirements) {
        const sealedForRequirement = input.checks.some(
          (check) => check.visibility === "sealed" && check.requirementIds.includes(requirement.id),
        );
        if (sealedForRequirement) continue;
        for (const sensitivity of requirement.sensitivities) {
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
              message: `Requirement ${requirement.id} handles ${sensitivity} and has no sealed verifies check.`,
              requirementIds: [requirement.id],
              details: { sensitivity },
            }),
          );
        }
      }
      return {
        diagnostics,
        unverifiedRequirements: unverified,
        unimplementedRequirements: unimplemented,
        orphanTasks: orphans,
        executedQueries: executed,
      };
  }

  private namedIds(
    name: RequiredQuery,
    ids: readonly string[],
    executed: { name: string; sql: string }[],
  ): string[] {
    executed.push({ name, sql: canonicalTraceabilityQuery(name) });
    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  }

}

function sqlWaiver(requirement: CompilationInput["requirements"][number]): boolean {
  return (
    requirement.waived &&
    requirement.risk === "low" &&
    requirement.sensitivities.length === 0 &&
    requirement.waiverApprovedBy !== null &&
    requirement.waiverApprovedBy.trim() !== ""
  );
}
