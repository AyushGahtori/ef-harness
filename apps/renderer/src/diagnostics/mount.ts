import type { ReactNode } from "react";
import type { CenterTabSlot } from "../shell/types.js";
import { h } from "../shell/dom.js";
import { DiagnosticsHealthView } from "./health-view.js";
import type { DiagnosticsHealthActions, DiagnosticsHealthModel } from "./model.js";

const emptyModel: DiagnosticsHealthModel = {
  telemetryAvailable: false,
  unavailableMessage: null,
  databases: [],
  writeLatency: {
    sampleCount: 0,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    busyRetryCount: 0,
    sloMs: 50,
    withinSlo: true,
  },
  lastVerifiedBackupAt: null,
  sparklines: [],
  pressureHistory: [],
  currentPressure: null,
  pools: [],
  footprints: [],
  providers: [],
  workers: { pass: 0, retry: 0, stuck: 0, loop: 0 },
  conformance: [],
  storage: { casBlobBytes: 0, archivedZstdLogBytes: 0, activeWorktreeCount: 0 },
  crashes: [],
  selfCheck: [],
  previewFiles: [],
  includeSanitizedGraph: false,
  redactedSummary: "",
  cleanupMessage: null,
};

const emptyActions: DiagnosticsHealthActions = {
  runSelfCheck: () => Promise.resolve([]),
  exportBundle: () => Promise.resolve([]),
  saveZip: () => Promise.resolve(),
  runSafeCacheCleanup: () => Promise.resolve(""),
  copySummary: () => undefined,
  rebuildTelemetry: () => Promise.resolve(),
  setIncludeSanitizedGraph: () => undefined,
};

export function diagnosticsHealthSlot(
  model: DiagnosticsHealthModel = emptyModel,
  actions: DiagnosticsHealthActions = emptyActions,
): CenterTabSlot {
  const view = new DiagnosticsHealthView(model, actions);
  return {
    ownerTask: "Task 133",
    render(): ReactNode {
      const document = view.renderDocument("light");
      return h(
        "section",
        {
          "data-diagnostics-health": "mounted",
          "data-owner-task": "Task 133",
          "data-document-bytes": String(document.length),
        },
        "Diagnostics & Health",
      );
    },
  };
}
