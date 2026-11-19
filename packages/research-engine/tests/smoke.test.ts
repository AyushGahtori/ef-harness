import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/research-engine", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/research-engine");
    expect(layer).toBe(2);
  });
});
