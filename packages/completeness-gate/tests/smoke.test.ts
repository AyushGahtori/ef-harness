import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/completeness-gate", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/completeness-gate");
    expect(layer).toBe(2);
  });
});
