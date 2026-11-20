import { MIXED_LOAD_SEED, QUEUE_PRIORITIES } from "./constants.mjs";
import { createPrng } from "./prng.mjs";

/**
 * Fixed schedule so mixed runs compare the same command pattern across machines.
 * Thinking delay and execution choice stay on separate fields.
 * @param {number} thinkingWidth
 * @param {number} [seed]
 */
export function mixedSchedule(thinkingWidth, seed = MIXED_LOAD_SEED) {
  const rng = createPrng(seed);
  const steps = [];
  for (let worker = 0; worker < thinkingWidth; worker += 1) {
    const roll = rng.next();
    const priority = roll < 0.25 ? "verifier" : roll < 0.8 ? "worker" : "background";
    if (!QUEUE_PRIORITIES.includes(priority)) {
      throw new Error(`schedule produced an unknown priority: ${priority}`);
    }
    steps.push({
      worker,
      thinkMs: rng.int(30, 90),
      runActive: rng.next() >= 0.45,
      priority,
    });
  }
  return steps;
}
