import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/intake", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/intake");
    expect(layer).toBe(2);
  });
});
