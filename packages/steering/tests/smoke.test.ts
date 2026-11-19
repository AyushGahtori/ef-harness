import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/steering", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/steering");
    expect(layer).toBe(3);
  });
});
