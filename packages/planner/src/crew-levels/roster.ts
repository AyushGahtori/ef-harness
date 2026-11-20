import { CrewLevelsError } from "./errors.js";
import { assertNonNegativeMoney, assertSafeCount } from "./money.js";
import {
  type CostCurrency,
  type DifficultyTier,
  type ModelRosterEntry,
  type PassPriors,
  type SpendKind,
  type WorkerLevel,
  entryCurrency,
} from "./types.js";

export interface ModelEntryInit {
  readonly modelId: string;
  readonly family: string;
  readonly provider: string;
  readonly connectionId: string;
  readonly tier: WorkerLevel;
  readonly contextWindow: number;
  readonly supportsTools: boolean;
  readonly supportsStructuredJson: boolean;
  readonly supportsVision: boolean;
  readonly spendKind: SpendKind;
  readonly inputMicroUsdPer1M: bigint;
  readonly outputMicroUsdPer1M: bigint;
  readonly cachedInputMicroUsdPer1M: bigint;
  readonly allowancePpmPer1M: bigint;
  readonly defaultPassPriors: PassPriors;
  readonly deprecatedAfter: number | null;
  readonly pinned: boolean;
}

export interface SignedProviderPolicy {
  readonly revision: number;
  readonly signed: true;
  readonly revokeModelIds: readonly string[];
  readonly upserts: readonly ModelEntryInit[];
  readonly deprecations: readonly {
    readonly modelId: string;
    readonly deprecatedAfter: number | null;
  }[];
}

export interface LocalModelCapabilities {
  readonly source: "ollama" | "lm-studio";
  readonly models: readonly ModelEntryInit[];
}

export interface SubscriptionWeight {
  readonly modelId: string;
  readonly allowancePpmPer1M: bigint;
}

export type RosterSource =
  | "seed"
  | "signed-policy"
  | "local-capabilities"
  | "subscription-weights";

const DEFAULTS: Readonly<Record<WorkerLevel, PassPriors>> = {
  junior: { trivial: 0.9, standard: 0.62, complex: 0.28, critical: 0.12 },
  mid: { trivial: 0.96, standard: 0.88, complex: 0.7, critical: 0.45 },
  senior: { trivial: 0.98, standard: 0.94, complex: 0.9, critical: 0.78 },
  principal: { trivial: 0.98, standard: 0.97, complex: 0.94, critical: 0.9 },
};

export function defaultPassPriors(tier: WorkerLevel): PassPriors {
  switch (tier) {
    case "junior":
      return DEFAULTS.junior;
    case "mid":
      return DEFAULTS.mid;
    case "senior":
      return DEFAULTS.senior;
    case "principal":
      return DEFAULTS.principal;
  }
}

export function passPriors(
  tier: WorkerLevel,
  overrides: Partial<PassPriors> = {},
): PassPriors {
  const base = defaultPassPriors(tier);
  return {
    trivial: overrides.trivial ?? base.trivial,
    standard: overrides.standard ?? base.standard,
    complex: overrides.complex ?? base.complex,
    critical: overrides.critical ?? base.critical,
  };
}

function copyPriors(priors: PassPriors): PassPriors {
  return {
    trivial: priors.trivial,
    standard: priors.standard,
    complex: priors.complex,
    critical: priors.critical,
  };
}

function assertPrior(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new CrewLevelsError("bad-model", `${label} prior must be in (0, 1]`);
  }
}

