import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./git-util.ts";
import type { CheckResult } from "./types.ts";

function check(
  id: string,
  pass: boolean,
  evidenceClass: CheckResult["evidenceClass"],
  observed: string,
  expected: string,
): CheckResult {
  return { id, verdict: pass ? "PASS" : "FAIL", evidenceClass, observed, expected };
}

export function runFoundationChecks(repoRoot: string, inject: readonly string[]): CheckResult[] {
  const schema = runCommand(process.execPath, ["schema/schema-test.js"], repoRoot);
  const schemaOutput = `${schema.stdout}\n${schema.stderr}`;
  const schemaPass = schema.status === 0 && /67\/67 passed/.test(schemaOutput);
  const diagrams = runCommand(process.execPath, ["scripts/verify-diagrams.mjs"], repoRoot);
  const diagramPass = diagrams.status === 0 && !inject.includes("stale-diagram");
  const secretPass = scanOwnedTree(repoRoot);
  return [
    check(
      "schema-test-67",
      schemaPass,
      "executed-foundation",
      schemaPass ? "67/67 passed" : "schema test failed",
      "67/67 passed",
    ),
    check(
      "diagram-integrity",
      diagramPass,
      inject.includes("stale-diagram") ? "local-port-fixture" : "executed-foundation",
      diagramPass ? "diagrams ok" : "stale diagram injected or diagram check failed",
      "diagram integrity passes",
    ),
    check(
      "owned-tree-secret-scan",
      secretPass,
      "executed-local",
      secretPass ? "0 secret markers" : "secret marker found",
      "0 secret markers in task 200 files",
    ),
  ];
}

function scanOwnedTree(repoRoot: string): boolean {
  const needles = [
    ["sk", "_live_"].join(""),
    ["sk-ant", "-"].join(""),
    ["sk-proj", "-"].join(""),
    ["ghp", "_"].join(""),
    ["AK", "IA"].join(""),
    ["BEGIN ", "PRIVATE KEY"].join(""),
    ["anti", "gravity"].join(""),
    ["setup-", "token"].join(""),
    ["~/", ".gemini"].join(""),
  ];
  const roots = [path.join(repoRoot, "benchmarks", "m6-release"), path.join(repoRoot, "tests", "e2e", "m6-exit-gate")];
  for (const root of roots) {
    if (!walkClean(root, needles)) return false;
  }
  return true;
}

function walkClean(dir: string, needles: readonly string[]): boolean {
  if (!fs.existsSync(dir)) return true;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!walkClean(full, needles)) return false;
      continue;
    }
    if (!entry.isFile() || entry.name === "node_modules") continue;
    const text = fs.readFileSync(full, "utf8");
    if (needles.some((needle) => text.includes(needle))) return false;
  }
  return true;
}
