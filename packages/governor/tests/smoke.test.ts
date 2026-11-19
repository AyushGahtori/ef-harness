import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/governor", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/governor");
    expect(layer).toBe(3);
  });
});
