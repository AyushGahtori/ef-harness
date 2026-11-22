import { describe, expect, it } from "vitest";
import {
  WorkerInspectorPanel,
  collectText,
  findAll,
  findByName,
} from "../../src/cockpit/inspector/index.js";
import {
  attempt,
  brief,
  check,
  FakePorts,
  file,
  identity,
  milestone,
  rawCredential,
} from "./support.js";

const CHAIN =
  "Claimed → Brief compiled (2.4k tokens) → Edited 2 files → Ran vitest (12/12 passed) → Clean Verifier (PASS) → Merged commit abc123";

function workingPorts(): FakePorts {
  const ports = new FakePorts();
  const pass = attempt({
    attemptId: "att-3",
    number: 3,
    outcome: "pass",
    level: "Sr",
    escalatedFrom: "Mid",
    sliceSha256: "sha-historical",
    logArtifactId: "log-3",
    milestones: [
      milestone("m1", "Claimed", { at: "14:02", handoffId: "HO-9" }),
      milestone("m2", "Brief compiled (2.4k tokens)", { at: "14:03" }),
      milestone("m3", "Edited 2 files", { at: "14:04", filePath: "src/kitchen/print.tsx", line: 14 }),
      milestone("m4", "Ran vitest (12/12 passed)", {
        at: "14:05",
        command: "vitest",
        commandOutput: '{"tool":"bash","raw":true}',
      }),
      milestone("m5", "Clean Verifier (PASS)", { at: "14:06" }),
      milestone("m6", "Merged commit abc123", { at: "14:07" }),
    ],
    files: [file("src/kitchen/print.tsx", 2400, 42, 3)],
    checks: [
      check({ id: "c-static", layer: "STATIC_AUDIT", status: "pass", summary: "Static audit clean" }),
      check({ id: "c-types", layer: "typecheck", status: "pass", summary: "typecheck passed" }),
      check({ id: "c-lint", layer: "lint", status: "pass", summary: "lint passed" }),
      check({ id: "c-unit", layer: "unit", status: "pass", summary: "12/12 passed" }),
      check({
        id: "c-pw",
        layer: "playwright",
        status: "fail",
        summary: "bounding box 12,4 80x24 · a11y name Print",
        screenshotArtifactId: "shot-1",
      }),
      check({ id: "c-rev", layer: "reviewer@1", status: "pass", summary: "reviewer found no blockers" }),
      check({
        id: "c-taste",
        layer: "taste-reviewer@1",
        status: "advisory",
        summary: "advisory: tighten the empty state",
      }),
      check({
        id: "c-hidden",
        layer: "hidden",
        status: "fail",
        summary: "Hidden check failed on the totals table",
        sealedSource: "SEALED_ORACLE_BODY_unit",
        hideSealedSource: true,
        disputeAvailable: true,
      }),
    ],
  });
  const failed1 = attempt({
    attemptId: "att-1",
    number: 1,
    outcome: "failed",
    hint: "Hint 1",
    sliceSha256: "sha-attempt-1",
    files: [file("src/kitchen/draft.tsx", 800, 4, 1)],
    milestones: [milestone("a1", "Claimed"), milestone("a1b", "Ran vitest (10/12 passed)")],
  });
  const failed2 = attempt({
    attemptId: "att-2",
    number: 2,
    outcome: "failed",
    hint: "Hint 2",
    sliceSha256: "sha-attempt-2",
    files: [file("src/kitchen/draft.tsx", 900, 6, 1)],
    milestones: [milestone("a2", "Claimed")],
  });
  ports.snapshots.set("T-7", {
    identity: identity({ lane: "Verifying", holdReason: "cutoff changing" }),
    attempts: [failed1, failed2, pass],
  });
  ports.briefs.set("sha-historical", brief());
  ports.briefs.set("sha-attempt-1", brief({ sliceSha256: "sha-attempt-1", goal: "attempt 1 brief" }));
  ports.briefs.set("sha-attempt-2", brief({ sliceSha256: "sha-attempt-2", goal: "attempt 2 brief" }));
  ports.handoffReads.set("att-3", [
    { handoffId: "HO-9", tool: "harness.read_result", summary: "planner brief" },
  ]);
  ports.lineage.set("HO-9", [
    { handoffId: "HO-9", fromRole: "Planner", toRole: "Worker", summary: "brief" },
  ]);
  ports.diffs.set("att-3:src/kitchen/print.tsx", {
    line: 14,
    lines: ["+const ready = 1", "-const old = 0"],
  });
  return ports;
}

