import { describe, expect, it } from "vitest";
import {
  DRAFT_SESSION_KEY,
  MemorySessionStorage,
  PerTargetDraftStore,
} from "../../src/composer/index.js";
import {
  authQuestion,
  composer,
  cutoffBox,
  orderEntity,
  submitElement,
} from "./fixtures.js";

describe("per-target drafts and non-answering selection", () => {
  it("restores a question draft from memory and session storage", () => {
    const session = new MemorySessionStorage();
    const clock = "2026-04-02T12:00:00.000Z";
    const store = new PerTargetDraftStore({ session, now: () => clock });
    store.save("question:Q-04", { text: "Magic link", cursor: 5, selectionEnd: 5 });
    const revived = new PerTargetDraftStore({ session, now: () => clock });
    expect(revived.read("question:Q-04")).toEqual({
      text: "Magic link",
      cursor: 5,
      selectionEnd: 5,
    });
    expect(session.getItem(DRAFT_SESSION_KEY)).toContain("Magic link");
    expect(revived.read("general")).toEqual({ text: "", cursor: 0, selectionEnd: 0 });
  });

  it("keeps an in-progress question when a canvas box is only inspected", () => {
    const view = composer();
    const question = authQuestion();
    view.focusQuestion(question);
    view.type("Magic link");
    view.setCaret(5, 5);
    view.inspectBoxes([orderEntity()]);
    const model = view.viewModel();
    expect(model.target.kind).toBe("Question");
    expect(model.draftText).toBe("Magic link");
    expect(model.cursor).toBe(5);
    expect(model.preview?.switchLabel).toBe("Switch composer to this box");
    expect(model.preview?.boxes[0]?.nodeId).toBe("entity:Order");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    if (model.target.kind === "Question") {
      expect(model.target.selectedOptionPosition).toBe(1);
      expect(model.target.optionsVersion).toBe(2);
    }
    view.dismissPreview();
    expect(view.viewModel().draftText).toBe("Magic link");
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().preview).toBeNull();
  });

  it("does not hijack an open question when the selection controller syncs", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Magic link");
    view.bundle.selection.select([cutoffBox()]);
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().draftText).toBe("Magic link");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    view.dispose();
  });

  it("stashes the question draft when the composer explicitly switches to a box", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Magic link");
    view.setCaret(6, 6);
    view.inspectBoxes([cutoffBox()]);
    view.switchComposerToPreview();
    expect(view.viewModel().target.kind).toBe("Box");
    expect(view.viewModel().draftText).toBe("");
    expect(view.viewModel().pausedQuestion?.note).toBe(
      "Paused: you're talking about Cutoff Rule R17",
    );
    expect(view.viewModel().pausedQuestion?.selectedOptionPosition).toBe(1);
    expect(view.machine.draftStore.read("question:Q-04")).toEqual({
      text: "Magic link",
      cursor: 6,
      selectionEnd: 6,
    });
    view.focusQuestion(authQuestion());
    expect(view.viewModel().draftText).toBe("Magic link");
    expect(view.viewModel().cursor).toBe(6);
    expect(view.bundle.sequencer.messages).toHaveLength(0);
  });

  it("previews a point-to-fix element without submitting the open question", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("Email");
    view.inspectPreviewElement(submitElement());
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().draftText).toBe("Email");
    expect(view.viewModel().preview?.switchLabel).toBe("Switch composer to this element");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
  });

  it("moves a cleared-target paragraph onto General and keeps it recoverable", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    const paragraph = "A long paragraph that must survive clearing the target pill.";
    view.type(paragraph);
    view.setCaret(4, 4);
    view.clearPill();
    expect(view.viewModel().target.kind).toBe("General");
    expect(view.viewModel().pillText).toBe("Message project / steering");
    expect(view.viewModel().draftText).toBe(paragraph);
    expect(view.viewModel().cursor).toBe(4);
    expect(view.machine.draftStore.read("question:Q-04").text).toBe(paragraph);
    view.focusQuestion(authQuestion());
    expect(view.viewModel().draftText).toBe(paragraph);
  });

  it("asks before Esc clears a target that still has text", () => {
    const view = composer();
    view.focusQuestion(authQuestion());
    view.type("still typing");
    const first = view.keydown("Escape");
    expect(first.action).toBe("confirm-clear");
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.viewModel().draftText).toBe("still typing");
    expect(view.viewModel().escConfirm?.message).toContain("draft stays recoverable");
    view.confirmClearTarget();
    expect(view.viewModel().target.kind).toBe("General");
    expect(view.viewModel().draftText).toBe("still typing");
    expect(view.machine.draftStore.read("question:Q-04").text).toBe("still typing");
  });

  it("returns to General immediately when Esc finds an empty explicit target", () => {
    const view = composer();
    view.activateTarget({ kind: "Box", boxes: [cutoffBox()] });
    const result = view.keydown("Escape");
    expect(result.action).toBe("clear-target");
    expect(view.viewModel().target.kind).toBe("General");
    expect(view.viewModel().escConfirm).toBeNull();
  });
});