export function normalizeModelEntry(input: ModelEntryInit): ModelRosterEntry {
  if (input.modelId.trim().length === 0) {
    throw new CrewLevelsError("bad-model", "modelId is required");
  }
  if (input.family.trim().length === 0 || input.provider.trim().length === 0) {
    throw new CrewLevelsError("bad-model", "family and provider are required");
  }
  if (input.connectionId.trim().length === 0) {
    throw new CrewLevelsError("bad-model", "connectionId is required");
  }
  assertSafeCount(input.contextWindow, "contextWindow");
  if (input.contextWindow <= 0) {
    throw new CrewLevelsError("bad-model", "contextWindow must be positive");
  }
  assertNonNegativeMoney(input.inputMicroUsdPer1M, "inputMicroUsdPer1M");
  assertNonNegativeMoney(input.outputMicroUsdPer1M, "outputMicroUsdPer1M");
  assertNonNegativeMoney(input.cachedInputMicroUsdPer1M, "cachedInputMicroUsdPer1M");
  assertNonNegativeMoney(input.allowancePpmPer1M, "allowancePpmPer1M");
  const tiers: DifficultyTier[] = ["trivial", "standard", "complex", "critical"];
  for (const tier of tiers) {
    const value =
      tier === "trivial"
        ? input.defaultPassPriors.trivial
        : tier === "standard"
          ? input.defaultPassPriors.standard
          : tier === "complex"
            ? input.defaultPassPriors.complex
            : input.defaultPassPriors.critical;
    assertPrior(value, tier);
  }
  if (
    input.deprecatedAfter !== null &&
    (!Number.isSafeInteger(input.deprecatedAfter) || input.deprecatedAfter < 0)
  ) {
    throw new CrewLevelsError("bad-model", "deprecatedAfter must be epoch milliseconds or null");
  }
  return {
    modelId: input.modelId,
    family: input.family,
    provider: input.provider,
    connectionId: input.connectionId,
    tier: input.tier,
    contextWindow: input.contextWindow,
    supportsTools: input.supportsTools,
    supportsStructuredJson: input.supportsStructuredJson,
    supportsVision: input.supportsVision,
    spendKind: input.spendKind,
    inputMicroUsdPer1M: input.inputMicroUsdPer1M,
    outputMicroUsdPer1M: input.outputMicroUsdPer1M,
    cachedInputMicroUsdPer1M: input.cachedInputMicroUsdPer1M,
    allowancePpmPer1M: input.allowancePpmPer1M,
    defaultPassPriors: copyPriors(input.defaultPassPriors),
    deprecatedAfter: input.deprecatedAfter,
    pinned: input.pinned,
  };
}

function sortEntries(entries: readonly ModelRosterEntry[]): ModelRosterEntry[] {
  return [...entries].sort((left, right) =>
    left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0,
  );
}

export interface EligibilityQuery {
  readonly nowMs: number;
  readonly currency: CostCurrency;
  readonly requireTools: boolean;
  readonly requireStructuredJson: boolean;
  readonly requireVision: boolean;
}

export class VersionedModelRoster {
  private constructor(
    readonly version: number,
    readonly entries: readonly ModelRosterEntry[],
    readonly revokedModelIds: readonly string[],
    readonly source: RosterSource,
    readonly policyRevision: number | null,
    private readonly prior: VersionedModelRoster | null,
  ) {}

