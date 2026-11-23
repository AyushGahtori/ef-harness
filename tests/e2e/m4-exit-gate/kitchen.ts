import fs from "node:fs";
import path from "node:path";
import { plansDir } from "./paths.ts";
import type { ChatGptPlusProfile, HiddenSuitePort, KitchenTask, M4Fixtures } from "./types.ts";

export function loadM4Fixtures(): M4Fixtures {
  const root = plansDir();
  const profile = readJson<ChatGptPlusProfile>(path.join(root, "chatgpt-plus-profile.json"));
  const tasksFile = readJson<{ tasks: KitchenTask[] }>(path.join(root, "kitchen-tasks.json"));
  const suite = readJson<HiddenSuitePort>(path.join(root, "hidden-suite.port.json"));
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
    if (!leakCanary) return base;
    return `${base}${this.suite.canary}\n${this.suite.checks.map((check) => check.title).join("\n")}\n`;
  }

  promptsLeak(prompts: readonly string[]): boolean {
    return prompts.some(
      (prompt) => prompt.includes(this.suite.canary) || this.suite.checks.some((check) => prompt.includes(check.title)),
    );
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}
