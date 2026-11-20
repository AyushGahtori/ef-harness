import { afterEach, describe, expect, it } from "vitest";
import { DepthSession, openDepthKnowledgeGraph } from "../../src/depth/index.js";
import type { DepthCatalogEntry } from "../../src/depth/index.js";
import { FIXED_CLOCK, catalogEntry, highOpen, mustAsk, stageRecommendations } from "./fixtures.js";

const sessions: DepthSession[] = [];

afterEach(() => {
  while (sessions.length > 0) sessions.pop()?.close();
});

function openSession(catalog: readonly DepthCatalogEntry[]): DepthSession {
  const session = new DepthSession({ catalog, clock: FIXED_CLOCK, stage: "mvp", title: "Delegation fixture" });
  sessions.push(session);
  return session;
}

describe("accept all recommended and autopilot", () => {
  it("delegates the two normal questions and keeps the payments must-ask visible", () => {
    const session = openSession([
      highOpen("access.keyboard", "Keyboard access", 2),
      highOpen("logs.destination", "Where logs go", 3),
      mustAsk("payments_side_effects", "payments.collection", "How are payments collected"),
    ]);
    const result = session.acceptAllRecommended({
      scope: "batch",
      criterionIds: ["access.keyboard", "logs.destination", "payments.collection"],
    });
    expect(result.delegatedCriterionIds).toEqual(["access.keyboard", "logs.destination"]);
    expect(result.held).toEqual([
      {
        criterionId: "payments.collection",
        badge: "Needs your decision (must-ask: handles payments)",
      },
    ]);
    for (const criterionId of result.delegatedCriterionIds) {
      const decision = session.decision(criterionId);
      expect(decision.basis).toBe("delegated");
      expect(decision.status).toBe("settled");
      expect(decision.delegatedAt).toBe(FIXED_CLOCK.now());
      expect(decision.stageAtDelegation).toBe("mvp");
      expect(decision.recommendedOptionId).toBe("keep");
      expect(decision.rationale?.length).toBeGreaterThan(0);
      expect(session.graph.getNode(decision.nodeId)?.basis).toBe("delegated");
    }
    const held = session.decision("payments.collection");
    expect(held.status).toBe("open");
    expect(held.basis).toBeUndefined();
    expect(held.decisionBadge).toBe("Needs your decision (must-ask: handles payments)");
    expect(session.graph.getNode(held.nodeId)?.basis).toBeNull();
    const ledgerIds = session.ledger.view().entries.map((entry) => entry.criterionId);
    expect(ledgerIds).toEqual(expect.arrayContaining(result.delegatedCriterionIds));
    expect(ledgerIds).not.toContain("payments.collection");
    expect(session.decisions().some((decision) => decision.basis === "explicit")).toBe(false);
  });

  it("delegates every non-must-ask open criterion when the scope is the whole project", () => {
    const session = openSession([
      highOpen("access.keyboard", "Keyboard access"),
      highOpen("logs.destination", "Where logs go"),
      mustAsk("authentication_roles", "auth.roles", "Who can sign in"),
    ]);
    const result = session.acceptAllRecommended({ scope: "open" });
    expect(result.delegatedCriterionIds).toEqual(["access.keyboard", "logs.destination"]);
    expect(result.held.map((item) => item.criterionId)).toEqual(["auth.roles"]);
    expect(session.decision("auth.roles").basis).toBeUndefined();
  });

  it("uses the greedy selector for a batch and repeats the same ids", () => {
    const catalog = Array.from({ length: 6 }, (_unused, index) =>
      highOpen(`batch.0${index + 1}`, `Batch ${index + 1}`),
    );
    const first = openSession(catalog);
    const second = openSession(catalog);
    const left = first.acceptAllRecommended({ scope: "batch" });
    const right = second.acceptAllRecommended({ scope: "batch" });
    expect(left.delegatedCriterionIds).toEqual(["batch.01", "batch.02", "batch.03"]);
    expect(right.delegatedCriterionIds).toEqual(left.delegatedCriterionIds);
    expect(first.decision("batch.04").status).toBe("open");
  });

  it("stops autopilot on must-ask, conflict, spec-expander risk, and ambiguous brownfield findings", () => {
    const cases: { entry: DepthCatalogEntry; reason: string }[] = [
      { entry: mustAsk("core_workflow", "product.workflow", "Primary workflow"), reason: "must_ask" },
      {
        entry: catalogEntry({
          criterionId: "product.conflict",
          label: "Conflicting requirement",
          conflict: true,
          recommendations: stageRecommendations("keep", "Cannot delegate a conflict."),
        }),
        reason: "conflict",
      },
      {
        entry: catalogEntry({
          criterionId: "spec.proposal",
          label: "High risk proposal",
          highRiskSpecExpander: true,
          recommendations: stageRecommendations("keep", "A human reviews this proposal."),
        }),
        reason: "high_risk_spec_expander",
      },
      {
        entry: catalogEntry({
          criterionId: "repo.finding",
          label: "Brownfield finding",
          ambiguousBrownfield: true,
          recommendations: stageRecommendations("keep", "A human reviews this finding."),
        }),
        reason: "ambiguous_brownfield",
      },
    ];
    for (const item of cases) {
      const session = openSession([item.entry]);
      const run = session.runAutopilot();
      expect(run.settledCriterionIds).toEqual([]);
      expect(run.haltReason).toBe(item.reason);
      expect(session.decision(item.entry.criterionId).basis).toBeUndefined();
      expect(session.decision(item.entry.criterionId).value).toBeNull();
    }
  });

  it("commits each autopilot criterion and stops before the next one when cancelled", () => {
    const session = openSession(
      Array.from({ length: 5 }, (_unused, index) => highOpen(`auto.0${index + 1}`, `Auto ${index + 1}`)),
    );
    const before = session.decisions().map((decision) => [decision.criterionId, decision.version]);
    const run = session.runAutopilot({ cancelAfter: 2 });
    expect(run.cancelled).toBe(true);
    expect(run.haltReason).toBe("cancelled");
    expect(run.settledCriterionIds).toEqual(["auto.01", "auto.02"]);
    for (const criterionId of run.settledCriterionIds) {
      const decision = session.decision(criterionId);
      expect(decision.basis).toBe("delegated");
      expect(decision.delegatedAt).toBe(FIXED_CLOCK.now());
      expect(decision.recommendedOptionId).toBe("keep");
      expect(decision.rationale?.length).toBeGreaterThan(0);
    }
    const third = session.decision("auto.03");
    const previous = before.find((pair) => pair[0] === "auto.03");
    expect(third.version).toBe(previous?.[1]);
    expect(third.basis).toBeUndefined();
    expect(third.delegatedAt).toBeUndefined();
    expect(third.value).toBeNull();
    expect(session.decisions().some((decision) => decision.basis === "explicit")).toBe(false);
  });

  it("rolls a failed transaction back with no partial node", () => {
    const graph = openDepthKnowledgeGraph(":memory:");
    expect(() =>
      graph.transaction(() => {
        graph.insertWorkItem({ id: "project-1", title: "Project", createdAt: 1 });
        const change = graph.insertChangeSet({ origin: "kernel", summary: "boom", createdAt: 1 });
        graph.insertNode({
          id: "decision:project-1:half",
          kind: "decision",
          title: "Half written",
          text: "Half written",
          fields: { criterion: "half", label: "Half", status: "open", value: null, work_item: "project-1" },
          changeSetId: change.id,
          rev: change.rev,
        });
        throw new Error("boom");
      }),
    ).toThrow(/boom/);
    expect(graph.getNode("decision:project-1:half")).toBeNull();
    graph.transaction(() => {
      graph.insertWorkItem({ id: "project-1", title: "Project", createdAt: 2 });
    });
    graph.close();
  });
});
