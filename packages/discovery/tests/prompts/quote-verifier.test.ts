import { describe, expect, it } from "vitest";
import { ExactQuoteEvidenceVerifier } from "../../src/prompts/index.js";
import { developerTurn, locate } from "./helpers.js";

describe("ExactQuoteEvidenceVerifier", () => {
  it("rejects assistant quotes, edited digits, dropped negations, bounds, currency, and stale options", () => {
    const kept = "don't allow edits after 10:45";
    const verifier = new ExactQuoteEvidenceVerifier([
      developerTurn("T1", kept),
      developerTurn("T2", "Budget is $10"),
      { id: "T3", author: "harness", text: "Use email for the totals." },
      developerTurn("T4", "use the second one"),
      developerTurn("T5", "old cutoff", { superseded: true }),
      developerTurn("T6", "Email the totals", { retractedSpans: [{ start: 0, end: 5 }] }),
    ]);

    const assistant = verifier.validateSpan(locate("Use email for the totals.", "Use email", "T3"));
    expect(assistant.accepted).toBe(false);
    expect(assistant.code).toBe("assistant_author");

    const edited = verifier.validateSpan({
      turn: "T1",
      start: 0,
      end: kept.length,
      quote: "don't allow edits after 11:00",
    });
    expect(edited.accepted).toBe(false);
    expect(edited.code).toBe("digit_altered");

    const dropped = verifier.validateSpan(locate(kept, "allow edits after 10:45"));
    expect(dropped.accepted).toBe(false);
    expect(dropped.code).toBe("negation_dropped");

    const keptQuote = verifier.validateSpan(locate(kept, kept));
    expect(keptQuote.accepted).toBe(true);
    expect(keptQuote.code).toBe("accepted");

    const bounds = verifier.validateSpan({ turn: "T1", start: 0, end: 500, quote: kept });
    expect(bounds.code).toBe("out_of_bounds");

    const currency = verifier.validateSpan({
      turn: "T2",
      start: "Budget is ".length,
      end: "Budget is $10".length,
      quote: "10",
    });
    expect(currency.code).toBe("currency_altered");
    expect(verifier.validateSpan(locate("Budget is $10", "$10", "T2")).accepted).toBe(true);

    const stale = verifier.validateSpan(locate("use the second one", "use the second one", "T4"), {
      basis: "explicit",
      value: "email",
      questionId: "Q2",
      binding: {
        turnId: "T4",
        questionId: "Q2",
        optionsVersionAtInputStart: 2,
        replyOptionsVersion: 3,
      },
    });
    expect(stale.code).toBe("stale_options_version");

    const unbound = verifier.validateSpan(locate("use the second one", "use the second one", "T4"), {
      basis: "explicit",
      value: "email",
      questionId: "Q2",
    });
    expect(unbound.code).toBe("positional_unbound");

    const bound = verifier.validateSpan(locate("use the second one", "use the second one", "T4"), {
      basis: "explicit",
      value: "email",
      questionId: "Q2",
      binding: {
        turnId: "T4",
        questionId: "Q2",
        optionsVersionAtInputStart: 3,
        replyOptionsVersion: 3,
      },
    });
    expect(bound.accepted).toBe(true);

    expect(verifier.validateSpan(locate("old cutoff", "old cutoff", "T5")).code).toBe("superseded");
    expect(verifier.validateSpan(locate("Email the totals", "Email", "T6")).code).toBe("retracted");
  });

  it("rejects every in-turn mention of a scrapped topic, including a wider span", () => {
    const text = "Maybe add printing. Email the totals. Actually, scrap printing";
    const verifier = new ExactQuoteEvidenceVerifier([developerTurn("T1", text)]);
    const first = text.indexOf("printing");
    const wider = text.indexOf("add printing");
    const later = text.lastIndexOf("printing");
    expect(verifier.validateSpan({ turn: "T1", start: first, end: first + "printing".length, quote: "printing" }).code).toBe("retracted");
    expect(verifier.validateSpan({ turn: "T1", start: wider, end: wider + "add printing".length, quote: "add printing" }).code).toBe("retracted");
    expect(verifier.validateSpan({ turn: "T1", start: later, end: later + "printing".length, quote: "printing" }).code).toBe("retracted");
    expect(verifier.validateSpan(locate(text, "Email the totals")).accepted).toBe(true);

    const draft = "Email the totals. scrap the draft";
    const draftVerifier = new ExactQuoteEvidenceVerifier([developerTurn("T2", draft)]);
    expect(draftVerifier.validateSpan(locate(draft, "Email the totals", "T2")).accepted).toBe(true);
    const draftAt = draft.lastIndexOf("draft");
    expect(draftVerifier.validateSpan({ turn: "T2", start: draftAt, end: draftAt + "draft".length, quote: "draft" }).code).toBe("retracted");
  });

  it("collapses whitespace without ignoring digits or negations", () => {
    const text = "Email   the totals at 10:45";
    const verifier = new ExactQuoteEvidenceVerifier([developerTurn("T1", text)]);
    const accepted = verifier.validateSpan({
      turn: "T1",
      start: 0,
      end: text.length,
      quote: "Email the totals at 10:45",
    });
    expect(accepted.accepted).toBe(true);
  });
});
