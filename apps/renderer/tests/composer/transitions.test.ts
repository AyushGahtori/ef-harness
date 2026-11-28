import { describe, expect, it } from "vitest";
import { pillText, useComposerTarget } from "../../src/composer/index.js";
import type { ComposerTarget } from "../../src/composer/index.js";
import {
  authQuestion,
  boxTarget,
  composer,
  cutoffBox,
  elementTarget,
  ordersBox,
  cateringBox,
  submitElement,
} from "./fixtures.js";

function targets(): Record<"Question" | "Box" | "Element" | "General", ComposerTarget> {
  return {
    Question: authQuestion(),
    Box: boxTarget([cutoffBox()]),
    Element: elementTarget(submitElement()),
    General: { kind: "General" },
  };
}

describe("single composer target transitions", () => {
  it("shows the four exact target pills and only one composer slot", () => {
    const view = composer();
    expect(view.viewModel().pillText).toBe("Message project / steering");
    expect(view.viewModel().composerCount).toBe(1);
    expect(view.viewModel().slot).toBe("chat-composer");
    expect(view.bundle.shell.mounted?.composerId).toBe("single-composer");

    view.focusQuestion(authQuestion());
    expect(view.viewModel().pillText).toBe("Replying to: Auth Method [Q-04] · ✕");

    view.activateTarget(boxTarget([cutoffBox(), ordersBox(), cateringBox()]));
    expect(view.viewModel().pillText).toBe("Talking about: Cutoff Rule R17 (+2 more) · ✕");

    view.activateTarget(elementTarget(submitElement()));
    expect(view.viewModel().pillText).toBe(
      "Fixing UI: Submit Order button (OrderForm.tsx:84) · ✕",
    );
    expect(pillText({ kind: "General" })).toBe("Message project / steering");
  });

  it("preserves text and cursor for every target pair", () => {
    const kinds = ["Question", "Box", "Element", "General"] as const;
    const catalog = targets();
    for (const from of kinds) {
      for (const to of kinds) {
        const view = composer();
        view.activateTarget(catalog[from]);
        const marker = `${from}->${to}`;
        view.type(marker);
        view.setCaret(1, 1);
        view.activateTarget(catalog[to]);
        if (from !== to) {
          expect(view.viewModel().draftText).toBe("");
          view.type("other");
        }
        view.activateTarget(catalog[from]);
        expect(view.viewModel().draftText).toBe(marker);
        expect(view.viewModel().cursor).toBe(1);
        expect(view.viewModel().selectionEnd).toBe(1);
        expect(view.bundle.sequencer.messages).toHaveLength(0);
        view.dispose();
      }
    }
  });

  it("exposes the active target through useComposerTarget", () => {
    const view = composer();
    const binding = useComposerTarget(view.machine);
    let calls = 0;
    const stop = binding.subscribe(() => {
      calls += 1;
    });
    view.focusQuestion(authQuestion());
    expect(calls).toBeGreaterThan(0);
    const snapshot = binding.getSnapshot();
    expect(snapshot.composerId).toBe("single-composer");
    expect(snapshot.targetKey).toBe("question:Q-04");
    expect(snapshot.pillText).toBe("Replying to: Auth Method [Q-04] · ✕");
    expect(snapshot.openQuestionId).toBe("Q-04");
    stop();
    view.dispose();
  });
});
