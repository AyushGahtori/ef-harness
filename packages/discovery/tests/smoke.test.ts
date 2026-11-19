import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/discovery", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/discovery");
    expect(layer).toBe(2);
  });
});
