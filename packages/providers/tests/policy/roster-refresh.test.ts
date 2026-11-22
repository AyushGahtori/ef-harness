import { describe, expect, it } from "vitest";
import {
  VersionedModelRosterPort,
  type RosterModelRecord,
} from "../../src/policy/index.js";
import { createEngine, editablePolicy, signPolicy } from "./fixtures.js";

describe("policy roster refresh", () => {
  it("merges prices, capabilities, and deprecations while preserving pins and local models", () => {
    const roster = new VersionedModelRosterPort();
    const pinned = sample("user-pinned-custom", "user", true);
    pinned.inputMicroUsdPer1M = 123;
    const local = sample("ollama-qwen-14b", "ollama", false);
    local.provider = "ollama";
    local.contextWindow = 32_768;
    roster.upsert(pinned);
    roster.upsert(local);

    const { engine } = createEngine({ roster });
    engine.loadStartup();
    expect(engine.rosterPort().get("user-pinned-custom")?.inputMicroUsdPer1M).toBe(123);
    expect(engine.rosterPort().get("ollama-qwen-14b")?.origin).toBe("ollama");

    const next = editablePolicy();
    next.policyVersion += 1;
    next.publishedAt = "2026-11-22T00:00:00.000Z";
    const oldModel = next.models.find((model) => model.modelId === "model-old-v1");
    const mid = next.models.find((model) => model.modelId === "openai-general-mid");
    const flash = next.models.find((model) => model.modelId === "gemini-api-flash");
    expect(oldModel && mid && flash).toBeTruthy();
    if (!oldModel || !mid || !flash) return;
    oldModel.deprecatedAfter = "2026-11-22T00:00:00.000Z";
    oldModel.replacementModelId = "model-new-v2";
    mid.inputMicroUsdPer1M = 2_700_000;
    mid.supportsVision = false;
    mid.supportsTools = true;
    flash.revoked = true;
    next.models.push({
      ...mid,
      modelId: "model-new-v2",
      family: "openai",
      tier: "mid",
      revoked: false,
      deprecatedAfter: null,
      replacementModelId: null,
      supportsVision: true,
    });

    const applied = engine.ingestRemotePolicy(signPolicy(next));
    expect(applied.applied).toBe(true);

    const preservedPin = roster.get("user-pinned-custom");
    const preservedLocal = roster.get("ollama-qwen-14b");
    expect(preservedPin?.inputMicroUsdPer1M).toBe(123);
    expect(preservedPin?.pinnedByUser).toBe(true);
    expect(preservedLocal?.contextWindow).toBe(32_768);
    expect(preservedLocal?.origin).toBe("ollama");

    const updated = roster.get("openai-general-mid");
    expect(updated?.inputMicroUsdPer1M).toBe(2_700_000);
    expect(updated?.supportsVision).toBe(false);

    const parked = JSON.parse('{"modelId":"model-old-v1"}') as { modelId: string };
    const resolution = roster.resolveReference(parked.modelId);
    expect(resolution.found).toBe(true);
    expect(resolution.recommendation).toContain("model-new-v2");
    expect(resolution.replacementModelId).toBe("model-new-v2");

    expect(roster.selectable().some((model) => model.modelId === "gemini-api-flash")).toBe(false);
    expect(() => roster.resolveReference("gemini-api-flash")).not.toThrow();
    expect(roster.resolveReference("gemini-api-flash").selectable).toBe(false);
    expect(roster.get("model-new-v2")?.origin).toBe("policy");
  });
});

function sample(
  modelId: string,
  origin: RosterModelRecord["origin"],
  pinnedByUser: boolean,
): RosterModelRecord {
  return {
    modelId,
    family: "custom",
    provider: "custom",
    tier: "mid",
    contextWindow: 16_384,
    supportsTools: true,
    supportsStructuredJson: true,
    supportsVision: false,
    inputMicroUsdPer1M: 0,
    outputMicroUsdPer1M: 0,
    cachedInputMicroUsdPer1M: 0,
    defaultPassPriors: { standard: 0.5 },
    deprecatedAfter: null,
    replacementModelId: null,
    revoked: false,
    origin,
    pinnedByUser,
  };
}
