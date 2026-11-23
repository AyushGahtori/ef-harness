import { describe, expect, it } from "vitest";
import {
  CrossTabSelectionContext,
  LocalClipboard,
  LocalEarsOracleValidator,
  LocalProposedRequirementReviewQueue,
  LocalStartBuild,
  LocalVsCodeOpener,
  LocalWorkerInspector,
  MatrixCoverageExplorer,
  MediumRiskProposalReviewPanel,
  PlanTreeAndPreviewTab,
  RuntimeTasksTableTab,
  SpecBrowserTab,
  THEME,
  contrastPairs,
  contrastRatio,
  leaksInternalMarkers,
} from "../../src/canvas/tabs/index.js";
import {
  PRINT_EARS,
  bestElapsed,
  openDb,
  seedCli,
  seedConflict,
  seedMatrices,
  seedPlan,
  seedProposals,
  seedRuntime,
  seedSpec,
} from "./support.js";

describe("SpecBrowserTab", () => {
  it("renders decisions, EARS, wireframes, rules, provenance, and chosen-for-you links from state.db", () => {
    const db = openDb();
    seedSpec(db);
    seedConflict(db);
    const selection = new CrossTabSelectionContext();
    const opener = new LocalVsCodeOpener();
    const clipboard = new LocalClipboard();
    const tab = new SpecBrowserTab(db, selection, { repoRoot: "C:/kitchen", vscode: opener, clipboard });
    const html = tab.render();
    expect(html).toContain('data-source="state.db"');
    expect(html).toContain("System Overview");
    expect(html).toContain("Lunch tickets for the kitchen.");
    expect(html).toContain("Decisions &amp; Chosen For You");
    expect(html).toContain("Chosen for you");
    expect(html).toContain("EARS Requirements");
    expect(html).toContain("Contracts/Schemas");
    expect(html).toContain("Screen Specs");
    expect(html).toContain("Seams");
    expect(html).toContain("Research Facts");
    expect(html).toContain("Cross-Cutting Rules (X-01..X-14)");
    expect(html).toContain("<svg");
    expect(html).toContain("Kitchen tickets");
    expect(html).toContain('data-provenance="Explicit · Turn 2"');
    expect(html).toContain('data-provenance="Derived ← D-4"');
    expect(html).toContain('data-provenance="Delegated"');
    expect(html).toContain('data-provenance="Proposed"');
    expect(html).toContain('data-provenance="Observed"');
    expect(html).toContain('data-touch="print"');
    expect(html).toContain("Locate on Canvas");
    expect(html).toContain("Open in VS Code (.harness/views/features/orders.md)");
    expect(html).toContain("Copy Feature Spec Markdown");
    expect(html).toContain("font-variant-numeric: tabular-nums");
    for (let index = 1; index <= 14; index += 1) {
      expect(html).toContain(`X-${String(index).padStart(2, "0")}`);
    }
    expect(html).toContain("1 contradiction blocks build start — Jump to Conflict");
    expect(html).toContain("cell:M04:anon:401");
    expect(html).toContain("D-4");

    tab.locateOnCanvas("R-Explicit");
    expect(selection.activeTab).toBe("canvas");
    expect(selection.requirementId).toBe("R-Explicit");
    expect(selection.featureId).toBe("F-Orders");

    tab.openInVsCode("F-Orders");
    expect(opener.commands).toEqual(["code C:/kitchen/.harness/views/features/orders.md"]);
    expect(selection.activeTab).toBe("vscode");
    expect(selection.requirementId).toBe("R-Explicit");

    const markdown = tab.copyFeatureMarkdown("F-Orders");
    expect(markdown).toContain(PRINT_EARS);
    expect(markdown).toContain("Order schema");
    expect(markdown).toContain("Kitchen tickets");
    expect(leaksInternalMarkers(markdown)).toBe(false);
    expect(clipboard.text).toBe(markdown);

    tab.setSearch("Print");
    const filtered = tab.render();
    expect(filtered).toContain("Print tickets");
    expect(filtered).not.toContain("Cancel ticket");

    const before = tab.render();
    expect(before).not.toContain('data-active="true"');
    tab.pressKey("ArrowDown");
    expect(tab.render()).toContain('data-active="true"');
    tab.setTheme("dark");
    expect(tab.render()).toContain('data-theme="dark"');
    db.close();
  });

  it("hides wireframes for a headless CLI and shows command specs plus the exit-code matrix", () => {
    const db = openDb();
    seedCli(db);
    const tab = new SpecBrowserTab(db, new CrossTabSelectionContext());
    const html = tab.render();
    expect(html).not.toContain("Screen Specs");
    expect(html).not.toContain("<svg");
    expect(html).toContain("CLI Command Specs");
    expect(html).toContain("orders export writes a CSV and exits 0.");
    expect(html).toContain("Exit-Code Matrix");
    expect(html).toContain("A missing menu file exits 2.");
    db.close();
  });
});

