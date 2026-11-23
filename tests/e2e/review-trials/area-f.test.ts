import { describe, expect, it } from "vitest";
import { AREA_F_EVIDENCE, runAreaF } from "./lib/area-f.js";
import { withTrial } from "./lib/runtime.js";

describe("Area F mid-build steering, holds and calm inbox", () => {
  it("stops without a model and keeps independent hold reasons", async () => {
    const evidence = await withTrial((ctx) => runAreaF(ctx));
    expect([...evidence].sort()).toEqual([...AREA_F_EVIDENCE].sort());
  });
});
