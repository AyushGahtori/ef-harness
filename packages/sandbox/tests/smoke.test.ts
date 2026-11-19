import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/sandbox", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/sandbox");
    expect(layer).toBe(1);
  });
});
