import { describe, expect, it } from "vitest";
import { AREA_J_EVIDENCE, runAreaJ } from "./lib/area-j.js";
import { withTrial } from "./lib/runtime.js";

describe("Area J ship safety, investigations and portability", () => {
  it("reconciles unknown effects and fences the public harness-state export", async () => {
    const evidence = await withTrial((ctx) => runAreaJ(ctx));
    expect([...evidence].sort()).toEqual([...AREA_J_EVIDENCE].sort());
  });
});
