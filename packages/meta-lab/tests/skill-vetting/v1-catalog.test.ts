import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TouchesTagSchema } from "@ef-harness/shared-contracts";
import {
  SkillVettingCatalog,
  V1_SKILL_COUNT,
  defaultRepoRoot,
} from "../../src/skill-vetting/index.js";

const parents: string[] = [];

afterEach(() => {
  for (const parent of parents.splice(0)) {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

describe("v1 skill vetting catalog", () => {
  it("validates 20 skills, closed touches tags, and infer-or-ask byte parity", () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "ef-v1-skills-"));
    parents.push(parent);
    const result = new SkillVettingCatalog(defaultRepoRoot()).validate(parent);
    expect(V1_SKILL_COUNT).toBe(20);
    expect(result.skills).toHaveLength(20);
    expect(result.skills.slice(0, 6)).toEqual([
      "infer-or-ask",
      "systematic-debugging",
      "test-driven-verification",
      "frontend-accessibility-ui",
      "sql-migrations-safety",
      "api-security-hardening",
    ]);
    expect(result.skills).toContain("browser-extension-mv3");
    expect(result.skills).toContain("desktop-electron-ipc-security");
    expect(result.skills).toContain("stripe-billing-webhooks");
    for (const skillId of result.skills) {
      const tokens = result.tokenCounts[skillId];
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThanOrEqual(2000);
    }
    const manifest = JSON.parse(
      fs.readFileSync(path.join(defaultRepoRoot(), "corpus", "skills", "manifest.json"), "utf8"),
    ) as { skills: { skillId: string; allowedTouches: string[] }[] };
    expect(manifest.skills).toHaveLength(20);
    for (const entry of manifest.skills) {
      expect(entry.allowedTouches.length).toBeGreaterThan(0);
      for (const tag of entry.allowedTouches) {
        expect(TouchesTagSchema.safeParse(tag).success).toBe(true);
      }
    }
    const bundled = fs.readFileSync(
      path.join(defaultRepoRoot(), "corpus", "skills", "m2", "infer-or-ask", "SKILL.md"),
    );
    const canonical = fs.readFileSync(path.join(defaultRepoRoot(), "skills", "infer-or-ask", "SKILL.md"));
    expect(bundled.equals(canonical)).toBe(true);
  });
});
