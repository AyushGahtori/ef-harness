import { describe, expect, it } from "vitest";
import {
  decimalDollarsToMicroUsd,
  LocalBudgetLedger,
  LocalSignedProviderPolicyEngine,
  LocalVersionedModelRoster,
  microUsdForTokens,
  UNPRICED_CUSTOM_LABEL,
  USER_RATE_LABEL,
  VersionedPriceTableEstimator,
  type ModelMicroUsdRates,
} from "../../src/api-keys/index.js";

describe("VersionedPriceTableEstimator", () => {
  it("prices every token bucket as exact integer micro-USD and applies cached-read rates", () => {
    const estimator = new VersionedPriceTableEstimator();
    const cached = estimator.estimate({
      modelId: "claude-sonnet",
      inputTokens: 1_500n,
      cachedReadTokens: 8_500n,
      outputTokens: 0n,
      cacheWriteTokens: 0n,
      reasoningTokens: 0n,
      connectionId: "conn-cache",
    });
    const fresh = estimator.estimate({
      modelId: "claude-sonnet",
      inputTokens: 10_000n,
      cachedReadTokens: 0n,
      outputTokens: 0n,
      cacheWriteTokens: 0n,
      reasoningTokens: 0n,
    });
    expect(cached.costMicroUsd).toBe(7_050n);
    expect(fresh.costMicroUsd).toBe(30_000n);
    expect(fresh.costMicroUsd > cached.costMicroUsd * 4n).toBe(true);
    expect(cached.pricingStatus).toBe("estimated");
    expect(cached.estimated).toBe(true);
    expect(cached.pricingSource).toBe("estimated");
    expect(cached.label).toBe("Estimated from published rates (price table v2026.11)");

    const full = estimator.estimate({
      modelId: "claude-sonnet",
      inputTokens: 1_500n,
      cachedReadTokens: 8_500n,
      outputTokens: 200n,
      cacheWriteTokens: 400n,
      reasoningTokens: 50n,
    });
    expect(full.costMicroUsd).toBe(12_300n);
    expect(full.inputTokens).toBe(1_500n);
    expect(full.cachedReadTokens).toBe(8_500n);
    expect(full.cacheWriteTokens).toBe(400n);
    expect(full.reasoningTokens).toBe(50n);
  });

  it("keeps integer math exact where a floating conversion cannot", () => {
    const tokens = 9_007_199_254_740_993n;
    expect(microUsdForTokens(tokens, 1_000_000n)).toBe(tokens);
    expect(microUsdForTokens(1n, 500_000n)).toBe(1n);
    expect(microUsdForTokens(1n, 499_999n)).toBe(0n);
    expect(decimalDollarsToMicroUsd("0.012345")).toBe(12_345n);
    expect(decimalDollarsToMicroUsd("9007199254740993.5")).toBe(9_007_199_254_740_993_500_000n);
    expect(decimalDollarsToMicroUsd("0.0000005")).toBe(1n);
    expect(decimalDollarsToMicroUsd("0.0000004")).toBe(0n);
  });

  it("labels provider-reported costs separately from the estimate", () => {
    const ledger = new LocalBudgetLedger();
    const estimator = new VersionedPriceTableEstimator({ ledger });
    const quote = estimator.quote(
      {
        modelId: "openrouter-auto",
        connectionId: "conn-or",
        inputTokens: 1_000n,
        outputTokens: 0n,
      },
      { usageCostDecimal: "0.012345" },
    );
    expect(quote.estimated.estimated).toBe(true);
    expect(quote.estimated.pricingSource).toBe("estimated");
    expect(quote.estimated.costMicroUsd).toBe(1_000n);
    expect(quote.providerReported).toMatchObject({
      estimated: false,
      pricingSource: "provider_reported",
      pricingStatus: "provider_reported",
      costMicroUsd: 12_345n,
      connectionId: "conn-or",
    });
    expect(ledger.listByConnection("conn-or")).toHaveLength(2);
    const integer = estimator.ingestProviderReported({
      modelId: "openrouter-auto",
      inputTokens: 1n,
      outputTokens: 1n,
      costMicroUsd: 42n,
    });
    expect(integer.pricingSource).toBe("provider_reported");
    expect(integer.costMicroUsd).toBe(42n);
  });

  it("does not invent a dollar price for a custom endpoint and still counts tokens", () => {
    const estimator = new VersionedPriceTableEstimator();
    const unpriced = estimator.estimate({
      modelId: "corp-proxy-model",
      endpointKind: "custom",
      inputTokens: 123n,
      outputTokens: 45n,
      cachedReadTokens: 7n,
      cacheWriteTokens: 8n,
      reasoningTokens: 9n,
    });
    expect(unpriced).toMatchObject({
      pricingStatus: "unpriced_custom_endpoint",
      pricingSource: "unpriced",
      estimated: false,
      costMicroUsd: 0n,
      label: UNPRICED_CUSTOM_LABEL,
      inputTokens: 123n,
      outputTokens: 45n,
      cachedReadTokens: 7n,
      cacheWriteTokens: 8n,
      reasoningTokens: 9n,
    });
    const zeros = estimator.estimate({
      modelId: "corp-proxy-model",
      endpointKind: "custom",
      inputTokens: 10n,
      outputTokens: 10n,
      customRates: {
        inputMicroUsdPer1M: 0n,
        outputMicroUsdPer1M: 0n,
        cachedInputReadMicroUsdPer1M: 0n,
        cacheWriteMicroUsdPer1M: 0n,
        reasoningTokenMicroUsdPer1M: 0n,
      },
    });
    expect(zeros.pricingStatus).toBe("unpriced_custom_endpoint");
    const user = estimator.estimate({
      modelId: "corp-proxy-model",
      endpointKind: "custom",
      inputTokens: 1_000n,
      outputTokens: 0n,
      customRates: {
        inputMicroUsdPer1M: 1_000_000n,
        outputMicroUsdPer1M: 2_000_000n,
        cachedInputReadMicroUsdPer1M: 100_000n,
        cacheWriteMicroUsdPer1M: 1_250_000n,
        reasoningTokenMicroUsdPer1M: 2_000_000n,
      },
    });
    expect(user).toMatchObject({
      pricingStatus: "estimated",
      estimated: true,
      label: USER_RATE_LABEL,
      costMicroUsd: 1_000n,
    });
  });

  it("applies a policy price-table update and refuses mixed currencies", () => {
    const replacement: ModelMicroUsdRates = {
      modelId: "rounding-probe",
      provider: "openai",
      inputMicroUsdPer1M: 500_000n,
      outputMicroUsdPer1M: 0n,
      cachedInputReadMicroUsdPer1M: 0n,
      cacheWriteMicroUsdPer1M: 0n,
      reasoningTokenMicroUsdPer1M: 0n,
    };
    const estimator = new VersionedPriceTableEstimator({
      policy: new LocalSignedProviderPolicyEngine(undefined),
      roster: new LocalVersionedModelRoster([
        { modelId: "plan-model", provider: "openai", currency: "ppm" },
        { modelId: "local-model", provider: "ollama", currency: "local_slots" },
        {
          modelId: "roster-only",
          provider: "openai",
          currency: "micro_usd",
          rates: {
            modelId: "roster-only",
            provider: "openai",
            inputMicroUsdPer1M: 2_000_000n,
            outputMicroUsdPer1M: 0n,
            cachedInputReadMicroUsdPer1M: 0n,
            cacheWriteMicroUsdPer1M: 0n,
            reasoningTokenMicroUsdPer1M: 0n,
          },
        },
      ]),
    });
    estimator.applyPolicyUpdate({ priceTableVersion: "2026.12", models: [replacement], mode: "replace" });
    const rounded = estimator.estimate({ modelId: "rounding-probe", inputTokens: 1n, outputTokens: 0n });
    expect(rounded.label).toBe("Estimated from published rates (price table v2026.12)");
    expect(rounded.costMicroUsd).toBe(1n);
    const fromRoster = estimator.estimate({ modelId: "roster-only", inputTokens: 1_000_000n, outputTokens: 0n });
    expect(fromRoster.costMicroUsd).toBe(2_000_000n);
    expect(() => estimator.estimate({ modelId: "plan-model", inputTokens: 1n, outputTokens: 0n })).toThrow(/ppm/);
    expect(() => estimator.estimate({ modelId: "local-model", inputTokens: 1n, outputTokens: 0n })).toThrow(/local slots/);
    const missing = estimator.estimate({ modelId: "missing-model", inputTokens: 4n, outputTokens: 5n });
    expect(missing).toMatchObject({ pricingStatus: "unpriced_unknown_model", costMicroUsd: 0n, inputTokens: 4n, outputTokens: 5n, estimated: false });
  });

  it("exposes deterministic prompt-cache economics per provider", () => {
    const estimator = new VersionedPriceTableEstimator();
    expect(estimator.cacheEconomics("anthropic")).toEqual(estimator.cacheEconomics("anthropic"));
    expect(estimator.cacheEconomics("anthropic")).toMatchObject({
      mechanism: "ephemeral_breakpoints",
      prefixStability: "required",
      stablePrefixRequired: true,
      cacheTtlSeconds: 300,
      breakpointControl: "explicit",
    });
    expect(estimator.cacheEconomics("openai")).toMatchObject({
      mechanism: "automatic_prefix",
      prefixStability: "automatic",
      cacheTtlSeconds: 600,
    });
    expect(estimator.cacheEconomics("gemini")).toMatchObject({
      mechanism: "context_cache",
      prefixStability: "explicit_cache",
      cacheTtlSeconds: 3600,
    });
    expect(estimator.cacheEconomics("openrouter")).toMatchObject({
      mechanism: "upstream_passthrough",
      cacheTtlSeconds: null,
    });
    expect(estimator.cacheEconomics("custom")).toMatchObject({
      mechanism: "none",
      prefixStability: "unsupported",
      stablePrefixRequired: false,
      cacheTtlSeconds: null,
    });
    expect(estimator.listCacheEconomics().map((hint) => hint.provider)).toEqual([
      "anthropic",
      "openai",
      "gemini",
      "openrouter",
      "custom",
    ]);
  });
});