describe("worker inspector panel", () => {
  it("opens the five tabs, the pass attempt, and the structured timeline", async () => {
    const ports = workingPorts();
    const panel = new WorkerInspectorPanel(ports.deps());
    const applied = await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    expect(applied.applied).toBe(true);
    const view = panel.view();
    const text = collectText(view);
    expect(text).toContain("A0014 · print page");
    expect(text).toContain("gpt-5.1 · ChatGPT Plus");
    expect(text).toContain("Sr");
    expect(text).toContain("4 min");
    expect(text).toContain("$0.18");
    expect(text).toContain("Verifying");
    expect(text).toContain("Held: cutoff changing");
    expect(text).toContain("Escalated Mid → Sr");
    expect(findByName(view, "Pause")).toBeDefined();
    expect(findByName(view, "Explain")).toBeDefined();
    expect(findByName(view, "I fixed it myself")).toBeDefined();
    for (const label of ["Timeline", "Diff", "Checks", "Brief", "Raw Stream"]) {
      expect(findByName(view, label)?.props.selected).toBe(label === "Timeline");
    }
    expect(view.props.host).toBe("collapsible-shell");
    expect(view.props.minPx).toBe(340);
    expect(view.props.maxPx).toBe(480);
    expect(text).toContain(CHAIN);
    expect(text).toContain("Attempt 1 (Failed — Hint 1)");
    expect(text).toContain("Attempt 2 (Failed — Hint 2)");
    expect(text).toContain("Attempt 3 (PASS)");
    expect(text).not.toContain('{"tool"');
    panel.toggleCommand("m4");
    expect(collectText(panel.view())).toContain("Structured result (hidden raw JSON)");
    expect(collectText(panel.view())).not.toContain('"raw":true');
  });

  it("switches attempts and keeps diffs, hints, and briefs on that attempt", async () => {
    const ports = workingPorts();
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    await panel.selectAttempt("att-1");
    panel.setTab("diff");
    const text = collectText(panel.view());
    expect(text).toContain("Hint 1");
    expect(text).toContain("src/kitchen/draft.tsx");
    expect(text).not.toContain("src/kitchen/print.tsx");
    panel.setTab("brief");
    expect(collectText(panel.view())).toContain("sha-attempt-1");
    expect(ports.briefRequests).toContain("sha-attempt-1");
  });

  it("shows a queued task's brief, upstream wait, and estimate without an error", async () => {
    const ports = new FakePorts();
    ports.snapshots.set("T-9", {
      identity: identity({
        lane: "Queued",
        elapsedMs: 0,
        spendMicroUsd: 0,
        phase0GateOpen: true,
        waitingOn: ["T-2", "T-3"],
        estimatedLevel: "Mid",
        estimatedCostMicroUsd: 110_000,
      }),
      attempts: [],
    });
    ports.previews.set("T-9", brief({ sliceSha256: "sha-preview", goal: "Upcoming print brief" }));
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-9", host: "collapsible-shell" });
    const text = collectText(panel.view());
    expect(text).toContain("Waiting on T-2, T-3");
    expect(text).toContain("Estimated Mid · $0.11");
    panel.setTab("brief");
    const briefText = collectText(panel.view());
    expect(briefText).toContain("Upcoming brief");
    expect(briefText).toContain("Upcoming print brief");
    expect(briefText).toContain("MUST");
    expect(briefText).toContain("cutoff 10:45 Europe/Berlin");
    expect(findAll(panel.view(), (node) => node.type === "alert")).toHaveLength(0);
  });

  it("shows the phase 0 gate on a queued task that has not been claimed", async () => {
    const ports = new FakePorts();
    ports.snapshots.set("T-0", {
      identity: identity({ lane: "Queued", phase0GateOpen: false, waitingOn: [] }),
      attempts: [],
    });
    ports.previews.set(
      "T-0",
      brief({ requirements: [{ id: "R-1", band: "MUST", version: 1, text: "Gate must pass", laterVersion: null }] }),
    );
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-0", host: "popout" });
    expect(panel.view().props.host).toBe("popout");
    expect(collectText(panel.view())).toContain("Waiting on Phase 0 Gate 0");
    panel.setTab("brief");
    const text = collectText(panel.view());
    expect(text).toContain("Gate must pass");
    expect(findAll(panel.view(), (node) => node.type === "alert")).toHaveLength(0);
  });

  it("reconstructs the pinned historical brief and lists pulls plus handoff reads", async () => {
    const ports = workingPorts();
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("brief");
    const text = collectText(panel.view());
    expect(text).toContain("sha-historical");
    expect(text).toContain("cutoff 10:45 Europe/Berlin");
    expect(text).not.toContain("cutoff 11:00");
    expect(text).toContain("R-5 updated later");
    expect(text).toContain("2.4k tokens");
    expect(text).toContain("X-01");
    expect(text).toContain("X-14");
    expect(text).not.toContain("not a cross-cutting rule");
    expect(text).toContain("skill-print");
    expect(text).toContain("skill-a11y");
    expect(text).toContain("src/kitchen/print.tsx");
    expect(text).toContain("kb.get_fact");
    expect(text).toContain("fact-cutoff");
    expect(text).toContain("harness.read_result");
    expect(text).toContain("HO-9");
    expect(ports.briefRequests[0]).toBe("sha-historical");
    panel.followRequirement("R-5");
    panel.followHandoff("HO-9");
    expect(ports.shell.nodes).toEqual(["R-5", "HO-9"]);
  });

  it("refuses a third mounted skill", async () => {
    const ports = workingPorts();
    ports.briefs.set(
      "sha-historical",
      brief({
        skills: [
          { id: "skill-print", sha256: "abc" },
          { id: "skill-a11y", sha256: "def" },
          { id: "skill-extra", sha256: "fff" },
        ],
      }),
    );
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("brief");
    const text = collectText(panel.view());
    expect(text).toContain("Skill mount refused above 2");
    expect(text).not.toContain("skill-extra");
  });

  it("runs header actions and opens the editor at the diff line", async () => {
    const ports = workingPorts();
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.pause();
    const summary = panel.explain();
    panel.fixedItMyself();
    expect(ports.shell.pauses).toEqual(["T-7"]);
    expect(ports.shell.fixes).toEqual(["T-7"]);
    expect(summary).toBe("Started with Claimed. Latest: Merged commit abc123.");
    expect(ports.shell.explains[0]?.evidence).toHaveLength(6);
    await panel.loadDiff("src/kitchen/print.tsx");
    panel.followFile("src/kitchen/print.tsx");
    expect(ports.shell.editors).toEqual(["code -g src/kitchen/print.tsx:14"]);
  });

  it("hides sealed hidden-check source during an active retry and offers DisputeTest", async () => {
    const ports = workingPorts();
    const latest = ports.snapshots.get("T-7");
    if (!latest) throw new Error("missing snapshot");
    const hidden = latest.attempts[2];
    if (!hidden) throw new Error("missing attempt");
    ports.snapshots.set("T-7", {
      identity: latest.identity,
      attempts: [latest.attempts[0], latest.attempts[1], { ...hidden, outcome: "failed", hint: "Hint 3" }].filter(
        (item): item is NonNullable<typeof item> => item !== undefined,
      ),
    });
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("checks");
    const text = collectText(panel.view());
    expect(text).toContain("STATIC_AUDIT");
    expect(text).toContain("typecheck");
    expect(text).toContain("lint");
    expect(text).toContain("unit");
    expect(text).toContain("playwright");
    expect(text).toContain("bounding box 12,4 80x24 · a11y name Print");
    expect(text).toContain("reviewer@1");
    expect(text).toContain("taste-reviewer@1");
    expect(text).toContain("advisory: tighten the empty state");
    expect(text).toContain("Hidden check failed on the totals table");
    expect(text).not.toContain("SEALED_ORACLE_BODY_unit");
    expect(findByName(panel.view(), "DisputeTest")).toBeDefined();
    panel.disputeTest("c-hidden");
    expect(ports.shell.disputes).toEqual([{ taskId: "T-7", checkId: "c-hidden" }]);
    await panel.openScreenshot("c-pw");
    expect(collectText(panel.view())).toContain("PNG thumbnail");
    expect(findByName(panel.view(), "Screenshot")?.props.zoomed).toBe(true);
    expect(ports.shotCalls[0]?.limit).toBe(64 * 1024);
    panel.closeLightbox();
    expect(findByName(panel.view(), "Screenshot")).toBeUndefined();
  });

  it("blocks a diff chunk that skipped daemon redaction", async () => {
    const ports = workingPorts();
    const secret = rawCredential();
    ports.diffs.set("att-3:src/kitchen/print.tsx", { line: 14, lines: [`+token = ${secret}`] });
    const panel = new WorkerInspectorPanel(ports.deps());
    await panel.show({ taskId: "T-7", host: "collapsible-shell" });
    panel.setTab("diff");
    const result = await panel.loadDiff("src/kitchen/print.tsx");
    expect(result.applied).toBe(true);
    const text = collectText(panel.view());
    expect(text).toContain("Blocked: diff preview was not pre-redacted");
    expect(text).not.toContain(secret);
  });
});
