import { describe, expect, it } from "vitest";
import { withTrial } from "./lib/runtime.js";
import { runTrial5, TRIAL_EVIDENCE } from "./lib/trials.js";

describe("Trial 5 real-app multi-surface behavior", () => {
  it("rejects client-only validation and checks the live API, SQLite, and mail", async () => {
    const evidence = await withTrial((ctx) => runTrial5(ctx));
    expect([...evidence].sort()).toEqual([...TRIAL_EVIDENCE[5]].sort());
  }, 20_000);
});
