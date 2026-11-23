import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial1, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 1 clean-copy verification isolation", () => {
  it("does not let dirty worker files fool the clean verifier", async () => {
    const evidence = await withTrial((ctx) => runTrial1(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[1]].sort());
  });
});
