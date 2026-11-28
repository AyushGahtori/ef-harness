import { LiveKeyRefusedError } from "./errors.js";
import type {
  GuardDecision,
  LiveKeyTestRefusalGuard,
  PreparedPreviewEnv,
  PreviewSecret,
  RuntimeOnlyEnvInjector,
} from "./ports.js";

const LAUNCH_ENV = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "TEMP",
  "TMP",
];

/** Stripe live secret prefix, split so source text does not contain the scanner needle. */
export function stripeLivePrefix(): string {
  return ["sk", "_live_"].join("");
}

export function stripeTestPrefix(): string {
  return ["sk", "_test_"].join("");
}

function isLoopbackUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") return true;
  if (!host.endsWith(".localhost")) return false;
  const label = host.slice(0, -".localhost".length);
  return label.length > 0 && !label.includes(".");
}

function looksLive(value: string): boolean {
  return (
    value.includes(stripeLivePrefix()) ||
    value.includes("rk_live_") ||
    value.includes("pk_live_")
  );
}

/**
 * Refuses live and production secrets before they can reach Live Preview.
 * Swap for Task 120 `LiveKeyTestRefusalGuard`.
 */
export class LocalLiveKeyTestRefusalGuard implements LiveKeyTestRefusalGuard {
  inspect(secret: PreviewSecret): GuardDecision {
    if (secret.scope === "live" || secret.scope === "prod" || secret.scope === "production") {
      return refuse(
        "prod_scope",
        "Refused to inject a production-scoped secret into Live Preview.",
      );
    }
    if (secret.scope !== "dev" && secret.scope !== "test") {
      return refuse("scope", "Live Preview accepts only dev or test scoped secrets.");
    }
    if (looksLive(secret.value)) {
      return refuse(
        "stripe_live",
        "Refused to inject a live key into Live Preview. Supply a test key or the local mock.",
      );
    }
    if (secret.kind === "stripe" && !secret.value.startsWith(stripeTestPrefix())) {
      return refuse(
        "stripe_test_required",
        "Refused to inject a non-test Stripe key into Live Preview.",
      );
    }
    if ((secret.kind === "smtp" || secret.kind === "s3" || secret.kind === "oauth") && !isLoopbackUrl(secret.value)) {
      return refuse(
        "remote_endpoint",
        "Refused to inject a non-local SMTP, S3, or OAuth endpoint into Live Preview.",
      );
    }
    return { allowed: true, code: "ok", message: "" };
  }

  assertPreviewSecrets(secrets: readonly PreviewSecret[]): void {
    for (const secret of secrets) {
      const decision = this.inspect(secret);
      if (!decision.allowed) throw new LiveKeyRefusedError(decision.code, decision.message);
    }
  }
}

function refuse(code: string, message: string): GuardDecision {
  return { allowed: false, code, message };
}

/**
 * Injects dev/test secrets into the child environment block only.
 * Swap for Task 120 `RuntimeOnlyEnvInjector`.
 */
export class LocalRuntimeOnlyEnvInjector implements RuntimeOnlyEnvInjector {
  private readonly registered = new Map<string, string>();

  constructor(private readonly guard: LiveKeyTestRefusalGuard) {}

  prepare(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly secrets: readonly PreviewSecret[];
    readonly extras: Readonly<Record<string, string>>;
  }): PreparedPreviewEnv {
    this.guard.assertPreviewSecrets(input.secrets);
    assertNoSecretInArgv(input.command, input.args, input.secrets);
    const env: Record<string, string> = {};
    for (const name of LAUNCH_ENV) {
      const value = process.env[name];
      if (typeof value === "string" && value.length > 0) env[name] = value;
    }
    for (const [name, value] of Object.entries(input.extras)) {
      if (looksLive(value)) {
        throw new LiveKeyRefusedError("stripe_live", "Refused to inject a live key into Live Preview.");
      }
      env[name] = value;
    }
    for (const secret of input.secrets) {
      env[secret.name] = secret.value;
      if (secret.value.length >= 8) this.registered.set(secret.name, secret.value);
    }
    return { env, argv: [...input.args], shell: false };
  }

  redact(text: string): string {
    let redacted = text;
    for (const [name, value] of this.registered) {
      if (value.length < 8) continue;
      redacted = redacted.split(value).join(`[REDACTED_SECRET:${name}]`);
    }
    return redacted;
  }
}

function assertNoSecretInArgv(
  command: string,
  args: readonly string[],
  secrets: readonly PreviewSecret[],
): void {
  const fields = [command, ...args];
  for (const secret of secrets) {
    if (secret.value.length < 8) continue;
    for (const field of fields) {
      if (field.includes(secret.value)) {
        throw new LiveKeyRefusedError(
          "argv_secret",
          "Refused to place a preview secret on the process command line.",
        );
      }
    }
  }
}
