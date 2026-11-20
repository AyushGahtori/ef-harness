import { describe, expect, it } from "vitest";
import {
  assertTaskReadyForDispatch,
  canonicalTraceabilityQuery,
  CLOSED_TOUCHES_TAGS,
  createKitchenAppWavePlan,
  CROSS_CUTTING_RULES,
  DeterministicGraphCompiler,
  LocalFiveLayerContradictionEngine,
  LocalIndependentOracleAuthorSealer,
  TraceabilitySqlGate,
  UncompiledDispatchError,
} from "../../src/graph-compiler/index.js";
import type {
  CompilationInput,
  CompilationResult,
  JitFeaturePlanner,
  PlanTask,
} from "../../src/graph-compiler/index.js";

function compiler(ports?: ConstructorParameters<typeof DeterministicGraphCompiler>[0]): DeterministicGraphCompiler {
  return new DeterministicGraphCompiler(ports);
}

function codes(result: CompilationResult): string[] {
  return result.diagnostics.map((item) => item.code);
}

function mapTask(plan: CompilationInput, id: string, update: (task: PlanTask) => PlanTask): CompilationInput {
  return {
    ...plan,
    tasks: plan.tasks.map((task) => (task.id === id ? update(task) : task)),
  };
}

function withScaffold(plan: CompilationInput, waived: boolean): CompilationInput {
  const files = ["a", "b", "c", "d", "e", "f"].map((name) => `src/scaffold/${name}.ts`);
  const task: PlanTask = {
    id: "T-Scaffold",
    featureId: "F-Shared",
    title: "Generate the scaffold",
    taskKind: "scaffold",
    level: "junior",
    writeScope: files,
    primaryFiles: files,
    responsibilities: ["Generate the scaffold"],
    touches: [],
    mustBandTokens: 200,
    mustTokenAttribution: [{ nodeId: "REQ-SCAFFOLD", tokens: 200 }],
    mustBandRuleIds: [],
    implements: ["REQ-SCAFFOLD"],
    obeys: [],
    handlesEdgeCases: [],
    dependsOn: [],
    names: [],
    mutatesSharedContract: false,
    createsMigration: false,
    migrationIntentSlot: null,
    estimatedMinCostMicroUsd: 1_000,
    generatedScaffold: true,
  };
  return {
    ...plan,
    tasks: [...plan.tasks, task],
    requirements: [
      ...plan.requirements,
      {
        id: "REQ-SCAFFOLD",
        featureId: "F-Shared",
        title: "Scaffold files exist",
        kind: "spec_item",
        active: true,
        risk: "low",
        sensitivities: [],
        waived: false,
        waiverApprovedBy: null,
        waiverReason: null,
      },
    ],
    checks: [
      ...plan.checks,
      { id: "CHK-SCAFFOLD", featureId: "F-Shared", requirementIds: ["REQ-SCAFFOLD"], visibility: "visible" },
    ],
    waivers: waived
      ? [
          {
            code: "generated_scaffold_file_count",
            reason: "Generated scaffold owns six files",
            approvedBy: "developer",
            risk: "low",
            audited: true,
            taskId: "T-Scaffold",
          },
        ]
      : [],
  };
}

