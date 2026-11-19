import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/providers", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/providers");
    expect(layer).toBe(3);
  });
});
