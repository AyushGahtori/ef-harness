import { describe, expect, it } from "vitest";
import { MultiBoxClauseSplitter } from "../../src/composer/index.js";
import {
  boxTarget,
  cateringBox,
  composer,
  cutoffBox,
  menuBox,
  ordersBox,
} from "./fixtures.js";

describe("multi-box clauses, file drop, and keyboard ergonomics", () => {
  it("splits a two-box cutoff message into ordered anchored clauses", () => {
    const boxes = [cutoffBox(4), cateringBox()];
    const split = new MultiBoxClauseSplitter().split(
      "Move cutoff to 10:30 and send catering email at 10:45",
      boxes,
    );
    expect(split.nodeIds).toEqual(["D-17", "D-Email"]);
    expect(split.nodeRevisions).toEqual([
      { nodeId: "D-17", revision: 4 },
      { nodeId: "D-Email", revision: 2 },
    ]);
    expect(split.clauses).toHaveLength(2);
    expect(split.clauses[0]).toMatchObject({
      order: 1,
      clauseText: "Move cutoff to 10:30",
      nodeId: "D-17",
      revision: 4,
      intentType: "edit_existing",
    });
    expect(split.clauses[1]).toMatchObject({
      order: 2,
      clauseText: "send catering email at 10:45",
      nodeId: "D-Email",
      revision: 2,
      intentType: "edit_existing",
    });
  });

  it("splits a menu and orders dictation and forwards it to the clause executor", () => {
    const view = composer();
    const boxes = [menuBox(), ordersBox()];
    view.activateTarget(boxTarget(boxes));
    view.type("Add gluten-free tag to Menu and show it on Order summary");
    const sent = view.send();
    expect(sent.status).toBe("sent");
    expect(view.bundle.clauseExecutor.executions).toHaveLength(1);
    const execution = view.bundle.clauseExecutor.executions[0];
    expect(execution?.nodeIds).toEqual(["F-Menu", "F-Orders"]);
    expect(execution?.nodeRevisions).toEqual([
      { nodeId: "F-Menu", revision: 1 },
      { nodeId: "F-Orders", revision: 8 },
    ]);
    expect(execution?.clauses.map((clause) => clause.nodeId)).toEqual(["F-Menu", "F-Orders"]);
    expect(execution?.clauses[0]?.clauseText).toContain("Menu");
    expect(execution?.clauses[1]?.clauseText.toLowerCase()).toContain("order");
    if (sent.status !== "sent") return;
    expect(sent.submission.nodeIds).toEqual(["F-Menu", "F-Orders"]);
    expect(sent.submission.clauses).toHaveLength(2);
  });

  it("shows PDF and SVG chips and routes them on send", () => {
    const view = composer();
    const chips = view.dropFiles([
      { name: "PRD.pdf", byteSize: 2048, mediaType: "application/pdf" },
      { name: "logo.svg", byteSize: 120, mediaType: "image/svg+xml" },
      { name: "session.har", byteSize: 4096, mediaType: "application/json" },
      { name: "brief.docx", byteSize: 8192, mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    ]);
    expect(chips.map((chip) => chip.typeBadge)).toEqual(["PDF", "SVG", "HAR", "DOCX"]);
    expect(chips[0]?.sizeLabel).toBe("2 KB");
    expect(chips[1]?.sizeLabel).toBe("120 B");
    expect(chips[0]?.route).toBe("intake");
    expect(chips[1]?.route).toBe("brand-asset");
    expect(view.viewModel().attachments).toHaveLength(4);
    const sent = view.send();
    expect(sent.status).toBe("sent");
    expect(view.bundle.intake.converted.map((chip) => chip.name)).toEqual([
      "PRD.pdf",
      "session.har",
      "brief.docx",
    ]);
    expect(view.bundle.intake.extracted.map((chip) => chip.name)).toEqual([
      "PRD.pdf",
      "session.har",
      "brief.docx",
    ]);
    expect(view.bundle.brand.sanitized.map((chip) => chip.name)).toEqual(["logo.svg"]);
    expect(view.viewModel().attachments).toHaveLength(0);
  });

  it("inserts a newline on Shift+Enter, sends on Enter, and recalls draft history", () => {
    const view = composer();
    view.type("first line");
    const newline = view.keydown("Enter", { shift: true });
    expect(newline.action).toBe("newline");
    expect(view.viewModel().draftText).toBe("first line\n");
    expect(view.bundle.sequencer.messages).toHaveLength(0);
    view.type("second line");
    const sent = view.keydown("Enter");
    expect(sent.action).toBe("send");
    expect(sent.send?.status).toBe("sent");
    expect(view.viewModel().draftText).toBe("");
    const recalled = view.keydown("ArrowUp");
    expect(recalled.action).toBe("history");
    expect(view.viewModel().draftText).toBe("first line\nsecond line");
  });

  it("walks older sent drafts with a second Up Arrow", () => {
    const view = composer();
    view.type("one");
    view.send();
    view.type("two");
    view.send();
    view.keydown("ArrowUp");
    expect(view.viewModel().draftText).toBe("two");
    view.setCaret(0, 0);
    view.keydown("ArrowUp");
    expect(view.viewModel().draftText).toBe("one");
  });

  it("closes a preview on Esc before it asks to clear the question", () => {
    const view = composer();
    view.focusQuestion({
      kind: "Question",
      questionId: "Q-04",
      title: "Auth Method",
      optionsVersion: 2,
      options: [
        { position: 1, label: "Magic link" },
        { position: 2, label: "Email+Password" },
      ],
    });
    view.type("Magic link");
    view.inspectBoxes([cutoffBox()]);
    expect(view.keydown("Escape").action).toBe("dismiss-preview");
    expect(view.viewModel().preview).toBeNull();
    expect(view.viewModel().target.kind).toBe("Question");
    expect(view.keydown("Escape").action).toBe("confirm-clear");
  });
});
