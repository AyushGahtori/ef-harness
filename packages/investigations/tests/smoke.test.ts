import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/investigations", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/investigations");
    expect(layer).toBe(4);
  });
});
