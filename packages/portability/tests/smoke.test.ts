import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/portability", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/portability");
    expect(layer).toBe(4);
  });
});
