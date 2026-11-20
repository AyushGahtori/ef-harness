import fs from "node:fs";
import path from "node:path";
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
  constructor(private readonly commands: readonly SmokeCommand[] = [new BarrelTypecheck(), new FastUnitSmoke()]) {}

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
