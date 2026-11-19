import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/spec-expansion", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/spec-expansion");
    expect(layer).toBe(2);
  });
});