describe("MatrixCoverageExplorer", () => {
  it("shows collapsed rules for every active matrix and virtualizes raw cells", () => {
    const db = openDb();
    seedMatrices(db, 2160);
    const explorer = new MatrixCoverageExplorer(db, new CrossTabSelectionContext());
    const collapsed = explorer.render();
    expect(collapsed).toContain('data-mode="collapsed"');
    expect(collapsed).toContain("Role × Action Permissions Matrix");
    expect(collapsed).toContain("Screen × UI State Matrix");
    expect(collapsed).toContain("API Endpoint × Status &amp; Error Matrix");
    expect(collapsed).toContain("State Machine × Transition Matrix");
    expect(collapsed).toContain('data-matrix="M04" data-collapsed="42"');
    expect(collapsed).toContain("ALL unauthenticated private API calls → 401");
    for (const label of [
      "Pass 1 Decision",
      "Pass 2 Elaboration/UP",
      "Pass 3 Spec-Expander",
      "Proposed",
      "Conflict",
      "N/A",
    ]) {
      expect(collapsed).toContain(label);
    }
    expect(collapsed).toContain("●");
    expect(collapsed).toContain("■");
    expect(collapsed).toContain("▲");
    expect(collapsed).toContain("◆");
    expect(collapsed).toContain("✕");
    expect(collapsed).not.toContain('data-total="2160"');

    explorer.setShowRaw(true);
    const elapsed = bestElapsed(() => explorer.setShowRaw(true).elapsedMs);
    const raw = explorer.render();
    expect(elapsed).toBeLessThan(10);
    expect(raw).toContain('data-total="2160"');
    expect(raw).toContain('data-window-count="24"');
    expect(raw.match(/data-row-id=/g)?.length).toBe(24);
    explorer.pressKey("PageDown");
    expect(explorer.render()).toContain('data-window-start="24"');
    db.close();
  });
});

