import { describe, expect, it } from "vitest";
import { certifySlo6StartupIpc } from "./ports/startup-ipc.ts";

describe("SLO 6 — cold start & IPC throughput", () => {
  it("slo-startup-ipc.test.ts meets boot, pipe, and stream SLOs", async () => {
    const result = await certifySlo6StartupIpc();
    expect(result.pass, result.detail.join("; ")).toBe(true);
    expect(result.coldBootMs).toBeLessThan(800);
    expect(result.pipeP99Ms).toBeLessThan(5);
    expect(result.streamThroughputMbps).toBeGreaterThanOrEqual(50);
  }, 60_000);
});