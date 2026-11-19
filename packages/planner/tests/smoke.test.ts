import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/planner", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/planner");
    expect(layer).toBe(3);
  });
});
