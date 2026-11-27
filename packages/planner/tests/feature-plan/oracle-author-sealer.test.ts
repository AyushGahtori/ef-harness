import { describe, expect, it } from "vitest";

import {
  FeaturePlanDatabase,
  FeaturePlanError,
  FeaturePlanningSession,
  FakeModelAdapter,
} from "../../src/feature-plan/index.js";
import { cutoffRequirement, openAiOnly, openSession, roster, sessionInput } from "./fixture.js";

describe("IndependentOracleAuthorSealer", () => {
  it("repairs a tautology, a timer, and a live stripe url in one pass", async () => {
    const model = new FakeModelAdapter();
    model.pushOracle(scriptedOracle(weakHappy()));
    const { db, session } = openSession(sessionInput({ model, requirements: [cutoffRequirement()] }));
    const receipt = await session.planAndSeal(sessionInput({ model, requirements: [cutoffRequirement()] }));
    expect(receipt.repairAttempts).toBe(1);
    const repairs = model.calls.filter((call) => call.repair !== null);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]?.repair?.attempt).toBe(1);
    expect(repairs[0]?.repair?.reasons.join(" ")).toContain("concrete value assertions");
    expect(repairs[0]?.repair?.reasons.join(" ")).toContain("deterministic clock");
    expect(repairs[0]?.repair?.reasons.join(" ")).toContain("loopback");
    const happy = session.store.readForCleanVerifier("S-happy");
    expect(happy.assertion).toBe("expect(res.status).toBe(201)");
    expect(happy.assertion).not.toContain("setTimeout");
    expect(JSON.stringify(happy)).not.toContain("api.stripe.com");
    expect(JSON.stringify(happy)).not.toContain("expect(true).toBe(true)");
    expect(db.listHidden(session.currentPlan().featureId).every((row) => row.status === "sealed")).toBe(true);
  });

  it("does not seal when the single repair is still weak", async () => {
    const model = new FakeModelAdapter();
    model.pushOracle(scriptedOracle(weakHappy()));
    model.pushRepair(scriptedOracle(weakHappy()));
    const db = FeaturePlanDatabase.memory();
    const session = new FeaturePlanningSession(db);
    let caught: unknown;
    try {
      await session.planAndSeal(sessionInput({ model, requirements: [cutoffRequirement()] }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FeaturePlanError);
    expect((caught as FeaturePlanError).code).toBe("oracle_lint");
    expect((caught as FeaturePlanError).details.repairAttempts).toBe(1);
    expect(model.calls.filter((call) => call.repair !== null)).toHaveLength(1);
    expect(db.listHidden()).toEqual([]);
  });

  it("rejects a single happy-path case and demands the cutoff boundary", async () => {
    const model = new FakeModelAdapter();
    model.pushOracle({
      schema: "oracle-author@1",
      held_back: [cleanCase("S-only", "happy", '{"at":"10:59"}', "201", "expect(res.status).toBe(201)")],
      rubrics: [],
    });
    const db = FeaturePlanDatabase.memory();
    const session = new FeaturePlanningSession(db);
    await expect(session.planAndSeal(sessionInput({ model, requirements: [cutoffRequirement()] }))).rejects.toThrow(
      FeaturePlanError,
    );
    try {
      model.pushOracle({
        schema: "oracle-author@1",
        held_back: [cleanCase("S-only", "happy", '{"at":"10:59"}', "201", "expect(res.status).toBe(201)")],
        rubrics: [],
      });
      await session.planAndSeal(sessionInput({ model, requirements: [cutoffRequirement()] }));
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("insufficient_oracle_pool");
      expect((error as FeaturePlanError).details.missing).toEqual(expect.arrayContaining(["boundary", "negative"]));
    }
    expect(model.calls.filter((call) => call.repair !== null)).toHaveLength(0);
    expect(db.listHidden()).toEqual([]);
  });

  it("stamps same_family_only when only one provider is connected", async () => {
    const model = new FakeModelAdapter();
    const { session } = openSession();
    const input = sessionInput({
      model,
      roster: roster(openAiOnly()),
      buildWorker: { family: "openai", model: "gpt-senior" },
      requirements: [cutoffRequirement()],
    });
    const receipt = await session.planAndSeal(input);
    expect(receipt.oracleIndependence).toBe("same_family_only");
    expect(receipt.selectedFamily).toBe("openai");
    expect(receipt.selectedModel).toBe("gpt-mini");
    expect(receipt.warnings.map((warning) => warning.code)).toEqual(["same_family_degraded"]);
    expect(session.log.entries.map((entry) => entry.code)).toContain("same_family_degraded");
    const oracleCall = model.calls.find((call) => call.role === "oracle-author@1" && call.repair === null);
    expect(oracleCall?.model).toBe("gpt-mini");
    expect(session.store.listForFeature(input.featureId).length).toBeGreaterThanOrEqual(3);
  });

  it("refuses worker code as oracle input", async () => {
    const { session } = openSession();
    await expect(
      session.planAndSeal(
        sessionInput({
          requirements: [cutoffRequirement()],
          workerCode: "export function placeOrder() { return true }",
        }),
      ),
    ).rejects.toThrow(FeaturePlanError);
    try {
      await session.planAndSeal(
        sessionInput({
          requirements: [cutoffRequirement()],
          workerCode: "export function placeOrder() { return true }",
        }),
      );
    } catch (error) {
      expect((error as FeaturePlanError).code).toBe("oracle_input_contaminated");
    }
  });
});

function weakHappy(): Record<string, unknown> {
  return cleanCase(
    "S-happy",
    "happy",
    "https://api.stripe.com/v1/charges",
    "ok",
    "expect(true).toBe(true); setTimeout(3000)",
  );
}

function scriptedOracle(happy: Record<string, unknown>): Record<string, unknown> {
  return {
    schema: "oracle-author@1",
    held_back: [
      happy,
      cleanCase("S-boundary", "boundary", '{"at":"11:00"}', "201", "expect(res.status).toBe(201)"),
      cleanCase("S-negative", "negative", '{"at":"11:01"}', "422", "expect(res.status).toBe(422)"),
    ],
    rubrics: [],
  };
}

function cleanCase(
  id: string,
  diversity: string,
  input: string,
  expected: string,
  assertion: string,
): Record<string, unknown> {
  return {
    check_id: id,
    requirement_ids: ["REQ-cutoff"],
    input,
    expected,
    rule_id: "R-cutoff",
    diversity,
    kind: "api",
    entry_point: "POST /api/orders",
    assertion,
  };
}
