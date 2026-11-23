import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fixturesDir, repoRoot } from "../paths.ts";

/** Local ports for Task 048 KernelPackageInstaller and Task 078 skill vetting. */

export interface SkillPin {
  readonly id: string;
  readonly path: string;
  readonly sha256: string;
  readonly tokens: number;
}

export class KernelPackageInstaller {
  constructor(private readonly allowBuilds: readonly string[]) {}

  runLifecycle(packageName: string, scriptName: string, exec: () => void): boolean {
    const lifecycle = scriptName === "postinstall" || scriptName === "preinstall" || scriptName === "install";
    if (lifecycle && !this.allowBuilds.includes(packageName)) return false;
    exec();
    return true;
  }
}

export function readAllowBuilds(): readonly string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot(), "package.json"), "utf8")) as {
    pnpm?: { onlyBuiltDependencies?: string[] };
  };
  return pkg.pnpm?.onlyBuiltDependencies ?? [];
}

export function loadSkillManifest(): { readonly skills: readonly SkillPin[] } {
  const manifest = path.join(fixturesDir(), "skills-manifest.json");
  return JSON.parse(fs.readFileSync(manifest, "utf8")) as { skills: SkillPin[] };
}

export function verifySkillPins(manifest: { readonly skills: readonly SkillPin[] }, drift?: boolean): boolean {
  for (const skill of manifest.skills) {
    const full = path.join(repoRoot(), skill.path);
    if (!fs.existsSync(full)) return false;
    const text = fs.readFileSync(full, "utf8");
    const hash = createHash("sha256").update(text).digest("hex");
    const expected = drift ? "0000000000000000000000000000000000000000000000000000000000000000" : skill.sha256;
    if (hash !== expected) return false;
    if (skill.tokens > 2000) return false;
    if (/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/.test(text)) return false;
  }
  return manifest.skills.length === 20;
}

export function verifySignedComponentManifest(): boolean {
  const manifestPath = path.join(fixturesDir(), "component-manifest.json");
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    entries: { name: string; version: string; ed25519: string }[];
  };
  return raw.entries.every((row) => row.version !== "latest" && /^[a-f0-9]{64}$/.test(row.ed25519));
}