import { describe, expect, it } from "vitest";
import { ResidentLedger, collectText, findByName } from "../../src/cockpit/inspector/index.js";
import { WorkerInspectorPanel } from "../../src/cockpit/inspector/index.js";
import { MAX_RENDERER_HEAP_BYTES } from "../../src/cockpit/inspector/constants.js";
import { InspectorMemoryCeilingError } from "../../src/cockpit/inspector/errors.js";
import {
  DIFF_CHUNK,
  HEAP_LIMIT,
  LOG_BYTES,
  attempt,
  brief,
  FakePorts,
  file,
  identity,
  milestone,
  rawCredential,
} from "./support.js";

const LARGE_3_MB = 3_250_586;

function streamPorts(): { ports: FakePorts; panel: WorkerInspectorPanel } {
  const ports = new FakePorts();
  ports.totalLines = 20_000;
  ports.totalBytes = LOG_BYTES;
  ports.archived = true;
  ports.snapshots.set("T-7", {
    identity: identity(),
    attempts: [
      attempt({
        attemptId: "att-1",
        number: 1,
        outcome: "running",
        sliceSha256: "sha-historical",
        logArtifactId: "log-live",
        files: [
          file("src/kitchen/print.tsx", 2400, 42, 3),
          file("generated/fixture.json", LARGE_3_MB, 10_000, 0),
          file("src/kitchen/exact-100kb.ts", 100 * 1024, 10, 0),
        ],
        milestones: [milestone("m", "Claimed")],
      }),
    ],
  });
  ports.briefs.set("sha-historical", brief());
  ports.diffs.set("att-1:src/kitchen/print.tsx", {
    line: 8,
    lines: ["+const ready = 1"],
  });
  const panel = new WorkerInspectorPanel(ports.deps());
  return { ports, panel };
}

