import { expect, it } from "vitest";
import { KernelPackageInstaller, loadSkillManifest, readAllowBuilds, verifySkillPins, verifySignedComponentManifest } from "./ports/supply-chain.ts";

it("pillar 3 — supply-chain & pnpm allowBuilds enforcement", () => {
  const allowBuilds = readAllowBuilds();
  expect(allowBuilds).toContain("esbuild");
  const installer = new KernelPackageInstaller(allowBuilds);
  let ran = false;
  expect(installer.runLifecycle("rogue-pkg", "postinstall", () => { ran = true; })).toBe(false);
  expect(ran).toBe(false);
  const manifest = loadSkillManifest();
  expect(manifest.skills).toHaveLength(20);
  expect(verifySkillPins(manifest)).toBe(true);
  expect(verifySignedComponentManifest()).toBe(true);
});