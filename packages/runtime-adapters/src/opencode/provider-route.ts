import { OpenCodeAdapterError } from "./errors.js";
import type { ProviderConnection, ProviderId } from "./types.js";

const BLOCKED_EXACT = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "CURSOR_API_KEY",
  "NPM_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "STRIPE_SECRET_KEY",
] as const;

const ALLOWED_HOST_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "COMSPEC", "ComSpec", "WINDIR"] as const;

const PROVIDER_KEY: Record<Exclude<ProviderId, "ollama">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export function assertLoopbackUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OpenCodeAdapterError("provider_route", `${label} is not a URL`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new OpenCodeAdapterError("provider_route", `${label} must stay on the loopback allowlist proxy`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenCodeAdapterError("provider_route", `${label} must use http or https`);
  }
  return value;
}

export function providerEnv(connection: ProviderConnection): Record<string, string> {
  const baseUrl = assertLoopbackUrl(connection.baseUrl, "provider baseURL");
  if (connection.provider === "ollama") {
    return { OLLAMA_HOST: baseUrl };
  }
  if (!connection.apiKey) {
    throw new OpenCodeAdapterError("provider_route", "authorized provider key is missing");
  }
  const keyName = PROVIDER_KEY[connection.provider];
  const env: Record<string, string> = { [keyName]: connection.apiKey };
  if (connection.provider === "openai") env.OPENAI_BASE_URL = baseUrl;
  if (connection.provider === "anthropic") env.ANTHROPIC_BASE_URL = baseUrl;
  return env;
}

export function buildOpenCodeChildEnv(input: {
  readonly hostEnv: Readonly<Record<string, string | undefined>>;
  readonly configPath: string;
  readonly configDir: string;
  readonly providerEnv: Readonly<Record<string, string>>;
}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ALLOWED_HOST_KEYS) {
    const value = input.hostEnv[key];
    if (typeof value === "string" && value.length > 0) env[key] = value;
  }
  for (const key of BLOCKED_EXACT) {
    delete env[key];
  }
  env.HOME = input.configDir;
  env.USERPROFILE = input.configDir;
  env.TEMP = input.configDir;
  env.TMP = input.configDir;
  env.OPENCODE_CONFIG = input.configPath;
  env.OPENCODE_CONFIG_DIR = input.configDir;
  for (const [key, value] of Object.entries(input.providerEnv)) {
    env[key] = value;
  }
  return env;
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}
