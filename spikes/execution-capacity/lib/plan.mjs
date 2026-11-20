/**
 * @param {{ modes: readonly string[], workerCounts: readonly number[], loads: readonly string[], poolWidth: number }} options
 */
export function buildPlan(options) {
  /** @type {{ isolationMode: string, workerCount: number, load: string, thinkingWidth: number, executingWidth: number }[]} */
  const cells = [];
  for (const isolationMode of options.modes) {
    for (const workerCount of options.workerCounts) {
      for (const load of options.loads) {
        const thinkingWidth = workerCount;
        const executingWidth =
          isolationMode === "own_loop" ? Math.min(options.poolWidth, Math.max(1, workerCount)) : workerCount;
        cells.push({ isolationMode, workerCount, load, thinkingWidth, executingWidth });
      }
    }
  }
  return cells;
}
