import { describe, expect, it } from "vitest";
import { CLI_API_EVIDENCE, runCliAndApiJourney } from "./lib/journey-cli-api.js";
import { withLifecycle } from "./lib/runtime.js";

describe("journey-cli-and-api", () => {
  it("passes headless CLI purity and backend API concurrency contracts", async () => {
    const evidence = await withLifecycle((ctx) => runCliAndApiJourney(ctx));
    expect([...evidence].sort()).toEqual([...CLI_API_EVIDENCE].sort());
  }, 20_000);
});