  static seed(
    models: readonly ModelEntryInit[],
    version = 1,
  ): VersionedModelRoster {
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new CrewLevelsError("bad-model", "roster version must be a positive integer");
    }
    return new VersionedModelRoster(
      version,
      sortEntries(uniqueEntries(models.map(normalizeModelEntry))),
      [],
      "seed",
      null,
      null,
    );
  }

  modelsAt(version: number): readonly ModelRosterEntry[] | null {
    if (version === this.version) return this.entries;
    return this.prior?.modelsAt(version) ?? null;
  }

  isRevoked(modelId: string): boolean {
    return this.revokedModelIds.includes(modelId);
  }

  isDeprecated(entry: ModelRosterEntry, nowMs: number): boolean {
    return entry.deprecatedAfter !== null && nowMs >= entry.deprecatedAfter;
  }

  eligible(query: EligibilityQuery): readonly ModelRosterEntry[] {
    return this.entries.filter((entry) => {
      if (this.isRevoked(entry.modelId)) return false;
      if (this.isDeprecated(entry, query.nowMs)) return false;
      if (entryCurrency(entry) !== query.currency) return false;
      if (query.requireTools && !entry.supportsTools) return false;
      if (query.requireStructuredJson && !entry.supportsStructuredJson) return false;
      if (query.requireVision && !entry.supportsVision) return false;
      return true;
    });
  }

  activeFamilies(query: EligibilityQuery): readonly string[] {
    const families = new Set<string>();
    for (const entry of this.eligible(query)) families.add(entry.family);
    return [...families].sort();
  }

  applySignedPolicy(policy: SignedProviderPolicy): VersionedModelRoster {
    if (policy.signed !== true) {
      throw new CrewLevelsError("unsigned-policy", "provider policy must be signed");
    }
    if (!Number.isSafeInteger(policy.revision) || policy.revision < 1) {
      throw new CrewLevelsError("bad-model", "policy revision must be a positive integer");
    }
    const revoked = new Set(this.revokedModelIds);
    for (const modelId of policy.revokeModelIds) revoked.add(modelId);
    const byId = new Map(this.entries.map((entry) => [entry.modelId, entry]));
    for (const upsert of policy.upserts) {
      const normalized = normalizeModelEntry(upsert);
      const existing = byId.get(normalized.modelId);
      if (existing?.pinned === true && !revoked.has(normalized.modelId)) continue;
      byId.set(normalized.modelId, normalized);
    }
    for (const deprecation of policy.deprecations) {
      const existing = byId.get(deprecation.modelId);
      if (existing === undefined) continue;
      if (existing.pinned && !revoked.has(existing.modelId)) continue;
      byId.set(existing.modelId, {
        ...existing,
        deprecatedAfter: deprecation.deprecatedAfter,
      });
    }
    return this.next(
      sortEntries([...byId.values()]),
      [...revoked].sort(),
      "signed-policy",
      policy.revision,
    );
  }

  applyLocalCapabilities(update: LocalModelCapabilities): VersionedModelRoster {
    const byId = new Map(this.entries.map((entry) => [entry.modelId, entry]));
    for (const model of update.models) {
      const normalized = normalizeModelEntry({
        ...model,
        provider: model.provider.trim().length === 0 ? update.source : model.provider,
        spendKind: "local",
      });
      const existing = byId.get(normalized.modelId);
      if (existing?.pinned === true && !this.isRevoked(normalized.modelId)) continue;
      byId.set(normalized.modelId, normalized);
    }
    return this.next(
      sortEntries([...byId.values()]),
      this.revokedModelIds,
      "local-capabilities",
      null,
    );
  }

  applySubscriptionWeights(weights: readonly SubscriptionWeight[]): VersionedModelRoster {
    const weightById = new Map<string, bigint>();
    for (const weight of weights) {
      assertNonNegativeMoney(weight.allowancePpmPer1M, "allowancePpmPer1M");
      weightById.set(weight.modelId, weight.allowancePpmPer1M);
    }
    const entries = this.entries.map((entry) => {
      const weight = weightById.get(entry.modelId);
      if (weight === undefined || entry.spendKind !== "subscription") return entry;
      return { ...entry, allowancePpmPer1M: weight };
    });
    return this.next(entries, this.revokedModelIds, "subscription-weights", null);
  }

  private next(
    entries: readonly ModelRosterEntry[],
    revokedModelIds: readonly string[],
    source: RosterSource,
    policyRevision: number | null,
  ): VersionedModelRoster {
    return new VersionedModelRoster(
      this.version + 1,
      entries,
      revokedModelIds,
      source,
      policyRevision,
      this,
    );
  }
}

function uniqueEntries(entries: readonly ModelRosterEntry[]): ModelRosterEntry[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.modelId)) {
      throw new CrewLevelsError("bad-model", `duplicate modelId ${entry.modelId}`);
    }
    seen.add(entry.modelId);
  }
  return [...entries];
}
