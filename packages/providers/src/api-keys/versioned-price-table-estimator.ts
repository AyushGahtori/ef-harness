import { randomUUID } from "node:crypto";
import {
  ApiKeyOnboardingError,
  type ApiCostLedgerEntry,
  type ApiKeyProviderId,
  type CustomRateTable,
  type ModelMicroUsdRates,
  type PricingSource,
  type PricingStatus,
  type PromptCacheEconomicsHint,
  type TurnTokenUsage,
} from "./api-key-types.js";
import type { BudgetLedgerPort } from "./local-budget-ledger.js";
import {
  assertRateTable,
  asNonNegativeBigInt,
  decimalDollarsToMicroUsd,
  microUsdForTokens,
  rateTableIsZero,
} from "./integer-micro-usd.js";
import { BUNDLED_PRICE_TABLE_VERSION, bundledPriceModels } from "./price-table.js";
import { estimatedPriceLabel, UNPRICED_CUSTOM_LABEL, USER_RATE_LABEL } from "./prefix-fragments.js";
import type { SignedProviderPolicyEnginePort, VersionedModelRosterPort } from "./sibling-ports.js";

const CACHE_HINTS: Record<ApiKeyProviderId, PromptCacheEconomicsHint> = {
  anthropic: {
    provider: "anthropic",
    mechanism: "ephemeral_breakpoints",
    prefixStability: "required",
    stablePrefixRequired: true,
    cacheTtlSeconds: 300,
    breakpointControl: "explicit",
    guidance:
      "Keep stable project-wide invariant blocks in a deterministic prefix and place ephemeral cache breakpoints after that prefix. Default ephemeral TTL is 300 seconds.",
  },
  openai: {
    provider: "openai",
    mechanism: "automatic_prefix",
    prefixStability: "automatic",
    stablePrefixRequired: true,
    cacheTtlSeconds: 600,
    breakpointControl: "automatic",
    guidance:
      "OpenAI caches a stable prefix automatically. Keep invariant blocks in a deterministic order so sibling turns share the cached prefix. Default hint TTL is 600 seconds.",
  },
  gemini: {
    provider: "gemini",
    mechanism: "context_cache",
    prefixStability: "explicit_cache",
    stablePrefixRequired: true,
    cacheTtlSeconds: 3600,
    breakpointControl: "explicit",
    guidance:
      "Use Gemini context caching for a stable prefix. Default hint TTL is 3600 seconds. Do not put the API key in the cache resource name or URL.",
  },
  openrouter: {
    provider: "openrouter",
    mechanism: "upstream_passthrough",
    prefixStability: "required",
    stablePrefixRequired: true,
    cacheTtlSeconds: null,
    breakpointControl: "upstream",
    guidance:
      "OpenRouter cache behavior follows the upstream provider. Keep the same stable prefix that upstream cache expects. TTL is not fixed by OpenRouter.",
  },
  custom: {
    provider: "custom",
    mechanism: "none",
    prefixStability: "unsupported",
    stablePrefixRequired: false,
    cacheTtlSeconds: null,
    breakpointControl: "none",
    guidance: "Custom endpoints do not advertise prompt-cache economics. Do not assume a cache discount.",
  },
};

const HINT_ORDER: readonly ApiKeyProviderId[] = ["anthropic", "openai", "gemini", "openrouter", "custom"];

export interface PolicyPriceUpdate {
  readonly priceTableVersion: string;
  readonly models: readonly ModelMicroUsdRates[];
  readonly mode?: "replace" | "upsert";
}

export interface ProviderReportedCost {
  readonly modelId: string;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cachedReadTokens?: bigint;
  readonly cacheWriteTokens?: bigint;
  readonly reasoningTokens?: bigint;
  readonly connectionId?: string;
  readonly usageCostDecimal?: string;
  readonly costMicroUsd?: bigint;
}

export interface TurnQuote {
  readonly estimated: ApiCostLedgerEntry;
  readonly providerReported?: ApiCostLedgerEntry;
}

interface TokenCounts {
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly cachedReadTokens: bigint;
  readonly cacheWriteTokens: bigint;
  readonly reasoningTokens: bigint;
}

export class VersionedPriceTableEstimator {
  private version: string;
  private readonly models = new Map<string, ModelMicroUsdRates>();
  private readonly ledger: BudgetLedgerPort | undefined;
  private readonly roster: VersionedModelRosterPort | undefined;

