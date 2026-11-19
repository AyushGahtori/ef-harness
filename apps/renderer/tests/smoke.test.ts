import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/renderer", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/renderer");
    expect(layer).toBe(5);
  });
});
