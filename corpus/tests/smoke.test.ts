import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/corpus", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/corpus");
    expect(layer).toBe(5);
  });
});
