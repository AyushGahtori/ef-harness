import fs from "node:fs";
import { createRequire } from "node:module";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser } from "playwright";
import { OfficeA11yCoordinator } from "../../src/office/a11y/index.js";
import {
  MemoryAnimationDirector,
  MemoryBoardView,
  MemoryCamera,
  MemoryCenterTabs,
  MemoryFocusMode,
  MemoryInbox,
  MemoryInspector,
  MemoryMediaQuery,
  MemoryPhasePreset,
  MemoryPixiTicker,
  MemoryPressureMachine,
  makeWorker,
} from "./fixtures.js";

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve("axe-core"), "utf8");

function renderMirror(): string {
  const coordinator = new OfficeA11yCoordinator({
    media: new MemoryMediaQuery(),
    director: new MemoryAnimationDirector(),
    phasePreset: new MemoryPhasePreset(),
    pressure: new MemoryPressureMachine(),
    tabs: new MemoryCenterTabs(),
    board: new MemoryBoardView(),
    pixi: new MemoryPixiTicker(),
    focusMode: new MemoryFocusMode(),
    camera: new MemoryCamera(),
    inspector: new MemoryInspector(),
    inbox: new MemoryInbox(),
  });
  coordinator.setWorkers(
    [
      makeWorker({ agentId: "A0014", title: "print page", roomId: "qa-verification-lab" }),
      makeWorker({ agentId: "A0020", title: "merge queue", roomId: "integration-merge-bay" }),
    ],
    1,
  );
  return coordinator.renderMirrorHtml();
}

describe("OfficeSemanticMirrorTree axe-core", () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  }, 30_000);

  it("passes axe-core with zero serious violations", async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html lang="en"><body style="background:#111;color:#eee;font-family:Segoe UI,sans-serif;padding:16px">${renderMirror()}</body></html>`,
    );
    await page.addScriptTag({ content: axeSource });
    const violations = await page.evaluate(async () => {
      const runtime = globalThis as unknown as {
        axe: {
          run: (node: Element) => Promise<{
            violations: { id: string; impact: string | null; help: string }[];
          }>;
        };
      };
      const mirror = document.getElementById("office-semantic-mirror");
      if (!mirror) {
        throw new Error("office-semantic-mirror root missing");
      }
      const result = await runtime.axe.run(mirror);
      return result.violations
        .filter((item) => item.impact === "serious" || item.impact === "critical")
        .map((item) => `${item.id}:${item.impact ?? "unknown"}`);
    });
    expect(violations).toEqual([]);
    await page.close();
  }, 30_000);
});