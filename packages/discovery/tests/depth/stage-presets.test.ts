import { afterEach, describe, expect, it } from "vitest";
import {
  ASK_THRESHOLD,
  DepthSession,
  MustAskPolicyFloor,
  StageDepthController,
  assertAutomaticBasis,
  computeAskScore,
  BasisHonestyError,
} from "../../src/depth/index.js";
import type { DepthCatalogEntry, ProjectStage } from "../../src/depth/index.js";
import { FIXED_CLOCK, catalogEntry, countedOpen, lowImpact, mediumImpact, mustAsk } from "./fixtures.js";

const sessions: DepthSession[] = [];

afterEach(() => {
  while (sessions.length > 0) sessions.pop()?.close();
});

function openSession(
  catalog: readonly DepthCatalogEntry[],
  options?: { stage?: ProjectStage; prompt?: string },
): DepthSession {
  const session = new DepthSession({
    catalog,
    clock: FIXED_CLOCK,
    stage: options?.stage,
    prompt: options?.prompt,
    title: "Depth fixture",
  });
  sessions.push(session);
  return session;
}

describe("ask_value", () => {
  it("is a deterministic integer product of impact and uncertainty", () => {
    const entry = lowImpact("scale.users", "Expected users");
    const first = computeAskScore(entry, "production");
    const second = computeAskScore(entry, "production");
    expect(second).toEqual(first);
    expect(Number.isInteger(first.askValue)).toBe(true);
    expect(Number.isInteger(first.impact)).toBe(true);
    expect(Number.isInteger(first.uncertainty)).toBe(true);
    expect(first.askValue).toBe(first.impact * first.uncertainty);
    expect(first.askThreshold).toBe(ASK_THRESHOLD.production);
  });
});