describe("DeterministicGraphCompiler kitchen wave", () => {
  const plan = createKitchenAppWavePlan();

  it("publishes the closed tag and rule registries", () => {
    expect(CLOSED_TOUCHES_TAGS).toHaveLength(28);
    expect(CROSS_CUTTING_RULES.map((rule) => rule.id)).toEqual([
      "X-01",
      "X-02",
      "X-03",
      "X-04",
      "X-05",
      "X-06",
      "X-07",
      "X-08",
      "X-09",
      "X-10",
      "X-11",
      "X-12",
      "X-13",
      "X-14",
    ]);
  });

  it("executes the canonical traceability queries", () => {
    expect(canonicalTraceabilityQuery("requirements_without_task")).toContain("task_requirements");
    expect(canonicalTraceabilityQuery("requirements_without_check")).toContain("check_requirements");
    expect(canonicalTraceabilityQuery("tasks_without_requirement")).toContain("task_runtime");
    const report = new TraceabilitySqlGate().check(
      plan,
      new LocalFiveLayerContradictionEngine(),
      new LocalIndependentOracleAuthorSealer(),
    );
    expect(report.executedQueries.map((query) => query.name)).toEqual([
      "requirements_without_task",
      "requirements_without_check",
      "tasks_without_requirement",
    ]);
    expect(report.diagnostics).toEqual([]);
  });

  it("passes all 9 passes and stamps an immutable snapshot", () => {
    const first = compiler().compile(plan);
    const second = compiler().compile(plan);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.repairRounds).toBe(0);
    expect(first.snapshot.passCount).toBe(9);
    expect(first.snapshot.planEpoch).toBe(7);
    expect(first.snapshot.compiledAt).toBe(plan.compiledAt);
    expect(first.snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
    expect(first.snapshot.tasks).toHaveLength(plan.tasks.length);
    for (const stamp of first.snapshot.tasks) {
      expect(stamp.state).toBe("READY");
      expect(stamp.passedAllNinePasses).toBe(true);
      expect(stamp.compiledSliceSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(stamp.planEpoch).toBe(7);
      assertTaskReadyForDispatch(stamp);
    }
  });

  it("refuses dispatch when compilation did not pass", () => {
    const failed = compiler().compile({
      ...plan,
      contradictions: [{ src: "REQ-ORDERS", dst: "REQ-12", resolved: false }],
    });
    expect(failed.ok).toBe(false);
    expect(failed.snapshot).toBeNull();
    expect(() => assertTaskReadyForDispatch(null)).toThrow(UncompiledDispatchError);
  });

  it("allows a shared file when the tasks are ordered and rejects the same pair in parallel", () => {
    const shared = mapTask(plan, "T-Menu-Api", (task) => ({
      ...task,
      writeScope: ["src/menu/shared.ts"],
      primaryFiles: ["src/menu/shared.ts"],
    }));
    const ordered = mapTask(shared, "T-Menu-Schema", (task) => ({
      ...task,
      dependsOn: ["T-Menu-Api"],
      writeScope: ["src/menu/shared.ts"],
      primaryFiles: ["src/menu/shared.ts"],
    }));
    const parallel = mapTask(shared, "T-Menu-Schema", (task) => ({
      ...task,
      writeScope: ["src/menu/shared.ts"],
      primaryFiles: ["src/menu/shared.ts"],
    }));
    expect(compiler().compile(ordered).ok).toBe(true);
    const rejected = compiler().compile(parallel);
    expect(rejected.ok).toBe(false);
    expect(codes(rejected)).toContain("parallel_write_overlap");
  });

  it("fails each injected defect with an exact diagnostic", () => {
    const cycle = mapTask(
      mapTask(plan, "T-Menu-Api", (task) => ({ ...task, dependsOn: ["T-Menu-Schema"] })),
      "T-Menu-Schema",
      (task) => ({ ...task, dependsOn: ["T-Menu-Api"] }),
    );
    const cycleResult = compiler().compile(cycle);
    expect(cycleResult.ok).toBe(false);
    expect(codes(cycleResult)).toContain("task_cycle");
    expect(cycleResult.diagnostics.find((item) => item.code === "task_cycle")?.message).toContain("T-Menu-Api");

    const caseClash = mapTask(
      mapTask(plan, "T-Menu-Api", (task) => ({
        ...task,
        writeScope: ["src/api/Orders.ts"],
        primaryFiles: ["src/api/Orders.ts"],
      })),
      "T-Menu-Schema",
      (task) => ({
        ...task,
        writeScope: ["src/api/orders.ts"],
        primaryFiles: ["src/api/orders.ts"],
      }),
    );
    const caseResult = compiler().compile(caseClash);
    expect(codes(caseResult)).toContain("parallel_write_overlap");
    const caseDiagnostic = caseResult.diagnostics.find((item) => item.code === "parallel_write_overlap");
    expect(caseDiagnostic?.paths).toEqual(["src/api/Orders.ts", "src/api/orders.ts"]);

    const wildcard = mapTask(
      mapTask(plan, "T-Menu-Api", (task) => ({
        ...task,
        writeScope: ["src/**"],
        primaryFiles: ["src/menu/api.ts"],
      })),
      "T-Menu-Schema",
      (task) => ({
        ...task,
        writeScope: ["src/ui/Header.tsx"],
        primaryFiles: ["src/ui/Header.tsx"],
      }),
    );
    const wildcardResult = compiler().compile(wildcard);
    expect(codes(wildcardResult)).toContain("broad_leaf_wildcard");
    expect(codes(wildcardResult)).toContain("parallel_write_overlap");
    expect(wildcardResult.diagnostics.some((item) => item.taskIds.includes("T-Menu-Schema"))).toBe(true);

    const shadowed = mapTask(plan, "T-Menu-Api", (task) => ({
      ...task,
      names: [{ kind: "http_route", value: "POST /api/orders", method: null }],
    }));
    expect(codes(compiler().compile(shadowed))).toContain("name_collision");

    const orphan = {
      ...plan,
      requirements: [
        ...plan.requirements,
        {
          id: "REQ-ORPHAN",
          featureId: "F-Menu",
          title: "Unmapped garnish note",
          kind: "spec_item" as const,
          active: true,
          risk: "low" as const,
          sensitivities: [],
          waived: false,
          waiverApprovedBy: null,
          waiverReason: null,
        },
      ],
    };
    const orphanResult = compiler().compile(orphan);
    expect(orphanResult.unimplementedRequirements).toContain("REQ-ORPHAN");
    expect(codes(orphanResult)).toContain("unimplemented_requirement");

    const missingOracle = {
      ...plan,
      checks: plan.checks.filter((check) => !check.requirementIds.includes("REQ-12")),
    };
    const oracleResult = compiler().compile(missingOracle);
    expect(oracleResult.unverifiedRequirements).toEqual(["REQ-12"]);
    expect(oracleResult.diagnostics.find((item) => item.code === "unverified_requirement")?.details.unverified_requirements).toEqual([
      "REQ-12",
    ]);

    const oversized = mapTask(plan, "T-Menu-Api", (task) => ({
      ...task,
      mustBandTokens: 3_900,
      mustTokenAttribution: [
        { nodeId: "REQ-MENU-API", tokens: 2_100 },
        { nodeId: "X-01", tokens: 1_800 },
      ],
    }));
    const oversizedResult = compiler().compile(oversized);
    const oversizedDiagnostic = oversizedResult.diagnostics.find((item) => item.code === "oversized_must");
    expect(oversizedDiagnostic?.details.errorName).toBe("OversizedMustTaskError");
    expect(oversizedDiagnostic?.details.mustTokens).toBe(3_900);
    expect(oversizedDiagnostic?.details.recommendation).toBe("split_or_promote_senior");
    expect(oversizedDiagnostic?.message).toContain("Senior");

    const contradiction = compiler().compile({
      ...plan,
      contradictions: [{ src: "REQ-ORDERS", dst: "REQ-12", resolved: false }],
    });
    expect(codes(contradiction)).toContain("unresolved_contradiction");

    const shortfall = compiler().compile({
      ...plan,
      budget: { remainingProjectMicroUsd: 20_000_000, remainingWaveMicroUsd: 1 },
    });
    expect(codes(shortfall)).toContain("budget_shortfall");
  });

  it("permits an audited scaffold waiver and rejects non-waivable waivers", () => {
    expect(compiler().compile(withScaffold(plan, false)).ok).toBe(false);
    expect(codes(compiler().compile(withScaffold(plan, false)))).toContain("generated_scaffold_file_count");
    const waived = compiler().compile(withScaffold(plan, true));
    expect(waived.ok).toBe(true);
    if (waived.ok) expect(waived.snapshot.appliedWaivers).toEqual(["generated_scaffold_file_count:T-Scaffold"]);

    for (const code of ["cycle_check", "unresolved_contradiction", "must_truncation", "missing_sealed_check"]) {
      const rejected = compiler().compile({
        ...plan,
        waivers: [
          {
            code,
            reason: "please skip",
            approvedBy: "planner",
            risk: "low",
            audited: true,
            taskId: "T-Menu-Api",
          },
        ],
      });
      expect(codes(rejected)).toContain("NON_WAIVABLE_SAFETY_INVARIANT");
      expect(rejected.ok).toBe(false);
    }
  });

  it("repairs auto-fixable defects for at most two rounds", () => {
    const overlap = mapTask(
      mapTask(plan, "T-Menu-Api", (task) => ({
        ...task,
        writeScope: ["src/menu/shared.ts"],
        primaryFiles: ["src/menu/shared.ts"],
      })),
      "T-Menu-Schema",
      (task) => ({
        ...task,
        writeScope: ["src/menu/shared.ts"],
        primaryFiles: ["src/menu/shared.ts"],
      }),
    );
    const fixer: JitFeaturePlanner = {
      repair(input) {
        return mapTask(
          mapTask(input, "T-Menu-Api", (task) => ({
            ...task,
            writeScope: ["src/menu/api.ts"],
            primaryFiles: ["src/menu/api.ts"],
          })),
          "T-Menu-Schema",
          (task) => ({
            ...task,
            writeScope: ["src/menu/schema.ts"],
            primaryFiles: ["src/menu/schema.ts"],
          }),
        );
      },
    };
    const fixed = compiler({ planner: fixer }).compile(overlap);
    expect(fixed.ok).toBe(true);
    expect(fixed.repairRounds).toBe(1);

    const stuck: JitFeaturePlanner = { repair: (input) => input };
    const exhausted = compiler({ planner: stuck }).compile(overlap);
    expect(exhausted.ok).toBe(false);
    expect(exhausted.repairRounds).toBe(2);
    expect(codes(exhausted)).toContain("escalated_to_developer");

    const cyclic = mapTask(plan, "T-Menu-Api", (task) => ({ ...task, dependsOn: ["T-Menu-Api"] }));
    let called = false;
    const unused: JitFeaturePlanner = {
      repair(input) {
        called = true;
        return input;
      },
    };
    const cycleResult = compiler({ planner: unused }).compile(cyclic);
    expect(called).toBe(false);
    expect(cycleResult.repairRounds).toBe(0);
    expect(codes(cycleResult)).toContain("task_cycle");

    const unmapped: CompilationInput = {
      ...plan,
      requirements: [
        ...plan.requirements,
        {
          id: "REQ-NEW",
          featureId: "F-Menu",
          title: "One unmapped note",
          kind: "spec_item",
          active: true,
          risk: "low",
          sensitivities: [],
          waived: false,
          waiverApprovedBy: null,
          waiverReason: null,
        },
      ],
      checks: [
        ...plan.checks,
        { id: "CHK-NEW", featureId: "F-Menu", requirementIds: ["REQ-NEW"], visibility: "visible" },
      ],
    };
    const mapper: JitFeaturePlanner = {
      repair(input) {
        return mapTask(input, "T-Menu-Api", (task) => ({
          ...task,
          implements: [...task.implements, "REQ-NEW"],
        }));
      },
    };
    const mapped = compiler({ planner: mapper }).compile(unmapped);
    expect(mapped.ok).toBe(true);
    expect(mapped.repairRounds).toBe(1);

    const two: CompilationInput = {
      ...unmapped,
      requirements: [
        ...unmapped.requirements,
        {
          id: "REQ-NEW-2",
          featureId: "F-Menu",
          title: "Second unmapped note",
          kind: "spec_item",
          active: true,
          risk: "low",
          sensitivities: [],
          waived: false,
          waiverApprovedBy: null,
          waiverReason: null,
        },
      ],
      checks: [
        ...unmapped.checks,
        { id: "CHK-NEW-2", featureId: "F-Menu", requirementIds: ["REQ-NEW-2"], visibility: "visible" },
      ],
    };
    const skipped = compiler({ planner: unused }).compile(two);
    expect(skipped.repairRounds).toBe(0);
    expect(skipped.unimplementedRequirements).toEqual(["REQ-NEW", "REQ-NEW-2"]);
  });

  it("consults sibling ports without letting them hide safety invariants", () => {
    const extraConflict = compiler({
      contradictionEngine: { unresolvedContradictions: () => [{ src: "A", dst: "B", resolved: false }] },
    }).compile(plan);
    expect(codes(extraConflict)).toContain("unresolved_contradiction");

    const brokeBudget = compiler({
      budgetLedger: { remaining: () => ({ remainingProjectMicroUsd: 0, remainingWaveMicroUsd: 0 }) },
    }).compile(plan);
    expect(codes(brokeBudget)).toContain("budget_shortfall");

    const slicer = compiler({
      slicer: {
        measureMust: (task) => ({
          taskId: task.id,
          level: task.level,
          tokens: task.id === "T-Menu-Api" ? 3_900 : task.mustBandTokens,
          attribution: [{ nodeId: task.id, tokens: 3_900 }],
          ruleIds: task.mustBandRuleIds,
        }),
      },
      mustGuard: { assertFits: () => null },
    }).compile(plan);
    expect(slicer.diagnostics.find((item) => item.code === "oversized_must")?.details.errorName).toBe(
      "OversizedMustTaskError",
    );

    const stripped = {
      ...plan,
      checks: plan.checks.filter((check) => check.id !== "CHK-MENU-SEALED"),
    };
    expect(codes(compiler().compile(stripped))).toContain("missing_feature_sealed_check");
    const sealed = compiler({
      oracleSealer: {
        sealedCheckIds: (_input, featureId) => (featureId === "F-Menu" ? ["CHK-MENU-SEALED"] : []),
      },
    }).compile(stripped);
    expect(sealed.ok).toBe(true);

    const shadowed = compiler({
      nameRegistry: {
        detectCollisions: () => [
          {
            kind: "exported_symbol",
            reason: "brownfield_shadow",
            left: "formatEnvelope",
            right: "formatEnvelope",
            leftOwner: "T-Contract",
            rightOwner: "brownfield",
          },
        ],
      },
    }).compile(plan);
    expect(codes(shadowed)).toContain("name_collision");
  });
});
