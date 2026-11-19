import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/e2e", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/e2e");
    expect(layer).toBe(5);
  });
});
