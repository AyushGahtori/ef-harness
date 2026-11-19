import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/sim", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/sim");
    expect(layer).toBe(1);
  });
});
