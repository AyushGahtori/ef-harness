import fs from "node:fs/promises";
import path from "node:path";

import type { GitleaksPort, SecretFinding } from "./ports.js";
import { assertInsideRoot } from "./scope.js";

function secretPatterns(): RegExp[] {
  const needles = [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
  ];
  return needles.map((needle) => new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

function liveAssignment(line: string): boolean {
  const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
  if (!match) return false;
  const name = match[1] ?? "";
  const value = (match[2] ?? "").trim();
  if (!/(KEY|TOKEN|SECRET|PASSWORD)/.test(name)) return false;
  if (value.length < 12) return false;
  if (/^(changeme|example|placeholder)$/i.test(value)) return false;
  if (value.startsWith("<") && value.endsWith(">")) return false;
  return true;
}

/** Local `Task 036` scanner. `.env.example` is the only env file allowed in git. */
export class LocalGitleaksScanner implements GitleaksPort {
  async scan(repoPath: string, trackedFiles: readonly string[]): Promise<readonly SecretFinding[]> {
    const findings: SecretFinding[] = [];
    const patterns = secretPatterns();
    for (const rel of trackedFiles) {
      const base = path.posix.basename(rel.replaceAll("\\", "/"));
      if (base === ".env.example") continue;
      if (base === ".env" || (base.startsWith(".env.") && base !== ".env.example")) {
        findings.push({ path: rel, reason: "committed env file" });
      }
      let text = "";
      try {
        text = await fs.readFile(assertInsideRoot(repoPath, rel), "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        findings.push({ path: rel, reason: message });
        continue;
      }
      if (patterns.some((pattern) => pattern.test(text)) || text.split(/\r?\n/).some((line) => liveAssignment(line))) {
        findings.push({ path: rel, reason: "live-shaped secret" });
      }
    }
    return findings;
  }
}