describe("MediumRiskProposalReviewPanel", () => {
  it("approves, edits, and rejects atomically and keeps vague draft text", () => {
    const db = openDb();
    seedProposals(db);
    const selection = new CrossTabSelectionContext();
    const queue = new LocalProposedRequirementReviewQueue(db, new LocalEarsOracleValidator());
    const panel = new MediumRiskProposalReviewPanel(db, selection, queue);
    let html = panel.render();
    expect(html).toContain("Pending medium-risk: 3");
    expect(html).toContain("Approve all in Feature");
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Edit<");
    expect(html).toContain(">Reject<");
    expect(html).toContain(PRINT_EARS);
    expect(html).toContain("When the cook clicks Print, the page shows a confirmation dialog.");

    const before = db.getNode("P-1");
    panel.setDraft("P-1", "ears", "handle nicely");
    panel.edit("P-1");
    html = panel.render();
    expect(html).toContain("handle nicely");
    expect(html).toContain("vague");
    expect(db.getNode("P-1")?.text).toBe(before?.text);
    expect(db.getNode("P-1")?.version).toBe(before?.version);
    expect(db.getNode("P-1")?.basis).toBe("proposed");

    const versionTwo = db.getNode("P-2")?.version;
    const versionThree = db.getNode("P-3")?.version;
    expect(() =>
      queue.settle({
        edits: [
          {
            cellId: "P-2",
            earsText: PRINT_EARS,
            oracleSketch: "When the cook clicks Print, the page shows a confirmation dialog.",
          },
          { cellId: "P-3", earsText: "handle nicely", oracleSketch: "handle nicely" },
        ],
      }),
    ).toThrow(/vague|EARS/);
    expect(db.getNode("P-2")?.version).toBe(versionTwo);
    expect(db.getNode("P-3")?.version).toBe(versionThree);

    panel.approveAll("F-Orders");
    expect(db.getNode("P-1")?.basis).toBe("explicit");
    expect(db.getNode("P-2")?.basis).toBe("explicit");
    expect(db.getNode("P-1")?.status).toBe("active");
    expect(db.getNode("P-3")?.basis).toBe("proposed");
    html = panel.render();
    expect(html).toContain("Pending medium-risk: 1");
    expect(html).toContain("Explicit settled: 2");
    expect(html).not.toContain('data-cell-id="P-1"');

    panel.reject("P-3");
    expect(db.getNode("P-3")?.status).toBe("superseded");
    expect(db.getNode("CMT-P-3")?.kind).toBe("comment");
    expect(panel.render()).toContain("Pending medium-risk: 0");
    expect(panel.render()).toContain("Readiness: ready");
    db.close();
  });
});

describe("PlanTreeAndPreviewTab", () => {
  it("separates planned work from projected ranges, switches presets quickly, and blocks Start Build", () => {
    const db = openDb();
    seedPlan(db);
    const selection = new CrossTabSelectionContext();
    const start = new LocalStartBuild();
    const plan = new PlanTreeAndPreviewTab(db, selection, undefined, start);
    let html = plan.render();
    expect(html).toContain("Planned Now");
    expect(html).toContain("Projected Later");
    expect(html).toContain("Phase 0");
    expect(html).toContain("Wave 1");
    for (let step = 1; step <= 8; step += 1) expect(html).toContain(`P0.${step}`);
    expect(html).toContain('class="tier-chip">Jr');
    expect(html).toContain('class="tier-chip">Mid');
    expect(html).toContain('class="tier-chip">Sr');
    expect(html).toContain("src/orders/**");
    expect(html).toContain("3/5/6/4/2%");
    expect(html).toContain("Research 3% · Arch 5% · Plan/Oracles 6% · Integration/Review 4% · Audit 2%");
    expect(html).toContain("&lt;= 20%");
    expect(html).toContain("Chosen for you");
    expect(html).toContain(">Change<");
    expect(html).toContain(">Override<");
    expect(html).toContain("Deferred items");
    expect(html).toContain("SMS receipts");
    expect(html).toContain("Wave 3");
    expect(html).toContain("6–9 tasks");
    expect(html).toContain("~$0.60–$1.10");
    expect(html).toContain("Detailed tasks compiled after Wave 1 finishes");
    expect(html).toContain(">Start Build<");
    expect(html).not.toContain("Plan Delta");

    const balanced = html.match(/data-task-id="P0-2"[^>]*data-cost="(\d+)"/);
    expect(balanced?.[1]).toBe("1800000");
    plan.switchPreset("Cheapest");
    html = plan.render();
    expect(html.match(/data-task-id="P0-2"[^>]*data-cost="(\d+)"/)?.[1]).toBe("1000000");
    expect(html).toContain('data-minutes="15"');
    plan.switchPreset("Fastest");
    html = plan.render();
    expect(html.match(/data-task-id="P0-4"[^>]*data-cost="(\d+)"/)?.[1]).toBe("3200000");

    plan.switchPreset("Balanced");
    const elapsed = bestElapsed(() => plan.switchPreset("Cheapest").elapsedMs);
    expect(elapsed).toBeLessThan(30);
    expect(plan.lastRecalcMs).toBeLessThan(30);

    expect(plan.startBuild().started).toBe(true);
    expect(start.calls).toBe(1);
    plan.changeChosen("D-Magic");
    expect(plan.lastRoute).toBe("Task-087:D-Magic");
    plan.overrideChosen("D-Magic");
    expect(selection.decisionId).toBe("D-Magic");

    db.insertInbox({
      id: "conflict-1",
      kind: "conflict",
      subject: "Cutoff vs print",
      priority: 1,
      payload: { summary: "Cutoff disagrees", cell_ids: ["cell:M06:cutoff"], decision_ids: ["D-4"] },
    });
    html = plan.render();
    expect(html).toContain("1 contradiction blocks build start — Jump to Conflict");
    expect(html).toContain('disabled');
    expect(html).toContain("Resolve 1 conflict first");
    expect(html).toContain("cell:M06:cutoff");
    const blocked = plan.startBuild();
    expect(blocked.started).toBe(false);
    expect(blocked.reason).toBe("Resolve 1 conflict first");
    expect(start.calls).toBe(1);
    plan.focusBlocker();
    expect(selection.conflictId).toBe("conflict-1");
    expect(selection.cellId).toBe("cell:M06:cutoff");
    expect(selection.decisionId).toBe("D-4");
    plan.pressKey("ArrowDown");
    expect(plan.render()).toContain('data-active="true"');

    db.setMeta("plan_mode", "revision");
    db.insertNodes([
      { id: "plan-delta", kind: "plan", title: "Plan delta", text: "Before 8 tasks, after 9 tasks." },
    ]);
    const revision = plan.render();
    expect(revision).toContain("Plan Delta");
    expect(revision).toContain("Before 8 tasks, after 9 tasks.");
    expect(revision).not.toContain(">Start Build<");
    db.close();
  });

  it("disables Start Build for an open must-ask", () => {
    const db = openDb();
    seedPlan(db);
    db.insertNodes([
      {
        id: "D-Ask",
        kind: "decision",
        title: "Payments",
        text: "Which provider?",
        status: "draft",
        fields: { must_ask: true },
      },
    ]);
    const plan = new PlanTreeAndPreviewTab(db, new CrossTabSelectionContext());
    const html = plan.render();
    expect(html).toContain("Resolve 1 must-ask first");
    expect(plan.startBuild().started).toBe(false);
    db.close();
  });
});