  constructor(options?: {
    readonly ledger?: BudgetLedgerPort;
    readonly roster?: VersionedModelRosterPort;
    readonly policy?: SignedProviderPolicyEnginePort;
  }) {
    const policyTable = options?.policy?.currentPriceTable();
    this.version = policyTable?.version?.trim() || BUNDLED_PRICE_TABLE_VERSION;
    const seed = policyTable?.models ?? bundledPriceModels();
    for (const row of seed) {
      this.models.set(row.modelId, copyRates(row));
    }
    this.ledger = options?.ledger;
    this.roster = options?.roster;
  }

  priceTableVersion(): string {
    return this.version;
  }

  estimate(usage: TurnTokenUsage): ApiCostLedgerEntry {
    const tokens = tokenCounts(usage);
    if (usage.endpointKind === "custom") {
      return this.record(this.customEntry(usage, tokens));
    }
    this.assertMicroUsd(usage.modelId);
    const rates = this.rateFor(usage.modelId);
    if (!rates) {
      return this.record(
        this.entry({
          usage,
          tokens,
          costMicroUsd: 0n,
          pricingSource: "unpriced",
          pricingStatus: "unpriced_unknown_model",
          estimated: false,
          label: `No published micro-USD rate for this model (price table v${this.version})`,
        }),
      );
    }
    return this.record(this.pricedEntry(usage, tokens, rates, estimatedPriceLabel(this.version)));
  }

  ingestProviderReported(input: ProviderReportedCost): ApiCostLedgerEntry {
    const decimal = input.usageCostDecimal;
    const integer = input.costMicroUsd;
    if ((decimal === undefined) === (integer === undefined)) {
      throw new ApiKeyOnboardingError(
        "Provide either a provider decimal dollar cost or an integer micro-USD cost",
      );
    }
    const costMicroUsd =
      integer !== undefined
        ? asNonNegativeBigInt(integer, "costMicroUsd")
        : decimalDollarsToMicroUsd(decimal ?? "");
    const usage: TurnTokenUsage = {
      modelId: input.modelId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      ...(input.cachedReadTokens !== undefined ? { cachedReadTokens: input.cachedReadTokens } : {}),
      ...(input.cacheWriteTokens !== undefined ? { cacheWriteTokens: input.cacheWriteTokens } : {}),
      ...(input.reasoningTokens !== undefined ? { reasoningTokens: input.reasoningTokens } : {}),
      ...(input.connectionId !== undefined ? { connectionId: input.connectionId } : {}),
    };
    return this.record(
      this.entry({
        usage,
        tokens: tokenCounts(usage),
        costMicroUsd,
        pricingSource: "provider_reported",
        pricingStatus: "provider_reported",
        estimated: false,
        label: "Provider-reported cost",
      }),
    );
  }

