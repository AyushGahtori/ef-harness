import { describe, expect, it } from "vitest";
import {
  DiagnosticsHealthView,
  type DiagnosticsHealthModel,
} from "../../src/diagnostics/index.js";
import { runAxe } from "./mini-dom.js";

const model: DiagnosticsHealthModel = {
  telemetryAvailable: true,
  unavailableMessage: null,
  databases: [
    { name: "state.db", bytes: 4096, walBytes: 128, schemaVersion: 7, quickCheck: "ok" },
    { name: "global.db", bytes: 2048, walBytes: 0, schemaVersion: 3, quickCheck: "ok" },
    { name: "telemetry.db", bytes: 1024, walBytes: 0, schemaVersion: 1, quickCheck: "ok" },
  ],
  writeLatency: {
    sampleCount: 5,
    p50Ms: 14,
    p95Ms: 18,
    p99Ms: 18,
    busyRetryCount: 3,
    sloMs: 50,
    withinSlo: true,
  },
  lastVerifiedBackupAt: 1_700_000_000_000,
  sparklines: [
    {
      id: "ram",
      label: "RAM used",
      unit: "bytes",
      points: [
        { at: 1, value: 4000 },
        { at: 2, value: 5000 },
      ],
      min: 4000,
      max: 5000,
      latest: 5000,
    },
    {
      id: "ui-latency",
      label: "UI input-to-paint p95",
      unit: "ms",
      points: [
        { at: 1, value: 12 },
        { at: 2, value: 16 },
      ],
      min: 12,
      max: 16,
      latest: 16,
    },
  ],
  pressureHistory: [{ at: 2, level: "Yellow", reason: "RAM low (20% free)" }],
  currentPressure: { at: 2, level: "Yellow", reason: "RAM low (20% free)" },
  pools: [
    { id: 1, name: "Thinking", used: 4, capacity: 12 },
    { id: 2, name: "Warm execution", used: 2, capacity: 4 },
    { id: 3, name: "Services", used: 1, capacity: 2 },
  ],
  footprints: [{ commandClass: "playwright", peakRamMbP90: 1900, wallClockMs: 12000 }],
  providers: [{ connectionId: "openai", latencyMs: 55, rateLimit429: 3, aimdConcurrency: 2 }],
  workers: { pass: 5, retry: 3, stuck: 1, loop: 1 },
  conformance: [{ adapterId: "codex", status: "pass", detail: "suite green" }],
  storage: { casBlobBytes: 4096, archivedZstdLogBytes: 2048, activeWorktreeCount: 3 },
  crashes: [],
  selfCheck: [
    {
      id: "mingit-version",
      name: "MinGit version",
      status: "red",
      detail: "MinGit is missing",
      fixSteps: ["Open Settings, Components, Repair MinGit, then re-run Self-Check."],
    },
  ],
  previewFiles: [
    { name: "daemon-logs-redacted.txt", byteLength: 42, text: "C:\\Users\\<USER>\\Desktop\\<REPO>\\api.ts safe\n" },
  ],
  includeSanitizedGraph: false,
  redactedSummary: "## EF Harness diagnostics (redacted)\n\n- OS: Windows 11\n- App Version: 0.0.0\n",
  cleanupMessage: null,
};

function view(): DiagnosticsHealthView {
  return new DiagnosticsHealthView(model, {
    runSelfCheck: () => Promise.resolve(model.selfCheck),
    exportBundle: () => Promise.resolve(model.previewFiles),
    saveZip: () => Promise.resolve(),
    runSafeCacheCleanup: () => Promise.resolve("reclaimed 10 bytes, pinned 2"),
    copySummary: () => undefined,
    rebuildTelemetry: () => Promise.resolve(),
    setIncludeSanitizedGraph: () => undefined,
  });
}

describe("diagnostics health view", () => {
  it("renders numeric sparklines, tables, and both themes", () => {
    const light = view().renderDocument("light");
    const dark = view().renderDocument("dark");
    for (const html of [light, dark]) {
      expect(html).toContain("font-variant-numeric:tabular-nums");
      expect(html).toContain("class=\"tabular-nums\"");
      expect(html).toContain("Minimum 4000 bytes");
      expect(html).toContain("latest 5000 bytes");
      expect(html).toContain("Run Self-Check");
      expect(html).toContain("Run safe cache cleanup");
      expect(html).toContain("Export Diagnostics Bundle");
      expect(html).toContain("Save .zip");
      expect(html).toContain("Copy Redacted Summary for GitHub Issue");
      expect(html).toContain("Rebuild Telemetry DB");
      expect(html).toContain("C:\\Users\\&lt;USER&gt;\\Desktop\\&lt;REPO&gt;\\api.ts safe");
      expect(html).toContain("Pool 1 Thinking");
      expect(html).not.toContain(" checked");
    }
    expect(light).toContain("background-color:#ffffff");
    expect(dark).toContain("background-color:#121418");
  });

  it("shows the telemetry rebuild message and keeps preview text exact", async () => {
    let copied = "";
    const unavailable = new DiagnosticsHealthView(
      {
        ...model,
        telemetryAvailable: false,
        unavailableMessage: "telemetry.db unavailable — click Rebuild Telemetry DB",
      },
      {
        runSelfCheck: () => Promise.resolve([]),
        exportBundle: () => Promise.resolve(model.previewFiles),
        saveZip: () => Promise.resolve(),
        runSafeCacheCleanup: () => Promise.resolve("pinned kept"),
        copySummary: (markdown) => {
          copied = markdown;
        },
        rebuildTelemetry: () => Promise.resolve(),
        setIncludeSanitizedGraph: () => undefined,
      },
    );
    const html = unavailable.renderDocument("light");
    expect(html).toContain("telemetry.db unavailable — click Rebuild Telemetry DB");
    await unavailable.copySummary();
    expect(copied).toBe(model.redactedSummary);
    expect(await unavailable.runSafeCacheCleanup()).toContain("pinned");
  });

  it("passes axe-core in light and dark themes", async () => {
    for (const theme of ["light", "dark"] as const) {
      const result = await runAxe(view().renderDocument(theme));
      const summary = result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n");
      expect(result.violations, summary).toEqual([]);
    }
  });
});
