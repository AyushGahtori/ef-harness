import { describe, expect, it } from "vitest";
import { LearnedFootprintStore } from "../../src/admission/learned-footprint-store.js";
import { MemoryFootprintAdmission } from "../../src/admission/memory-footprint-admission.js";
import { InMemoryGlobalDb } from "../../src/admission/ports/in-memory-global-db.js";
import type { JobObjectFootprintReading } from "../../src/admission/ports/hardware-snapshot.js";
import {
  COMMAND_CLASS_DEFAULT_MB,
  GiB,
  MiB,
  defaultFootprintMb,
  safetyReserveMb,
} from "../../src/admission/thresholds.js";
import type { AdmissionResources } from "../../src/admission/memory-footprint-admission.js";

function reading(partial: Partial<JobObjectFootprintReading> & Pick<JobObjectFootprintReading, "peakJobMemoryUsedBytes">): JobObjectFootprintReading {
  return {
    currentWorkingSetBytes: partial.peakJobMemoryUsedBytes,
    totalUserTimeMs: 0,
    totalKernelTimeMs: 0,
    diskWriteBytes: 0,
    wallClockMs: 0,
    activeChildProcessCount: 1,
    ...partial,
  };
}

const healthyDisk = {
  projectDiskFreeBytes: 40 * GiB,
  appDataDiskFreeBytes: 40 * GiB,
  lowMemoryNotification: false,
  pressure: "GREEN" as const,
  totalRamMb: 16 * 1024,
  availCommitMb: 20 * 1024,
};

