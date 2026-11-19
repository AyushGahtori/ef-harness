import { QUEUE_PRIORITIES } from "./constants.mjs";

/**
 * Verifier commands run before worker commands, which run before background.
 * Inside one priority, attempts take turns so one attempt cannot drain the lane.
 */
export function createExecutionQueue() {
  /** @type {Record<string, { attemptId: string, command: unknown, priority: string }[]>} */
  const lanes = { verifier: [], worker: [], background: [] };
  /** @type {Record<string, string | null>} */
  const lastAttempt = { verifier: null, worker: null, background: null };

  return {
    /**
     * @param {"verifier" | "worker" | "background"} priority
     * @param {string} attemptId
     * @param {unknown} command
     */
    enqueue(priority, attemptId, command) {
      if (!QUEUE_PRIORITIES.includes(priority)) {
        throw new Error(`unknown queue priority: ${priority}`);
      }
      const lane = lanes[priority];
      if (!lane) throw new Error(`missing lane ${priority}`);
      lane.push({ attemptId, command, priority });
    },
    dequeue() {
      for (const priority of QUEUE_PRIORITIES) {
        const lane = lanes[priority];
        if (!lane || lane.length === 0) continue;
        const previous = lastAttempt[priority];
        let index = lane.findIndex((item) => item.attemptId !== previous);
        if (index < 0) index = 0;
        const [item] = lane.splice(index, 1);
        if (!item) return null;
        lastAttempt[priority] = item.attemptId;
        return item;
      }
      return null;
    },
    get size() {
      return QUEUE_PRIORITIES.reduce((sum, priority) => sum + (lanes[priority]?.length ?? 0), 0);
    },
  };
}
