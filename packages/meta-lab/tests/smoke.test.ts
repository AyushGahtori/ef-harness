import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/meta-lab", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/meta-lab");
    expect(layer).toBe(4);
  });
});
