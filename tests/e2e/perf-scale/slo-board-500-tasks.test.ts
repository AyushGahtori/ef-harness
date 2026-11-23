import { describe, expect, it } from "vitest";
import { certifyInjectedBoard, certifySlo2Board } from "./ports/db-board.ts";

describe("SLO 2 — 500 tasks / 5,000 requirements board", () => {
  it("slo-board-500-tasks.test.ts keeps median & p95 frame updates < 10 ms", () => {
    const result = certifySlo2Board();
    expect(result.tasks).toBe(500);
    expect(result.requirements).toBe(5000);
    expect(result.pass, result.detail.join("; ")).toBe(true);
    expect(result.medianMs).toBeLessThan(10);
    expect(result.p95).toBeLessThan(10);
  });

  it("fails closed on virtualization regression", () => {
    const bad = certifyInjectedBoard(8, 22);
    expect(bad.pass).toBe(false);
    expect(bad.detail.some((line) => line.includes("p95"))).toBe(true);
  });
});