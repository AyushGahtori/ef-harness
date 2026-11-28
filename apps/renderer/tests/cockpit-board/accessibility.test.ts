import fs from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import {
  BOARD_THEMES,
  contrastRatio,
  themeContrastPairs,
  type BoardHealthSignalPort,
  type BoardTaskRecord,
  type BoardThemeName,
} from "../../src/cockpit/board/index.js";
import { createView, makeTask } from "./fixtures.js";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core"), "utf8");

function boardTasks(): BoardTaskRecord[] {
  const longPath = "packages/backend/src/features/kitchen/orders/handlers/submitOrderHandler.ts";
  return [
    makeTask({
      taskId: "queued-1",
      state: "READY",
      blockedBy: [{ taskId: "T03", title: "kitchen totals" }],
    }),
    makeTask({
      taskId: "think-1",
      state: "CODING",
      poolPhase: "thinking",
      holderAttempt: "a1",
      statusEvent: { kind: "editing", path: longPath, step: 4, stepEstimate: 8 },
    }),
    makeTask({
      taskId: "wait-1",
      state: "CODING",
      agentId: "A0003",
      title: "receipts",
      poolPhase: "waiting_for_run_slot",
      queuePosition: 2,
      queueBlocker: "verifier running",
      holderAttempt: "a2",
    }),
    makeTask({
      taskId: "run-1",
      state: "CODING",
      agentId: "A0004",
      title: "vitest",
      poolPhase: "running_command",
      runningCommand: "vitest",
      runSlot: 1,
      runSlotCapacity: 2,
      elapsedSeconds: 14,
      holderAttempt: "a3",
    }),
    makeTask({
      taskId: "inbox-1",
      state: "WAITING_INPUT",
      openInboxItemId: "inbox-card-11",
      inboxNeed: "STRIPE_SECRET_KEY",
      inboxBlockedTaskIds: ["T12", "T13"],
      agentId: "A0011",
      title: "checkout",
    }),
    makeTask({
      taskId: "held-1",
      state: "CODING",
      submissionPending: true,
      holds: [
        { reason: "user_paused", source: "user", summary: "paused" },
        { reason: "ambiguous_message", source: "msg", summary: "clarifying cutoff" },
      ],
    }),
    makeTask({
      taskId: "verify-1",
      state: "CLEAN_VERIFY",
      verifyFlow: "Playwright mobile flow",
      retry: 2,
      retryMax: 3,
      hint: 1,
      reviewer: "reviewer@1",
    }),
    makeTask({
      taskId: "merge-1",
      state: "ACCEPTED",
      mergeBehindCount: 1,
      mergeBehindLabel: "F-Menu",
      activity: "project_merge",
    }),
    makeTask({
      taskId: "done-1",
      state: "ACCEPTED",
      acceptedLabel: "13:58",
      spendLabel: "$0.11",
      level: "mid",
    }),
  ];
}

const health: BoardHealthSignalPort = {
  signalsFor(taskId) {
    if (taskId === "held-1") return [{ kind: "stuck_clock", label: "No events for 5 minutes" }];
    return [];
  },
};

