import {
  type CompiledTaskFeatures,
  type ModelEntryInit,
  type PassPriors,
  type SpendKind,
  type WorkerLevel,
  passPriors,
} from "../../src/crew-levels/index.js";

export function blankTask(
  overrides: Partial<CompiledTaskFeatures> = {},
): CompiledTaskFeatures {
  return {
    taskId: overrides.taskId ?? "T-1",
    fileCount: overrides.fileCount ?? 1,
    mustBandTokens: overrides.mustBandTokens ?? 100,
    riskTags: overrides.riskTags ?? [],
    contractFanIn: overrides.contractFanIn ?? 0,
    fileRanks: overrides.fileRanks ?? [],
    priorFailedAttempts: overrides.priorFailedAttempts ?? 0,
    roleId: overrides.roleId ?? null,
    migrationKind: overrides.migrationKind ?? "none",
    crossFeatureConflictMerge: overrides.crossFeatureConflictMerge ?? false,
    language: overrides.language ?? "ts",
  };
}

export function complexTask(): CompiledTaskFeatures {
  return blankTask({
    taskId: "T-complex",
    fileCount: 9,
    mustBandTokens: 18_000,
    contractFanIn: 4,
  });
}

export function model(fields: {
  readonly modelId: string;
  readonly tier: WorkerLevel;
  readonly family?: string;
  readonly provider?: string;
  readonly connectionId?: string;
  readonly rate?: bigint;
  readonly allowancePpmPer1M?: bigint;
  readonly priors?: Partial<PassPriors>;
  readonly spendKind?: SpendKind;
  readonly tools?: boolean;
  readonly json?: boolean;
  readonly vision?: boolean;
  readonly contextWindow?: number;
  readonly pinned?: boolean;
  readonly deprecatedAfter?: number | null;
}): ModelEntryInit {
  const spendKind = fields.spendKind ?? "paid-api";
  return {
    modelId: fields.modelId,
    family: fields.family ?? "openai",
    provider: fields.provider ?? (spendKind === "local" ? "ollama" : "openai"),
    connectionId: fields.connectionId ?? "conn-1",
    tier: fields.tier,
    contextWindow: fields.contextWindow ?? 128_000,
    supportsTools: fields.tools ?? true,
    supportsStructuredJson: fields.json ?? true,
    supportsVision: fields.vision ?? false,
    spendKind,
    inputMicroUsdPer1M: fields.rate ?? 0n,
    outputMicroUsdPer1M: 0n,
    cachedInputMicroUsdPer1M: 0n,
    allowancePpmPer1M: fields.allowancePpmPer1M ?? 0n,
    defaultPassPriors: passPriors(fields.tier, fields.priors ?? {}),
    deprecatedAfter: fields.deprecatedAfter ?? null,
    pinned: fields.pinned ?? false,
  };
}
