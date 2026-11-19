import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/mcp-server", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/mcp-server");
    expect(layer).toBe(1);
  });
});
