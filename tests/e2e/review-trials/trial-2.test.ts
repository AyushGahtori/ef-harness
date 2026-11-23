import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial2, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 2 blind oracle independence and zero leakage", () => {
  it("denies sealed checks and rejects a vacuous base-green proof", async () => {
    const evidence = await withTrial((ctx) => runTrial2(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[2]].sort());
  });
});
