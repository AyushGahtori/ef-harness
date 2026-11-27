import { describe, expect, it } from "vitest";
import { AskOwnerResponderEngine, FakeModelAdapter, SpecialistStateDb } from "../../src/specialists/index.js";
import type { WorkerEscalationRequest } from "../../src/specialists/index.js";

function engine(db: SpecialistStateDb, model = new FakeModelAdapter()): AskOwnerResponderEngine {
  return new AskOwnerResponderEngine({
    db,
    model,
    roster: [
      { family: "openai", vision: false, level: "Senior" },
      { family: "anthropic", vision: false, level: "Senior" },
    ],
    workerFamily: "openai",
  });
}

function paymentsDb(): SpecialistStateDb {
  const db = SpecialistStateDb.memory();
  db.insertNode({
    id: "F-Payments",
    kind: "feature",
    title: "Payments",
    text: "Stripe webhooks are planned and not built.",
    fields: { wave: 2 },
  });
  for (const id of ["T-P1", "T-P2", "T-P3", "T-P4"]) {
    db.insertNode({ id, kind: "task", title: id, fields: { feature: "F-Payments" } });
    db.insertTask({ taskId: id, featureId: "F-Payments", state: "READY" });
  }
  return db;
}

describe("AskOwnerResponderEngine", () => {
  it("answers the Stripe question from state.db and ignores a hallucinated model reply", async () => {
    const db = paymentsDb();
    const model = new FakeModelAdapter().enqueue("ask-owner-responder@1", {
      kind: "answer",
      text: "Stripe webhooks are already live in production.",
      changes: [],
    });
    const result = await engine(db, model).answerQuestion("Did we add Stripe webhooks yet?");
    expect(result.text).toBe("Planned for Wave 2 (Feature F-Payments, 0/4 tasks started yet)");
    expect(result.guessed).toBe(false);
    expect(result.grounded).toBe(true);
    expect(result.text.toLowerCase()).not.toContain("production");
    expect(result.schema.kind).toBe("answer");
    expect(result.schema.changes).toEqual([]);
    expect(result.citations.some((citation) => citation.id === "F-Payments" && citation.href === "ef://node/F-Payments")).toBe(true);
    expect(model.calls[0]?.prompt).toContain("F-Payments");
    expect(model.calls[0]?.prompt).toContain("Wave 2");
    expect(model.calls[0]?.family).toBe("anthropic");
  });

  it("explains a waiting task, a cutoff table, and auth receipts from recorded rows", async () => {
    const db = SpecialistStateDb.memory();
    db.insertNode({ id: "F-Orders", kind: "feature", title: "Orders", fields: { wave: 1 } });
    db.insertNode({ id: "T-4", kind: "task", title: "Place order", fields: { feature: "F-Orders" } });
    db.insertNode({ id: "T-3", kind: "task", title: "Menu", fields: { feature: "F-Orders" } });
    db.insertTask({ taskId: "T-4", featureId: "F-Orders", state: "WAITING_INPUT" });
    db.insertTask({ taskId: "T-3", featureId: "F-Orders", state: "CODING" });
    db.insertHold({ taskId: "T-4", reason: "user_pause", source: "developer" });
    db.insertEdge({ src: "T-4", type: "depends_on", dst: "T-3" });
    db.insertNode({
      id: "C-cutoffs",
      kind: "contract",
      title: "Meal cutoffs",
      text: "The meal_cutoffs table stores the daily order cutoff.",
      fields: { file: "schema/meals.sql" },
    });
    db.insertTable({ name: "meal_cutoffs", ownerNodeId: "C-cutoffs" });
    db.insertNode({
      id: "CHK-AUTH",
      kind: "check",
      title: "Auth session tests",
      text: "auth login coverage",
    });
    db.insertReceipt({
      checkId: "CHK-AUTH",
      attemptId: "A-9",
      status: "pass",
      receiptId: "rcpt-auth-1",
    });
    const responder = engine(db);
    const waiting = await responder.answerQuestion("Why is task T-4 waiting?");
    expect(waiting.text).toContain("T-4");
    expect(waiting.text).toContain("waiting for a decision");
    expect(waiting.text).toContain("You paused it");
    expect(waiting.text).toContain("T-3");
    expect(waiting.citations.some((citation) => citation.id === "T-4")).toBe(true);
    expect(waiting.citations.some((citation) => citation.id === "T-3")).toBe(true);

    const table = await responder.answerQuestion("Which database table stores cutoffs?");
    expect(table.text).toBe("The meal_cutoffs table stores cutoffs.");
    expect(table.citations.some((citation) => citation.id === "C-cutoffs")).toBe(true);
    expect(table.citations.some((citation) => citation.kind === "file" && citation.id === "schema/meals.sql")).toBe(true);

    const auth = await responder.answerQuestion("Did auth tests pass?");
    expect(auth.text).toContain("Auth tests passed");
    expect(auth.text).toContain("rcpt-auth-1");
    expect(auth.citations.some((citation) => citation.kind === "receipt" && citation.id === "rcpt-auth-1")).toBe(true);
  });

  it("refuses to guess when state.db has no matching fact", async () => {
    const model = new FakeModelAdapter().enqueue("ask-owner-responder@1", {
      kind: "answer",
      text: "The kitchen is painted blue.",
      changes: [],
    });
    const result = await engine(SpecialistStateDb.memory(), model).answerQuestion("Is the kitchen painted blue?");
    expect(result.text).toBe("No recorded fact in state.db answers that. I will not guess.");
    expect(result.citations).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });

  it("shows a 3-line dispute card and records a one-click verdict", async () => {
    const db = SpecialistStateDb.memory();
    db.insertNode({ id: "REQ-STATUS", kind: "rule", title: "Validation status", text: "Invalid orders return 422." });
    db.insertNode({ id: "CHK-STATUS", kind: "check", title: "Status check", text: "expect 400" });
    db.insertNode({ id: "T-9", kind: "task", title: "Validate", text: "" });
    const request: WorkerEscalationRequest = {
      taskId: "T-9",
      question: "The sealed check expects 400 when the spec says 422.",
      logs: "assertion failed: expected 400 received 422",
      diffSummary: "handler returns 422",
      requirementQuote: "Invalid orders return 422.",
      sealedAssertion: "expect(response.status).toBe(400)",
      checkId: "CHK-STATUS",
      requirementId: "REQ-STATUS",
      recordedDecision: null,
    };
    const responder = engine(db);
    const card = await responder.formatWorkerEscalation(request);
    expect(card.schema.kind).toBe("escalate");
    expect(card.schema.changes).toEqual([]);
    expect(card.card?.lines).toHaveLength(3);
    expect(card.card?.lines[1]).toContain("Invalid orders return 422.");
    expect(card.card?.lines[1]).toContain("expect(response.status).toBe(400)");
    expect(card.card?.options.length).toBeGreaterThanOrEqual(2);
    expect(card.card?.options.length).toBeLessThanOrEqual(3);
    expect(card.card?.options.filter((option) => option.recommended)).toHaveLength(1);
    expect(card.card?.recommendationId).toBe("follow-requirement");
    expect(card.card?.lines.join(" ")).not.toMatch(/hunk|fingerprint|epoch/i);
    expect(card.citations.some((citation) => citation.id === "REQ-STATUS")).toBe(true);
    expect(card.citations.some((citation) => citation.id === "REQ-MISSING")).toBe(false);

    const upheld = await responder.resolveDisputeChoice(request, "follow-requirement");
    expect(upheld.schema.kind).toBe("dispute_upheld");
    expect(upheld.schema.changes[0]?.target_id).toBe("CHK-STATUS");
    expect(upheld.schema.changes[0]?.text).toContain("422");
    const rejected = await responder.resolveDisputeChoice(request, "keep-check");
    expect(rejected.schema.kind).toBe("dispute_rejected");
    expect(rejected.schema.changes).toEqual([]);
  });

  it("returns a brief fix when a recorded decision already settles the question", async () => {
    const db = SpecialistStateDb.memory();
    db.insertNode({
      id: "D-CUTOFF",
      kind: "decision",
      title: "Cutoff",
      text: "Late orders are rejected after the cutoff.",
    });
    db.insertNode({ id: "T-1", kind: "task", title: "Cutoff", text: "" });
    const result = await engine(db).formatWorkerEscalation({
      taskId: "T-1",
      question: "Should late orders be rejected after the cutoff?",
      logs: "",
      diffSummary: "",
      requirementQuote: null,
      sealedAssertion: null,
      checkId: null,
      requirementId: null,
      recordedDecision: { id: "D-CUTOFF", quote: "Late orders are rejected after the cutoff." },
    });
    expect(result.schema.kind).toBe("brief_fix");
    expect(result.schema.changes[0]?.text).toContain("Late orders are rejected after the cutoff.");
    expect(result.card).toBeNull();
    expect(result.citations.some((citation) => citation.id === "D-CUTOFF")).toBe(true);
  });

  it("builds a jargon-free ambiguity card when nothing is recorded", async () => {
    const result = await engine(SpecialistStateDb.memory()).formatWorkerEscalation({
      taskId: "T-2",
      question: "Should guests see the kitchen summary?",
      logs: "worker stopped",
      diffSummary: "no product decision in the brief",
      requirementQuote: null,
      sealedAssertion: null,
      checkId: null,
      requirementId: null,
      recordedDecision: null,
    });
    expect(result.schema.kind).toBe("escalate");
    expect(result.card?.lines).toHaveLength(3);
    expect(result.card?.options).toHaveLength(3);
    expect(result.card?.recommendationId).toBe("record-decision");
    expect(result.text).toContain("Should guests see the kitchen summary?");
  });

  it("returns a schema-valid model answer when every claim is in the fact sheet", async () => {
    const db = paymentsDb();
    const model = new FakeModelAdapter().enqueue("ask-owner-responder@1", {
      kind: "answer",
      text: "Stripe webhooks are planned and not built.",
      changes: [],
    });
    const result = await engine(db, model).answerQuestion("Did we add Stripe webhooks yet?");
    expect(result.text).toBe("Stripe webhooks are planned and not built.");
    expect(result.llmCalls).toBe(1);
    expect(result.schema.kind).toBe("answer");
    expect(result.guessed).toBe(false);
  });
});
