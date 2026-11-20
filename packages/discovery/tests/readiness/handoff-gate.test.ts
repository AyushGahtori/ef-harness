import { describe, expect, it } from "vitest";
import {
  addDecision,
  addFeature,
  createDb,
  featureState,
  seedWorkItem,
  services,
  workItemStatus,
} from "./harness.js";

describe("readiness handoff gate", () => {
  it("transitions to ready and emits discovery.scope_ready only when planning is allowed", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-1", title: "Purpose", status: "settled", basis: "explicit" });
    addDecision(db, "W1", { id: "D-2", title: "Audience", status: "settled", basis: "explicit" });
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    const transition = gate.transition("W1");
    expect(transition.workItemStatus).toBe("ready");
    expect(workItemStatus(db, "W1")).toBe("ready");
    expect(transition.events.map((event) => event.type)).toEqual(["discovery.scope_ready"]);
    expect(transition.events[0]?.payload.action).toBe("Expand Spec & Plan");
    const row = db.prepare("SELECT id, payload FROM outbox WHERE type = 'discovery.scope_ready'").get() as {
      id: string;
      payload: string;
    };
    expect(JSON.parse(row.payload).action).toBe("Expand Spec & Plan");
    const delivery = db.prepare("SELECT consumer FROM outbox_deliveries WHERE event_id = ?").get(row.id) as {
      consumer: string;
    };
    expect(delivery.consumer).toBe("ui_projection");
  });

  it("does not open planning while a conflict remains", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-1", title: "Conflict", status: "conflict" });
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    const transition = gate.transition("W1");
    expect(transition.workItemStatus).toBe("discovering");
    expect(transition.events).toEqual([]);
    const readyEvents = db.prepare("SELECT count(*) AS n FROM outbox WHERE type = 'discovery.scope_ready'").get() as {
      n: number;
    };
    expect(readyEvents.n).toBe(0);
  });

  it("returns a ready scope to discovering when derived criteria are reopened", () => {
    const db = createDb();
    seedWorkItem(db);
    addDecision(db, "W1", { id: "D-1", title: "Derived 1", status: "settled", basis: "derived" });
    addDecision(db, "W1", { id: "D-2", title: "Derived 2", status: "settled", basis: "derived" });
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    expect(gate.transition("W1").workItemStatus).toBe("ready");
    const reason = "premise P1 was superseded";
    const reopened = gate.reopenAfterPremiseSupersession({
      workItemId: "W1",
      decisionIds: ["D-1", "D-2"],
      reason,
      turnId: "turn-2",
    });
    expect(reopened.workItemStatus).toBe("discovering");
    expect(workItemStatus(db, "W1")).toBe("discovering");
    expect(explainer.latestDelta("W1")?.explanation).toContain(reason);
    expect(explainer.latestDelta("W1")?.reopenReason).toBe(reason);
    expect(reopened.events.some((event) => event.type === "discovery.scope_reopened")).toBe(true);
    const statuses = db
      .prepare("SELECT fields ->> '$.status' AS status, fields ->> '$.basis' AS basis FROM nodes WHERE id IN ('D-1', 'D-2')")
      .all() as Array<{ status: string; basis: string | null }>;
    expect(statuses.every((row) => row.status === "open" && row.basis == null)).toBe(true);
  });

  it("marks a fully pruned scope not applicable and does not emit scope_ready", () => {
    const db = createDb();
    seedWorkItem(db);
    addFeature(db, "W1", "S-Auth", "Auth");
    addDecision(db, "W1", { id: "D-1", title: "Login", status: "not_applicable", scopeId: "S-Auth", scopeLabel: "Auth" });
    addDecision(db, "W1", { id: "D-2", title: "Roles", status: "not_applicable", scopeId: "S-Auth", scopeLabel: "Auth" });
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W1", turnId: "turn-1" });
    const transition = gate.transition("W1");
    expect(transition.workItemStatus).toBe("discovering");
    expect(featureState(db, "S-Auth")).toBe("not_applicable");
    expect(transition.events).toEqual([]);
  });

  it("does not hand off an empty scope that is still awaiting definition", () => {
    const db = createDb();
    seedWorkItem(db, "W-empty");
    const { explainer, gate } = services(db);
    explainer.recordBaseline({ workItemId: "W-empty", turnId: "turn-1" });
    const transition = gate.transition("W-empty");
    expect(transition.project.headline).toBe("awaiting scope definition");
    expect(transition.workItemStatus).toBe("discovering");
    expect(transition.events).toEqual([]);
  });
});
