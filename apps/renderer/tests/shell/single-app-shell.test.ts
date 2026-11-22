import { describe, expect, it } from "vitest";
import { auditShellHtml, seriousOrCritical } from "../../src/shell/audit.js";
import { createDaemonSnapshot } from "../../src/shell/daemon-store.js";
import { UiLatencyHeartbeatMonitor } from "../../src/shell/heartbeat.js";
import { layoutHoldsCenter, resolveLayout } from "../../src/shell/layout.js";
import { MemoryLatencySink } from "../../src/shell/ports.js";
import { createConnectedShell } from "../../src/shell/shell.js";
import type { CenterTabId, DaemonEvent, PhaseId } from "../../src/shell/types.js";
import { CENTER_TABS, PHASES } from "../../src/shell/types.js";

const phases: PhaseId[] = ["discover", "plan", "build", "ship"];
const tabs: CenterTabId[] = CENTER_TABS.map((tab) => tab.id);

function runningShell() {
  return createConnectedShell({
    snapshot: createDaemonSnapshot({
      run: "running",
      inbox: [
        { id: "q1", bucket: "needs-you", title: "Pick a database", unread: true },
        { id: "c1", bucket: "chat", title: "Earlier note", unread: true },
        { id: "f1", bucket: "fyi", title: "Cache cleaned", unread: true },
      ],
      spend: {
        active: { kind: "api", connectionLabel: "API", spentUsd: 1.42, capUsd: 10 },
        breakdown: [
          { kind: "api", connectionLabel: "API", spentUsd: 1.42, capUsd: 10 },
          {
            kind: "subscription",
            connectionLabel: "ChatGPT",
            percentOfWindow: 14,
            windowLabel: "5h",
          },
        ],
      },
    }),
  });
}

function buttonTag(html: string, label: string): string {
  const tags = html.match(/<button\b[^>]*>/g) ?? [];
  return tags.find((tag) => tag.includes(`aria-label="${label}"`)) ?? "";
}

describe("single app shell layout", () => {
  it("keeps the four zones, stop, governor, and spend meter stable", () => {
    const { shell } = runningShell();
    const html = shell.renderHtml();
    const model = shell.viewModel();
    expect(html).toContain("<header");
    expect(html).toContain('aria-label="Chat and inbox"');
    expect(html).toContain("<main");
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain('aria-label="Composer"');
    expect(html).toContain('data-height="48"');
    expect(html).toContain('data-fixed="true"');
    expect(buttonTag(html, "Stop")).not.toContain("disabled");
    expect(html).toContain("Green");
    expect(html).toContain("$1.42 / $10");
    expect(model.layout.centerWidthPx).toBeGreaterThanOrEqual(420);
    expect(model.layout.topBarHeightPx).toBe(48);
    expect(html.match(/data-mounted="true"/g)?.length).toBe(tabs.length);
    shell.dispose();
  });

  it("toggles light, dark, and system themes", () => {
    const { shell } = runningShell();
    shell.activate("theme:dark");
    expect(shell.renderHtml()).toContain('data-theme="dark"');
    shell.activate("theme:light");
    expect(shell.renderHtml()).toContain('data-theme="light"');
    shell.activate("theme:system");
    shell.setSystemTheme("dark");
    expect(shell.viewModel().tokens.name).toBe("dark");
    expect(shell.renderHtml()).toContain('data-theme="dark"');
    shell.dispose();
  });

  it("opens a mixed spend breakdown without changing the active currency", () => {
    const { shell } = runningShell();
    expect(shell.viewModel().spendPrimary).toBe("$1.42 / $10");
    shell.activate("toggle-spend");
    const html = shell.renderHtml();
    expect(html).toContain("API: $1.42 / $10");
    expect(html).toContain("ChatGPT: 14% of 5h window");
    shell.dispose();
  });

  it("shows the governor level and its driver", () => {
    const { shell, pressure } = runningShell();
    pressure.set("orange", "RAM low (1.8 GB free)");
    const html = shell.renderHtml();
    expect(html).toContain("Orange");
    expect(html).toContain("RAM low (1.8 GB free)");
    expect(html).toContain('data-level="orange"');
    shell.dispose();
  });

  it("clamps a 1024x768 window by collapsing the older pane", () => {
    const layout = resolveLayout({
      viewportWidth: 1024,
      viewportHeight: 768,
      leftWidthPx: 400,
      leftCollapsed: false,
      leftOpenedAt: 1,
      inspectorWidthPx: 450,
      inspectorCollapsed: false,
      inspectorOpenedAt: 2,
    });
    expect(layout.leftForceCollapsed).toBe(true);
    expect(layout.inspectorOverlay).toBe(false);
    expect(layout.centerWidthPx).toBeGreaterThanOrEqual(420);
    expect(layoutHoldsCenter(layout, 1024)).toBe(true);
  });

  it("uses an inspector overlay when collapsing one pane is not enough", () => {
    const layout = resolveLayout({
      viewportWidth: 700,
      viewportHeight: 768,
      leftWidthPx: 400,
      leftCollapsed: false,
      leftOpenedAt: 1,
      inspectorWidthPx: 450,
      inspectorCollapsed: false,
      inspectorOpenedAt: 2,
    });
    expect(layout.inspectorOverlay).toBe(true);
    expect(layout.centerWidthPx).toBeGreaterThanOrEqual(420);
  });

  it("restores requested pane widths when the window grows again", () => {
    const { shell } = createConnectedShell({ viewport: { width: 1600, height: 900 } });
    shell.dragLeftRail(400);
    shell.dragInspector(450);
    shell.setViewport(1024, 768);
    const narrow = shell.viewModel();
    expect(narrow.layout.centerWidthPx).toBeGreaterThanOrEqual(420);
    expect(narrow.leftRequestedWidthPx).toBe(400);
    expect(narrow.inspectorRequestedWidthPx).toBe(450);
    shell.setViewport(1600, 900);
    const wide = shell.viewModel();
    expect(wide.layout.leftCollapsed).toBe(false);
    expect(wide.layout.inspectorCollapsed).toBe(false);
    expect(wide.layout.centerWidthPx).toBe(1600 - 400 - 450);
    shell.dispose();
  });

  it("clamps dragged widths and persists them per window", () => {
    const { shell, preferences } = createConnectedShell({
      viewport: { width: 1800, height: 1000 },
      windowId: "win-a",
    });
    shell.dragLeftRail(100);
    shell.dragLeftRail(900);
    shell.dragInspector(10);
    shell.dragInspector(2000);
    shell.activate("toggle-inspector");
    expect(shell.viewModel().leftRequestedWidthPx).toBe(420);
    expect(shell.viewModel().inspectorRequestedWidthPx).toBe(480);
    shell.dispose();
    const restored = createConnectedShell({
      preferences,
      windowId: "win-a",
      viewport: { width: 1800, height: 1000 },
    });
    expect(restored.shell.viewModel().leftRequestedWidthPx).toBe(420);
    expect(restored.shell.viewModel().layout.inspectorCollapsed).toBe(true);
    restored.shell.dispose();
  });
});

