import { ExplainerProviderError } from "./explainer.js";
import { isOneSentence } from "./explainer-schema.js";
import type { BoundedExplainerFacts } from "./types.js";

export type FakeModelMode =
  | "scripted"
  | "two_sentence"
  | "offline"
  | "payment_required"
  | "essay"
  | "bad_citation";

/**
 * Test double for `cockpit-explainer@1`. Successful replies cite only ids
 * that were actually on the bounded timeline.
 */
export class FakeModelAdapter {
  calls = 0;
  tokensCharged = 0;
  readonly tokensPerCall = 17;
  readonly prompts: BoundedExplainerFacts[] = [];
  mode: FakeModelMode = "scripted";

  async complete(facts: BoundedExplainerFacts): Promise<unknown> {
    this.calls += 1;
    this.prompts.push(facts);
    if (this.mode === "offline") {
      throw new ExplainerProviderError("offline");
    }
    if (this.mode === "payment_required") {
      throw new ExplainerProviderError("payment_required", 402);
    }
    const last = facts.timeline.at(-1);
    if (!last) {
      throw new ExplainerProviderError("offline");
    }
    if (this.mode === "essay") {
      return {
        prose: Array.from({ length: 10 }, (_, index) => `Speculation paragraph ${index + 1}.`).join(
          " ",
        ),
      };
    }
    if (this.mode === "bad_citation") {
      return {
        whatItWasTryingToDo: "It was trying to invent a cause.",
        whyItStalledOrFailed: "It stalled because of an unseen event.",
        recommendedNextClick: "Recommended next click: Guess.",
        citedEventIds: ["evt-hallucinated"],
      };
    }
    this.tokensCharged += this.tokensPerCall;
    if (this.mode === "two_sentence") {
      return {
        sentences: [
          `It is working through ${last.summary}.`,
          "A blocker is visible in the cited event.",
        ],
        citedEventIds: [last.id],
      };
    }
    const trying = `It was trying to ${last.summary}.`;
    const why = facts.failingTestOrErrorSnippet
      ? `It stalled on ${facts.failingTestOrErrorSnippet}.`
      : "It is still making progress.";
    const next = "Recommended next click: Inspect.";
    if (!isOneSentence(trying) || !isOneSentence(why) || !isOneSentence(next)) {
      throw new Error("scripted explainer reply is not one sentence per bullet");
    }
    return {
      whatItWasTryingToDo: trying,
      whyItStalledOrFailed: why,
      recommendedNextClick: next,
      citedEventIds: [last.id],
    };
  }
}
