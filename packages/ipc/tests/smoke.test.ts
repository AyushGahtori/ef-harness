import { describe, expect, it } from "vitest";
import { layer, packageName } from "../src/index.js";

describe("@ef-harness/ipc", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/ipc");
    expect(layer).toBe(1);
  });
});
