import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/daemon", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/daemon");
    expect(layer).toBe(5);
  });
});