describe("shell state retention", () => {
  it("keeps composer draft, tab scratch, filter, and scroll across tabs and collapse", () => {
    const { shell } = runningShell();
    shell.setComposerDraft("keep this draft");
    shell.setTabScratch("office", "office-note");
    shell.setRailScroll(120);
    shell.activate("filter:needs-you");
    shell.activate("tab:preview");
    shell.activate("toggle-left");
    shell.activate("toggle-left");
    const model = shell.viewModel();
    expect(model.composerDraft).toBe("keep this draft");
    expect(model.tabScratch.office).toBe("office-note");
    expect(model.leftScrollTop).toBe(120);
    expect(model.railFilter).toBe("needs-you");
    expect(model.centerTab).toBe("preview");
    const html = shell.renderHtml();
    expect(html).toContain("keep this draft");
    expect(html).toContain('data-scratch="office-note"');
    expect(html).toContain('data-scroll-top="120"');
    expect(html).not.toContain("<script>");
    shell.dispose();
  });

  it("counts needs-you separately from FYI unread", () => {
    const { shell } = runningShell();
    const model = shell.viewModel();
    expect(model.needsYouCount).toBe(1);
    expect(model.unreadCount).toBe(2);
    shell.activate("filter:chat");
    expect(shell.renderHtml()).toContain("Earlier note");
    expect(shell.renderHtml()).not.toContain("Pick a database");
    shell.activate("filter:needs-you");
    expect(shell.renderHtml()).toContain("Needs You (1)");
    expect(shell.renderHtml()).toContain("Pick a database");
    shell.dispose();
  });
});