describe("stage presets and must-ask floor", () => {
  const lows = Array.from({ length: 8 }, (_unused, index) => lowImpact(`low.${index}`, `Low ${index}`));
  const mediums = [
    mediumImpact("ops.logs", "Logs"),
    mediumImpact("ops.accessibility", "Accessibility"),
    mediumImpact("ops.errors", "Error handling"),
    mediumImpact("ops.deploy_basics", "Deployment basics"),
  ];
  const floor = [
    mustAsk("authentication_roles", "auth.roles", "Who can sign in"),
    mustAsk("payments_side_effects", "payments.collection", "How are payments collected"),
    mustAsk("retention_privacy_pii", "privacy.retention", "How long personal data is kept"),
    mustAsk("core_workflow", "product.workflow", "Primary workflow"),
    mustAsk("deployment_target", "deploy.target", "Where the app runs"),
    mustAsk("user_contradiction", "product.contradiction", "Conflicting earlier answer"),
  ];
  const catalog = [...lows, ...mediums, ...floor];

  it("asks dramatically fewer low-impact questions in Prototype than Production and never skips a must-ask class", () => {
    const asked = (stage: ProjectStage) => {
      const session = openSession(catalog, { stage });
      for (const entry of floor) {
        const decision = session.decision(entry.criterionId);
        expect(decision.status).toBe("open");
        expect(decision.basis).toBeUndefined();
        expect(decision.mustAsk).toBe(true);
        expect(decision.value).toBeNull();
      }
      return countedOpen(session.decisions());
    };
    const prototype = asked("prototype");
    const mvp = asked("mvp");
    const production = asked("production");
    expect(prototype).toBe(0);
    expect(mvp).toBe(mediums.length);
    expect(production).toBe(lows.length + mediums.length);
    expect(production - prototype).toBeGreaterThanOrEqual(8);
  });

  it("publishes stage chip verification strictness and persists the stage on the project node", () => {
    const session = openSession([lowImpact("scale.users", "Expected users")]);
    expect(session.stage()).toBe("mvp");
    expect(session.chip().control).toBe("discover-top-bar-stage-chip");
    expect(session.chip().label).toBe("MVP");
    expect(session.profile().verification.level).toBe("standard");
    expect(session.profile().askThreshold).toBe(ASK_THRESHOLD.mvp);
    session.switchStage("prototype");
    expect(session.chip().label).toBe("Prototype");
    expect(session.profile().verification.level).toBe("relaxed");
    expect(session.profile().verification.confirmDerived).toBe(false);
    session.switchStage("production");
    expect(session.profile().verification.level).toBe("strict");
    expect(session.profile().verification.confirmDerived).toBe(true);
    expect(session.profile().visibleQuestionCap).toBe(25);
    const stageNode = session.graph.getNode("project-stage:project-1");
    expect(stageNode?.kind).toBe("arch_node");
    expect(JSON.parse(stageNode?.fieldsJson ?? "{}")).toMatchObject({
      role: "project_stage",
      stage: "production",
      verification_level: "strict",
    });
  });

  it("forces a question when the prototype recommendation is missing and the MVP rule is not safe", () => {
    const trap = catalogEntry({
      criterionId: "storage.engine",
      label: "Where is data stored",
      options: [
        { id: "trap-option-zero", label: "Trap" },
        { id: "postgres", label: "Postgres" },
      ],
      recommendations: [
        {
          stage: "mvp",
          optionId: "postgres",
          rationale: "MVP likes Postgres but it is not safe to assume for a prototype.",
          safeForLowerStage: false,
        },
      ],
      strongConventionStages: [],
    });
    const session = openSession([trap], { stage: "prototype" });
    const decision = session.decision("storage.engine");
    expect(decision.value).toBeNull();
    expect(decision.basis).toBeUndefined();
    expect(decision.mustAsk).toBe(true);
    expect(decision.decisionBadge).toBe("Needs your decision (no safe recommendation for this stage)");
    expect(session.recommendationFor("storage.engine").kind).toBe("force_must_ask");
    const run = session.runAutopilot();
    expect(run.settledCriterionIds).toEqual([]);
    expect(run.haltReason).toBe("missing_recommendation");
    expect(session.decision("storage.engine").value).not.toBe("trap-option-zero");
  });

  it("falls back to a safe MVP recommendation and never selects option zero", () => {
    const entry = catalogEntry({
      criterionId: "storage.engine",
      label: "Where is data stored",
      riskTier: "low",
      reworkCost: "easy",
      strongConventionStages: ["prototype", "mvp"],
      options: [
        { id: "trap-option-zero", label: "Trap" },
        { id: "mvp-safe", label: "SQLite file" },
      ],
      recommendations: [
        {
          stage: "mvp",
          optionId: "mvp-safe",
          rationale: "A local SQLite file is the safe MVP default.",
          safeForLowerStage: true,
        },
      ],
    });
    const session = openSession([entry], { stage: "prototype" });
    const decision = session.decision("storage.engine");
    expect(decision.basis).toBe("defaulted");
    expect(decision.value).toBe("mvp-safe");
    expect(decision.value).not.toBe("trap-option-zero");
    const recommendation = session.recommendationFor("storage.engine");
    expect(recommendation.kind).toBe("option");
    if (recommendation.kind === "option") {
      expect(recommendation.fellBack).toBe(true);
      expect(recommendation.sourceStage).toBe("mvp");
    }
  });

  it("keeps an obvious deployment target off the floor and escalates Stripe and HIPAA in Prototype", () => {
    const session = openSession(
      [
        catalogEntry({
          criterionId: "deploy.local",
          label: "Local runtime",
          mustAskClass: "deployment_target",
          domain: "deployment",
          deploymentObvious: true,
          riskTier: "low",
          reworkCost: "easy",
        }),
        mustAsk("deployment_target", "deploy.target", "Where the app runs"),
        catalogEntry({
          criterionId: "payments.processor",
          label: "Card processor",
          domain: "payments",
          riskTier: "low",
          reworkCost: "easy",
        }),
        catalogEntry({
          criterionId: "privacy.phi",
          label: "Health data",
          domain: "sensitive_data",
          riskTier: "low",
          reworkCost: "easy",
        }),
      ],
      { stage: "prototype" },
    );
    expect(session.decision("deploy.local").basis).toBe("defaulted");
    expect(session.decision("deploy.target").status).toBe("open");
    expect(session.decision("payments.processor").basis).toBe("defaulted");
    const escalated = session.noteUserText("Please add Stripe and keep the app HIPAA ready.");
    expect(escalated.reopened).toEqual(expect.arrayContaining(["payments.processor", "privacy.phi"]));
    expect(session.decision("payments.processor").status).toBe("open");
    expect(session.decision("payments.processor").decisionBadge).toBe(
      "Needs your decision (must-ask: handles payments)",
    );
    expect(session.decision("privacy.phi").decisionBadge).toBe(
      "Needs your decision (must-ask: privacy and personal data)",
    );
    expect(session.ledger.view().entries.map((entry) => entry.criterionId)).not.toContain("payments.processor");
    const run = session.runAutopilot();
    expect(run.settledCriterionIds).not.toContain("payments.processor");
    expect(run.settledCriterionIds).not.toContain("privacy.phi");
    expect(run.haltReason).toBe("must_ask");
  });

  it("halts a vague SaaS prompt on workflow, auth, and data model instead of inventing them", () => {
    const session = openSession(
      [
        mustAsk("core_workflow", "product.workflow", "Primary workflow"),
        mustAsk("authentication_roles", "auth.roles", "Who can sign in"),
        catalogEntry({
          criterionId: "data.model",
          label: "Data model",
          domain: "data_model",
          riskTier: "low",
          reworkCost: "easy",
        }),
      ],
      { stage: "prototype", prompt: "Build a SaaS app" },
    );
    const run = session.runAutopilot();
    expect(run.settledCriterionIds).toEqual([]);
    expect(run.halted).toBe(true);
    expect(run.haltReason).toBe("must_ask");
    expect(run.remainingBlockers).toEqual(["auth.roles", "data.model", "product.workflow"]);
    for (const criterionId of run.remainingBlockers) {
      const decision = session.decision(criterionId);
      expect(decision.status).toBe("open");
      expect(decision.value).toBeNull();
      expect(decision.basis).toBeUndefined();
    }
    expect(session.decision("data.model").decisionBadge).toBe("Needs your decision (must-ask: data model)");
    expect(new MustAskPolicyFloor("Build a SaaS app").signals().vagueProduct).toBe(true);
  });
});

describe("controller identity", () => {
  it("exposes the stage controller and refuses an explicit automatic basis", () => {
    const session = openSession([lowImpact("scale.users", "Expected users")], { stage: "prototype" });
    expect(session.stages).toBeInstanceOf(StageDepthController);
    expect(() => assertAutomaticBasis("explicit")).toThrow(BasisHonestyError);
  });
});
