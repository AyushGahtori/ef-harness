import {
  createPlanRequest,
  type CrewLevel,
  type PlannedTaskInput,
  type PlanPreviewRequest,
  type ProjectedFeatureInput,
  type RevisionCandidate,
} from "../../src/plan-preview/index.js";

export function plannedTask(overrides: Partial<PlannedTaskInput> & Pick<PlannedTaskInput, "id" | "title">): PlannedTaskInput {
  return {
    featureId: "F-Core",
    featureTitle: "Core",
    phase: "wave1",
    writeScope: [`packages/app/src/${overrides.id}/**`],
    balancedLevel: "Mid",
    safetyFloor: "Junior",
    criticalPath: false,
    juniorCostMicroUsd: 100_000n,
    juniorCostPpm: 10_000,
    durationMinutes: 10,
    dependsOn: [],
    ...overrides,
  };
}

export function projectedFeature(
  overrides: Partial<ProjectedFeatureInput> & Pick<ProjectedFeatureInput, "featureId" | "title">,
): ProjectedFeatureInput {
  return {
    kind: "feature",
    wave: 2,
    taskCount: { min: 6, max: 9 },
    costMicroUsd: { min: 600_000n, max: 1_100_000n },
    costPpm: { min: 12_000, max: 22_000 },
    minutes: { min: 20, max: 50 },
    dependsOn: [],
    optional: true,
    priority: 1,
    ...overrides,
  };
}

export function samplePlan(overrides: Partial<PlanPreviewRequest> = {}): PlanPreviewRequest {
  const base = createPlanRequest({
    projectId: "kitchen-app",
    connection: "api",
    revision: 4,
    totalBudgetMicroUsd: 10_000_000n,
    totalBudgetPpm: 1_000_000,
    preset: "Balanced",
    tasks: [
      plannedTask({
        id: "P0-schema",
        title: "Schema",
        phase: "phase0",
        phase0Step: "P0.1",
        featureId: "F-Foundation",
        featureTitle: "Foundation",
        balancedLevel: "Senior",
        safetyFloor: "Mid",
        criticalPath: true,
        writeScope: ["schema/**"],
      }),
      plannedTask({
        id: "W1-copy",
        title: "Copy",
        balancedLevel: "Mid",
        safetyFloor: "Junior",
        criticalPath: false,
        writeScope: ["packages/app/src/copy/**"],
      }),
      plannedTask({
        id: "W1-auth",
        title: "Auth",
        featureId: "F-Auth",
        featureTitle: "Auth",
        balancedLevel: "Senior",
        safetyFloor: "Mid",
        criticalPath: true,
        writeScope: ["packages/app/src/auth/**"],
      }),
    ],
    projected: [
      projectedFeature({
        featureId: "F-AdminEmail",
        title: "Admin & Catering Email",
        wave: 2,
        priority: 1,
      }),
      projectedFeature({
        featureId: "F-Auth",
        title: "Auth",
        wave: 2,
        priority: 2,
        taskCount: { min: 4, max: 6 },
        costMicroUsd: { min: 400_000n, max: 700_000n },
        costPpm: { min: 8_000, max: 14_000 },
        minutes: { min: 12, max: 18 },
      }),
      projectedFeature({
        featureId: "F-Orders",
        title: "Orders",
        wave: 2,
        priority: 3,
        dependsOn: ["F-Auth"],
        taskCount: { min: 5, max: 8 },
        costMicroUsd: { min: 500_000n, max: 900_000n },
        costPpm: { min: 10_000, max: 18_000 },
        minutes: { min: 15, max: 30 },
      }),
      projectedFeature({
        featureId: "F-Complete",
        title: "Final audit",
        kind: "completion",
        wave: 0,
        priority: 99,
        taskCount: { min: 2, max: 4 },
        costMicroUsd: { min: 200_000n, max: 400_000n },
        costPpm: { min: 4_000, max: 8_000 },
        minutes: { min: 8, max: 16 },
        optional: false,
      }),
    ],
    chosenForYou: [
      {
        criterionId: "database",
        criterionLabel: "Database",
        chosenValue: "SQLite",
        optionId: "sqlite",
        basis: "delegated",
        rationale: "Local-first default",
        impactLevel: "high",
        downstreamTaskCount: 2,
        decisionId: "dec-db",
      },
      {
        criterionId: "auth-method",
        criterionLabel: "Sign-in",
        chosenValue: "Email+Password",
        optionId: "email-password",
        basis: "delegated",
        rationale: "Delegated during autopilot",
        impactLevel: "high",
        downstreamTaskCount: 2,
        decisionId: "dec-auth",
        impactedTaskIds: ["W1-auth"],
      },
      {
        criterionId: "manager-edits",
        criterionLabel: "Menu edits",
        chosenValue: "Manager only",
        optionId: "manager",
        basis: "defaulted",
        rationale: "Stage default",
        impactLevel: "medium",
        downstreamTaskCount: 1,
        decisionId: "dec-edits",
      },
    ],
    deferred: [
      {
        decisionId: "dec-polish",
        criterionId: "polish-motion",
        label: "Reduced-motion polish",
        deferredReason: "Optional visual polish",
        revisitWave: "wave-3",
      },
    ],
  });
  return { ...base, ...overrides };
}

export function levelOf(previewTasks: readonly { id: string; crewLevel: CrewLevel }[], id: string): CrewLevel {
  const task = previewTasks.find((item) => item.id === id);
  if (!task) throw new Error(`missing ${id}`);
  return task.crewLevel;
}

export function candidate(overrides: Partial<RevisionCandidate> = {}): RevisionCandidate {
  return {
    revisionId: "rev-1",
    isFirstBuild: false,
    connection: "api",
    deltaTasks: 1,
    deltaCostMicroUsd: 100_000n,
    deltaPlanWindowPpm: 1_000,
    planWindowPpm: 1_000_000,
    nowMs: 1_700_000_000_000,
    unresolvedMustAsk: false,
    unresolvedConflict: false,
    breakingContract: false,
    destructiveMigration: null,
    newPackages: [],
    externalEffects: [],
    ...overrides,
  };
}

export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectStrings(nested, out);
  }
  return out;
}
