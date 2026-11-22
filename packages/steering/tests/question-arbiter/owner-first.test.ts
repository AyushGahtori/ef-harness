import { describe, expect, it } from "vitest";
import { submitKind, mailboxOf, openArbiter, ownersOf, request } from "./harness.js";

describe("OwnerFirstQuestionFilter", () => {
  it("answers a settled entity-schema question in under 5ms with zero interruption", () => {
    const runtime = openArbiter();
    runtime.settled.registerEntityColumn("users", "email");
    const ask = (taskId: string) =>
      runtime.filter.intercept(
        request({
          text: "What column name does users table use for email?",
          waitingTaskId: taskId,
          kind: "technical",
        }),
      );
    ask("T-warm");
    let fastest = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample < 25; sample += 1) {
      const result = ask(`T-email-${sample}`);
      expect(result.lane).toBe("auto_reply");
      expect(result.userInterrupted).toBe(false);
      if (result.lane !== "auto_reply") throw new Error("expected an automatic reply");
      expect(result.answer).toBe("users.email");
      expect(result.source).toBe("entity_schema");
      fastest = Math.min(fastest, result.elapsedMs);
    }
    expect(fastest).toBeLessThan(5);
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
    expect(runtime.arbiter.interruptionTotals("build-1").intercepted).toBe(26);
    expect(runtime.arbiter.interruptionTotals("build-1").humanInterruptions).toBe(0);
  });

  it("matches an entity column from a paraphrase", () => {
    const runtime = openArbiter();
    runtime.settled.registerEntityColumn("users", "email");
    const result = runtime.filter.intercept(
      request({
        text: "Which column does the users table store for email?",
        waitingTaskId: "T-para",
        kind: "technical",
      }),
    );
    expect(result.lane).toBe("auto_reply");
    if (result.lane === "auto_reply") expect(result.answer).toBe("users.email");
  });

  it("routes a technical question to the contract owner mailbox", () => {
    const runtime = openArbiter();
    ownersOf(runtime).register({
      contractId: "auth-middleware",
      ownerRole: "auth-owner",
      ownerTaskId: "T-auth-owner",
    });
    const result = runtime.filter.intercept(
      request({
        text: "What export name does auth middleware use?",
        waitingTaskId: "W-3",
        kind: "technical",
        contractId: "auth-middleware",
      }),
    );
    expect(result.lane).toBe("owner_mailbox");
    expect(result.userInterrupted).toBe(false);
    if (result.lane !== "owner_mailbox") throw new Error("expected owner mailbox");
    expect(result.targetRole).toBe("auth-owner");
    expect(result.targetOwnerTaskId).toBe("T-auth-owner");
    expect(mailboxOf(runtime).messages).toHaveLength(1);
    expect(mailboxOf(runtime).messages[0]?.payload.question).toBe("What export name does auth middleware use?");
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
  });

  it("prefers a settled record over an owner mailbox", () => {
    const runtime = openArbiter();
    runtime.settled.register({
      text: "What export name does auth middleware use?",
      answer: "requireAuth",
      source: "contract",
      topicKey: "auth-export",
    });
    ownersOf(runtime).register({
      contractId: "auth-middleware",
      ownerRole: "auth-owner",
      ownerTaskId: "T-auth-owner",
    });
    const result = runtime.filter.intercept(
      request({
        text: "What export name does auth middleware use?",
        waitingTaskId: "T-1",
        kind: "technical",
        contractId: "auth-middleware",
      }),
    );
    expect(result.lane).toBe("auto_reply");
    expect(mailboxOf(runtime).messages).toHaveLength(0);
  });

  it("promotes human-judgment questions and keeps technical misses as escalation", () => {
    const runtime = openArbiter();
    ownersOf(runtime).register({
      contractId: "orders",
      ownerRole: "orders-author",
      ownerTaskId: "T-author",
    });
    const dispute = runtime.filter.intercept(
      request({
        text: "Does the dispute test still expect cancelled orders?",
        waitingTaskId: "T-dispute",
        kind: "dispute_test",
        contractId: "orders",
      }),
    );
    expect(dispute.lane).toBe("human_queue");
    expect(dispute.userInterrupted).toBe(true);
    if (dispute.lane === "human_queue") expect(dispute.reason).toBe("dispute_test");
    expect(mailboxOf(runtime).messages).toHaveLength(0);

    for (const kind of ["secret", "approval", "human_step", "breaking_ccr", "ambiguous_steering", "escalation"] as const) {
      const card = runtime.filter.intercept(
        request({ text: `Needs a human for ${kind}`, waitingTaskId: `T-${kind}`, kind }),
      );
      expect(card.lane).toBe("human_queue");
      expect(card.userInterrupted).toBe(true);
    }

    const unresolved = runtime.filter.intercept(
      request({
        text: "What header does the unsigned client send?",
        waitingTaskId: "T-unresolved",
        kind: "technical",
      }),
    );
    expect(unresolved.lane).toBe("human_queue");
    if (unresolved.lane === "human_queue") expect(unresolved.reason).toBe("unresolvable_escalation");
    expect(runtime.arbiter.interruptionTotals("build-1").humanInterruptions).toBe(8);
  });

  it("does not interrupt for an advisory digest card", () => {
    const runtime = openArbiter();
    const result = runtime.filter.intercept(
      request({ text: "FYI the export finished", waitingTaskId: "T-fyi", kind: "advisory" }),
    );
    expect(result.lane).toBe("human_queue");
    expect(result.userInterrupted).toBe(false);
    expect(runtime.arbiter.digest()[0]?.priority).toBe("P4");
    expect(runtime.arbiter.surfaced().some((item) => item.priority === "P4")).toBe(false);
    expect(runtime.arbiter.interruptionTotals("build-1").humanInterruptions).toBe(0);
  });

  it("auto-replies after a developer answer settles the decision", () => {
    const runtime = openArbiter();
    const first = runtime.arbiter.submit(
      request({ text: "Should cancelled orders appear in daily kitchen totals?", waitingTaskId: "T-1" }),
    );
    if (first.lane !== "human_queue") throw new Error("expected a card");
    runtime.arbiter.answer(first.card.questionId, { optionsVersion: 1, optionId: "opt-1" });
    const second = runtime.filter.intercept(
      request({ text: "Should cancelled orders appear in daily kitchen totals?", waitingTaskId: "T-2" }),
    );
    expect(second.lane).toBe("auto_reply");
    expect(second.userInterrupted).toBe(false);
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
  });

  it("keeps the helper available for direct kind submission", () => {
    const runtime = openArbiter();
    submitKind(runtime, "product", "T-helper");
    expect(runtime.arbiter.activeQueue()).toHaveLength(1);
  });
});
