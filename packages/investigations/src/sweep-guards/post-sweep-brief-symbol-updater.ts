import type { QueuedTaskRecord, SweepSymbolMapEntry } from "./types.js";

const MAX_SYMBOL_MAP_HEADER_TOKENS = 300;

function approximateTokenCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function rewriteScopePath(path: string, pathMappings: Readonly<Record<string, string>>): string {
  for (const [oldPath, newPath] of Object.entries(pathMappings)) {
    if (path === oldPath || path.startsWith(`${oldPath}/`)) {
      return path.replace(oldPath, newPath);
    }
  }
  return path;
}

export class PostSweepBriefSymbolUpdater {
  private readonly symbolMaps = new Map<string, SweepSymbolMapEntry>();

  persistSymbolMap(entry: SweepSymbolMapEntry): void {
    this.symbolMaps.set(entry.sweepId, entry);
  }

  getSymbolMap(sweepId: string): SweepSymbolMapEntry | undefined {
    return this.symbolMaps.get(sweepId);
  }

  buildCompactHeader(entry: SweepSymbolMapEntry): string {
    const lines = [
      "[RECENT SWEEP SYMBOL MAP]",
      `sweepId: ${entry.sweepId}`,
      "pathMappings:",
      ...Object.entries(entry.pathMappings).map(([k, v]) => `  ${k} → ${v}`),
      "symbolMappings:",
      ...Object.entries(entry.symbolMappings).map(([k, v]) => `  ${k} → ${v}`),
    ];
    if (entry.persistedExclusions.length > 0) {
      lines.push(`persistedExclusions: ${entry.persistedExclusions.join(", ")}`);
    }
    let header = lines.join("\n");
    while (approximateTokenCount(header) > MAX_SYMBOL_MAP_HEADER_TOKENS && lines.length > 3) {
      lines.pop();
      header = `${lines.join("\n")}\n…`;
    }
    return header;
  }

  updateQueuedTasks(
    tasks: readonly QueuedTaskRecord[],
    entry: SweepSymbolMapEntry,
  ): { updated: QueuedTaskRecord[]; count: number } {
    const header = this.buildCompactHeader(entry);
    let count = 0;
    const updated = tasks.map((task) => {
      if (task.status !== "queued" && task.status !== "paused") {
        return task;
      }
      const newScope = task.writeScope.map((p) => rewriteScopePath(p, entry.pathMappings));
      const scopeChanged = newScope.some((p, i) => p !== task.writeScope[i]);
      const briefNeedsHeader = !task.compiledBrief.includes("[RECENT SWEEP SYMBOL MAP]");
      if (!scopeChanged && !briefNeedsHeader) {
        return task;
      }
      count += 1;
      const brief = briefNeedsHeader ? `${header}\n\n${task.compiledBrief}` : task.compiledBrief;
      return { ...task, writeScope: newScope, compiledBrief: brief };
    });
    return { updated, count };
  }
}

export { MAX_SYMBOL_MAP_HEADER_TOKENS };