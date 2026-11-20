import { describe, expect, it } from "vitest";
import { VersionedModelRoster, passPriors } from "../../src/crew-levels/index.js";
import { model } from "./fixtures.js";

describe("VersionedModelRoster", () => {
  it("keeps versions, pinned custom models, and signed revocations", () => {
    const pinned = model({
      modelId: "local-pinned",
      tier: "junior",
      family: "ollama",
      spendKind: "local",
      pinned: true,
      provider: "ollama",
    });
    const seed = VersionedModelRoster.seed([
      pinned,
      model({ modelId: "api-senior", tier: "senior", family: "anthropic" }),
    ]);
    const revised = seed
      .applySignedPolicy({
        revision: 4,
        signed: true,
        revokeModelIds: ["api-senior"],
        upserts: [
          model({
            modelId: "local-pinned",
            tier: "senior",
            family: "replaced",
            spendKind: "local",
            pinned: true,
          }),
          model({ modelId: "api-mid", tier: "mid", family: "google", deprecatedAfter: 5_000 }),
        ],
        deprecations: [],
      })
      .applyLocalCapabilities({
        source: "ollama",
        models: [
          model({
            modelId: "llama-14b",
            tier: "mid",
            family: "llama",
            spendKind: "paid-api",
            provider: "",
            tools: false,
            json: false,
            contextWindow: 8_192,
          }),
        ],
      })
      .applySubscriptionWeights([
        { modelId: "sub-model", allowancePpmPer1M: 400n },
        { modelId: "api-mid", allowancePpmPer1M: 999n },
      ]);

    expect(seed.version).toBe(1);
    expect(revised.version).toBe(4);
    expect(revised.modelsAt(1)?.map((entry) => entry.modelId).sort()).toEqual([
      "api-senior",
      "local-pinned",
    ]);
    const kept = revised.entries.find((entry) => entry.modelId === "local-pinned");
    expect(kept?.family).toBe("ollama");
    expect(kept?.tier).toBe("junior");
    expect(revised.isRevoked("api-senior")).toBe(true);
    const local = revised.entries.find((entry) => entry.modelId === "llama-14b");
    expect(local?.spendKind).toBe("local");
    expect(local?.provider).toBe("ollama");
    expect(local?.supportsTools).toBe(false);
    const eligible = revised.eligible({
      nowMs: 5_000,
      currency: "micro-usd",
      requireTools: true,
      requireStructuredJson: true,
      requireVision: false,
    });
    expect(eligible.map((entry) => entry.modelId)).toEqual(["local-pinned"]);
  });

  it("filters vision, tools, deprecated, and revoked models and separates currencies", () => {
    const roster = VersionedModelRoster.seed([
      model({
        modelId: "blind",
        tier: "senior",
        vision: false,
        rate: 10n,
      }),
      model({
        modelId: "sighted",
        tier: "senior",
        vision: true,
        family: "google",
        rate: 12n,
      }),
      model({
        modelId: "no-tools",
        tier: "mid",
        tools: false,
        family: "llama",
        spendKind: "local",
      }),
      model({
        modelId: "chat",
        tier: "mid",
        spendKind: "subscription",
        allowancePpmPer1M: 500n,
        family: "openai",
        connectionId: "chatgpt",
      }),
    ]).applySignedPolicy({
      revision: 1,
      signed: true,
      revokeModelIds: ["blind"],
      upserts: [],
      deprecations: [{ modelId: "sighted", deprecatedAfter: 100 }],
    });

    const vision = roster.eligible({
      nowMs: 100,
      currency: "micro-usd",
      requireTools: true,
      requireStructuredJson: true,
      requireVision: true,
    });
    expect(vision).toEqual([]);
    const ppm = roster.eligible({
      nowMs: 0,
      currency: "ppm",
      requireTools: true,
      requireStructuredJson: true,
      requireVision: false,
    });
    expect(ppm.map((entry) => entry.modelId)).toEqual(["chat"]);
    expect(roster.activeFamilies({
      nowMs: 0,
      currency: "ppm",
      requireTools: false,
      requireStructuredJson: false,
      requireVision: false,
    })).toEqual(["openai"]);
    expect(passPriors("junior").complex).toBeLessThan(passPriors("senior").complex);
  });
});
