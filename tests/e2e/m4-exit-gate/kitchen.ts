import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LookAndFeelInterviewFlow } from "@ef-harness/planner";
import { escapeText } from "@ef-harness/renderer";
import {
  renderKitchenPages,
  renderKitchenServer,
  renderOrdersUiFiles,
  renderPhase0Files,
} from "../m2-exit-gate/kitchen-codegen.js";
import { KitchenHiddenAcceptanceSuite as Task105HiddenSuite } from "../m2-exit-gate/hidden-suite.js";
import { plansDir, repoRoot } from "./paths.js";
import type { ChatGptPlusProfile, HiddenSuitePort, KitchenTask, M4Fixtures } from "./types.js";

export function loadM4Fixtures(): M4Fixtures {
  const root = plansDir();
  const profile = readJson<ChatGptPlusProfile>(path.join(root, "chatgpt-plus-profile.json"));
  const tasksFile = readJson<{ tasks: KitchenTask[] }>(path.join(root, "kitchen-tasks.json"));
  const suite = readJson<HiddenSuitePort>(
    path.join(repoRoot(), "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json"),
  );
  const opening = fs.readFileSync(path.join(root, "opening-spec.txt"), "utf8").trim();
  if (profile.reserveFraction !== 0.2 || profile.startCwnd !== 2) {
    throw new Error("ChatGPT Plus profile must keep a 20% personal reserve and start at cwnd 2.");
  }
  if (tasksFile.tasks.length < 7) throw new Error("Kitchen build needs at least 7 tasks so minute 60 lands mid-run.");
  if (suite.checks.length !== 29) throw new Error("Hidden suite port must carry the 29 Task 105 checks.");
  if (opening.includes(suite.canary)) throw new Error("Opening spec leaked the hidden canary.");
  return { profile, tasks: tasksFile.tasks, opening, suite };
}

export class KitchenHiddenAcceptanceSuite {
  constructor(private readonly suite: HiddenSuitePort) {}

  score(failIds: readonly string[]): { readonly passed: number; readonly total: number; readonly rate: number } {
    const failed = new Set(failIds);
    const passed = this.suite.checks.filter((check) => !failed.has(check.id)).length;
    const total = this.suite.checks.length;
    return { passed, total, rate: total === 0 ? 0 : passed / total };
  }

  buildPrompt(opening: string, taskId: string, leakCanary: boolean): string {
    const base = `${opening}\nTask ${taskId}\nchecks_hidden_count: ${this.suite.checks.length}\n`;
    const visible = escapeText(base);
    if (!leakCanary) return visible;
    return `${visible}${this.suite.canary}\n${this.suite.checks.map((check) => check.title).join("\n")}\n`;
  }

  promptsLeak(prompts: readonly string[]): boolean {
    return prompts.some(
      (prompt) => prompt.includes(this.suite.canary) || this.suite.checks.some((check) => prompt.includes(check.title)),
    );
  }
}

let offlinePromise: Promise<readonly string[]> | null = null;

export function offlineHiddenFailures(): Promise<readonly string[]> {
  offlinePromise ??= measureOfflineHidden();
  return offlinePromise;
}

async function measureOfflineHidden(): Promise<readonly string[]> {
  const catalogPath = path.join(repoRoot(), "benchmarks", "m2-kitchen-e2e", "hidden", "acceptance-suite.json");
  const lookAndFeel = new LookAndFeelInterviewFlow().capture({
    mood: "neutral",
    density: "balanced",
    theme: "light",
    primary: "#0B3F8F",
  });
  const spec = {
    cutoffMinutes: 11 * 60,
    cutoffLabel: "11:00 AM",
    dietaryEnabled: true,
    timezoneOffsetHours: -5,
    lookAndFeel,
  };
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "m4-kitchen-"));
  const files = {
    ...renderPhase0Files(spec),
    ...renderOrdersUiFiles(spec),
    ...renderKitchenPages(),
    ...renderKitchenServer(spec),
  };
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(repoDir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  const outcome = await new Task105HiddenSuite().run(
    {
      origin: "http://127.0.0.1:1",
      dbPath: catalogPath,
      mailpitUrl: "http://127.0.0.1:1",
      repoDir,
      axeSource: "",
      catalogPath,
      timeoutMs: 1_000,
    },
    ["H-M2-26", "H-M2-28"],
  );
  return outcome.checks.filter((check) => !check.pass).map((check) => check.id);
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
