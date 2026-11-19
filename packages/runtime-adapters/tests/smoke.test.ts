import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/runtime-adapters", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/runtime-adapters");
    expect(layer).toBe(3);
  });
});
