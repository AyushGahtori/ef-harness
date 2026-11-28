import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GlobalBrokerDb } from "@ef-harness/db";
import { LearnedFootprintStore } from "../../src/admission/learned-footprint-store.js";
import { openGlobalBrokerPort } from "../../src/admission/global-broker-port.js";
import type { JobObjectFootprintReading } from "../../src/admission/ports/hardware-snapshot.js";
import { GiB } from "../../src/admission/thresholds.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function reading(partial: Partial<JobObjectFootprintReading>): JobObjectFootprintReading {
  return {
    peakJobMemoryUsedBytes: 1.9 * GiB,
    currentWorkingSetBytes: 1.9 * GiB,
    totalUserTimeMs: 800,
    totalKernelTimeMs: 400,
    diskWriteBytes: 4_096,
    wallClockMs: 2_200,
    activeChildProcessCount: 1,
    ...partial,
  };
}

describe("learned footprints on GlobalBrokerDb", () => {
  it("round-trips the 14-field calibration row", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ef-footprints-"));
    roots.push(root);
    const db = GlobalBrokerDb.open({ root });
    try {
      const store = new LearnedFootprintStore(openGlobalBrokerPort(db));
      const saved = store.record({
        projectId: "next-app",
        commandClass: "playwright",
        observedAtMs: 50,
        reading: reading({}),
      });
      expect(saved.samples).toBe(1);
      expect(saved.wallClockMs).toBe(2_200);
      expect(saved.peakRamSamplesMb.length).toBe(1);
      const estimate = store.estimate("task-1", "next-app", "playwright");
      expect(estimate).toEqual({
        taskId: "task-1",
        predictedMb: saved.predictedMb,
        wallClockMs: 2_200,
      });
    } finally {
      db.close();
    }
    const again = GlobalBrokerDb.open({ root });
    try {
      const reloaded = new LearnedFootprintStore(openGlobalBrokerPort(again)).get("next-app", "playwright");
      expect(reloaded).toMatchObject({
        p50Mb: expect.any(Number),
        p90Mb: expect.any(Number),
        samples: 1,
        peakCpuTimeMs: 1_200,
        diskWriteBytes: 4_096,
        wallClockMs: 2_200,
      });
    } finally {
      again.close();
    }
  });
});
