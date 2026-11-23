import { describe, expect, it } from "vitest";
import { GREENFIELD_EVIDENCE, runGreenfieldJourney } from "./lib/journey-greenfield.js";
import { withLifecycle } from "./lib/runtime.js";

describe("journey-greenfield-full", () => {
  it("drives M2→M6 with <=20% paperwork, 0 silent stashes, and post-deploy smoke", async () => {
    const result = await withLifecycle((ctx) => runGreenfieldJourney(ctx));
    expect([...result.evidence].sort()).toEqual([...GREENFIELD_EVIDENCE].sort());
    expect(result.paperworkPct).toBeLessThanOrEqual(20);
    expect(result.silentStashes).toBe(0);
    expect(result.milestones).toContain("M6");
  }, 30_000);
});