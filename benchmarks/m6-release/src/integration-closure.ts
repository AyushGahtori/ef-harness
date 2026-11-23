import fs from "node:fs";
import path from "node:path";
import { git } from "./git-util.ts";
import type { IntegrationSwap } from "./types.ts";

export interface IntegrationScan {
  readonly branch: string;
  readonly gitCommit: string;
  readonly swaps: readonly IntegrationSwap[];
  readonly swapCount: number;
  readonly handoffPresentCount: number;
  readonly unaccounted: readonly string[];
  readonly conflicts: readonly string[];
}

const CONFLICT = /^(<{7}|={7}|>{7})/m;

export function loadExportsByTask(tasksMarkdown: string): Map<string, string[]> {
  const exportsByTask = new Map<string, string[]>();
  for (let number = 1; number <= 200; number += 1) {
    exportsByTask.set(String(number).padStart(3, "0"), []);
  }
  for (const line of tasksMarkdown.split(/\r?\n/)) {
    const marker = /in `\.agent-handoffs\/task-(\d{3})\.md`/.exec(line);
    const task = marker?.[1];
    const exportAt = line.lastIndexOf("Export `");
    if (!task || exportAt < 0) continue;
    const portion = line.slice(exportAt);
    const names = [...portion.matchAll(/`([^`]+)`/g)]
      .map((match) => match[1] ?? "")
      .filter((name) => name.length > 0 && !name.includes("agent-handoffs") && !/^Task \d/.test(name));
    const existing = exportsByTask.get(task) ?? [];
    for (const name of names) {
      if (!existing.includes(name)) existing.push(name);
    }
    exportsByTask.set(task, existing);
  }
  return exportsByTask;
}

export function scanIntegration(repoRoot: string, inject: readonly string[]): IntegrationScan {
  const tasksPath = path.join(repoRoot, "IMPLEMENTATION_TASKS.md");
  const exportsByTask = loadExportsByTask(fs.readFileSync(tasksPath, "utf8"));
  const swaps: IntegrationSwap[] = [];
  const unaccounted: string[] = [];
  const conflicts: string[] = [];
  for (let number = 1; number <= 200; number += 1) {
    const task = String(number).padStart(3, "0");
    const exportsForTask = exportsByTask.get(task) ?? [];
    const handoff = path.join(repoRoot, ".agent-handoffs", `task-${task}.md`);
    const present = fs.existsSync(handoff);
    const text = present ? fs.readFileSync(handoff, "utf8") : "";
    const conflicted = CONFLICT.test(text);
    let disposition: IntegrationSwap["disposition"] = "local-port-swap";
    if (inject.includes("unwired-147") && task === "147") {
      disposition = "unaccounted";
    } else if (conflicted) {
      disposition = "conflict";
    } else if (present) {
      disposition = "handoff-present";
    }
    if (disposition === "unaccounted") unaccounted.push(task);
    if (disposition === "conflict") conflicts.push(task);
    swaps.push({
      task,
      disposition,
      port: disposition === "local-port-swap" ? `local-port:task-${task}` : "",
      exports: exportsForTask,
    });
  }
  return {
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot).trim(),
    gitCommit: git(["rev-parse", "HEAD"], repoRoot).trim(),
    swaps,
    swapCount: swaps.filter((swap) => swap.disposition === "local-port-swap").length,
    handoffPresentCount: swaps.filter((swap) => swap.disposition === "handoff-present").length,
    unaccounted,
    conflicts,
  };
}
