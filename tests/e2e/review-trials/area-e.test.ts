import { describe, expect, it } from "vitest";
import { AREA_E_EVIDENCE, runAreaE } from "./lib/area-e.js";
import { withTrial } from "./lib/runtime.js";

describe("Area E parallel feature isolation, merge queue and CCR", () => {
  it("lands a no-ff queue with EF trailers, CAS refs, and bisection", async () => {
    const evidence = await withTrial((ctx) => runAreaE(ctx));
    expect([...evidence].sort()).toEqual([...AREA_E_EVIDENCE].sort());
  });
});
