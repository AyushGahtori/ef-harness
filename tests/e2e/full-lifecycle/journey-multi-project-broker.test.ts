import { describe, expect, it } from "vitest";
import { MULTI_PROJECT_EVIDENCE, runMultiProjectJourney } from "./lib/journey-multi-project.js";
import { withLifecycle } from "./lib/runtime.js";

describe("journey-multi-project-broker", () => {
  it("runs Project A and Project B under one harnessd without port or quota clashes", async () => {
    const evidence = await withLifecycle((ctx) => runMultiProjectJourney(ctx));
    expect([...evidence].sort()).toEqual([...MULTI_PROJECT_EVIDENCE].sort());
  }, 20_000);
});