describe("learned footprints and admission", () => {
  it("uses conservative defaults until the first Job Object reading", () => {
    const store = new LearnedFootprintStore(new InMemoryGlobalDb());
    expect(defaultFootprintMb("unit_test")).toBe(400);
    expect(defaultFootprintMb("typecheck")).toBe(900);
    expect(COMMAND_CLASS_DEFAULT_MB.typecheck).toBe(900);
    expect(defaultFootprintMb("playwright")).toBe(1_500);
    expect(defaultFootprintMb("pnpm_install")).toBe(1_000);
    expect(store.predictionMb("next-app", "unit_test")).toBe(400);
    expect(store.predictionMb("next-app", "typecheck")).toBe(900);
    expect(store.predictionMb("next-app", "playwright")).toBe(1_500);
    expect(store.predictionMb("next-app", "pnpm_install")).toBe(1_000);
    expect(store.schemaRow("next-app", "playwright")).toBeNull();
    expect(store.predictionMb("next-app", "build")).toBe(COMMAND_CLASS_DEFAULT_MB.build);
    expect(store.predictionMb("next-app", "db_migrate")).toBe(COMMAND_CLASS_DEFAULT_MB.db_migrate);
  });

  it("writes global.db footprints from Job Object peak RAM, CPU, disk, and duration", () => {
    const db = new InMemoryGlobalDb();
    const store = new LearnedFootprintStore(db);
    const peakBytes = 1.9 * GiB;
    const first = store.record({
      projectId: "next-app",
      commandClass: "playwright",
      observedAtMs: 50,
      reading: reading({
        peakJobMemoryUsedBytes: peakBytes,
        totalUserTimeMs: 800,
        totalKernelTimeMs: 400,
        diskWriteBytes: 4_096,
        wallClockMs: 2_200,
      }),
    });
    const expectedMb = Math.ceil(peakBytes / MiB);
    expect(first.predictedMb).toBe(expectedMb);
    expect(first.p90Mb).toBe(expectedMb);
    expect(first.peakRamMb).toBe(expectedMb);
    expect(first.peakCpuTimeMs).toBe(1_200);
    expect(first.diskWriteBytes).toBe(4_096);
    expect(first.wallClockMs).toBe(2_200);
    expect(first.samples).toBe(1);
    const schema = store.schemaRow("next-app", "playwright");
    expect(schema).toEqual({
      consumer: "playwright",
      project: "next-app",
      p50_mb: expectedMb,
      p95_mb: expectedMb,
      samples: 1,
      updated_at: 50,
    });
    expect(db.footprints.list()).toHaveLength(1);

    store.record({
      projectId: "next-app",
      commandClass: "playwright",
      observedAtMs: 80,
      reading: reading({
        peakJobMemoryUsedBytes: 500 * MiB,
        totalUserTimeMs: 10,
        totalKernelTimeMs: 10,
        diskWriteBytes: 100,
        wallClockMs: 100,
      }),
    });
    const learned = store.get("next-app", "playwright");
    expect(learned?.peakCpuTimeMs).toBe(1_200);
    expect(learned?.diskWriteBytes).toBe(4_096);
    expect(learned?.wallClockMs).toBe(2_200);
    expect(learned?.peakRamMb).toBe(expectedMb);
    expect(learned?.predictedMb).toBe(expectedMb);
    expect(learned?.samples).toBe(2);
  });

  it("queues a second heavy command that would not fit, and admits one idle command on the floor", () => {
    const db = new InMemoryGlobalDb();
    const store = new LearnedFootprintStore(db);
    const gate = new MemoryFootprintAdmission(store);
    const reserve = safetyReserveMb(16 * 1024);
    const availRamMb = 3_800;
    expect(availRamMb - reserve).toBeLessThan(1_500);
    const tight: AdmissionResources = { ...healthyDisk, availRamMb };

    const first = gate.request({
      ...tight,
      id: "playwright-1",
      projectId: "next-app",
      commandClass: "playwright",
      role: "verifier",
    });
    expect(first.kind).toBe("admit");
    if (first.kind === "admit") expect(first.floor).toBe(true);

    const second = gate.request({
      ...tight,
      id: "playwright-2",
      projectId: "next-app",
      commandClass: "playwright",
      role: "worker",
    });
    expect(second).toMatchObject({
      kind: "queue",
      reason: "queued: predicted footprint does not fit while another job is running",
    });
    expect(gate.runningCount).toBe(1);

    const roomy = gate.complete("playwright-1", { ...healthyDisk, availRamMb: 8_000 });
    expect(roomy.map((decision) => decision.id)).toEqual(["playwright-2"]);
    expect(roomy[0]?.kind).toBe("admit");
  });

  it("refuses a learned footprint that no longer fits beside a running job", () => {
    const store = new LearnedFootprintStore(new InMemoryGlobalDb());
    store.record({
      projectId: "next-app",
      commandClass: "playwright",
      observedAtMs: 1,
      reading: reading({ peakJobMemoryUsedBytes: 6 * GiB }),
    });
    const predicted = store.predictionMb("next-app", "playwright");
    expect(predicted).toBe(Math.ceil((6 * GiB) / MiB));
    const availRamMb = 5_000;
    const slack = availRamMb - safetyReserveMb(16 * 1024);
    expect(slack).toBeGreaterThanOrEqual(1_500);
    expect(slack).toBeLessThan(predicted);

    const learned = new MemoryFootprintAdmission(store);
    const resources: AdmissionResources = { ...healthyDisk, availRamMb };
    expect(
      learned.request({
        ...resources,
        id: "unit",
        projectId: "next-app",
        commandClass: "unit_test",
        role: "worker",
      }).kind,
    ).toBe("admit");
    expect(
      learned.request({
        ...resources,
        id: "browser",
        projectId: "next-app",
        commandClass: "playwright",
        role: "worker",
      }),
    ).toMatchObject({ kind: "queue" });

    const defaults = new MemoryFootprintAdmission(new LearnedFootprintStore(new InMemoryGlobalDb()));
    expect(
      defaults.request({
        ...resources,
        id: "browser-default",
        projectId: "next-app",
        commandClass: "playwright",
        role: "worker",
      }).kind,
    ).toBe("admit");
  });

  it("halts on RED, low memory, and under 2 GB, and pauses new work under 5 GB", () => {
    const gate = new MemoryFootprintAdmission(new LearnedFootprintStore(new InMemoryGlobalDb()));
    const base = {
      id: "build-1",
      projectId: "next-app",
      commandClass: "build" as const,
      role: "worker" as const,
      ...healthyDisk,
      availRamMb: 12 * 1024,
    };
    expect(gate.request({ ...base, pressure: "RED" })).toMatchObject({ kind: "halt" });
    expect(
      gate.request({ ...base, id: "build-2", lowMemoryNotification: true }),
    ).toMatchObject({ kind: "halt" });
    expect(
      gate.request({ ...base, id: "build-3", appDataDiskFreeBytes: 1.8 * GiB }),
    ).toMatchObject({ kind: "halt" });
    expect(gate.runningCount).toBe(0);
    expect(
      gate.request({ ...base, id: "build-4", appDataDiskFreeBytes: 4 * GiB }),
    ).toMatchObject({
      kind: "queue",
      reason: "queued: disk headroom is below 5 GB",
    });
  });

  it("waits to spawn a second heavy job while ORANGE, and queues when commit is short", () => {
    const gate = new MemoryFootprintAdmission(new LearnedFootprintStore(new InMemoryGlobalDb()));
    const resources: AdmissionResources = {
      ...healthyDisk,
      availRamMb: 12 * 1024,
      pressure: "ORANGE",
    };
    expect(
      gate.request({
        ...resources,
        id: "heavy-1",
        projectId: "next-app",
        commandClass: "playwright",
        role: "verifier",
      }).kind,
    ).toBe("admit");
    expect(
      gate.request({
        ...resources,
        id: "heavy-2",
        projectId: "next-app",
        commandClass: "build",
        role: "worker",
      }),
    ).toMatchObject({
      kind: "queue",
      reason: "queued: waiting before spawning a heavy job under orange pressure",
    });

    const commitGate = new MemoryFootprintAdmission(new LearnedFootprintStore(new InMemoryGlobalDb()));
    const roomy: AdmissionResources = { ...healthyDisk, availRamMb: 12 * 1024, availCommitMb: 100 };
    commitGate.request({
      ...roomy,
      availCommitMb: 8_000,
      id: "resident",
      projectId: "next-app",
      commandClass: "unit_test",
      role: "worker",
    });
    expect(
      commitGate.request({
        ...roomy,
        id: "needs-commit",
        projectId: "next-app",
        commandClass: "unit_test",
        role: "worker",
      }),
    ).toMatchObject({
      kind: "queue",
      reason: "queued: commit headroom is insufficient while another job is running",
    });
  });
});
