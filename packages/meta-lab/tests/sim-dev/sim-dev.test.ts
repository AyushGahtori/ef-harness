import { describe, expect, it } from "vitest";
import {
  AnonymizedSessionReplayer,
  AnonymizationScrubber,
  DeterministicFakeModelAdapter,
  ExactInputModelResponseCache,
  HiddenSpecPersonaSimDev,
  HiddenSpecLeakageError,
  PersonaIsolationVault,
  ScriptedRegressionSimDev,
  exactInputCacheKey,
} from "../../src/sim-dev/index.js";

describe("sim-dev harnesses", () => {
  it("drives scripted regression deterministically and flags unmatched questions", async () => {
    const driver = new ScriptedRegressionSimDev({
      id: "kitchen-smoke",
      strictUnmatched: true,
      rules: [
        {
          matchQuestionId: "q_auth",
          replyText: "Email magic links for customers; staff get admin dashboard.",
          clickAction: "reply",
        },
        {
          matchTopicPattern: "payments",
          replyText: "Stripe Checkout, no raw card storage.",
        },
      ],
    });

    const discovery = await driver.driveDiscovery([
      { questionId: "q_auth", topic: "auth", promptText: "How do users sign in?" },
      { questionId: "q_pay", topic: "payments", promptText: "Billing?" },
    ]);
    expect(discovery.transcript).toHaveLength(2);
    expect(discovery.unmatchedQuestions).toBe(0);

    const halted = await driver.driveDiscovery([
      { questionId: "q_unknown", topic: "surprise", promptText: "New question?" },
    ]);
    expect(halted.haltedReason).toBe("unmatched_question_encountered");

    const mid = await driver.driveMidBuild(
      [
        {
          atMilestone: "onTaskStarted",
          whenFeatureId: "F-Orders",
          whenProgressPct: 50,
          message: "Actually add coupons too",
        },
      ],
      {
        featureId: "F-Orders",
        taskId: "T-Orders-UI",
        progressPct: 55,
        inboxCards: [
          { cardId: "approve-plan", kind: "approval", title: "Plan", body: "Ship?" },
        ],
      },
    );
    expect(mid.transcript.some((entry) => entry.triggerEvent === "onTaskStarted")).toBe(true);
  });

  it("enforces hidden-spec isolation, turn ceilings, and synthetic SecretCard credentials", async () => {
    const hidden = "SECRET_PRODUCT_SPEC: multi-tenant payroll with HIPAA";
    const driver = new HiddenSpecPersonaSimDev(
      {
        persona: "busy_founder_terse",
        hiddenSpec: hidden,
        maxTurns: 3,
        repetitionCeiling: 2,
      },
      new DeterministicFakeModelAdapter([
        { response: "Payroll plus contractor payouts." },
        { response: "Managers approve timesheets." },
        { response: "Keep audit logs 7 years." },
        { response: "Also mobile receipts." },
      ]),
    );
    const vault = driver.isolationVault();
    expect(vault.exportVisibleToHarness()).toEqual({ hasHiddenSpec: false });
    expect(() => vault.assertHarnessRequest("state.db")).toThrow(HiddenSpecLeakageError);

    const result = await driver.driveDiscovery([
      { questionId: "q1", topic: "workflow", promptText: "What is the core workflow?" },
      { questionId: "q2", topic: "auth", promptText: "Who can access?" },
      { questionId: "q3", topic: "data", promptText: "Retention?" },
      { questionId: "q4", topic: "extra", promptText: "More?" },
    ]);
    expect(result.haltedReason).toBe("persona_turn_ceiling");

    const secretRun = await driver.driveMidBuild([], {
      featureId: "F-X",
      taskId: "T-X",
      progressPct: 10,
      inboxCards: [{ cardId: "sec", kind: "secret", title: "API key", body: "Provide key" }],
    });
    expect(secretRun.transcript[0]?.responseText).toBe("sk_test_SIM_MOCK_123");
  });

  it("scrubs recorded sessions and replays turns reproducibly", async () => {
    const fixture = {
      sessionId: "sess-1",
      turns: [
        {
          seq: 1,
          userMessage: "Ship to ayush@acme.com from C:\\Users\\Ayush\\my-company\\secret.env",
          uiActions: [{ kind: "click" as const, target: "approve" }],
        },
      ],
    };
    const replayer = new AnonymizedSessionReplayer(fixture);
    const exported = await replayer.exportRecordedSession();
    expect(exported.scrubPasses).toBe(2);
    expect(exported.turns[0]?.userMessage).not.toMatch(/ayush@acme\.com/);
    expect(exported.turns[0]?.userMessage).toMatch(/<USER>|<EMAIL|<PROJECT>/);

    const run1 = await replayer.driveDiscovery();
    const run2 = await replayer.driveDiscovery();
    expect(run1.transcript).toEqual(run2.transcript);
  });

  it("runs double-pass scrubbing with a fail-closed gate", () => {
    const scrubber = new AnonymizationScrubber();
    const dirty = scrubber.scrub("C:\\Users\\Ayush\\my-company\\notes");
    expect(dirty.passes).toBe(2);
    expect(dirty.survivedSecrets).toHaveLength(0);
    expect(() => scrubber.assertClean(dirty.text)).not.toThrow();
  });

  it("hits exact-input cache on identical bytes and misses on prompt delta", async () => {
    const cache = new ExactInputModelResponseCache();
    const model = new DeterministicFakeModelAdapter([{ response: "cached-body" }]);
    const base = {
      modelId: "batch-resolve@1",
      systemPrompt: "Resolve criteria",
      messagesJson: "[]",
      toolsSchemaJson: "{}",
      temperature: 0,
      seed: 1,
      responseFormatSchema: "{}",
    };
    const first = await cache.resolve(base, model);
    expect(first.fromCache).toBe(false);
    const second = await cache.resolve(base, model);
    expect(second.fromCache).toBe(true);
    expect(second.costUsd).toBe(0);
    expect(second.latencyMs).toBeLessThan(5);
    expect(model.callCount).toBe(1);

    const tweaked = { ...base, systemPrompt: `${base.systemPrompt},` };
    expect(exactInputCacheKey(base)).not.toBe(exactInputCacheKey(tweaked));
    const miss = await cache.resolve(tweaked, model);
    expect(miss.fromCache).toBe(false);
    expect(model.callCount).toBe(2);

    cache.setCacheMode("bypass");
    const bypassed = await cache.resolve(base, model);
    expect(bypassed.fromCache).toBe(false);
    expect(cache.stats().bypassed).toBeGreaterThan(0);
    cache.close();
  });

  it("keeps persona vault isolated from harness prompts", () => {
    const vault = new PersonaIsolationVault("TOP_SECRET_ROADMAP");
    expect(vault.readForPersonaOnly()).toContain("TOP_SECRET");
  });
});