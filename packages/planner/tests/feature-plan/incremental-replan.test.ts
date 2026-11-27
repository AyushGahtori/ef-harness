import { describe, expect, it } from "vitest";

import { FakeModelAdapter } from "../../src/feature-plan/index.js";
import { cutoffRequirement, noteRequirement, openSession, sessionInput } from "./fixture.js";

describe("incremental feature re-planning", () => {
  it("replans and reseals only the impacted requirement", async () => {
    const model = new FakeModelAdapter();
    const { db, session, input } = openSession(sessionInput({ model }));
    await session.planAndSeal(input);
    const before = session.currentPlan();
    const cutoffBefore = before.tasks.find((task) => task.requirementIds.includes("REQ-cutoff"));
    const noteBefore = before.tasks.find((task) => task.requirementIds.includes("REQ-note"));
    const cutoffNodeBefore = db.getNode(cutoffBefore?.id ?? "");
    const noteChecksBefore = session.store.listForRequirements(["REQ-note"]).map((row) => ({
      id: row.id,
      sha256: row.sha256,
      sealedAt: row.sealedAt,
    }));
    const cutoffChecksBefore = session.store.listForRequirements(["REQ-cutoff"]).map((row) => ({
      id: row.id,
      sha256: row.sha256,
    }));
    session.beginGraphCompile(input.now + 10);

    const revisedNote = { ...noteRequirement(), oracleSketch: "unicode name revised" };
    const callsBefore = model.calls.length;
    const receipt = await session.replan({
      requirements: [cutoffRequirement(), revisedNote],
      impactedRequirementIds: ["REQ-note"],
      now: input.now + 50,
    });

    const plannerCalls = model.calls.slice(callsBefore).filter((call) => call.role === "feature-planner@1");
    expect(plannerCalls).toHaveLength(1);
    const plannerInput = plannerCalls[0]?.input as { requirements: { id: string }[] };
    expect(plannerInput.requirements.map((requirement) => requirement.id)).toEqual(["REQ-note"]);
    const oracleCalls = model.calls.slice(callsBefore).filter((call) => call.role === "oracle-author@1" && !call.repair);
    expect(oracleCalls).toHaveLength(1);
    expect(JSON.stringify(oracleCalls[0]?.input)).toContain("REQ-note");
    expect(JSON.stringify(oracleCalls[0]?.input)).not.toContain("REQ-cutoff");

    const after = session.currentPlan();
    const cutoffAfter = after.tasks.find((task) => task.requirementIds.includes("REQ-cutoff"));
    const noteAfter = after.tasks.find((task) => task.requirementIds.includes("REQ-note"));
    expect(cutoffAfter).toEqual(cutoffBefore);
    expect(noteAfter?.goal).toContain("unicode name revised");
    expect(noteAfter?.goal).not.toBe(noteBefore?.goal);
    expect(after.integration).toEqual(before.integration);
    expect(db.getNode(cutoffBefore?.id ?? "")).toEqual(cutoffNodeBefore);
    expect(session.store.listForRequirements(["REQ-cutoff"]).map((row) => ({ id: row.id, sha256: row.sha256 }))).toEqual(
      cutoffChecksBefore,
    );
    const noteChecksAfter = session.store.listForRequirements(["REQ-note"]);
    expect(noteChecksAfter.map((row) => row.id).sort()).toEqual(noteChecksBefore.map((row) => row.id).sort());
    expect(noteChecksAfter.every((row) => row.sealedAt === input.now + 50)).toBe(true);
    expect(noteChecksAfter.map((row) => row.sha256).sort()).not.toEqual(noteChecksBefore.map((row) => row.sha256).sort());
    expect(receipt.caseCount).toBeGreaterThanOrEqual(6);
    session.beginGraphCompile(input.now + 60);
    const brief = session.authorizeWorker(cutoffAfter?.id ?? "");
    expect(brief.checks_hidden_count).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(brief)).not.toContain("sealed-");
  });
});
