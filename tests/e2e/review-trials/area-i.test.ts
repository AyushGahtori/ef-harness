import { describe, expect, it } from "vitest";
import { AREA_I_EVIDENCE, runAreaI } from "./lib/area-i.js";
import { withTrial } from "./lib/runtime.js";

describe("Area I interactive UX, brownfield and editor coexistence", () => {
  it("rescues windows, pins drags, and lands without a silent stash", async () => {
    const evidence = await withTrial((ctx) => runAreaI(ctx));
    expect([...evidence].sort()).toEqual([...AREA_I_EVIDENCE].sort());
  });
});
