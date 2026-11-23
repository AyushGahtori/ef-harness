import { describe, expect, it } from "vitest";
import { AREA_G_EVIDENCE, runAreaG } from "./lib/area-g.js";
import { withTrial } from "./lib/runtime.js";

describe("Area G Windows sandbox, supply chain and secrets", () => {
  it("blocks escapes, unapproved builds, and raw secret bytes", async () => {
    const evidence = await withTrial((ctx) => runAreaG(ctx));
    expect([...evidence].sort()).toEqual([...AREA_G_EVIDENCE].sort());
  }, 20_000);
});
