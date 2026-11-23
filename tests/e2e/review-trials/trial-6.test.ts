import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial6, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 6 crash, hold and rollback resilience", () => {
  it("keeps harness/integration green and rolls the dirty slot back", async () => {
    const evidence = await withTrial((ctx) => runTrial6(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[6]].sort());
  });
});
