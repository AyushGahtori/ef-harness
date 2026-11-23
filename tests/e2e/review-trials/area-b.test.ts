import { describe, expect, it } from "vitest";
import { AREA_B_EVIDENCE, runAreaB } from "./lib/area-b.js";
import { withTrial } from "./lib/runtime.js";

describe("Area B honest discovery, exact-quote grounding and acyclic entailment", () => {
  it("keeps missing recipients and offline or native choices open", async () => {
    const evidence = await withTrial((ctx) => runAreaB(ctx));
    expect([...evidence].sort()).toEqual([...AREA_B_EVIDENCE].sort());
  });
});
