import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/spikes", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/spikes");
    expect(layer).toBe(5);
  });
});