describe("daemon stream", () => {
  it("coalesces a 200 event burst from 50 workers into one frame", () => {
    const connected = runningShell();
    const { shell, client, clock } = connected;
    const before = shell.reactCommitCount;
    shell.daemon.store.noteInput(clock.now());
    const events: DaemonEvent[] = Array.from({ length: 200 }, (_, index) => ({
      seq: index + 1,
      streamEpoch: "epoch-1",
      topic: "worker",
      type: "worker.status",
      payload: {
        id: `w${index % 50}`,
        status: "working",
        detail: `tick ${index}`,
      },
    }));
    client.emit({ kind: "events.batch", streamEpoch: "epoch-1", events });
    expect(clock.pendingFrames()).toBe(1);
    expect(shell.reactCommitCount).toBe(before);
    clock.flush(15);
    expect(shell.daemon.store.commitCount).toBe(1);
    expect(shell.daemon.store.appliedCount).toBe(200);
    expect(shell.daemon.store.lastBatchLatencyMs).toBeLessThan(16);
    expect(shell.daemon.store.lastFlushWorkMs).toBeLessThan(16);
    expect(shell.daemon.store.overBudgetFlushes).toBe(0);
    expect(shell.reactCommitCount).toBe(before + 1);
    expect(shell.viewModel().workerCount).toBe(50);
    expect(shell.stream.resyncCount).toBe(0);
    expect(shell.renderHtml()).toContain('data-worker-count="50"');
    shell.dispose();
  });

  it("resyncs on a new stream epoch without dropping the composer draft", () => {
    const { shell, client } = runningShell();
    shell.setComposerDraft("still typing");
    client.emit({
      kind: "events.batch",
      streamEpoch: "epoch-2",
      events: [
        {
          seq: 1,
          streamEpoch: "epoch-2",
          topic: "worker",
          type: "worker.status",
          payload: { id: "ghost", status: "working", detail: "stale" },
        },
      ],
    });
    expect(shell.viewModel().connection).toBe("reconnecting");
    expect(shell.renderHtml()).toContain("Reconnecting to harnessd...");
    expect(shell.viewModel().workers.some((worker) => worker.id === "ghost")).toBe(false);
    expect(client.sent.some((message) => message.kind === "snapshot.get")).toBe(true);
    expect(buttonTag(shell.renderHtml(), "Stop")).toContain("disabled");
    client.emit({
      kind: "snapshot",
      snapshot: createDaemonSnapshot({
        asOfSeq: 8,
        streamEpoch: "epoch-2",
        run: "running",
        workers: [{ id: "kept", status: "working", detail: "synced", updatedSeq: 8 }],
      }),
    });
    const model = shell.viewModel();
    expect(model.connection).toBe("live");
    expect(model.composerDraft).toBe("still typing");
    expect(model.workers.map((worker) => worker.id)).toEqual(["kept"]);
    expect(shell.renderHtml()).not.toContain("Reconnecting to harnessd...");
    expect(buttonTag(shell.renderHtml(), "Stop")).not.toContain("disabled");
    shell.dispose();
  });

  it("shows the reconnecting banner on disconnect and restores after snapshot", () => {
    const { shell, client } = runningShell();
    shell.setComposerDraft("draft survives");
    client.close();
    expect(shell.renderHtml()).toContain("Reconnecting to harnessd...");
    expect(buttonTag(shell.renderHtml(), "Pause")).toContain("disabled");
    client.emit({
      kind: "snapshot",
      snapshot: createDaemonSnapshot({ asOfSeq: 3, streamEpoch: "epoch-9", run: "running" }),
    });
    expect(shell.viewModel().connection).toBe("live");
    expect(shell.viewModel().composerDraft).toBe("draft survives");
    shell.dispose();
  });
});

