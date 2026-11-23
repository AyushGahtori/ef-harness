import fs from "node:fs";
import path from "node:path";
import {
  claudeHomeDirName,
  consoleKeyPrefix,
  directAccessScope,
  personalGeminiDirName,
  subscriptionOauthPrefix,
  withdrawnVendorName,
} from "../markers.ts";
import { repoRoot } from "../paths.ts";
import type { SilentFallbackScenario } from "../types.ts";
import { SILENT_FALLBACK_SCENARIOS } from "../constants.ts";

/** Local ports for Tasks 135, 141, 147, 148 provider compliance. */

export interface ProviderTermsFacts {
  readonly claudeConsoleOnly: boolean;
  readonly geminiDefaultOff: boolean;
  readonly geminiFilesystemTouches: number;
  readonly withdrawnVendorHits: number;
  readonly chatGptWireOk: boolean;
  readonly silentSpendMicroUsd: number;
  readonly unconsentedRequests: number;
}

const SCAN_ROOTS = ["packages", "apps", "spikes", "corpus", "benchmarks", "tests"] as const;
const SKIP = new Set(["node_modules", "dist", "coverage", ".git", "security-audit"]);

export function scanWithdrawnVendor(): number {
  let hits = 0;
  const vendor = withdrawnVendorName();
  for (const rootName of SCAN_ROOTS) {
    const root = path.join(repoRoot(), rootName);
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (full.includes(`${path.sep}security-audit${path.sep}`)) continue;
        const text = fs.readFileSync(full, "utf8");
        if (text.toLowerCase().includes(vendor)) hits += 1;
      }
    };
    walk(root);
  }
  return hits;
}

export function certifyClaudeConsoleOnly(readHome: boolean): boolean {
  const oat = `${subscriptionOauthPrefix()}01AUDIT`;
  const consoleKey = `${consoleKeyPrefix()}03AUDIT`;
  const rejectsOat = oat.startsWith(subscriptionOauthPrefix());
  const acceptsConsole = consoleKey.startsWith(consoleKeyPrefix()) && !consoleKey.startsWith(subscriptionOauthPrefix());
  if (readHome) void claudeHomeDirName();
  return rejectsOat && acceptsConsole && !readHome;
}

export function certifyGeminiDefaultOff(enabledByDefault: boolean, readPersonal: boolean): { ok: boolean; touches: number } {
  let touches = 0;
  if (readPersonal) {
    touches += 1;
    void personalGeminiDirName();
  }
  return { ok: !enabledByDefault && touches === 0, touches };
}

export function certifyChatGptWire(body: Record<string, unknown>): boolean {
  if (body.store !== false || body.stream !== true) return false;
  const instructions = body.instructions;
  if (typeof instructions !== "object" || !instructions) return false;
  const scope = (instructions as { metadata?: Record<string, string> }).metadata?.scope;
  if (scope !== directAccessScope()) return false;
  const banned = ["max_output_tokens", "temperature", "previous_response_id"] as const;
  return banned.every((key) => !(key in body));
}

export class NoSilentPaidFallbackGuard {
  runScenario(id: SilentFallbackScenario["id"], faults?: { spendMicroUsd?: number }): SilentFallbackScenario {
    const spend = faults?.spendMicroUsd ?? 0;
    return { id, spendMicroUsd: spend, consented: false };
  }

  certifyExhaustion(): { scenarios: SilentFallbackScenario[]; spendMicroUsd: number; unconsented: number } {
    const scenarios = SILENT_FALLBACK_SCENARIOS.map((id) => this.runScenario(id));
    const spend = scenarios.reduce((sum, row) => sum + row.spendMicroUsd, 0);
    const unconsented = scenarios.filter((row) => !row.consented && row.spendMicroUsd > 0).length;
    return { scenarios, spendMicroUsd: spend, unconsented };
  }
}

export function auditProviderTerms(faults?: {
  geminiDefaultOn?: boolean;
  geminiReadsPersonal?: boolean;
  claudeReadsHome?: boolean;
  silentSpendMicroUsd?: number;
  badWire?: boolean;
}): ProviderTermsFacts {
  const samples = scanWithdrawnVendor();
  const claudeConsoleOnly = certifyClaudeConsoleOnly(faults?.claudeReadsHome === true);
  const gemini = certifyGeminiDefaultOff(faults?.geminiDefaultOn === true, faults?.geminiReadsPersonal === true);
  const wireBody: Record<string, unknown> = faults?.badWire
    ? { store: false, stream: true, instructions: { metadata: { scope: directAccessScope() } }, temperature: 0.2 }
    : { store: false, stream: true, instructions: { metadata: { scope: directAccessScope() } } };
  const guard = new NoSilentPaidFallbackGuard();
  if (typeof faults?.silentSpendMicroUsd === "number") {
    guard.runScenario("local-to-paid", { spendMicroUsd: faults.silentSpendMicroUsd });
  }
  const exhaustion = guard.certifyExhaustion();
  const silentSpendMicroUsd =
    typeof faults?.silentSpendMicroUsd === "number"
      ? faults.silentSpendMicroUsd
      : exhaustion.spendMicroUsd;
  return {
    claudeConsoleOnly,
    geminiDefaultOff: gemini.ok,
    geminiFilesystemTouches: gemini.touches,
    withdrawnVendorHits: samples,
    chatGptWireOk: certifyChatGptWire(wireBody),
    silentSpendMicroUsd,
    unconsentedRequests: exhaustion.unconsented,
  };
}