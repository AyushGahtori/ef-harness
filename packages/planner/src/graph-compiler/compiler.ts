import type { MustBandOversizeRefusal } from "../slicer/types.js";
import { budgetDiagnostics } from "./budget.js";
import { tagAndRuleDiagnostics } from "./coverage.js";
import { cycleDiagnostics } from "./cycles.js";
import { detectNameCollisions } from "./name-collisions.js";
import type { NameCollision } from "./ports.js";
import {
  LocalBudgetLedger,
  LocalFiveLayerContradictionEngine,
  LocalIndependentOracleAuthorSealer,
  LocalKnowledgePacketSlicer,
  LocalOversizedMustAutoSplitGuard,
} from "./ports.js";
import type { GraphCompilerPorts, MustBandMeasurement } from "./ports.js";
import { ownershipDiagnostics } from "./ownership.js";
import { buildOrderingIndex } from "./reachability.js";
import { buildSnapshot } from "./snapshot.js";
import { taskSizeDiagnostics } from "./task-size.js";
import { TraceabilitySqlGate } from "./traceability-sql-gate.js";
import { diagnostic } from "./types.js";
import type {
  CompilationDiagnostic,
  CompilationFailure,
  CompilationInput,
  CompilationResult,
  CompilationSuccess,
  PlanTask,
} from "./types.js";
import { CompilationWaiverGuard, scaffoldFileWarnings } from "./waiver-guard.js";
import { WriteScopeDisjointnessChecker } from "./write-scope-checker.js";

const AUTO_FIXABLE_CODES = new Set([
  "parallel_write_overlap",
  "windows_case_collision",
  "broad_leaf_wildcard",
  "oversized_must",
  "leaf_file_bound",
  "leaf_responsibility_bound",
  "unimplemented_requirement",
]);

export class DeterministicGraphCompiler {
  private readonly traceability = new TraceabilitySqlGate();
  private readonly writeScopes = new WriteScopeDisjointnessChecker();
  private readonly waivers = new CompilationWaiverGuard();

  constructor(private readonly ports: GraphCompilerPorts = {}) {}

  compile(input: CompilationInput): CompilationResult {
    let current = input;
    let repairRounds = 0;
    let outcome = this.runPasses(current);
    const planner = this.ports.planner;
    while (!outcome.ok && repairRounds < 2 && planner && isAutoFixable(outcome.diagnostics)) {
      const repaired = planner.repair(current, outcome.diagnostics);
      repairRounds += 1;
      if (!repaired) break;
      current = repaired;
      outcome = this.runPasses(current);
    }
    if (outcome.ok) {
      const success: CompilationSuccess = {
        ok: true,
        repairRounds,
        escalated: false,
        elapsedMs: outcome.elapsedMs,
        diagnostics: outcome.diagnostics,
        snapshot: outcome.snapshot,
        unverifiedRequirements: [],
        unimplementedRequirements: [],
        orphanTasks: [],
      };
      return success;
    }
    const failure: CompilationFailure = {
      ok: false,
      repairRounds,
      escalated: true,
      elapsedMs: outcome.elapsedMs,
      diagnostics: [
        ...outcome.diagnostics,
        diagnostic({
          pass: 9,
          code: "escalated_to_developer",
          message:
            repairRounds === 0
              ? "Compilation failed on a defect the planner repair loop cannot auto-fix. Escalating to the developer."
              : `Compilation still failing after ${repairRounds} planner repair rounds. Escalating to the developer.`,
          details: { repairRounds },
        }),
      ],
      snapshot: null,
      unverifiedRequirements: outcome.unverifiedRequirements,
      unimplementedRequirements: outcome.unimplementedRequirements,
      orphanTasks: outcome.orphanTasks,
    };
    return failure;
  }

  compileFeatureWave(input: CompilationInput): CompilationResult {
    return this.compile(input);
  }

