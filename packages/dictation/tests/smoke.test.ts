import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/dictation", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/dictation");
    expect(layer).toBe(2);
  });
});
