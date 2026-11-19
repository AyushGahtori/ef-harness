import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/test-env", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/test-env");
    expect(layer).toBe(1);
  });
});