describe("RuntimeTasksTableTab", () => {
  it("sorts and filters 500 rows quickly and opens the worker inspector", () => {
    const db = openDb();
    seedRuntime(db, 500);
    const selection = new CrossTabSelectionContext();
    const inspector = new LocalWorkerInspector();
    const table = new RuntimeTasksTableTab(db, selection, inspector);
    table.render();
    const elapsed = bestElapsed(() => table.sortFilterAndRender("cost", "").elapsedMs);
    const html = table.render();
    expect(elapsed).toBeLessThan(10);
    expect(html).toContain('data-total="500"');
    expect(html).toContain('data-window-count="24"');
    expect(html).toContain("AgentID · Task");
    expect(html).toContain("Lane/Status");
    expect(html).toContain("Tier/Model");
    expect(html).toContain("Cost/Window");
    expect(html).toContain("Merge SHA");
    expect(html).toContain("font-variant-numeric: tabular-nums");
    expect(html).toContain('<tbody><tr data-task-id="T-499"');

    table.setSort("agent");
    const agentHtml = table.render();
    expect(agentHtml).toContain("agent-000 · Print ticket 0");
    expect(agentHtml).toContain("Orders");
    expect(agentHtml).toContain("Wave 1");
    expect(agentHtml).toContain("CODING");
    expect(agentHtml).toContain("Jr / gpt-test");
    expect(agentHtml).toContain(">2<");
    expect(agentHtml).toContain("1m 30s");
    expect(agentHtml).toContain("$50.00 · 4% window");
    expect(agentHtml).toContain("abc1234");

    table.setFilter("Orders");
    const filtered = table.render();
    expect(filtered).toContain('data-total="20"');
    expect(filtered).not.toContain("Billing task");

    const filterElapsed = bestElapsed(() => table.sortFilterAndRender("lane", "Orders").elapsedMs);
    expect(filterElapsed).toBeLessThan(10);

    db.patchRuntimeStates(
      Array.from({ length: 20 }, (_, index) => ({
        taskId: `T-${String(index).padStart(3, "0")}`,
        state: "ESCALATED",
      })),
    );
    table.setFilter("");
    table.setSort("agent");
    const live = table.render();
    expect(live).toContain("ESCALATED");
    const liveElapsed = bestElapsed(() => table.sortFilterAndRender("elapsed", "").elapsedMs);
    expect(liveElapsed).toBeLessThan(10);

    const clickStarted = performance.now();
    table.activateRow("T-000");
    expect(performance.now() - clickStarted).toBeLessThan(10);
    expect(inspector.shown).toEqual({ taskId: "T-000", host: "collapsible-shell" });
    expect(selection.taskId).toBe("T-000");
    expect(selection.featureId).toBe("F-Orders");
    expect(selection.activeTab).toBe("board");
    expect(table.render()).toContain('data-inspector-task="T-000"');

    table.pressKey("ArrowDown");
    expect(table.render()).toContain('data-active="true"');
    db.close();
  });
});

