import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { certifyInjectedDb, certifySlo1WorkersDb } from "./ports/db-board.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SLO 1 — 50 workers SQLite write", () => {
  it("slo-50-workers-db.test.ts certifies p99 < 50 ms with 0 busy errors", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-slo1-"));
    tempDirs.push(dir);
    const result = await certifySlo1WorkersDb(path.join(dir, "telemetry.db"));
    expect(result.busy, result.detail.join("; ")).toBe(0);
    expect(result.walStalls, result.detail.join("; ")).toBe(0);
    expect(result.pass, result.detail.join("; ")).toBe(true);
    expect(result.p99).toBeLessThan(50);
    expect(result.peakRssMb).toBeLessThan(250);
  });

  it("fails closed on injected p99 regression", () => {
    const bad = certifyInjectedDb(64, 0);
    expect(bad.pass).toBe(false);
    expect(bad.detail.some((line) => line.includes("p99"))).toBe(true);
  });
});