  validateDisjointWriteScopes(input: CompilationInput): readonly CompilationDiagnostic[] {
    const taskIds = new Set(input.tasks.map((task) => task.id));
    const featureIds = new Set(input.features.map((feature) => feature.id));
    const taskOrder = buildOrderingIndex(
      [...taskIds],
      input.tasks.flatMap((task) =>
        task.dependsOn
          .filter((dependency) => taskIds.has(dependency))
          .map((dependency) => ({ from: dependency, to: task.id })),
      ),
    );
    const featureOrder = buildOrderingIndex(
      [...featureIds],
      input.features.flatMap((feature) =>
        feature.dependsOn
          .filter((dependency) => featureIds.has(dependency))
          .map((dependency) => ({ from: dependency, to: feature.id })),
      ),
    );
    return this.writeScopes.check(input, taskOrder, featureOrder);
  }

  private runPasses(input: CompilationInput): PassOutcome {
    const started = performance.now();
    const diagnostics: CompilationDiagnostic[] = [];
    diagnostics.push(...structuralDiagnostics(input));
    diagnostics.push(...cycleDiagnostics(input));
    const taskIds = new Set(input.tasks.map((task) => task.id));
    const featureIds = new Set(input.features.map((feature) => feature.id));
    const taskOrder = buildOrderingIndex(
      [...taskIds],
      input.tasks.flatMap((task) =>
        task.dependsOn
          .filter((dependency) => taskIds.has(dependency))
          .map((dependency) => ({ from: dependency, to: task.id })),
      ),
    );
    const featureOrder = buildOrderingIndex(
      [...featureIds],
      input.features.flatMap((feature) =>
        feature.dependsOn
          .filter((dependency) => featureIds.has(dependency))
          .map((dependency) => ({ from: dependency, to: feature.id })),
      ),
    );
    diagnostics.push(...this.writeScopes.check(input, taskOrder, featureOrder));
    diagnostics.push(...nameDiagnostics(input, this.ports.nameRegistry?.detectCollisions(input) ?? []));
    const slicer = this.ports.slicer ?? new LocalKnowledgePacketSlicer();
    const guard = this.ports.mustGuard ?? new LocalOversizedMustAutoSplitGuard();
    for (const task of input.tasks) {
      const measured = slicer.measureMust(task);
      if (isOversizeRefusal(measured)) {
        diagnostics.push(
          diagnostic({
            pass: 4,
            code: "oversized_must",
            message: measured.summary,
            taskIds: [task.id],
            details: {
              code: measured.code,
              mustTokens: measured.mustTokens,
              ceiling: measured.ceiling,
              recommendations: measured.recommendations.map((item) => item.action),
            },
          }),
        );
        continue;
      }
      const measurement = measureTask(task, measured);
      diagnostics.push(...taskSizeDiagnostics(task, measurement, guard));
      diagnostics.push(...tagAndRuleDiagnostics(task, measurement));
    }
    const engine = this.ports.contradictionEngine ?? new LocalFiveLayerContradictionEngine();
    const sealer = this.ports.oracleSealer ?? new LocalIndependentOracleAuthorSealer();
    const trace = this.traceability.check(input, engine, sealer);
    diagnostics.push(...trace.diagnostics);
    diagnostics.push(...ownershipDiagnostics(input));
    const ledger = this.ports.budgetLedger ?? new LocalBudgetLedger();
    diagnostics.push(...budgetDiagnostics(input, ledger));
    const waiver = this.waivers.evaluate(input, scaffoldFileWarnings(input));
    diagnostics.push(...waiver.diagnostics);
    diagnostics.sort(compareDiagnostics);
    const snapshot = diagnostics.length === 0 ? buildSnapshot(input, waiver.appliedWaivers) : null;
    const elapsedMs = performance.now() - started;
    if (!snapshot) {
      return {
        ok: false,
        elapsedMs,
        diagnostics,
        snapshot: null,
        unverifiedRequirements: trace.unverifiedRequirements,
        unimplementedRequirements: trace.unimplementedRequirements,
        orphanTasks: trace.orphanTasks,
      };
    }
    return {
      ok: true,
      elapsedMs,
      diagnostics: [],
      snapshot,
      unverifiedRequirements: [],
      unimplementedRequirements: [],
      orphanTasks: [],
    };
  }
}

interface PassingOutcome {
  readonly ok: true;
  readonly elapsedMs: number;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly snapshot: CompilationSuccess["snapshot"];
  readonly unverifiedRequirements: readonly string[];
  readonly unimplementedRequirements: readonly string[];
  readonly orphanTasks: readonly string[];
}

