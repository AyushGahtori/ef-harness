import path from "node:path";

const CONSOLE_KEY_PREFIX = ["sk", "-ant", "-api"].join("");
const FORBIDDEN_LAUNCH_MODE = ["setup", "-token"].join("");
const BLOCKED_SEGMENTS = new Set([".claude", ".gemini"]);

export type ClaudeGuardCode =
  | "missing_console_api_key"
  | "non_api_key_credential"
  | "forbidden_launch_mode";

export class ClaudeCredentialError extends Error {
  readonly code: ClaudeGuardCode;

  constructor(code: ClaudeGuardCode, message: string) {
    super(message);
    this.name = "ClaudeCredentialError";
    this.code = code;
  }
}

export function assertClaudeConsoleKey(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new ClaudeCredentialError(
      "missing_console_api_key",
      "Claude probe requires an explicit console API key",
    );
  }
  const key = value.trim();
  if (!key.startsWith(CONSOLE_KEY_PREFIX)) {
    throw new ClaudeCredentialError(
      "non_api_key_credential",
      "Claude probe accepts only an explicit console API key",
    );
  }
  return key;
}

export function assertClaudeLaunchArgs(args: readonly string[]): void {
  const banned = FORBIDDEN_LAUNCH_MODE.toLowerCase();
  for (const arg of args) {
    if (arg.toLowerCase().includes(banned)) {
      throw new ClaudeCredentialError(
        "forbidden_launch_mode",
        "Claude probe refuses subscription credential launch modes",
      );
    }
  }
}

export function assertSafeProbePath(filePath: string): void {
  const segments = filePath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => BLOCKED_SEGMENTS.has(segment))) {
    throw new Error("Probe refuses credential directory paths");
  }
}

export function resolveClaudeApiKey(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const fromEnv = env.ANTHROPIC_API_KEY;
  return assertClaudeConsoleKey(explicit ?? fromEnv);
}

export function credentialPathForTest(home: string, segment: ".claude" | ".gemini"): string {
  return path.join(home, segment);
}
