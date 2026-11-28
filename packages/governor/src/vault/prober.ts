import {
  isUnconditionalLiveSecret,
  stripeLivePrefix,
} from "./patterns.js";
import { probePostgresSelectOne, PostgresAuthError, PostgresUnreachableError } from "./postgres-probe.js";
import type { ProbeInput, ProviderProbeResult, ProviderSecretProberPort } from "./ports.js";
import { POSTGRES_PROBE_TIMEOUT_MS, type EnvScope, type VerifiedStatus } from "./types.js";

export interface PostgresChecker {
  selectOne(connectionUrl: string, timeoutMs: number): Promise<void>;
}

export interface ProviderSecretProberOptions {
  readonly fetchImpl?: typeof fetch;
  readonly postgres?: PostgresChecker;
  readonly timeoutMs?: number;
}

export class ProviderSecretProber implements ProviderSecretProberPort {
  private readonly fetchImpl: typeof fetch;
  private readonly postgres: PostgresChecker;
  readonly timeoutMs: number;

  constructor(options: ProviderSecretProberOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.postgres = options.postgres ?? { selectOne: probePostgresSelectOne };
    this.timeoutMs = options.timeoutMs ?? POSTGRES_PROBE_TIMEOUT_MS;
  }

  async probe(input: ProbeInput): Promise<ProviderProbeResult> {
    try {
      if (input.provider === "postgres") return await this.probePostgres(input);
      if (input.provider === "stripe") return await this.probeStripe(input);
      return await this.probeHttp(input);
    } catch (error) {
      if (error instanceof PostgresAuthError) return { status: "invalid" };
      return { status: "unreachable" };
    }
  }

  private async probePostgres(input: ProbeInput): Promise<ProviderProbeResult> {
    try {
      await this.postgres.selectOne(input.secret, this.timeoutMs);
    } catch (error) {
      if (error instanceof PostgresAuthError) return { status: "invalid" };
      if (error instanceof PostgresUnreachableError) return { status: "unreachable" };
      return { status: "unreachable" };
    }
    return { status: successStatus(input.secret, input.envScope) };
  }

  private async probeStripe(input: ProbeInput): Promise<ProviderProbeResult> {
    const response = await this.request("https://api.stripe.com/v1/balance", {
      method: "GET",
      headers: { Authorization: `Bearer ${input.secret}`, Accept: "application/json" },
    }, input.secret);
    if (response.status === 401 || response.status === 403) return { status: "invalid" };
    if (response.status >= 500 || response.status === 0) return { status: "unreachable" };
    if (response.status !== 200) return { status: "invalid" };
    const livemode = readLivemode(response.body);
    if (livemode === null) return { status: "invalid" };
    if (livemode) return { status: "verified_live", stripeLivemode: true };
    return { status: "verified_test", stripeLivemode: false };
  }

  private async probeHttp(input: ProbeInput): Promise<ProviderProbeResult> {
    const request = httpRequestFor(input);
    const response = await this.request(request.url, { method: "GET", headers: request.headers }, input.secret);
    if (response.status === 401 || response.status === 403) return { status: "invalid" };
    if (response.status >= 500 || response.status === 0) return { status: "unreachable" };
    if (response.status !== 200) return { status: "invalid" };
    return { status: successStatus(input.secret, input.envScope) };
  }

  private async request(
    url: string,
    init: { method: "GET"; headers: Record<string, string> },
    secret: string,
  ): Promise<{ status: number; body: string }> {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = await response.text();
      return { status: response.status, body: scrub(body, secret) };
    } catch {
      return { status: 0, body: "" };
    }
  }
}

function successStatus(secret: string, envScope: EnvScope): Exclude<VerifiedStatus, "unverified" | "invalid" | "unreachable"> {
  if (isUnconditionalLiveSecret(secret) || secret.startsWith(stripeLivePrefix())) return "verified_live";
  if (envScope === "prod" || envScope === "staging") return "verified_live";
  return "verified_test";
}

function readLivemode(body: string): boolean | null {
  try {
    const parsed = JSON.parse(body) as { livemode?: unknown };
    if (typeof parsed.livemode !== "boolean") return null;
    return parsed.livemode;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function httpRequestFor(input: ProbeInput): { url: string; headers: Record<string, string> } {
  const bearer = { Authorization: `Bearer ${input.secret}`, Accept: "application/json" };
  switch (input.provider) {
    case "resend":
      return { url: "https://api.resend.com/domains", headers: bearer };
    case "sendgrid":
      return { url: "https://api.sendgrid.com/v3/scopes", headers: bearer };
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: bearer };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: {
          "x-api-key": input.secret,
          "anthropic-version": "2023-06-01",
          Accept: "application/json",
        },
      };
    case "gemini":
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(input.secret)}`,
        headers: { Accept: "application/json" },
      };
    case "openrouter":
      return { url: "https://openrouter.ai/api/v1/models", headers: bearer };
    default:
      return { url: "https://127.0.0.1/invalid", headers: bearer };
  }
}

function scrub(text: string, secret: string): string {
  if (secret.length === 0) return text;
  return text.split(secret).join("[REDACTED_SECRET]").split(encodeURIComponent(secret)).join("[REDACTED_SECRET]");
}
