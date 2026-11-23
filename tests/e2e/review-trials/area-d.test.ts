import { describe, expect, it } from "vitest";
import { AREA_D_EVIDENCE, runAreaD } from "./lib/area-d.js";
import { withTrial } from "./lib/runtime.js";

describe("Area D clean verification, step 3b oracles and anti-gaming", () => {
  it("seals cross-family checks and rejects a vacuous base-green proof", async () => {
    const evidence = await withTrial((ctx) => runAreaD(ctx));
    expect([...evidence].sort()).toEqual([...AREA_D_EVIDENCE].sort());
  });
});
