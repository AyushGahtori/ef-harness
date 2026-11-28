import { describe, expect, it } from "vitest";
import { TargetTypeMismatchGuard } from "../../src/composer/index.js";
import {
  authQuestion,
  boxTarget,
  budgetCard,
  composer,
  cutoffBox,
  dietaryQuestion,
  elementTarget,
  headerLogo,
  printButton,
} from "./fixtures.js";

describe("type mismatch, input-start snapshot, and auto-return", () => {
  it("locks the question and options version on the first keystroke", () => {
    const view = composer();
    view.bundle.clock.set("2026-04-01T00:00:00.000Z");
    view.focusQuestion({ ...authQuestion(), questionId: "Q-Auth", title: "Auth Method" });
    view.type("O");
    expect(view.bundle.snapshotter.captures).toHaveLength(1);
    const locked = view.bundle.snapshotter.captures[0];
    expect(locked?.targetType).toBe("Question");
    expect(locked?.targetId).toBe("Q-Auth");
    expect(locked?.optionsVersion).toBe(2);
    expect(locked?.openQuestionCardId).toBe("Q-Auth");
    expect(locked?.openQuestionOptionsVersion).toBe(2);
    expect(locked?.inputStartedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(locked?.frozen).toBe(true);

    view.bundle.clock.set("2026-04-01T00:00:00.400Z");
    view.receiveLateInboxCard(budgetCard());
    view.type("ption 1");
    const sent = view.send();
    expect(view.bundle.snapshotter.captures).toHaveLength(1);
    expect(sent.status).toBe("sent");
    if (sent.status !== "sent") return;
    expect(sent.submission.inputStartSnapshot.targetId).toBe("Q-Auth");
    expect(sent.submission.inputStartSnapshot.optionsVersion).toBe(2);
    expect(sent.submission.routedTargetId).toBe("Q-Auth");
    expect(sent.submission.routedOptionsVersion).toBe(2);
    expect(sent.submission.text).toBe("Option 1");
    expect(view.viewModel().lateInboxCardIds).toEqual(["Q-Budget"]);
    expect(sent.submission.routedTargetId).not.toBe("Q-Budget");
  });

  it("locks the same snapshot on mic press and does not send interim speech", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.pressMic();
    expect(view.viewModel().recording).toBe(true);
    expect(view.viewModel().snapshotLocked).toBe(true);
    expect(view.bundle.snapshotter.captures).toHaveLength(1);
    view.setInterimDraft("ten thirty", "tentative");
    expect(view.viewModel().interim?.stability).toBe("tentative");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    view.applyDictationSyllable("10:30");
    expect(view.viewModel().draftText).toContain("10:30");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    expect(view.bundle.dictation.syllables).toEqual(["10:30"]);
    view.pressMic();
    expect(view.bundle.snapshotter.captures).toHaveLength(1);
    expect(view.viewModel().recording).toBe(false);
  });

  it("prompts before a bare 2 is sent to a box while a numbered question is open", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.activateTarget(boxTarget([printButton()]));
    view.type("2");
    const blocked = view.send();
    expect(blocked.status).toBe("needs-confirmation");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    if (blocked.status !== "needs-confirmation") return;
    expect(blocked.prompt.message).toBe("Did you mean Option 2 for 'Auth Method'?");
    const kept = view.chooseMismatch("keep-current");
    expect(kept.status).toBe("sent");
    if (kept.status !== "sent") return;
    expect(kept.submission.routedKind).toBe("Box");
    expect(kept.submission.routedTargetId).toBe("D-Print");
    expect(kept.submission.inputStartSnapshot.targetType).toBe("Box");
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().toast?.message).toBe(
      "Sent to Print Button · Back to replying to 'Auth Method' (Stay on Print Button)",
    );
  });

  it("prompts when Option 2 is aimed at a preview element", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.activateTarget(elementTarget(headerLogo()));
    view.type("Option 2");
    const blocked = view.send();
    expect(blocked.status).toBe("needs-confirmation");
    if (blocked.status !== "needs-confirmation") return;
    expect(blocked.prompt.message).toBe("Did you mean Option 2 for 'Auth Method'?");
    const answered = view.chooseMismatch("answer-question");
    expect(answered.status).toBe("sent");
    if (answered.status !== "sent") return;
    expect(answered.submission.routedKind).toBe("Question");
    expect(answered.submission.routedTargetId).toBe("Q-04");
    expect(answered.submission.routedOptionsVersion).toBe(2);
    expect(answered.submission.text).toBe("Option 2");
  });

  it("catches a UI tweak aimed at a narrow multiple-choice question", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Make the header background darker blue");
    const blocked = view.send();
    expect(blocked.status).toBe("needs-confirmation");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    if (blocked.status !== "needs-confirmation") return;
    expect(blocked.prompt.message).toBe(
      "Send as answer to Auth Method, or switch to General steering?",
    );
    const steered = view.chooseMismatch("switch-to-general");
    expect(steered.status).toBe("sent");
    if (steered.status !== "sent") return;
    expect(steered.submission.routedKind).toBe("General");
    expect(steered.submission.routedTargetId).toBe("general");
    expect(view.viewModel().target.kind).toBe("General");
    expect(view.viewModel().openQuestionId).toBe("Q-04");
  });

  it("can still send the mismatched sentence as the question answer", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Make the header background darker blue");
    view.send();
    const sent = view.chooseMismatch("send-as-answer");
    expect(sent.status).toBe("sent");
    if (sent.status !== "sent") return;
    expect(sent.submission.routedKind).toBe("Question");
    expect(sent.submission.routedTargetId).toBe("Q-04");
  });

  it("returns to the waiting question after a side box message", () => {
    const view = composer();
    view.focusQuestion(dietaryQuestion());
    view.type("no peanuts");
    view.setCaret(3, 3);
    view.activateTarget(boxTarget([cutoffBox()]));
    view.type("Change this to 10:30");
    const sent = view.send();
    expect(sent.status).toBe("sent");
    if (sent.status !== "sent") return;
    expect(sent.submission.routedKind).toBe("Box");
    expect(sent.submission.routedTargetId).toBe("D-17");
    expect(sent.submission.nodeIds).toEqual(["D-17"]);
    expect(sent.submission.nodeRevisions).toEqual([{ nodeId: "D-17", revision: 3 }]);
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().draftText).toBe("no peanuts");
    expect(view.viewModel().cursor).toBe(3);
    expect(view.viewModel().toast?.message).toBe(
      "Sent to Cutoff Rule R17 · Back to replying to 'Dietary Notes' (Stay on Cutoff Rule R17)",
    );
    view.stayOnSideTarget();
    expect(view.viewModel().target.kind).toBe("Box");
    expect(view.viewModel().toast).toBeNull();
    expect(view.machine.draftStore.read("question:Q-Diet").text).toBe("no peanuts");
  });

  it("returns to the waiting question after a side element message", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Magic link");
    view.activateTarget(elementTarget(headerLogo()));
    view.type("Why is the logo faint?");
    view.send();
    expect(view.viewModel().toast?.message).toBe(
      "Sent to Header Logo · Back to replying to 'Auth Method' (Stay on Header Logo)",
    );
    expect(view.viewModel().draftText).toBe("Magic link");
    expect(view.viewModel().target.kind).toBe("Question");
  });

  it("flags Option B and an option label typed onto the wrong target", () => {
    const guard = new TargetTypeMismatchGuard();
    const question = authQuestion();
    const box = boxTarget([cutoffBox()]);
    const positional = guard.inspect({ target: box, text: "Option B", openQuestion: question });
    expect(positional?.message).toBe("Did you mean Option B for 'Auth Method'?");
    const labeled = guard.inspect({ target: box, text: "Magic link", openQuestion: question });
    expect(labeled?.message).toBe("Did you mean this as the answer to Q-04 (Auth Method)?");
    const answer = guard.inspect({
      target: question,
      text: "Magic link",
      openQuestion: question,
    });
    expect(answer).toBeNull();
  });
});
