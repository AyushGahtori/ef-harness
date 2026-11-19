import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/git-engine", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/git-engine");
    expect(layer).toBe(1);
  });
});