describe("board keyboard, actions, contrast, and axe-core", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it("moves with arrow keys and opens the inspector on Enter or click", () => {
    const { view, opened } = createView(
      [
        makeTask({ taskId: "q1", state: "READY", title: "one", agentId: "A0001" }),
        makeTask({ taskId: "q2", state: "READY", title: "two", agentId: "A0002" }),
        makeTask({ taskId: "w1", state: "CODING", title: "print page", agentId: "A0014", holderAttempt: "a" }),
      ],
      { viewportHeightPx: 160, overscanPx: 0 },
    );
    expect(view.snapshot().selectedTaskId).toBe("q1");
    view.handleKeyDown({ key: "ArrowDown" });
    const moved = view.snapshot();
    expect(moved.selectedTaskId).toBe("q2");
    expect(moved.mountedCardIds).toContain("q2");
    view.handleKeyDown({ key: "ArrowRight" });
    expect(view.snapshot().selectedTaskId).toBe("w1");
    view.handleKeyDown({ key: "Enter" });
    expect(opened.at(-1)).toMatchObject({ taskId: "w1", openedBy: "enter", lane: "working", agentTag: "A0014 · print page" });
    expect(view.activateCard("q1", "click")).toBe(true);
    expect(opened.some((item) => item.taskId === "q1" && item.openedBy === "click")).toBe(true);
  });

  it("runs inline quick actions only when they are safe", () => {
    const working = makeTask({ taskId: "w", state: "CODING", holderAttempt: "a" });
    const waiting = makeTask({
      taskId: "inbox",
      state: "WAITING_INPUT",
      openInboxItemId: "inbox-1",
      inboxNeed: "STRIPE_SECRET_KEY",
    });
    const paused = makeTask({
      taskId: "p",
      state: "CODING",
      holds: [{ reason: "user_paused", source: "user", summary: "paused" }],
    });
    const queued = makeTask({ taskId: "q", state: "READY" });
    const { view, performed } = createView([working, waiting, paused, queued]);
    expect(view.performQuickAction("pause_task", "w")).toBe(true);
    expect(view.performQuickAction("pause_task", "q")).toBe(false);
    expect(view.performQuickAction("resume", "p")).toBe(true);
    expect(view.performQuickAction("resume", "w")).toBe(false);
    expect(view.performQuickAction("jump_to_inbox", "inbox")).toBe(true);
    expect(view.performQuickAction("open_diff", "w")).toBe(true);
    expect(view.performQuickAction("i_fixed_it_myself", "w")).toBe(true);
    expect(view.performQuickAction("i_fixed_it_myself", "q")).toBe(true);
    expect(performed.map((item) => `${item.action}:${item.taskId}`)).toEqual([
      "pause_task:w",
      "resume:p",
      "jump_to_inbox:inbox",
      "open_diff:w",
      "i_fixed_it_myself:w",
      "i_fixed_it_myself:q",
    ]);
    expect(performed.find((item) => item.action === "jump_to_inbox")?.inboxItemId).toBe("inbox-1");
  });

  it("keeps light and dark text pairs at WCAG AA contrast", () => {
    for (const theme of Object.values(BOARD_THEMES)) {
      for (const pair of themeContrastPairs(theme)) {
        expect(contrastRatio(pair.foreground, pair.background), `${theme.name} ${pair.name}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
  });

  it("passes axe-core with no violations in light and dark", async () => {
    const tasks = boardTasks();
    const failures: string[] = [];
    for (const theme of ["light", "dark"] as const satisfies readonly BoardThemeName[]) {
      const { view } = createView(tasks, { theme, health, viewportHeightPx: 960, overscanPx: 0 });
      view.toggleDoneCollapsed();
      const html = view.renderHtml();
      expect(html.includes(".../orders/handlers/submitOrderHandler.ts")).toBe(true);
      expect(html.includes("packages/backend/src/features/kitchen/orders/handlers/submitOrderHandler.ts")).toBe(true);
      expect(html.includes('role="toolbar"')).toBe(true);
      expect(html.includes("<ul")).toBe(true);
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: axeSource });
      const violations = await page.evaluate(async () => {
        const runtime = globalThis as unknown as {
          axe: {
            run: (node: Document) => Promise<{
              violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[] }[] }[];
            }>;
          };
        };
        const result = await runtime.axe.run(document);
        return result.violations.map((item) => ({
          id: item.id,
          impact: item.impact,
          help: item.help,
          targets: item.nodes.slice(0, 3).map((node) => node.target.map(String).join(" ")),
        }));
      });
      await page.close();
      if (violations.length > 0) {
        failures.push(`${theme}: ${JSON.stringify(violations)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 30_000);

  it("ignores arrow keys when the board is empty", () => {
    const { view } = createView([]);
    expect(() => view.handleKeyDown({ key: "ArrowDown" })).not.toThrow();
    expect(view.snapshot().selectedTaskId).toBeNull();
    expect(view.snapshot().lanes).toHaveLength(7);
  });
});