  quote(usage: TurnTokenUsage, reported?: Omit<ProviderReportedCost, "modelId" | "inputTokens" | "outputTokens" | "cachedReadTokens" | "cacheWriteTokens" | "reasoningTokens" | "connectionId">): TurnQuote {
    const estimated = this.estimate(usage);
    if (!reported) return { estimated };
    const providerReported = this.ingestProviderReported({
      modelId: usage.modelId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ...(usage.cachedReadTokens !== undefined ? { cachedReadTokens: usage.cachedReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(usage.reasoningTokens !== undefined ? { reasoningTokens: usage.reasoningTokens } : {}),
      ...(usage.connectionId !== undefined ? { connectionId: usage.connectionId } : {}),
      ...(reported.usageCostDecimal !== undefined ? { usageCostDecimal: reported.usageCostDecimal } : {}),
      ...(reported.costMicroUsd !== undefined ? { costMicroUsd: reported.costMicroUsd } : {}),
    });
    return { estimated, providerReported };
  }

  applyPolicyUpdate(update: PolicyPriceUpdate): void {
    const version = update.priceTableVersion.trim();
    if (version.length === 0) {
      throw new ApiKeyOnboardingError("Price table version is required");
    }
    const mode = update.mode ?? "upsert";
    if (mode === "replace") this.models.clear();
    const seen = new Set<string>();
    for (const model of update.models) {
      if (seen.has(model.modelId)) {
        throw new ApiKeyOnboardingError(`Duplicate price row for ${model.modelId}`);
      }
      seen.add(model.modelId);
      this.models.set(model.modelId, copyRates(model));
    }
    this.version = version;
  }

  cacheEconomics(provider: ApiKeyProviderId): PromptCacheEconomicsHint {
    return { ...CACHE_HINTS[provider] };
  }

  listCacheEconomics(): readonly PromptCacheEconomicsHint[] {
    return HINT_ORDER.map((provider) => this.cacheEconomics(provider));
  }

  private customEntry(usage: TurnTokenUsage, tokens: TokenCounts): ApiCostLedgerEntry {
    const supplied = usage.customRates;
    if (!supplied || rateTableIsZero(assertRateTable(supplied))) {
      return this.entry({
        usage,
        tokens,
        costMicroUsd: 0n,
        pricingSource: "unpriced",
        pricingStatus: "unpriced_custom_endpoint",
        estimated: false,
        label: UNPRICED_CUSTOM_LABEL,
      });
    }
    return this.pricedEntry(usage, tokens, assertRateTable(supplied), USER_RATE_LABEL);
  }

  private pricedEntry(
    usage: TurnTokenUsage,
    tokens: TokenCounts,
    rates: CustomRateTable,
    label: string,
  ): ApiCostLedgerEntry {
    const safe = assertRateTable(rates);
    const costMicroUsd =
      microUsdForTokens(tokens.inputTokens, safe.inputMicroUsdPer1M) +
      microUsdForTokens(tokens.outputTokens, safe.outputMicroUsdPer1M) +
      microUsdForTokens(tokens.cachedReadTokens, safe.cachedInputReadMicroUsdPer1M) +
      microUsdForTokens(tokens.cacheWriteTokens, safe.cacheWriteMicroUsdPer1M) +
      microUsdForTokens(tokens.reasoningTokens, safe.reasoningTokenMicroUsdPer1M);
    return this.entry({
      usage,
      tokens,
      costMicroUsd,
      pricingSource: "estimated",
      pricingStatus: "estimated",
      estimated: true,
      label,
    });
  }

  private entry(input: {
    readonly usage: TurnTokenUsage;
    readonly tokens: TokenCounts;
    readonly costMicroUsd: bigint;
    readonly pricingSource: PricingSource;
    readonly pricingStatus: PricingStatus;
    readonly estimated: boolean;
    readonly label: string;
  }): ApiCostLedgerEntry {
    const connectionId = input.usage.connectionId;
    return {
      entryId: `cost-${randomUUID()}`,
      connectionId: connectionId && connectionId.length > 0 ? connectionId : null,
      modelId: input.usage.modelId,
      priceTableVersion: this.version,
      pricingSource: input.pricingSource,
      pricingStatus: input.pricingStatus,
      estimated: input.estimated,
      label: input.label,
      costMicroUsd: input.costMicroUsd,
      ...input.tokens,
    };
  }

  private record(entry: ApiCostLedgerEntry): ApiCostLedgerEntry {
    this.ledger?.record(entry);
    return entry;
  }

  private rateFor(modelId: string): ModelMicroUsdRates | undefined {
    const fromTable = this.models.get(modelId);
    if (fromTable) return fromTable;
    const fromRoster = this.roster?.describe(modelId)?.rates;
    if (!fromRoster || fromRoster.modelId !== modelId) return undefined;
    return copyRates(fromRoster);
  }

  private assertMicroUsd(modelId: string): void {
    const described = this.roster?.describe(modelId);
    if (!described || described.currency === "micro_usd") return;
    if (described.currency === "ppm") {
      throw new ApiKeyOnboardingError(
        "This model is priced in ppm plan allowance, not micro-USD. API key estimates cannot mix those currencies.",
      );
    }
    throw new ApiKeyOnboardingError("This model is priced in local slots, not micro-USD.");
  }
}

function tokenCounts(usage: TurnTokenUsage): TokenCounts {
  return {
    inputTokens: asNonNegativeBigInt(usage.inputTokens, "inputTokens"),
    outputTokens: asNonNegativeBigInt(usage.outputTokens, "outputTokens"),
    cachedReadTokens: asNonNegativeBigInt(usage.cachedReadTokens ?? 0n, "cachedReadTokens"),
    cacheWriteTokens: asNonNegativeBigInt(usage.cacheWriteTokens ?? 0n, "cacheWriteTokens"),
    reasoningTokens: asNonNegativeBigInt(usage.reasoningTokens ?? 0n, "reasoningTokens"),
  };
}

function copyRates(row: ModelMicroUsdRates): ModelMicroUsdRates {
  const safe = assertRateTable(row);
  if (row.modelId.trim().length === 0) {
    throw new ApiKeyOnboardingError("Price row model id is required");
  }
  return { ...safe, modelId: row.modelId, provider: row.provider };
}