interface FailingOutcome {
  readonly ok: false;
  readonly elapsedMs: number;
  readonly diagnostics: readonly CompilationDiagnostic[];
  readonly snapshot: null;
  readonly unverifiedRequirements: readonly string[];
  readonly unimplementedRequirements: readonly string[];
  readonly orphanTasks: readonly string[];
}

type PassOutcome = PassingOutcome | FailingOutcome;

function isOversizeRefusal(
  value: MustBandMeasurement | MustBandOversizeRefusal,
): value is MustBandOversizeRefusal {
  return "code" in value && value.code === "MustBandOversizeRefusal";
}

function measureTask(task: PlanTask, measured: MustBandMeasurement): MustBandMeasurement {
  const tokens = Math.max(measured.tokens, task.mustBandTokens);
  const ruleIds = [...new Set([...task.mustBandRuleIds, ...measured.ruleIds])].sort((a, b) =>
    a.localeCompare(b),
  );
  return {
    taskId: task.id,
    level: task.level,
    tokens,
    attribution: tokens === task.mustBandTokens ? task.mustTokenAttribution : measured.attribution,
    ruleIds,
  };
}

function structuralDiagnostics(input: CompilationInput): CompilationDiagnostic[] {
  const diagnostics: CompilationDiagnostic[] = [];
  if (input.compiledAt.trim() === "") {
    diagnostics.push(
      diagnostic({
        pass: 9,
        code: "invalid_snapshot_stamp",
        message: "compiledAt is required so the compiled plan snapshot is deterministic.",
      }),
    );
  }
  if (!Number.isInteger(input.planEpoch) || input.planEpoch < 0) {
    diagnostics.push(
      diagnostic({
        pass: 9,
        code: "invalid_snapshot_stamp",
        message: "planEpoch must be a non-negative integer.",
        details: { planEpoch: input.planEpoch },
      }),
    );
  }
  const features = new Set(input.features.map((feature) => feature.id));
  for (const task of input.tasks) {
    if (features.has(task.featureId)) continue;
    diagnostics.push(
      diagnostic({
        pass: 1,
        code: "unknown_feature",
        message: `Task ${task.id} belongs to unknown feature ${task.featureId}.`,
        taskIds: [task.id],
        featureIds: [task.featureId],
      }),
    );
  }
  return diagnostics;
}

function nameDiagnostics(input: CompilationInput, extra: readonly NameCollision[]): CompilationDiagnostic[] {
  if (extra.length === 0 && input.brownfieldNames.length === 0) {
    let named = false;
    for (const task of input.tasks) {
      if (task.names.length > 0) {
        named = true;
        break;
      }
    }
    if (!named) return [];
  }
  const taskIds = new Set(input.tasks.map((task) => task.id));
  const merged = new Map<string, NameCollision>();
  for (const collision of [...detectNameCollisions(input), ...extra]) {
    const key = [collision.reason, collision.kind, collision.left, collision.right, collision.leftOwner, collision.rightOwner].join(
      "\u0000",
    );
    merged.set(key, collision);
  }
  return [...merged.values()]
    .sort((a, b) => a.left.localeCompare(b.left) || a.right.localeCompare(b.right) || a.reason.localeCompare(b.reason))
    .map((collision) =>
      diagnostic({
        pass: 3,
        code: "name_collision",
        message: `${collision.reason} on ${collision.kind}: "${collision.left}" (${collision.leftOwner}) shadows "${collision.right}" (${collision.rightOwner}).`,
        taskIds: [collision.leftOwner, collision.rightOwner].filter((id) => taskIds.has(id)),
        details: {
          reason: collision.reason,
          kind: collision.kind,
          left: collision.left,
          right: collision.right,
        },
      }),
    );
}

function isAutoFixable(diagnostics: readonly CompilationDiagnostic[]): boolean {
  if (diagnostics.length === 0) return false;
  if (!diagnostics.every((item) => AUTO_FIXABLE_CODES.has(item.code))) return false;
  const unmapped = diagnostics
    .filter((item) => item.code === "unimplemented_requirement")
    .reduce((count, item) => count + item.requirementIds.length, 0);
  return unmapped <= 1;
}

function compareDiagnostics(left: CompilationDiagnostic, right: CompilationDiagnostic): number {
  return (
    left.pass - right.pass ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
