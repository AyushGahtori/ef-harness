import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/ship-deploy", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/ship-deploy");
    expect(layer).toBe(4);
  });
});
