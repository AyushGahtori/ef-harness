import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial3, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 3 Windows sandbox and proxy escape resistance", () => {
  it("blocks worktree escapes, foreign hosts, and leftover grandchildren", async () => {
    const evidence = await withTrial((ctx) => runTrial3(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[3]].sort());
  }, 20_000);
});
