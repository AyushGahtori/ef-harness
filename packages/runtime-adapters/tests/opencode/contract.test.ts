import { describe, expect, it } from "vitest";
import { assertAgentRuntimeAdapter } from "../../src/core/interface.js";
import { OpenCodeRuntimeAdapter } from "../../src/opencode/runtime-adapter.js";

describe("OpenCodeRuntimeAdapter contract", () => {
  it("passes assertAgentRuntimeAdapter", () => {
    const adapter = new OpenCodeRuntimeAdapter();
    assertAgentRuntimeAdapter(adapter);
    expect(adapter.runtime).toBe("opencode");
  });
});
