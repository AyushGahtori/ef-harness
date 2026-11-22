import { describe, expect, it } from "vitest";
import { GpuWhisperPriorityArbiter } from "../../src/admission/gpu-whisper-priority-arbiter.js";
import { WHISPER_VRAM_MB } from "../../src/admission/thresholds.js";

describe("GPU whisper priority", () => {
  it("reserves Whisper ahead of a queued Ollama dispatch", () => {
    const arbiter = new GpuWhisperPriorityArbiter(12_000);
    const queued = arbiter.enqueueLocalModel({
      id: "bg-qwen",
      modelId: "qwen2.5-coder:14b",
      vramMb: 9_000,
      role: "background",
      start: "queued",
    });
    expect(queued.state).toBe("queued");
    expect(arbiter.runningIds()).toEqual([]);

    const grant = arbiter.activateDictation("base");
    expect(grant.priority).toBe("interactive");
    expect(grant.device).toBe("gpu");
    expect(grant.ready).toBe(true);
    expect(grant.reservedMb).toBe(WHISPER_VRAM_MB.base);
    expect(arbiter.headroomMb()).toBe(12_000 - WHISPER_VRAM_MB.base);
    expect(arbiter.pump()).toEqual([]);
    expect(queued.state).toBe("queued");
    expect(queued.reason).toContain("whisper");

    const started = arbiter.deactivateDictation();
    expect(arbiter.dictationActive).toBe(false);
    expect(started.map((ticket) => ticket.id)).toEqual(["bg-qwen"]);
    expect(queued.state).toBe("granted");
    expect(arbiter.runningIds()).toEqual(["bg-qwen"]);
  });

  it("defers a new local-model dispatch for the whole dictation, even when VRAM would fit", () => {
    const arbiter = new GpuWhisperPriorityArbiter(16_000);
    arbiter.activateDictation("small");
    const ticket = arbiter.enqueueLocalModel({
      id: "ollama",
      modelId: "qwen2.5-coder:14b",
      vramMb: 4_000,
      role: "background",
      start: "now",
    });
    expect(ticket.state).toBe("queued");
    expect(arbiter.headroomMb()).toBeGreaterThan(ticket.vramMb);
    expect(arbiter.runningIds()).toEqual([]);
    arbiter.deactivateDictation();
    expect(ticket.state).toBe("granted");
  });

  it("keeps dictation ready on CPU when Whisper does not fit in VRAM", () => {
    const arbiter = new GpuWhisperPriorityArbiter(256);
    const grant = arbiter.activateDictation("medium");
    expect(grant.device).toBe("cpu");
    expect(grant.reservedMb).toBe(0);
    expect(grant.ready).toBe(true);
    expect(grant.priority).toBe("interactive");
    const ticket = arbiter.enqueueLocalModel({
      id: "local",
      modelId: "qwen2.5-coder:14b",
      vramMb: 200,
      role: "background",
      start: "now",
    });
    expect(ticket.state).toBe("queued");
    arbiter.deactivateDictation();
    expect(ticket.state).toBe("granted");
  });
});
