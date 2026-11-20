import type { DepthCatalogEntry, DepthClock, MustAskClass, ProjectStage } from "../../src/depth/index.js";

export const FIXED_CLOCK: DepthClock = { now: () => 1_700_000_000_000 };

const ALL_STAGES: Record<ProjectStage, boolean> = { prototype: true, mvp: true, production: true };

export function catalogEntry(
  overrides: {
    readonly criterionId: string;
    readonly label: string;
  } & Partial<Omit<DepthCatalogEntry, "criterionId" | "label">>,
): DepthCatalogEntry {
  const options = overrides.options ?? [
    { id: "recommended", label: "Recommended" },
    { id: "other", label: "Other" },
  ];
  const recommendations = overrides.recommendations ?? [
    {
      stage: "prototype" as const,
      optionId: options[0]?.id ?? "recommended",
      rationale: "Prototype recommendation.",
      safeForLowerStage: true,
    },
    {
      stage: "mvp" as const,
      optionId: options[0]?.id ?? "recommended",
      rationale: "MVP recommendation.",
      safeForLowerStage: true,
    },
    {
      stage: "production" as const,
      optionId: options[1]?.id ?? "other",
      rationale: "Production recommendation.",
      safeForLowerStage: false,
    },
  ];
  return {
    criterionId: overrides.criterionId,
    label: overrides.label,
    riskTier: overrides.riskTier ?? "low",
    reworkCost: overrides.reworkCost ?? "easy",
    downstreamTaskCount: overrides.downstreamTaskCount ?? 0,
    options,
    recommendations,
    stageApplicability: overrides.stageApplicability ?? ALL_STAGES,
    strongConventionStages: overrides.strongConventionStages ?? ["prototype", "mvp"],
    evidenceSettled: overrides.evidenceSettled ?? false,
    mustAskClass: overrides.mustAskClass ?? null,
    domain: overrides.domain ?? "general",
    deploymentObvious: overrides.deploymentObvious ?? false,
    materialOptionDifference: overrides.materialOptionDifference ?? false,
    conflict: overrides.conflict ?? false,
    highRiskSpecExpander: overrides.highRiskSpecExpander ?? false,
    ambiguousBrownfield: overrides.ambiguousBrownfield ?? false,
  };
}

export function lowImpact(criterionId: string, label: string): DepthCatalogEntry {
  return catalogEntry({
    criterionId,
    label,
    riskTier: "low",
    reworkCost: "easy",
    downstreamTaskCount: 0,
    strongConventionStages: ["prototype", "mvp"],
    options: [
      { id: "not_in_this_release", label: "Not in this release" },
      { id: "under_20", label: "Under 20" },
    ],
    recommendations: [
      {
        stage: "prototype",
        optionId: "not_in_this_release",
        rationale: "Prototype does not size for this.",
        safeForLowerStage: true,
      },
      {
        stage: "mvp",
        optionId: "not_in_this_release",
        rationale: "MVP keeps this lightweight.",
        safeForLowerStage: true,
      },
      {
        stage: "production",
        optionId: "under_20",
        rationale: "Production confirms the user band.",
        safeForLowerStage: false,
      },
    ],
  });
}

export function mediumImpact(criterionId: string, label: string): DepthCatalogEntry {
  return catalogEntry({
    criterionId,
    label,
    riskTier: "medium",
    reworkCost: "moderate",
    downstreamTaskCount: 0,
    strongConventionStages: ["prototype"],
    domain: "cross_cutting",
    options: [
      { id: "not_in_this_release", label: "Not in this release" },
      { id: "basic", label: "Basic" },
      { id: "durable", label: "Durable" },
    ],
    recommendations: [
      {
        stage: "prototype",
        optionId: "not_in_this_release",
        rationale: "Prototype defers this cross-cutting concern.",
        safeForLowerStage: true,
      },
      {
        stage: "mvp",
        optionId: "basic",
        rationale: "MVP uses the basic option.",
        safeForLowerStage: true,
      },
      {
        stage: "production",
        optionId: "durable",
        rationale: "Production uses the durable option.",
        safeForLowerStage: false,
      },
    ],
  });
}

export function highOpen(criterionId: string, label: string, downstreamTaskCount = 0): DepthCatalogEntry {
  return catalogEntry({
    criterionId,
    label,
    riskTier: "critical",
    reworkCost: "hard",
    downstreamTaskCount,
    strongConventionStages: [],
    materialOptionDifference: true,
    options: [
      { id: "keep", label: "Keep" },
      { id: "change", label: "Change" },
    ],
    recommendations: stageRecommendations("keep", "Keep this for the active stage."),
  });
}

export function mustAsk(mustAskClass: MustAskClass, criterionId: string, label: string): DepthCatalogEntry {
  const domain =
    mustAskClass === "authentication_roles"
      ? "authentication"
      : mustAskClass === "payments_side_effects"
        ? "payments"
        : mustAskClass === "retention_privacy_pii"
          ? "sensitive_data"
          : mustAskClass === "core_workflow"
            ? "workflow"
            : mustAskClass === "deployment_target"
              ? "deployment"
              : "general";
  return catalogEntry({
    criterionId,
    label,
    mustAskClass,
    domain,
    riskTier: "high",
    reworkCost: "hard",
    deploymentObvious: false,
    recommendations: stageRecommendations("recommended", "A recommendation exists but must not be auto-settled."),
  });
}

export function stageRecommendations(optionId: string, rationale: string): DepthCatalogEntry["recommendations"] {
  return (["prototype", "mvp", "production"] as const).map((stage) => ({
    stage,
    optionId,
    rationale,
    safeForLowerStage: stage !== "production",
  }));
}

export function countedOpen(entries: readonly { status: string; basis?: string; mustAsk: boolean }[]): number {
  return entries.filter((entry) => entry.status === "open" && entry.basis === undefined && !entry.mustAsk).length;
}
