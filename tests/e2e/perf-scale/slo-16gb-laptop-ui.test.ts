import { describe, expect, it } from "vitest";
import { certifySlo5Ui } from "./ports/ui-laptop.ts";

describe("SLO 5 — 16 GB laptop UI latency", () => {
  it("slo-16gb-laptop-ui.test.ts preserves UI, Office, and Inspector budgets", () => {
    const result = certifySlo5Ui();
    expect(result.pass, result.detail.join("; ")).toBe(true);
    expect(result.uiLatencyP95).toBeLessThan(50);
    expect(result.officeIdleCpuPct).toBeLessThan(5);
    expect(result.officeHiddenCpuPct).toBe(0);
    expect(result.officeTickMs).toBeLessThanOrEqual(8);
    expect(result.inspectorHeapDeltaMb).toBeLessThan(25);
  });
});