import { describe, expect, it } from "vitest";
import { AREA_C_EVIDENCE, runAreaC } from "./lib/area-c.js";
import { withTrial } from "./lib/runtime.js";

describe("Area C context slicing, closed 28 tags and pull-to-push", () => {
  it("splits an oversized Must band and keeps sealed oracles out of the packet", async () => {
    const evidence = await withTrial((ctx) => runAreaC(ctx));
    expect([...evidence].sort()).toEqual([...AREA_C_EVIDENCE].sort());
  });
});
