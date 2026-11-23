import { describe, expect, it } from "vitest";
import { AREA_A_EVIDENCE, runAreaA } from "./lib/area-a.js";
import { withTrial } from "./lib/runtime.js";

describe("Area A storage, single-writer SQLite and crash safety", () => {
  it("rejects ATTACH, blocks a second writer, and recovers in four steps", async () => {
    const evidence = await withTrial((ctx) => runAreaA(ctx));
    expect([...evidence].sort()).toEqual([...AREA_A_EVIDENCE].sort());
  }, 20_000);
});
