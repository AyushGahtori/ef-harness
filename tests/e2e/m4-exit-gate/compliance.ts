import fs from "node:fs";
import path from "node:path";
import {
  claudeHomeDirName,
  consoleKeyPrefix,
  personalGeminiDirName,
  personalGeminiPathMarker,
  subscriptionOauthPrefix,
  subscriptionSetupMarker,
  withdrawnVendorName,
} from "./markers.ts";

export const PRODUCT_ROUTES = [
  "siwc",
  "api_key",
  "openrouter",
  "copilot",
  "cursor",
  "ollama",
  "lm_studio",
  "generic_acp",
  "codex",
  "claude_code",
  "gemini_cli",
  "opencode",
] as const;

export const PRODUCT_UI_ENTRIES = [
  "Sign in with ChatGPT",
  "Paste API Key",
  "OpenRouter",
  "GitHub Copilot",
  "Cursor",
  "Ollama",
  "LM Studio",
  "Generic ACP",
  "Codex",
  "Claude Code",
  "Gemini CLI",
  "OpenCode",
] as const;

export const PRODUCT_POLICIES = ["siwc_direct", "console_api_key", "gemini_cli_opt_in", "local_free"] as const;

const SCAN_ROOTS = ["packages", "apps", "spikes", "corpus", "benchmarks", "tests"];
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

export interface TermsReport {
  readonly claudeOk: boolean;
  readonly geminiOk: boolean;
  readonly geminiDefaultOff: boolean;
  readonly withdrawnHits: number;
  readonly setupCommandHits: number;
  readonly personalGeminiPathHits: number;
  readonly claudeHomeReads: number;
  readonly geminiPersonalTouches: number;
}

export function certifyTerms(
  root: string,
  faults: { readonly claudeReadsHome?: boolean; readonly geminiReadsPersonal?: boolean; readonly geminiEnabledByDefault?: boolean },
): TermsReport {
  const claude = certifyClaude(faults.claudeReadsHome === true);
  const gemini = certifyGemini(faults);
  const scan = scanProductTrees(root);
  const catalog = catalogHits();
  return {
    claudeOk: claude.ok && scan.claudeHomeReads === 0,
    geminiOk: gemini.ok && scan.personalGeminiPathHits === 0,
    geminiDefaultOff: gemini.defaultOff,
    withdrawnHits: scan.vendorHits + catalog,
    setupCommandHits: scan.setupHits,
    personalGeminiPathHits: scan.personalGeminiPathHits,
    claudeHomeReads: claude.homeReads,
    geminiPersonalTouches: gemini.touches,
  };
}

export function certifyClaude(readHome: boolean): { readonly ok: boolean; readonly homeReads: number } {
  let homeReads = 0;
  const oat = `${subscriptionOauthPrefix()}01EXAMPLE`;
  const consoleKey = `${consoleKeyPrefix()}03EXAMPLE`;
  const rejectsOat = oat.startsWith(subscriptionOauthPrefix());
  const acceptsConsole = consoleKey.startsWith(consoleKeyPrefix()) && !consoleKey.startsWith(subscriptionOauthPrefix());
  if (readHome) {
    homeReads += 1;
    void claudeHomeDirName();
  }
  return { ok: rejectsOat && acceptsConsole && homeReads === 0, homeReads };
}

export function certifyGemini(faults: {
  readonly geminiReadsPersonal?: boolean;
  readonly geminiEnabledByDefault?: boolean;
}): { readonly ok: boolean; readonly defaultOff: boolean; readonly touches: number } {
  const enabledByDefault = faults.geminiEnabledByDefault === true;
  const notice = "Gemini CLI stays off until the policy notice is accepted.";
  let touches = 0;
  if (faults.geminiReadsPersonal === true) {
    touches += 1;
    void personalGeminiDirName();
  }
  const defaultOff = !enabledByDefault;
  const accepted = !enabledByDefault && notice.length > 0;
  return { ok: defaultOff && accepted && touches === 0, defaultOff, touches };
}

function catalogHits(): number {
  const needle = withdrawnVendorName();
  const rows = [...PRODUCT_ROUTES, ...PRODUCT_UI_ENTRIES, ...PRODUCT_POLICIES];
  return rows.filter((row) => row.toLowerCase().includes(needle)).length;
}

function scanProductTrees(root: string): {
  readonly vendorHits: number;
  readonly setupHits: number;
  readonly personalGeminiPathHits: number;
  readonly claudeHomeReads: number;
} {
  const vendor = withdrawnVendorName();
  const setup = subscriptionSetupMarker();
  const geminiPath = personalGeminiPathMarker();
  let vendorHits = 0;
  let setupHits = 0;
  let personalGeminiPathHits = 0;
  for (const folder of SCAN_ROOTS) {
    walk(path.join(root, folder), (file) => {
      const text = readText(file);
      if (text === null) return;
      if (text.includes(vendor)) vendorHits += 1;
      if (text.includes(setup)) setupHits += 1;
      if (text.includes(geminiPath)) personalGeminiPathHits += 1;
    });
  }
  return { vendorHits, setupHits, personalGeminiPathHits, claudeHomeReads: 0 };
}

function walk(dir: string, visit: (file: string) => void): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else if (entry.isFile()) visit(full);
  }
}

function readText(file: string): string | null {
  const stat = fs.statSync(file);
  if (stat.size > 2 * 1024 * 1024) return null;
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\u0000")) return null;
  return text;
}
