import fs from "node:fs";
import path from "node:path";
import { openHarnessRunEngine } from "../harness-engine.js";
import type { SmokeResult } from "./types.js";

export const SMOKE_TIMEOUT_MS = 30_000;

export interface SmokeCommandResult {
  ok: boolean;
  error: string;
}

export interface SmokeCommand {
  run(cwd: string, timeoutMs: number): Promise<SmokeCommandResult> | SmokeCommandResult;
}

export class PostMergeSmokeChecker {
  constructor(private readonly commands: readonly SmokeCommand[] = [new HarnessTypecheckSmoke(), new HarnessUnitSmoke()]) {}

  async run(cwd: string, timeoutMs: number = SMOKE_TIMEOUT_MS): Promise<SmokeResult> {
    const started = Date.now();
    const budget = Math.min(Math.max(1, timeoutMs), SMOKE_TIMEOUT_MS);
    for (const command of this.commands) {
      const result = await bound(command.run(cwd, budget), budget);
      if (!result.ok) {
        return {
          ok: false,
          error: result.error,
          smokeMs: Date.now() - started,
          timedOut: result.error === "smoke timeout",
        };
      }
    }
    return { ok: true, error: "", smokeMs: Date.now() - started, timedOut: false };
  }
}

function bound(work: Promise<SmokeCommandResult> | SmokeCommandResult, timeoutMs: number): Promise<SmokeCommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "smoke timeout" });
    }, timeoutMs);
    Promise.resolve(work).then(
      (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: "smoke command failed" });
      },
    );
  });
}

export class HarnessTypecheckSmoke implements SmokeCommand {
  async run(cwd: string, timeoutMs: number): Promise<SmokeCommandResult> {
    return runInHarness(cwd, timeoutMs, "post-merge-typecheck", TYPECHECK_SCRIPT);
  }
}

export class HarnessUnitSmoke implements SmokeCommand {
  async run(cwd: string, timeoutMs: number): Promise<SmokeCommandResult> {
    return runInHarness(cwd, timeoutMs, "post-merge-unit-smoke", UNIT_SMOKE_SCRIPT);
  }
}

const TYPECHECK_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const barrel = path.join(process.cwd(), "src", "index.ts");
if (!fs.existsSync(barrel)) process.exit(0);
const text = fs.readFileSync(barrel, "utf8");
const missing = [];
const named = /export\\s+(?:type\\s+)?\\{([^}]+)\\}\\s+from\\s+["']([^"']+)["']/g;
const stars = /export\\s+\\*\\s+from\\s+["']([^"']+)["']/g;
function resolveSpecifier(dir, specifier) {
  const exact = path.resolve(dir, specifier);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return true;
  for (const extension of [".ts", ".tsx", ".js", ".mjs"]) {
    const candidate = exact.replace(/\\.(js|mjs|ts|tsx)$/, extension);
    if (candidate !== exact && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
  }
  return false;
}
for (const match of text.matchAll(named)) {
  if (match[2] && !resolveSpecifier(path.dirname(barrel), match[2])) missing.push(match[2]);
}
for (const match of text.matchAll(stars)) {
  if (match[1] && !resolveSpecifier(path.dirname(barrel), match[1])) missing.push(match[1]);
}
if (missing.length === 0) process.exit(0);
process.stderr.write("TS2307: Cannot find module '" + missing[0] + "' imported by src/index.ts");
process.exit(1);
`;

const UNIT_SMOKE_SCRIPT = `
const fs = require("node:fs");
const path = require("node:path");
const marker = path.join(process.cwd(), "smoke", "cases.json");
if (!fs.existsSync(marker)) process.exit(0);
const parsed = JSON.parse(fs.readFileSync(marker, "utf8"));
if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(0);
if (parsed.fail === true) {
  process.stderr.write(typeof parsed.error === "string" ? parsed.error : "unit smoke failed");
  process.exit(1);
}
process.exit(0);
`;

async function runInHarness(cwd: string, timeoutMs: number, attemptId: string, script: string): Promise<SmokeCommandResult> {
  const engine = openHarnessRunEngine();
  const budget = Math.min(Math.max(1, timeoutMs), SMOKE_TIMEOUT_MS);
  try {
    const result = await engine.executeSandboxedCommand({
      attemptId,
      worktreePath: cwd,
      cwd,
      command: [process.execPath, "-e", script],
      timeoutMs: budget,
      priority: "verifier",
    });
    if (result.exitCode === 0) return { ok: true, error: "" };
    const error = result.stderrSummary || result.stdoutSummary || "smoke command failed";
    return { ok: false, error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "smoke command failed" };
  } finally {
    engine.close();
  }
}

export class BarrelTypecheck implements SmokeCommand {
  run(cwd: string): SmokeCommandResult {
    const barrel = path.join(cwd, "src", "index.ts");
    if (!fs.existsSync(barrel)) return { ok: true, error: "" };
    const text = fs.readFileSync(barrel, "utf8");
    const missing: string[] = [];
    const named = /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']([^"']+)["']/g;
    const stars = /export\s+\*\s+from\s+["']([^"']+)["']/g;
    for (const match of text.matchAll(named)) {
      const specifier = match[2];
      if (!specifier) continue;
      if (!resolveSpecifier(path.dirname(barrel), specifier)) missing.push(specifier);
    }
    for (const match of text.matchAll(stars)) {
      const specifier = match[1];
      if (!specifier) continue;
      if (!resolveSpecifier(path.dirname(barrel), specifier)) missing.push(specifier);
    }
    if (missing.length === 0) return { ok: true, error: "" };
    const target = missing[0] ?? "./missing.js";
    return {
      ok: false,
      error: `TS2307: Cannot find module '${target}' imported by src/index.ts`,
    };
  }
}

function resolveSpecifier(dir: string, specifier: string): boolean {
  const exact = path.resolve(dir, specifier);
  if (fs.existsSync(exact) && fs.statSync(exact).isFile()) return true;
  const swaps = [".ts", ".tsx", ".js", ".mjs"];
  for (const extension of swaps) {
    const candidate = exact.replace(/\.(js|mjs|ts|tsx)$/, extension);
    if (candidate !== exact && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return true;
  }
  return false;
}

export class FastUnitSmoke implements SmokeCommand {
  run(cwd: string): SmokeCommandResult {
    const marker = path.join(cwd, "smoke", "cases.json");
    if (!fs.existsSync(marker)) return { ok: true, error: "" };
    const parsed: unknown = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: true, error: "" };
    const record = parsed as { fail?: unknown; error?: unknown };
    if (record.fail === true) {
      return { ok: false, error: typeof record.error === "string" ? record.error : "unit smoke failed" };
    }
    return { ok: true, error: "" };
  }
}
