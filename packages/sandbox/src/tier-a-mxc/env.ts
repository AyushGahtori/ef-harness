import path from "node:path";
import { MxcModeError } from "./errors.js";
import type { WrappedVendor } from "./types.js";
import { VENDOR_TOKEN_ENV } from "./constants.js";

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
  "USERDOMAIN",
  "USERNAME",
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
  readonly proxyUrl: string;
}

function readNamed(source: EnvSource, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (value.includes("\0") || value.includes("\n") || value.includes("\r")) return undefined;
  return value;
}

export function buildScrubbedEnvironment(
  source: EnvSource,
  redirects: EnvRedirects,
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
  env.TEMP = redirects.temp;
  env.TMP = redirects.temp;
  env.TMPDIR = redirects.temp;
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
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  delete env.ACCESS_TOKEN;
  delete env.CURSOR_API_KEY;
  delete env.ANTHROPIC_API_KEY;
  delete env.OPENAI_API_KEY;
  return env;
}

export function cacheLayout(tempDir: string, proxyPort: number): EnvRedirects {
  return {
    home: joinInside(tempDir, "home"),
    temp: tempDir,
    xdgCache: joinInside(tempDir, "xdg-cache"),
    npmCache: joinInside(tempDir, "npm-cache"),
    eslintCache: joinInside(tempDir, "eslint-cache"),
    vitestCache: joinInside(tempDir, "vitest-cache"),
    turboCache: joinInside(tempDir, "turbo-cache"),
    playwrightCache: joinInside(tempDir, "playwright-cache"),
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
  };
}

function joinInside(root: string, name: string): string {
  return path.join(root, name);
}

export function injectSingleVendorToken(
  env: Readonly<Record<string, string>>,
  vendor: WrappedVendor,
  token: string,
): Record<string, string> {
  const key = VENDOR_TOKEN_ENV[vendor];
  if (!key) {
    throw new MxcModeError(
      "file_login_vendor_rejects_injected_token",
      `Vendor ${vendor} does not accept an injected token`,
    );
  }
  if (token.length === 0 || token.includes("\0") || token.includes("\n") || token.includes("\r")) {
    throw new MxcModeError("vendor_token_not_encodable", "Vendor token is empty or not encodable");
  }
  const next: Record<string, string> = {};
  for (const name of Object.keys(env)) {
    const value = env[name];
    if (typeof value === "string") next[name] = value;
  }
  next[key] = token;
  return next;
}

export function environmentPairs(env: Readonly<Record<string, string>>): string[] {
  const pairs: string[] = [];
  for (const key of Object.keys(env)) {
    const value = env[key];
    if (typeof value !== "string") continue;
    if (key.includes("=") || key.includes("\0") || value.includes("\0") || value.includes("\n")) {
      throw new MxcModeError("env_not_encodable", `environment entry ${key} cannot be encoded`);
    }
    pairs.push(`${key}=${value}`);
  }
  return pairs;
}

export function redirectsAreInsideTemp(redirects: EnvRedirects, tempDir: string): boolean {
  const prefix = path.resolve(tempDir).toLowerCase();
  const values = [
    redirects.home,
    redirects.temp,
    redirects.xdgCache,
    redirects.npmCache,
    redirects.eslintCache,
    redirects.vitestCache,
    redirects.turboCache,
    redirects.playwrightCache,
  ];
  return values.every((value) => {
    const comparable = path.resolve(value).toLowerCase();
    return comparable === prefix || comparable.startsWith(`${prefix}${path.sep}`);
  });
}
