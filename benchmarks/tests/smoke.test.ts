import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/benchmarks", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/benchmarks");
    expect(layer).toBe(5);
  });
});
