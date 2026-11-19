import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/verifier", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/verifier");
    expect(layer).toBe(2);
  });
});
