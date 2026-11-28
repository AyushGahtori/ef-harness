import { describe, expect, it } from "vitest";
import { ALREADY_SAVED_MESSAGE, VS_CODE_STALE_PROMPT } from "../../src/question-arbiter/index.js";
import { mailboxOf, openArbiter, ownersOf, request } from "./harness.js";

describe("stale replies, retirement, and concurrent workers", () => {
  it("acknowledges a late reply that agrees and asks before a contradicting one", () => {
    const runtime = openArbiter();
    const opened = runtime.arbiter.submit(
      request({
        text: "What date format should we display?",
        waitingTaskId: "T-42",
        questionId: "Q-42",
        featureId: "F-Dates",
      }),
    );
    if (opened.lane !== "human_queue") throw new Error("expected Q-42");
    runtime.arbiter.retireByEdit({
      questionId: "Q-42",
      source: "markdown_edit",
      settledAnswer: "ISO 8601 (YYYY-MM-DD)",
    });
    const retired = runtime.arbiter.card("Q-42");
    expect(retired.status).toBe("retired");
    expect(retired.retiredReason).toBe("markdown_edit");
    expect(retired.settledBy).toBe("VS Code edit");
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
    const projection = runtime.projection("Q-42");
    expect(projection?.status).toBe("dismissed");
    expect(JSON.parse(projection?.payload ?? "{}")).toMatchObject({ domainStatus: "retired", retiredReason: "markdown_edit" });

    const before = runtime.arbiter.card("Q-42");
    const agreed = runtime.arbiter.answer("Q-42", { optionsVersion: 1, text: "ISO 8601 (YYYY-MM-DD)" });
    expect(agreed.outcome).toBe("already_saved");
    if (agreed.outcome === "already_saved") expect(agreed.message).toBe(ALREADY_SAVED_MESSAGE);
    expect(agreed.mutated).toBe(false);
    expect(runtime.arbiter.card("Q-42")).toEqual(before);

    const contradicted = runtime.arbiter.answer("Q-42", { optionsVersion: 1, text: "Locale short date" });
    expect(contradicted.outcome).toBe("needs_choice");
    if (contradicted.outcome !== "needs_choice") throw new Error("expected a choice");
    expect(contradicted.prompt).toBe(VS_CODE_STALE_PROMPT);
    expect(contradicted.headline).toBe(
      "This question was already resolved by VS Code edit — Keep VS Code edit or Change to your new reply?",
    );
    expect(contradicted.retainedReply).toBe("Locale short date");
    expect(contradicted.mutated).toBe(false);
    expect(runtime.arbiter.card("Q-42").settledAnswer).toBe("ISO 8601 (YYYY-MM-DD)");
    expect(runtime.arbiter.card("Q-42").status).toBe("retired");

    const kept = runtime.arbiter.choose(contradicted.pendingReplyId, "keep");
    expect(kept.outcome).toBe("kept");
    expect(kept.mutated).toBe(false);
    expect(runtime.arbiter.card("Q-42").settledAnswer).toBe("ISO 8601 (YYYY-MM-DD)");

    const again = runtime.arbiter.answer("Q-42", { optionsVersion: 1, text: "Locale short date" });
    if (again.outcome !== "needs_choice") throw new Error("expected another choice");
    const changed = runtime.arbiter.choose(again.pendingReplyId, "change");
    expect(changed.outcome).toBe("changed");
    expect(changed.mutated).toBe(true);
    if (changed.outcome === "changed") expect(changed.card.settledAnswer).toBe("Locale short date");
    expect(changed.card.status).toBe("answered");
  });

  it("does not apply a reply aimed at a superseded options version", () => {
    const runtime = openArbiter();
    const opened = runtime.arbiter.submit(request({ text: "Which toast copy should we use?", waitingTaskId: "T-opt" }));
    if (opened.lane !== "human_queue") throw new Error("expected a card");
    runtime.arbiter.reviseOptions(opened.card.questionId, ["Short", "Long"]);
    const stale = runtime.arbiter.answer(opened.card.questionId, { optionsVersion: 1, optionId: "opt-1" });
    expect(stale.outcome).toBe("needs_choice");
    expect(stale.mutated).toBe(false);
    expect(runtime.arbiter.card(opened.card.questionId).status).toBe("open");
    expect(runtime.arbiter.card(opened.card.questionId).settledAnswer).toBeNull();
    expect(runtime.arbiter.card(opened.card.questionId).optionsVersion).toBe(2);
    const applied = runtime.arbiter.answer(opened.card.questionId, { optionsVersion: 2, optionId: "opt-2" });
    expect(applied.outcome).toBe("applied");
  });

  it("retires every open card for an undone feature and leaves other features queued", () => {
    const runtime = openArbiter();
    runtime.arbiter.submit(request({ text: "Include the header row?", waitingTaskId: "T-e1", featureId: "F-Export" }));
    runtime.arbiter.submit(request({ text: "Include the totals row?", waitingTaskId: "T-e2", featureId: "F-Export" }));
    runtime.arbiter.submit(request({ text: "Keep the auth card?", waitingTaskId: "T-other", featureId: "F-Auth" }));
    const retired = runtime.arbiter.retireFeature("F-Export", "feature_undone");
    expect(retired).toHaveLength(2);
    expect(retired.every((card) => card.status === "retired" && card.retiredReason === "feature_undone")).toBe(true);
    expect(runtime.arbiter.activeQueue().map((card) => card.featureId)).toEqual(["F-Auth"]);
    const superseded = runtime.arbiter.retireFeature("F-Auth", "revision_superseded");
    expect(superseded.map((card) => card.retiredReason)).toEqual(["revision_superseded"]);
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);

    const late = runtime.arbiter.answer(retired[0]?.questionId ?? "", { optionsVersion: 1, text: "Yes" });
    expect(late.outcome).toBe("needs_choice");
    if (late.outcome === "needs_choice") {
      expect(late.headline).toBe(
        "This question was already resolved by feature undo — Keep feature undo or Change to your new reply?",
      );
      expect(late.prompt).toBe(late.headline);
    }
    expect(runtime.arbiter.card(retired[0]?.questionId ?? "").status).toBe("retired");
  });

  it("retires a criterion settled from the canvas", () => {
    const runtime = openArbiter();
    runtime.arbiter.submit(
      request({
        text: "Show cancelled orders?",
        waitingTaskId: "T-c1",
        scopeId: "kitchen",
        criterionId: "cancelled",
      }),
    );
    runtime.arbiter.submit(
      request({
        text: "Show cancelled orders in the other copy?",
        waitingTaskId: "T-c2",
        scopeId: "kitchen",
        criterionId: "cancelled",
      }),
    );
    const retired = runtime.arbiter.retireByEdit({
      scopeId: "kitchen",
      criterionId: "cancelled",
      source: "canvas_edit",
      settledAnswer: "No",
    });
    expect(retired).toHaveLength(1);
    expect(retired[0]?.status).toBe("retired");
    expect(retired[0]?.retiredReason).toBe("canvas_edit");
    expect(retired[0]?.settledBy).toBe("Canvas edit");
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
  });

  it("runs eight workers across duplicates, owner answers, and a stale reply", async () => {
    const runtime = openArbiter();
    runtime.settled.registerEntityColumn("users", "email");
    ownersOf(runtime).register({
      contractId: "auth-middleware",
      ownerRole: "auth-owner",
      ownerTaskId: "T-auth-owner",
    });
    const retired = runtime.arbiter.submit(
      request({ text: "Keep the retired export?", waitingTaskId: "T-retired", questionId: "Q-19", featureId: "F-Old" }),
    );
    if (retired.lane !== "human_queue") throw new Error("expected Q-19");
    runtime.arbiter.retireByEdit({
      questionId: "Q-19",
      source: "markdown_edit",
      settledAnswer: "Keep the file",
    });

    const operations = await Promise.all([
      ...["T-a", "T-b", "T-c", "T-d"].map((waitingTaskId) =>
        Promise.resolve().then(() =>
          runtime.filter.intercept(
            request({
              text: "Should cancelled orders appear in daily kitchen totals?",
              waitingTaskId,
              scopeId: "kitchen",
              criterionId: "cancelled-totals",
            }),
          ),
        ),
      ),
      Promise.resolve().then(() =>
        runtime.filter.intercept(
          request({
            text: "What column name does users table use for email?",
            waitingTaskId: "T-email-1",
            kind: "technical",
          }),
        ),
      ),
      Promise.resolve().then(() =>
        runtime.filter.intercept(
          request({
            text: "What column name does users table use for email?",
            waitingTaskId: "T-email-2",
            kind: "technical",
          }),
        ),
      ),
      Promise.resolve().then(() =>
        runtime.filter.intercept(
          request({
            text: "What export name does auth middleware use?",
            waitingTaskId: "T-export",
            kind: "technical",
            contractId: "auth-middleware",
          }),
        ),
      ),
      Promise.resolve().then(() => runtime.arbiter.answer("Q-19", { optionsVersion: 1, text: "Delete the file" })),
    ]);

    const human = operations.filter((item) => "lane" in item && item.lane === "human_queue");
    const autos = operations.filter((item) => "lane" in item && item.lane === "auto_reply");
    const owners = operations.filter((item) => "lane" in item && item.lane === "owner_mailbox");
    const stale = operations.find((item) => "outcome" in item);
    expect(human).toHaveLength(4);
    expect(autos).toHaveLength(2);
    expect(owners).toHaveLength(1);
    expect(stale && "outcome" in stale && stale.outcome).toBe("needs_choice");
    expect(runtime.arbiter.activeQueue()).toHaveLength(1);
    expect(runtime.arbiter.activeQueue()[0]?.blockingLabel).toBe("Blocking 4 tasks");
    expect(mailboxOf(runtime).messages).toHaveLength(1);
    expect(runtime.arbiter.card("Q-19").settledAnswer).toBe("Keep the file");
    expect(runtime.arbiter.card("Q-19").status).toBe("retired");

    const questionId = runtime.arbiter.activeQueue()[0]?.questionId ?? "";
    const answered = runtime.arbiter.answer(questionId, { optionsVersion: 1, optionId: "opt-1" });
    expect(answered.outcome).toBe("applied");
    if (answered.outcome === "applied") expect(answered.wokenTaskIds).toHaveLength(4);
    expect(runtime.wakes(questionId)).toHaveLength(4);
    expect(runtime.arbiter.activeQueue()).toHaveLength(0);
    const totals = runtime.arbiter.interruptionTotals("build-1");
    expect(totals.humanInterruptions).toBe(2);
    expect(totals.duplicatesCollapsed).toBe(3);
    expect(totals.intercepted).toBe(3);
  });
});
