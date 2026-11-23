import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial4, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 4 supply chain and secret hygiene", () => {
  it("refuses unapproved install scripts and leaves no raw secret bytes", async () => {
    const evidence = await withTrial((ctx) => runTrial4(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[4]].sort());
  });
});
