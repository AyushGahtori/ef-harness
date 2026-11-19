import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/integrator", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/integrator");
    expect(layer).toBe(3);
  });
});
