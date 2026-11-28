import { afterEach, describe, expect, it, vi } from "vitest";
import { MIC_OFF_AFTER_SILENCE, PAUSED_LISTENING_HINT } from "../../src/stt/index.js";
import { createSession, speechPcm, words } from "./support.js";

describe("exact 3s hint and 60s mic-off", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the pause hint at 3s, keeps the mic, and continues the same draft at 8s", async () => {
    vi.useFakeTimers();
    const { engine, decoder, composer, gpu } = createSession();
    decoder.queue(words("we should use sqlite"));
    decoder.queue(words("we should use sqlite"));
    await engine.start();
    engine.pushPcm(speechPcm());
    engine.pushPcm(speechPcm());
    expect(engine.snapshot().confirmed).toBe("we should use sqlite");

    vi.advanceTimersByTime(2_999);
    expect(engine.snapshot().hint).toBeNull();
    expect(engine.snapshot().micOn).toBe(true);

    vi.advanceTimersByTime(1);
    expect(engine.snapshot().hint).toBe(PAUSED_LISTENING_HINT);
    expect(engine.snapshot().micOn).toBe(true);
    expect(gpu.heldLeaseId()).not.toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(engine.snapshot().micOn).toBe(true);
    expect(engine.snapshot().hint).toBe(PAUSED_LISTENING_HINT);
    expect(composer.submitCount).toBe(0);

    decoder.queue(words("we should use sqlite for the schema"));
    engine.pushPcm(speechPcm());
    const continued = engine.snapshot();
    expect(continued.micOn).toBe(true);
    expect(continued.hint).toBeNull();
    expect(continued.fullText).toBe("we should use sqlite for the schema");
    expect(continued.confirmed).toBe("we should use sqlite");
    expect(continued.tentative).toBe("for the schema");
    expect(composer.submitCount).toBe(0);
    expect(composer.lastSubmitted).toBeNull();
  });

  it("turns the mic off at 60s, releases GPU priority, and keeps the draft", async () => {
    vi.useFakeTimers();
    const { engine, decoder, composer, gpu, jobs } = createSession();
    decoder.queue(words("hello schema"));
    decoder.queue(words("hello schema"));
    await engine.start();
    engine.pushPcm(speechPcm());
    engine.pushPcm(speechPcm());
    const jobId = engine.snapshot().jobId;
    expect(jobId).not.toBeNull();
    expect(gpu.backgroundDeferred).toBe(true);

    vi.advanceTimersByTime(3_000);
    expect(engine.snapshot().hint).toBe(PAUSED_LISTENING_HINT);
    expect(engine.snapshot().micOn).toBe(true);

    vi.advanceTimersByTime(57_000);
    const parked = engine.snapshot();
    expect(parked.micOn).toBe(false);
    expect(parked.hint).toBeNull();
    expect(parked.status).toBe(MIC_OFF_AFTER_SILENCE);
    expect(parked.confirmed).toBe("hello schema");
    expect(parked.fullText).toBe("hello schema");
    expect(parked.gpuHeld).toBe(false);
    expect(parked.jobOpen).toBe(false);
    expect(parked.pcmBytes).toBe(0);
    expect(parked.wavWrites).toBe(0);
    expect(parked.networkUploads).toBe(0);
    expect(gpu.releaseCount).toBe(1);
    expect(gpu.backgroundDeferred).toBe(false);
    expect(jobs.activeChildCount(jobId ?? "")).toBe(0);
    expect(composer.submitCount).toBe(0);
    expect(composer.confirmed).toBe("hello schema");

    engine.submitFromUser();
    expect(composer.submitCount).toBe(1);
    expect(composer.lastSubmitted).toBe("hello schema");
  });

  it("turns a forgotten mic off at 60s even when nobody spoke", async () => {
    vi.useFakeTimers();
    const { engine, gpu } = createSession();
    await engine.start();
    expect(engine.snapshot().micOn).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(engine.snapshot().micOn).toBe(false);
    expect(engine.snapshot().status).toBe(MIC_OFF_AFTER_SILENCE);
    expect(engine.snapshot().gpuHeld).toBe(false);
    expect(gpu.releaseCount).toBe(1);
    expect(engine.snapshot().autoSend).toBe(false);
  });
});
