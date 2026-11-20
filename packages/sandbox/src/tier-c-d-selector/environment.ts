import path from "node:path";
import type { ProxyAdvisory } from "./types.js";

const DENIED_ENV_NAME =
  /^(GH_TOKEN|GITHUB_TOKEN|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|CURSOR_API_KEY|NPM_TOKEN|NODE_AUTH_TOKEN)$/i;
const DENIED_ENV_PATTERN = /(TOKEN|SECRET|PASSWORD|CREDENTIAL)/i;
const EXTRA_ALLOW = new Set(["LANG", "LC_ALL", "TZ", "CI", "NODE_ENV", "EF_HARNESS_ATTEMPT_ID"]);

export function isDeniedEnvName(name: string): boolean {
  if (name === "GIT_SSH_COMMAND") return false;
  if (DENIED_ENV_NAME.test(name)) return true;
  return DENIED_ENV_PATTERN.test(name);
}

export function quoteWindowsArgument(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"]/.test(value)) return value;
  let quoted = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      quoted += `${"\\".repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    if (backslashes > 0) quoted += "\\".repeat(backslashes);
    quoted += char;
    backslashes = 0;
  }
  if (backslashes > 0) quoted += "\\".repeat(backslashes * 2);
  return `${quoted}"`;
}

export function buildWindowsCommandLine(executable: string, args: readonly string[]): string {
  return [executable, ...args].map((part) => quoteWindowsArgument(part)).join(" ");
}

export interface TierCEnvironmentInput {
  readonly tempPath: string;
  readonly systemRoot: string;
  readonly pathEntries: readonly string[];
  readonly proxy?: ProxyAdvisory;
  readonly extra?: Readonly<Record<string, string>>;
}

export function buildTierCEnvironment(input: TierCEnvironmentInput): Record<string, string> {
  const temp = input.tempPath;
  const command = path.win32.join(input.systemRoot, "System32", "cmd.exe");
  const env: Record<string, string> = {
    SystemRoot: input.systemRoot,
    windir: input.systemRoot,
    PATH: input.pathEntries.join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    COMSPEC: command,
    TEMP: temp,
    TMP: temp,
    TMPDIR: temp,
    HOME: temp,
    USERPROFILE: temp,
    HTTP_PROXY: input.proxy?.http ?? "http://127.0.0.1:9",
    HTTPS_PROXY: input.proxy?.https ?? "http://127.0.0.1:9",
    NO_PROXY: input.proxy?.noProxy ?? "localhost,127.0.0.1,::1",
    GIT_SSH_COMMAND: `${command} /c exit /b 1`,
  };
  if (input.extra) {
    for (const [key, value] of Object.entries(input.extra)) {
      if (!EXTRA_ALLOW.has(key) || isDeniedEnvName(key)) continue;
      env[key] = value;
    }
  }
  return env;
}

export function environmentBlockText(env: Readonly<Record<string, string>>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (key.includes("\n") || key.includes("\r") || value.includes("\n") || value.includes("\r")) {
      throw new Error(`Refusing environment entry ${key} that contains a newline.`);
    }
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}

export function scrubContainerEnv(
  extra: Readonly<Record<string, string>> | undefined,
  base: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = { ...base };
  if (!extra) return env;
  for (const [key, value] of Object.entries(extra)) {
    if (isDeniedEnvName(key) || !EXTRA_ALLOW.has(key)) continue;
    env[key] = value;
  }
  return env;
}
