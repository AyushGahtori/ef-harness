import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { certifySlo3Export } from "./ports/export-graph.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("SLO 3 — 300-entity export", () => {
  it("slo-300-entity-export.test.ts meets export & graph compile budgets", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ef-slo3-"));
    tempDirs.push(dir);
    const dbPath = path.join(dir, "state.db");
    const result = certifySlo3Export(dbPath, dir);
    expect(result.pass, result.detail.join("; ")).toBe(true);
    expect(result.fullViewsExportMs).toBeLessThan(500);
    expect(result.incrementalViewsExportMs).toBeLessThan(150);
    expect(result.harnessStateIncrementalMs).toBeLessThan(150);
    expect(result.harnessStateRehydrateMs).toBeLessThan(2000);
    expect(result.impactWalkMs).toBeLessThan(15);
    expect(result.graphCompileMs).toBeLessThan(100);
  });
});