describe("lazy diff and raw stream", () => {
  it("collapses files over 100 KB and fetches a single 64 KB chunk on demand", async () => {
    const { ports, panel } = streamPorts();
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("diff");
    expect(ports.diffCalls).toHaveLength(0);
    const collapsed = collectText(panel.view());
    expect(collapsed).toContain("Large file (3.1 MB) — Load preview chunk (64 KB)");
    expect(collapsed).toContain("+10000 / -0");
    expect(collapsed).not.toContain("Large file (100 KB)");
    await panel.loadDiff("generated/fixture.json");
    expect(ports.diffCalls).toEqual([
      { attemptId: "att-1", filePath: "generated/fixture.json", hunkOffset: 0, limit: DIFF_CHUNK },
    ]);
    expect(panel.residentBytes()).toBeLessThan(HEAP_LIMIT);
    expect(collectText(panel.view())).toContain("const");
    panel.setDiffLayout("split");
    const line = findByName(panel.view(), "add");
    expect(line?.props.column).toBe("split");
  });

  it("keeps a 50 MB archived log and a 1,000 line burst inside the heap cap", async () => {
    const { ports, panel } = streamPorts();
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("raw");
    expect(collectText(panel.view())).toContain("Raw stream is opt-in");
    expect(findByName(panel.view(), "Raw log")).toBeUndefined();
    expect(ports.logCalls).toHaveLength(0);
    await panel.toggleRawStream(true);
    expect(panel.rawOptedIn()).toBe(true);
    expect(panel.visibleLogLines()).toBeLessThanOrEqual(500);
    expect(panel.visibleLogLines()).toBeGreaterThan(0);
    expect(panel.residentBytes()).toBeLessThan(HEAP_LIMIT);
    expect(ports.logCalls.every((call) => call.limit <= DIFF_CHUNK)).toBe(true);
    expect(collectText(panel.view())).toContain("Archived seekable turn log");
    const afterOpen = ports.logCalls.length;
    ports.totalLines += 1000;
    await Promise.all(Array.from({ length: 1000 }, () => panel.noteLiveGrowth()));
    expect(ports.logCalls.length - afterOpen).toBeLessThanOrEqual(2);
    expect(panel.visibleLogLines()).toBeLessThanOrEqual(500);
    expect(panel.residentBytes()).toBeLessThan(HEAP_LIMIT);
    await panel.scrollRawStream(1);
    expect(panel.rawPinned()).toBe(false);
    expect(findByName(panel.view(), "Jump to live")).toBeDefined();
    const parked = ports.logCalls.length;
    ports.totalLines += 1000;
    await Promise.all(Array.from({ length: 50 }, () => panel.noteLiveGrowth()));
    expect(ports.logCalls.length).toBe(parked);
    await panel.jumpToLive();
    expect(panel.rawPinned()).toBe(true);
    expect(findByName(panel.view(), "Jump to live")).toBeUndefined();
    expect(ports.logCalls.length).toBeGreaterThan(parked);
    panel.copyVisibleLog();
    expect(ports.shell.copies[0]?.startsWith("L")).toBe(true);
  });

  it("discards a stale diff when the operator switches workers", async () => {
    const ports = new FakePorts();
    ports.honorAbort = false;
    const marker = "ALPHA_DIFF_MARKER";
    for (const taskId of ["A", "B"]) {
      ports.snapshots.set(taskId, {
        identity: identity({ title: taskId === "A" ? "alpha page" : "beta page", agentId: taskId }),
        attempts: [
          attempt({
            attemptId: `${taskId}-1`,
            number: 1,
            outcome: "running",
            sliceSha256: `sha-${taskId}`,
            files: [file("src/app.ts", 100, 1, 0)],
            milestones: [milestone("m", `milestone ${taskId}`)],
          }),
        ],
      });
      ports.briefs.set(`sha-${taskId}`, brief({ sliceSha256: `sha-${taskId}`, taskId }));
    }
    let resolveDiff: (chunk: {
      attemptId: string;
      filePath: string;
      hunkOffset: number;
      limit: number;
      bytesRead: number;
      hunks: { index: number; header: string; oldStart: number; newStart: number; lines: readonly string[] }[];
    }) => void = () => undefined;
    ports.heldDiff = new Promise((resolve) => {
      resolveDiff = resolve;
    });
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "A", host: "collapsible-shell" });
    const pending = panel.loadDiff("src/app.ts");
    await panel.show({ taskId: "B", host: "collapsible-shell" });
    resolveDiff({
      attemptId: "A-1",
      filePath: "src/app.ts",
      hunkOffset: 0,
      limit: DIFF_CHUNK,
      bytesRead: marker.length,
      hunks: [
        { index: 0, header: "@@", oldStart: 1, newStart: 1, lines: [`+${marker}`] },
      ],
    });
    const result = await pending;
    expect(result.applied).toBe(false);
    const text = collectText(panel.view());
    expect(text).toContain("beta page");
    expect(text).not.toContain(marker);
    expect(text).not.toContain("alpha page");
  });

  it("aborts nine of ten rapid card switches and keeps only the last worker", async () => {
    const ports = new FakePorts();
    const ids = Array.from({ length: 10 }, (_, index) => `W${index}`);
    for (const taskId of ids) {
      ports.snapshots.set(taskId, {
        identity: identity({ agentId: taskId, title: `worker ${taskId}` }),
        attempts: [
          attempt({
            attemptId: `${taskId}-att`,
            number: 1,
            outcome: "running",
            sliceSha256: `sha-${taskId}`,
            milestones: [milestone("m", `only ${taskId}`)],
          }),
        ],
      });
      ports.briefs.set(`sha-${taskId}`, brief({ sliceSha256: `sha-${taskId}`, taskId }));
    }
    const panel = new WorkerInspectorPanel(ports.deps());
    const results = await Promise.all(
      ids.map((taskId) => panel.show({ taskId, host: "collapsible-shell" })),
    );
    expect(results.filter((result) => result.applied).map(() => true)).toEqual([true]);
    expect(ports.signals.filter((signal) => signal.aborted)).toHaveLength(9);
    const text = collectText(panel.view());
    expect(text).toContain("worker W9");
    expect(text).toContain("only W9");
    for (const taskId of ids.slice(0, 9)) {
      expect(text).not.toContain(`only ${taskId}`);
    }
  });

  it("blocks a raw chunk that still contains a credential", async () => {
    const { ports, panel } = streamPorts();
    const secret = rawCredential();
    ports.forcedLogText = secret;
    ports.totalLines = 1;
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("raw");
    const result = await panel.toggleRawStream(true);
    expect(result.applied).toBe(true);
    const text = collectText(panel.view());
    expect(text).toContain("Blocked: raw stream chunk was not pre-redacted");
    expect(text).not.toContain(secret);
  });

  it("refuses to retain more than 25 MB", () => {
    const ledger = new ResidentLedger();
    expect(() => ledger.retain("too-big", MAX_RENDERER_HEAP_BYTES + 1)).toThrow(InspectorMemoryCeilingError);
    ledger.retain("chunk", DIFF_CHUNK);
    expect(ledger.total()).toBe(DIFF_CHUNK);
  });
});