describe("cross-tab selection and contrast", () => {
  it("keeps the feature and requirement selected across canvas, spec, plan, board, and vscode", () => {
    const db = openDb();
    seedSpec(db);
    db.insertNodes([
      {
        id: "W1-Link",
        kind: "task",
        title: "Print the tickets",
        fields: {
          feature: "F-Orders",
          band: "wave1",
          balanced_level: "Mid",
          safety_floor: "Junior",
          junior_cost_micro_usd: 100_000,
          duration_minutes: 8,
        },
      },
    ]);
    db.insertTaskRuntime({ taskId: "W1-Link", featureId: "F-Orders", state: "DRAFTED", level: "Mid" });
    const selection = new CrossTabSelectionContext();
    const spec = new SpecBrowserTab(db, selection, { repoRoot: "C:/kitchen" });
    const plan = new PlanTreeAndPreviewTab(db, selection);
    spec.selectRequirement("R-Explicit");
    selection.switchTab("plan");
    expect(selection.requirementId).toBe("R-Explicit");
    expect(selection.featureId).toBe("F-Orders");
    expect(plan.render()).toMatch(/data-feature-id="F-Orders"[^>]*data-selected="true"/);
    selection.switchTab("canvas");
    selection.switchTab("board");
    selection.switchTab("vscode");
    expect(selection.snapshot()).toMatchObject({
      featureId: "F-Orders",
      requirementId: "R-Explicit",
      activeTab: "vscode",
    });
    selection.switchTab("spec");
    expect(spec.render()).toContain('data-node-id="R-Explicit"');
    expect(spec.render()).toContain('data-selected="true"');
    db.close();
  });

  it("meets WCAG AA contrast for light and dark text, strips, and status colors", () => {
    for (const theme of ["light", "dark"] as const) {
      for (const pair of contrastPairs(theme)) {
        expect(contrastRatio(pair.fg, pair.bg), `${theme} ${pair.label}`).toBeGreaterThanOrEqual(4.5);
      }
      expect(THEME[theme].bg).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("canonical state.db", () => {
  it("re-reads requirement text after a review commit instead of keeping a private copy", () => {
    const db = openDb();
    seedProposals(db);
    const selection = new CrossTabSelectionContext();
    const panel = new MediumRiskProposalReviewPanel(db, selection);
    const spec = new SpecBrowserTab(db, selection);
    expect(spec.render()).toContain('data-provenance="Proposed"');
    panel.approve("P-1");
    const node = db.getNode("P-1");
    expect(node?.basis).toBe("explicit");
    expect(node?.fields.review_status).toBe("settled");
    const html = spec.render();
    expect(html).toContain('data-node-id="P-1"');
    expect(html).toContain('data-provenance="Explicit"');
    expect(html).not.toContain('data-cell-id="P-1"');
    db.close();
  });
});
