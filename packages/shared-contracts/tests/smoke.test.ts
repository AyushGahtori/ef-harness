import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_ASSETS,
  canonicalAssetAbsolute,
  layer,
  packageName,
} from "../src/index.js";

describe("@ef-harness/shared-contracts", () => {
  it("publishes a stable package identity", () => {
    expect(packageName).toBe("@ef-harness/shared-contracts");
    expect(layer).toBe(0);
  });

  it("resolves every canonical asset inside this repository", () => {
    for (const key of Object.keys(CANONICAL_ASSETS)) {
      const asset = key as keyof typeof CANONICAL_ASSETS;
      expect(fs.existsSync(canonicalAssetAbsolute(asset))).toBe(true);
    }
  });
});
