import { describe, expect, it } from "vitest";
import { DictationStabilityStream } from "../../src/stt/index.js";
import { createSession, speechPcm, words } from "./support.js";

describe("LocalAgreement-2 stability and keyboard edits", () => {
  it("keeps the first frame grey and confirms the agreed prefix on the next frame", async () => {
    const stream = new DictationStabilityStream();
    const first = stream.ingest(words("make sure orders"));
    expect(first.confirmed).toEqual([]);
    expect(first.tentative.map((token) => token.text)).toEqual(["make", "sure", "orders"]);
    expect(first.tentative.every((token) => token.stability === "tentative")).toBe(true);

    const second = stream.ingest(words("make sure orders don't"));
    expect(second.confirmed.map((token) => token.text)).toEqual(["make", "sure", "orders"]);
    expect(second.confirmed.every((token) => token.stability === "confirmed")).toBe(true);
    expect(second.tentative.map((token) => token.text)).toEqual(["don't"]);
    expect(second.tentative[0]?.stability).toBe("tentative");

    const third = stream.ingest(words("make sure orders don't"));
    expect(third.confirmed.map((token) => token.text)).toEqual(["make", "sure", "orders", "don't"]);
    expect(third.tentative).toEqual([]);
  });

  it("does not let a shorter stale frame revoke confirmed words", async () => {
    const stream = new DictationStabilityStream();
    stream.ingest(words("hello schema"));
    stream.ingest(words("hello schema"));
    const stale = stream.ingest(words("goodbye"));
    expect(stale.confirmed.map((token) => token.text)).toEqual(["hello", "schema"]);
    expect(stale.tentative).toEqual([]);
  });

  it("streams grey then black from recorded PCM and never auto-sends", async () => {
    const { engine, decoder, composer } = createSession();
    decoder.queue(words("make sure orders"));
    await engine.start();
    engine.pushPcm(speechPcm());
    expect(engine.snapshot().tentative).toBe("make sure orders");
    expect(engine.snapshot().confirmed).toBe("");
    expect(engine.snapshot().segments.every((token) => token.stability === "tentative")).toBe(true);

    decoder.queue(words("make sure orders"));
    engine.pushPcm(speechPcm());
    const confirmed = engine.snapshot();
    expect(confirmed.confirmed).toBe("make sure orders");
    expect(confirmed.tentative).toBe("");
    expect(confirmed.segments.every((token) => token.stability === "confirmed")).toBe(true);
    expect(confirmed.autoSend).toBe(false);
    expect(composer.submitCount).toBe(0);
    expect(composer.confirmed).toBe("make sure orders");
    expect(composer.targetKey).toBe("question:Q-41");
  });

  it("preserves a keyboard edit in confirmed text while the grey tail keeps moving", async () => {
    const { engine, decoder, composer } = createSession();
    await engine.start();
    decoder.queue(words("make sure orders"));
    engine.pushPcm(speechPcm());
    decoder.queue(words("make sure orders"));
    engine.pushPcm(speechPcm());

    engine.applyKeyboardEdit({ start: 10, end: 16, insert: "order" });
    const edited = engine.snapshot();
    expect(edited.confirmed).toBe("make sure order");
    expect(edited.cursor).toBe(15);

    decoder.queue(words("make sure orders"));
    engine.pushPcm(speechPcm());
    expect(engine.snapshot().confirmed).toBe("make sure order");
    expect(engine.snapshot().cursor).toBe(15);

    decoder.queue(words("make sure orders don't"));
    engine.pushPcm(speechPcm());
    const tail = engine.snapshot();
    expect(tail.confirmed).toBe("make sure order");
    expect(tail.tentative).toBe("don't");
    expect(tail.cursor).toBe(15);

    decoder.queue(words("make sure orders don't"));
    engine.pushPcm(speechPcm());
    const extended = engine.snapshot();
    expect(extended.confirmed).toBe("make sure order don't");
    expect(extended.tentative).toBe("");
    expect(extended.cursor).toBe(15);
    expect(extended.fullText.startsWith("make sure order")).toBe(true);
    expect(composer.submitCount).toBe(0);

    engine.submitFromUser();
    expect(composer.submitCount).toBe(1);
    expect(composer.lastSubmitted).toBe("make sure order don't");
  });
});
