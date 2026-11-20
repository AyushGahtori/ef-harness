import path from "node:path";
import { VENDOR_SDK_FIELD, VENDOR_TOKEN_ENV } from "./constants.js";
import { TierBError } from "./errors.js";
import type { TierBModeDecision, WrappedVendor } from "./types.js";

const WINDOWS_ALLOW = [
  "ALLUSERSPROFILE",
  "CommonProgramFiles",
  "CommonProgramFiles(x86)",
  "CommonProgramW6432",
  "COMPUTERNAME",
  "ComSpec",
  "HOMEDRIVE",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "PROCESSOR_LEVEL",
  "PROCESSOR_REVISION",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "PUBLIC",
  "SystemDrive",
  "SystemRoot",
  "windir",
  "PATH",
] as const;

const BLOCKED_NAMES = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "ACCESS_TOKEN",
  "CURSOR_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NPM_TOKEN",
]);

const SECRET_NAME = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|PASSWD|API_KEY|APIKEY)/i;

export interface EnvSource {
  readonly [key: string]: string | undefined;
}

export interface EnvRedirects {
  readonly home: string;
  readonly temp: string;
  readonly xdgCache: string;
  readonly npmCache: string;
  readonly eslintCache: string;
  readonly vitestCache: string;
  readonly turboCache: string;
  readonly playwrightCache: string;
  readonly appData: string;
  readonly localAppData: string;
  readonly proxyUrl: string;
}

function readNamed(source: EnvSource, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) return undefined;
  return value;
}

export function cacheLayout(tempDir: string, proxyPort: number): EnvRedirects {
  const home = path.join(tempDir, "home");
  return {
    home,
    temp: tempDir,
    xdgCache: path.join(tempDir, "xdg-cache"),
    npmCache: path.join(tempDir, "npm-cache"),
    eslintCache: path.join(tempDir, "eslint-cache"),
    vitestCache: path.join(tempDir, "vitest-cache"),
    turboCache: path.join(tempDir, "turbo-cache"),
    playwrightCache: path.join(tempDir, "playwright-cache"),
    appData: path.join(home, "AppData", "Roaming"),
    localAppData: path.join(home, "AppData", "Local"),
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
  };
}

export function buildScrubbedEnvironment(
  source: EnvSource,
  redirects: EnvRedirects,
  accountName: string,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of WINDOWS_ALLOW) {
    if (BLOCKED_NAMES.has(key) || SECRET_NAME.test(key)) continue;
    const value = readNamed(source, key);
    if (!value) continue;
    env[key] = value;
  }
  env.HOME = redirects.home;
  env.USERPROFILE = redirects.home;
  env.USERNAME = accountName;
  env.TEMP = redirects.temp;
  env.TMP = redirects.temp;
  env.TMPDIR = redirects.temp;
  env.APPDATA = redirects.appData;
  env.LOCALAPPDATA = redirects.localAppData;
  env.XDG_CACHE_HOME = redirects.xdgCache;
  env.npm_config_cache = redirects.npmCache;
  env.ESLINT_CACHE_LOCATION = redirects.eslintCache;
  env.VITEST_CACHE_DIR = redirects.vitestCache;
  env.TURBO_CACHE_DIR = redirects.turboCache;
  env.PLAYWRIGHT_CACHE_DIR = redirects.playwrightCache;
  env.HTTP_PROXY = redirects.proxyUrl;
  env.HTTPS_PROXY = redirects.proxyUrl;
  env.ALL_PROXY = redirects.proxyUrl;
  env.NO_PROXY = "localhost,127.0.0.1,::1";
  env.GIT_SSH_COMMAND = "cmd /c exit 1";
  for (const key of Object.keys(env)) {
    if (SECRET_NAME.test(key) || key.startsWith("AWS_") || key.startsWith("AZURE_") || BLOCKED_NAMES.has(key)) {
      delete env[key];
    }
  }
  return env;
}

export function injectSingleVendorToken(
  env: Readonly<Record<string, string>>,
  vendor: WrappedVendor,
  token: string,
): Record<string, string> {
  const key = VENDOR_TOKEN_ENV[vendor];
  if (!key) {
    throw new TierBError("file_login_vendor_rejects_injected_token", `${vendor} does not accept an injected token on Tier B`);
  }
  if (token.length === 0 || token.includes("\0") || token.includes("\n") || token.includes("\r")) {
    throw new TierBError("vendor_token_not_encodable", "Vendor token is empty or not encodable");
  }
  const next: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    const value = env[name];
    if (typeof value === "string") next[name] = value;
  }
  next[key] = token;
  return next;
}

export function redirectsAreInsideTemp(redirects: EnvRedirects, tempDir: string): boolean {
  const prefix = path.resolve(tempDir);
  const comparable = process.platform === "win32" ? prefix.toLowerCase() : prefix;
  const values = [
    redirects.home,
    redirects.temp,
    redirects.xdgCache,
    redirects.npmCache,
    redirects.eslintCache,
    redirects.vitestCache,
    redirects.turboCache,
    redirects.playwrightCache,
    redirects.appData,
    redirects.localAppData,
  ];
  return values.every((value) => {
    const resolved = path.resolve(value);
    const current = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    return current === comparable || current.startsWith(`${comparable}${path.sep}`);
  });
}

export function resolveTierBExecutionMode(vendor: WrappedVendor, requested: "wrapped" | "stripped"): TierBModeDecision {
  if (requested === "stripped" || vendor === "gemini") {
    return {
      vendor,
      requested,
      mode: "stripped",
      reason: vendor === "gemini" ? "file_login_on_tier_b" : "requested_stripped",
      tokenEnv: null,
      sdkField: null,
      homeAclMutations: [] as const,
    };
  }
  const tokenEnv = VENDOR_TOKEN_ENV[vendor];
  return {
    vendor,
    requested,
    mode: "wrapped",
    reason: tokenEnv ? "token_vendor" : "wrapped_without_token",
    tokenEnv,
    sdkField: VENDOR_SDK_FIELD[vendor],
    homeAclMutations: [] as const,
  };
}
