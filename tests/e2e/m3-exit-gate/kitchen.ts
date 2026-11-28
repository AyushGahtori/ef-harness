import fs from "node:fs";
import path from "node:path";
import { secretFindings, secretNeedles, scanTreeForSecrets } from "../m2-exit-gate/audit.js";
import type { HiddenSuiteDoc } from "./types.js";

export { scanTreeForSecrets, secretNeedles };

export function plantNeedle(file: string): void {
  const needle = secretNeedles()[0];
  if (!needle) throw new Error("missing secret needle");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `token ${needle}\n`, "utf8");
}

export function secretHits(text: string): number {
  return secretFindings(text).length;
}

const CHECK_OWNER: Record<string, string> = {
  "H-M2-01": "F-Orders",
  "H-M2-02": "F-Orders",
  "H-M2-03": "F-Orders",
  "H-M2-04": "F-Orders",
  "H-M2-05": "F-Orders",
  "H-M2-06": "F-Orders",
  "H-M2-07": "F-Orders",
  "H-M2-08": "F-Orders",
  "H-M2-09": "F-Orders",
  "H-M2-10": "F-Orders",
  "H-M2-11": "F-Orders",
  "H-M2-12": "F-Orders",
  "H-M2-13": "F-Orders",
  "H-M2-14": "F-Print",
  "H-M2-15": "F-Print",
  "H-M2-16": "F-CateringEmail",
  "H-M2-17": "F-CateringEmail",
  "H-M2-18": "F-CateringEmail",
  "H-M2-19": "F-Menu",
  "H-M2-20": "F-Menu",
  "H-M2-21": "F-CateringEmail",
  "H-M2-22": "F-CateringEmail",
  "H-M2-23": "shell",
  "H-M2-24": "shell",
  "H-M2-25": "shell",
  "H-M2-26": "shell",
  "H-M2-27": "shell",
  "H-M2-28": "shell",
  "H-M2-29": "F-Orders",
};

export function checkOwner(id: string): string {
  return CHECK_OWNER[id] ?? "shell";
}

export function buildWorkerPrompts(opening: string, taskIds: readonly string[], hiddenCount: number): string[] {
  return taskIds.map((taskId) => `${opening}\nTask ${taskId}\nchecks_hidden_count: ${hiddenCount}\n`);
}

export function promptsLeakHidden(prompts: readonly string[], suite: HiddenSuiteDoc): boolean {
  const blob = prompts.join("\n");
  if (blob.includes(suite.canary)) return true;
  return suite.checks.some((check) => blob.includes(check.title));
}
