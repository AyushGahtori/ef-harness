import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_LOCAL_WHISPER,
  MIC_DISCONNECTED,
  OS_DICTATION_BADGE,
  buildWhisperCppArgs,
  selectWhisperModel,
} from "../../src/stt/index.js";
import { createSession, silencePcm, speechPcm, words } from "./support.js";

describe("retraction, OS fallback, audio retention, and devices", () => {
  it("strike-through previews the preceding clause and stays reversible", async () => {
    const { engine, decoder } = createSession();
    await engine.start();
    decoder.queue(words("Move the cutoff to 11:00 no wait make it 10:30 instead"));
    engine.pushPcm(speechPcm());
    const live = engine.snapshot();
    expect(live.fullText).toBe("Move the cutoff to 11:00 no wait make it 10:30 instead");
    expect(live.retractions).toHaveLength(1);
    expect(live.retractions[0]).toMatchObject({
      text: "Move the cutoff to 11:00",
      cue: "no wait",
      decoration: "strike-through",
      destructive: false,
      reversible: true,
      reconciler: { task: "Task-071", kind: "cross_chunk_retraction", applyOn: "after_send" },
    });
    expect(live.fullText.includes("10:30")).toBe(true);

    decoder.queue(words("Keep auth. Drop the cache actually, scratch that"));
    engine.pushPcm(speechPcm());
    const scratched = engine.snapshot();
    expect(scratched.retractions.some((span) => span.cue === "actually scratch that")).toBe(true);
    expect(scratched.retractions.some((span) => span.text === "Drop the cache")).toBe(true);
    expect(scratched.fullText.includes("actually, scratch that")).toBe(true);

    engine.setRetractionPreviewEnabled(false);
    expect(engine.snapshot().retractions).toEqual([]);
    engine.setRetractionPreviewEnabled(true);
    const restored = engine.snapshot().retractions;
    expect(restored.length).toBeGreaterThan(0);
    const target = restored[0];
    expect(target).toBeDefined();
    if (!target) return;
    engine.applyKeyboardEdit({ start: target.start, end: Math.min(target.end, target.start + 4), insert: "Shift" });
    expect(engine.snapshot().retractions.some((span) => span.id === target.id)).toBe(false);
    expect(engine.snapshot().fullText.includes("Shift")).toBe(true);
  });

  it("recognizes never mind that part without deleting the clause", async () => {
    const { engine, decoder } = createSession();
    await engine.start();
    decoder.queue(words("Use a local cache never mind that part"));
    engine.pushPcm(speechPcm());
    const snap = engine.snapshot();
    expect(snap.retractions.map((span) => span.cue)).toEqual(["never mind that part"]);
    expect(snap.retractions[0]?.text).toBe("Use a local cache");
    expect(snap.fullText).toBe("Use a local cache never mind that part");
  });

  it("falls back to Windows dictation when Whisper is missing, quarantined, or Red", async () => {
    const missing = createSession({ component: { available: false, reason: "not_downloaded" } });
    missing.speech.queue(words("hello from windows"));
    await missing.engine.start();
    missing.engine.pushPcm(speechPcm());
    const offline = missing.engine.snapshot();
    expect(offline.mode).toBe("os");
    expect(offline.micOn).toBe(true);
    expect(offline.badge).toBe(OS_DICTATION_BADGE);
    expect(offline.downloadOffer).toBe(DOWNLOAD_LOCAL_WHISPER);
    expect(offline.fallbackReason).toBe("not_downloaded");
    expect(offline.fullText).toBe("hello from windows");
    expect(offline.gpuHeld).toBe(false);
    expect(missing.gpu.acquireCount).toBe(0);
    expect(missing.jobs.jobs.size).toBe(0);
    expect(missing.decoder.calls).toBe(0);
    expect(offline.wavWrites).toBe(0);
    expect(offline.networkUploads).toBe(0);

    const quarantined = createSession({ component: { available: false, reason: "quarantined" } });
    await quarantined.engine.start();
    expect(quarantined.engine.snapshot().mode).toBe("os");
    expect(quarantined.engine.snapshot().badge).toBe(OS_DICTATION_BADGE);
    expect(quarantined.engine.snapshot().fallbackReason).toBe("quarantined");

    const mismatch = createSession({ component: { available: false, reason: "hash_mismatch" } });
    await mismatch.engine.start();
    expect(mismatch.engine.snapshot().fallbackReason).toBe("hash_mismatch");
    expect(mismatch.engine.snapshot().micOn).toBe(true);

    const red = createSession({
      calibration: { totalRamMb: 32_768, gpuVramMb: 8_192, pressure: "RED" },
    });
    await red.engine.start();
    expect(red.engine.snapshot().mode).toBe("os");
    expect(red.engine.snapshot().fallbackReason).toBe("red_pressure");
    expect(red.gpu.acquireCount).toBe(0);
    expect(red.engine.snapshot().badge).toBe(OS_DICTATION_BADGE);
  });

  it("releases a running whisper.cpp child when pressure turns Red and keeps the draft", async () => {
    const { engine, decoder, calibration, gpu, jobs } = createSession();
    decoder.queue(words("orders don't allow edits"));
    decoder.queue(words("orders don't allow edits"));
    await engine.start();
    engine.pushPcm(speechPcm());
    engine.pushPcm(speechPcm());
    expect(engine.snapshot().confirmed).toBe("orders don't allow edits");
    expect(engine.snapshot().mode).toBe("whisper");

    calibration.current = { totalRamMb: 32_768, gpuVramMb: 8_192, pressure: "RED" };
    await engine.reconcilePressure();
    const parked = engine.snapshot();
    expect(parked.mode).toBe("os");
    expect(parked.confirmed).toBe("orders don't allow edits");
    expect(parked.micOn).toBe(true);
    expect(parked.gpuHeld).toBe(false);
    expect(parked.jobOpen).toBe(false);
    expect(parked.pcmBytes).toBe(0);
    expect(gpu.releaseCount).toBe(1);
    expect(jobs.diskWrites).toEqual([]);
    expect(parked.badge).toBe(OS_DICTATION_BADGE);
  });

  it("keeps confirmed words when the microphone drops and never writes wav audio", async () => {
    const { engine, decoder, capture, jobs, gpu } = createSession();
    engine.setCarryInitialPrompt("PostgreSQL Stripe");
    decoder.queue(words("keep this sentence"));
    decoder.queue(words("keep this sentence"));
    await engine.start();
    engine.pushPcm(speechPcm());
    engine.pushPcm(speechPcm());
    const args = engine.snapshot().whisperArgs ?? [];
    expect(args).toContain("-f");
    expect(args).toContain("-");
    expect(args).toContain("--carry-initial-prompt");
    expect(args).toContain("PostgreSQL Stripe");
    expect(args.some((arg) => /\.wav$/i.test(arg) || /^https?:\/\//i.test(arg))).toBe(false);
    expect(engine.snapshot().modelId).toBe("medium");
    expect(engine.snapshot().pcmBytes).toBeGreaterThan(0);
    expect(engine.snapshot().audioLevel).toBeGreaterThan(0);

    engine.pushPcm(silencePcm());
    expect(engine.snapshot().audioLevel).toBe(0);

    capture.disconnect();
    const dropped = engine.snapshot();
    expect(dropped.micOn).toBe(false);
    expect(dropped.status).toBe(MIC_DISCONNECTED);
    expect(dropped.confirmed).toBe("keep this sentence");
    expect(dropped.gpuHeld).toBe(false);
    expect(dropped.pcmBytes).toBe(0);
    expect(dropped.wavWrites).toBe(0);
    expect(dropped.networkUploads).toBe(0);
    expect(gpu.releaseCount).toBe(1);
    expect(jobs.diskWrites).toEqual([]);
    for (const child of jobs.jobs.values()) {
      expect(child.stdinBytes).toBe(0);
    }
  });

  it("reports a denied microphone without taking the GPU", async () => {
    const { engine, capture, gpu } = createSession();
    capture.failNext = "permission_denied";
    await engine.start();
    expect(engine.snapshot().micOn).toBe(false);
    expect(engine.snapshot().status).toBe(MIC_DISCONNECTED);
    expect(gpu.acquireCount).toBe(0);
    expect(engine.snapshot().mode).toBe("idle");
  });

  it("supports click-to-toggle and a configurable push-to-talk hotkey", async () => {
    const { engine } = createSession();
    expect(engine.snapshot().hotkey).toBe("Ctrl+Space");
    expect(engine.listInputDevices().map((device) => device.id)).toEqual(["default"]);

    await engine.handleKey({ type: "keydown", key: " ", ctrlKey: true });
    expect(engine.snapshot().micOn).toBe(true);
    await engine.handleKey({ type: "keyup", key: "Space", ctrlKey: true });
    expect(engine.snapshot().micOn).toBe(false);

    await engine.toggle();
    expect(engine.snapshot().micOn).toBe(true);
    await engine.handleKey({ type: "keyup", key: " ", ctrlKey: true });
    expect(engine.snapshot().micOn).toBe(true);
    await engine.toggle();
    expect(engine.snapshot().micOn).toBe(false);

    engine.setHotkey({ ctrl: true, alt: false, shift: true, meta: false, key: "d" }, "toggle");
    expect(engine.snapshot().hotkey).toBe("Ctrl+Shift+d");
    await engine.handleKey({ type: "keydown", key: "d", ctrlKey: true, shiftKey: true });
    expect(engine.snapshot().micOn).toBe(true);
    await engine.handleKey({ type: "keydown", key: "D", ctrlKey: true, shiftKey: true });
    expect(engine.snapshot().micOn).toBe(false);

    engine.selectInputDevice("missing");
    await engine.toggle();
    expect(engine.snapshot().status).toBe(MIC_DISCONNECTED);
    expect(engine.snapshot().micOn).toBe(false);
  });

  it("selects the quantized model from RAM and VRAM", async () => {
    expect(selectWhisperModel({ totalRamMb: 32_768, gpuVramMb: 8_192, pressure: "GREEN" })).toBe("medium");
    expect(selectWhisperModel({ totalRamMb: 16_384, gpuVramMb: 0, pressure: "GREEN" })).toBe("small.en");
    expect(selectWhisperModel({ totalRamMb: 8_192, gpuVramMb: 0, pressure: "YELLOW" })).toBe("base.en");
    expect(selectWhisperModel({ totalRamMb: 12_288, gpuVramMb: 4_096, pressure: "ORANGE" })).toBe("medium");
    expect(selectWhisperModel({ totalRamMb: 8_192, gpuVramMb: 2_048, pressure: "GREEN" })).toBe("small.en");

    const args = buildWhisperCppArgs({
      modelPath: "components/whisper/ggml-small.en.bin",
      carryInitialPrompt: "PostgreSQL",
    });
    expect(args).toEqual([
      "-m",
      "components/whisper/ggml-small.en.bin",
      "-l",
      "en",
      "-f",
      "-",
      "--no-prints",
      "--carry-initial-prompt",
      "PostgreSQL",
    ]);
  });
});
