import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultRepoRoot,
  verifyPinnedCatalog,
} from "../../src/skill-vetting/index.js";

const parents: string[] = [];

afterEach(() => {
  for (const parent of parents.splice(0)) {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

describe("M2 skill catalog", () => {
  it("passes hash, vetting, token, license, parity, and quarantine gates", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-skill-catalog-"));
    parents.push(parent);
    const result = verifyPinnedCatalog(defaultRepoRoot(), parent);
    expect(result.skills).toEqual([
      "infer-or-ask",
      "systematic-debugging",
      "test-driven-verification",
      "frontend-accessibility-ui",
      "sql-migrations-safety",
      "api-security-hardening",
    ]);
    for (const skillId of result.skills) {
      const tokens = result.tokenCounts[skillId];
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(2000);
    }
  });

  it("verifies offline when fetch is disabled", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-skill-offline-"));
    parents.push(parent);
    const previous = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network disabled");
    };
    try {
      expect(verifyPinnedCatalog(defaultRepoRoot(), parent).skills).toHaveLength(6);
    } finally {
      globalThis.fetch = previous;
    }
  });
});
