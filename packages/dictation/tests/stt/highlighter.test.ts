import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE_P, LowConfidenceCriticalSpanHighlighter, VERIFY_OR_EDIT } from "../../src/stt/index.js";
import { MemoryVocabulary } from "../../src/stt/index.js";
import type { HypothesisToken } from "../../src/stt/index.js";
import { createSession, speechPcm } from "./support.js";

function token(text: string, probability: number, semanticClass?: HypothesisToken["semanticClass"]): HypothesisToken {
  if (semanticClass === undefined) return { text, probability };
  return { text, probability, semanticClass };
}

describe("amber low-confidence critical spans", () => {
  const highlighter = new LowConfidenceCriticalSpanHighlighter();

  it("underlines the unsure negation and time and ignores the rest of the sentence", async () => {
    const spans = highlighter.mark([
      token("Make", 0.91),
      token("sure", 0.9),
      token("orders", 0.88),
      token("DON'T", 0.58),
      token("allow", 0.93),
      token("edits", 0.9),
      token("after", 0.87),
      token("11:30", 0.64),
    ]);
    expect(spans.map((span) => span.text)).toEqual(["DON'T", "11:30"]);
    expect(spans.map((span) => span.semanticClass)).toEqual(["negation", "time"]);
    expect(spans.every((span) => span.decoration === "amber-underline")).toBe(true);
    expect(spans.every((span) => span.tooltip === VERIFY_OR_EDIT)).toBe(true);
    expect(spans.every((span) => span.probability < LOW_CONFIDENCE_P)).toBe(true);
  });

  it("flags prices, quantities, dates, quantifiers, and unknown domain names only", async () => {
    const spans = highlighter.mark([
      token("$19", 0.4),
      token("5", 0.41),
      token("MB", 0.99),
      token("Friday", 0.5),
      token("never", 0.2),
      token("no", 0.3),
      token("without", 0.31),
      token("only", 0.33),
      token("all", 0.34),
      token("except", 0.35),
      token("Stripe", 0.4),
      token("MenuItem", 0.45),
      token("API", 0.46),
      token("the", 0.1),
      token("please", 0.12),
      token("15", 0.9),
      token("11:30", 0.72),
      token("50", Math.log(0.5)),
    ]);
    expect(spans.map((span) => [span.text, span.semanticClass])).toEqual([
      ["$19", "price"],
      ["5 MB", "quantity"],
      ["Friday", "date"],
      ["never", "negation"],
      ["no", "negation"],
      ["without", "negation"],
      ["only", "quantifier"],
      ["all", "quantifier"],
      ["except", "quantifier"],
      ["Stripe", "domain_identifier"],
      ["MenuItem", "domain_identifier"],
      ["API", "domain_identifier"],
      ["50", "number"],
    ]);
    const fifty = spans.find((span) => span.text === "50");
    expect(fifty?.probability).toBeCloseTo(0.5, 5);
  });

  it("does not amber a domain name that is already in project vocabulary", async () => {
    const known = new LowConfidenceCriticalSpanHighlighter(new MemoryVocabulary(["Stripe", "MenuItem"]));
    const spans = known.mark([
      token("Stripe", 0.4),
      token("MenuItem", 0.2),
      token("Playwright", 0.4),
      token("15", 0.71),
    ]);
    expect(spans.map((span) => span.text)).toEqual(["Playwright", "15"]);
  });

  it("projects the same underlines onto the live draft", async () => {
    const { engine, decoder } = createSession();
    await engine.start();
    const frame = [
      token("Make", 0.95),
      token("sure", 0.95),
      token("orders", 0.95),
      token("don't", 0.58),
      token("allow", 0.95),
      token("edits", 0.95),
      token("after", 0.95),
      token("11:30", 0.64),
    ];
    decoder.queue(frame);
    engine.pushPcm(speechPcm());
    const live = engine.snapshot();
    expect(live.highlights.map((span) => span.text)).toEqual(["don't", "11:30"]);
    expect(live.fullText).toBe("Make sure orders don't allow edits after 11:30");
  });
});
