import { describe, expect, it } from "vitest";
import { AREA_H_EVIDENCE, runAreaH } from "./lib/area-h.js";
import { withTrial } from "./lib/runtime.js";

describe("Area H provider plans, terms and conformance", () => {
  it("keeps console-only Claude, Gemini off, and paid fallback explicit", async () => {
    const evidence = await withTrial((ctx) => runAreaH(ctx));
    expect([...evidence].sort()).toEqual([...AREA_H_EVIDENCE].sort());
  });
});
