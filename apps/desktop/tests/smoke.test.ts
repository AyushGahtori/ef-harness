import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/desktop", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/desktop");
    expect(layer).toBe(5);
  });
});