describe("stop, pause, and keyboard", () => {
  it("fires kernel stop from every phase and center tab in under 100ms", () => {
    const { shell, stop } = runningShell();
    for (const phase of phases) {
      shell.activate(`phase:${phase}`);
      for (const tab of tabs) {
        shell.activate(`tab:${tab}`);
        const before = stop.calls.length;
        const started = performance.now();
        shell.activate("stop");
        expect(performance.now() - started).toBeLessThan(100);
        expect(stop.calls.length).toBe(before + 1);
        const receipt = shell.lastStop;
        expect(receipt?.preservedCheckpoints).toBe(true);
        expect(receipt?.destructive).toBe(false);
        expect(shell.lastStopLatencyMs).toBeLessThan(100);
        expect(shell.stopOverBudget).toBe(false);
        expect(shell.viewModel().run).toBe("stopped");
        shell.activate("resume");
        expect(shell.viewModel().run).toBe("running");
      }
    }
    expect(PHASES).toHaveLength(4);
    shell.dispose();
  });

  it("confirms emergency stop before firing, and resume is one click", () => {
    const { shell, stop, bridge } = runningShell();
    shell.handleKey({ key: "Backspace", ctrl: true, shift: true });
    expect(shell.renderHtml()).toContain("Confirm stop");
    expect(stop.calls).toHaveLength(0);
    shell.activate("confirm-stop");
    expect(stop.calls).toHaveLength(1);
    expect(stop.calls[0]?.source).toBe("shortcut-confirm");
    expect(bridge.sent.some((message) => message.kind === "rpc" && message.method === "build.stop")).toBe(
      true,
    );
    expect(buttonTag(shell.renderHtml(), "Resume")).not.toContain("disabled");
    shell.activate("resume");
    expect(shell.viewModel().run).toBe("running");
    shell.dispose();
  });

  it("handles phase, rail, inspector, focus, and escape shortcuts", () => {
    const { shell } = runningShell();
    shell.handleKey({ key: "2", ctrl: true });
    expect(shell.context.phase).toBe("plan");
    shell.handleKey({ key: "3", ctrl: true });
    expect(shell.viewModel().phase).toBe("build");
    shell.handleKey({ key: "4", ctrl: true });
    expect(shell.viewModel().phase).toBe("ship");
    shell.handleKey({ key: "1", ctrl: true });
    expect(shell.viewModel().phase).toBe("discover");
    shell.handleKey({ key: "b", ctrl: true });
    expect(shell.context.leftCollapsed).toBe(true);
    shell.handleKey({ key: "b", ctrl: true });
    expect(shell.context.leftCollapsed).toBe(false);
    shell.handleKey({ key: "i", ctrl: true });
    expect(shell.context.inspectorCollapsed).toBe(true);
    shell.openInspector({ kind: "worker", id: "w1", title: "A0014 · print page" });
    expect(shell.context.inspectorCollapsed).toBe(false);
    shell.activate("toggle-spend");
    shell.handleKey({ key: "Escape" });
    expect(shell.viewModel().spendOpen).toBe(false);
    expect(shell.context.inspectorCollapsed).toBe(false);
    shell.handleKey({ key: "Escape" });
    expect(shell.context.inspectorCollapsed).toBe(true);
    shell.handleKey({ key: ".", ctrl: true });
    expect(shell.context.focusMode).toBe(true);
    shell.focusTablist();
    shell.handleKey({ key: "ArrowRight" });
    expect(shell.context.centerTab).toBe("board");
    shell.handleKey({ key: "ArrowLeft" });
    expect(shell.context.centerTab).toBe("office");
    shell.handleKey({ key: " ", ctrl: true });
    expect(shell.viewModel().dictating).toBe(true);
    expect(shell.viewModel().focusId).toBe("composer-input");
    shell.dispose();
  });
});

describe("accessibility, heartbeat, and security", () => {
  it("passes the axe-core serious and critical audit in light and dark themes", () => {
    const { shell } = runningShell();
    const light = auditShellHtml(shell.renderHtml());
    expect(light.tool).toBe("axe-core");
    expect(light.version.length).toBeGreaterThan(0);
    expect(seriousOrCritical(light)).toEqual([]);
    shell.activate("theme:dark");
    shell.openInspector({ kind: "diff", id: "d1", title: "Chosen diff" });
    shell.activate("toggle-spend");
    const dark = auditShellHtml(shell.renderHtml());
    expect(seriousOrCritical(dark)).toEqual([]);
    shell.dispose();
  });

  it("reports UI latency at 1Hz only while the document is visible", () => {
    const sink = new MemoryLatencySink();
    const monitor = new UiLatencyHeartbeatMonitor(sink);
    monitor.noteSample(4, 0, false);
    monitor.noteSample(8, 500, false);
    expect(sink.samples).toHaveLength(0);
    monitor.noteSample(10, 1000, false);
    expect(sink.samples).toHaveLength(1);
    expect(sink.samples[0]?.p95Ms).toBe(10);
    monitor.noteSample(12, 2000, false);
    expect(sink.samples).toHaveLength(2);

    const hiddenSink = new MemoryLatencySink();
    const hidden = new UiLatencyHeartbeatMonitor(hiddenSink);
    hidden.noteSample(30, 0, true);
    hidden.noteSample(30, 1500, true);
    expect(hiddenSink.samples).toHaveLength(0);

    const connected = runningShell();
    connected.clock.documentHidden = true;
    connected.shell.daemon.store.noteInput(0);
    connected.client.emit({
      kind: "events.batch",
      streamEpoch: "epoch-1",
      events: [
        {
          seq: 1,
          streamEpoch: "epoch-1",
          topic: "worker",
          type: "worker.status",
          payload: { id: "w1", status: "working", detail: "hidden" },
        },
      ],
    });
    connected.clock.flush(15);
    expect(connected.sink.samples).toHaveLength(0);
    expect(connected.shell.viewModel().workerCount).toBe(1);
    connected.shell.dispose();
  });
});
