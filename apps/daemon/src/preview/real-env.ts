import { vault, type LiveKeyTestRefusalGuard as GovernorGuard } from "@ef-harness/governor";
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
] as const;

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

function scopeOf(secret: PreviewSecret): "dev" | "test" | "prod" {
  if (secret.scope === "dev" || secret.scope === "test") return secret.scope;
  return "prod";
}

export class PreviewLiveKeyGuard implements LiveKeyTestRefusalGuard {
  private readonly governor: GovernorGuard;

  constructor(governor: GovernorGuard = new vault.LiveKeyTestRefusalGuard()) {
    this.governor = governor;
  }

  inspect(secret: PreviewSecret): GuardDecision {
    if (secret.scope === "live" || secret.scope === "prod" || secret.scope === "production") {
      return refuse("prod_scope", "Refused to inject a production-scoped secret into Live Preview.");
    }
    if (secret.scope !== "dev" && secret.scope !== "test") {
      return refuse("scope", "Live Preview accepts only dev or test scoped secrets.");
    }
    const decision = this.governor.inspect({
      value: secret.value,
      envScope: scopeOf(secret),
      injectionTarget: "preview",
      name: secret.name,
      providerHint: secret.kind,
    });
    if (!decision.allowed) return { allowed: false, code: decision.code, message: decision.message };
    if (secret.kind === "stripe" && !secret.value.startsWith(vault.stripeTestPrefix())) {
      return refuse("stripe_test_required", "Refused to inject a non-test Stripe key into Live Preview.");
    }
    if ((secret.kind === "smtp" || secret.kind === "s3" || secret.kind === "oauth") && !isLoopbackUrl(secret.value)) {
      return refuse("remote_endpoint", "Refused to inject a non-local SMTP, S3, or OAuth endpoint into Live Preview.");
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

export class PreviewRuntimeEnv implements RuntimeOnlyEnvInjector {
  private readonly injector: vault.RuntimeOnlyEnvInjector;
  private readonly redactor: vault.PacketSecurityRedactor;
  private readonly registered = new Map<string, string>();

  constructor(private readonly guard: LiveKeyTestRefusalGuard) {
    this.redactor = new vault.PacketSecurityRedactor();
    this.injector = new vault.RuntimeOnlyEnvInjector(
      { readSecret: () => Promise.resolve(null) },
      this.redactor,
      new vault.LiveKeyTestRefusalGuard(),
    );
  }

  prepare(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly secrets: readonly PreviewSecret[];
    readonly extras: Readonly<Record<string, string>>;
  }): PreparedPreviewEnv {
    if (!(this.injector instanceof vault.RuntimeOnlyEnvInjector)) {
      throw new Error("preview env injector is not the governor runtime injector");
    }
    this.guard.assertPreviewSecrets(input.secrets);
    assertNoSecretInArgv(input.command, input.args, input.secrets);
    const env: Record<string, string> = {};
    for (const name of LAUNCH_ENV) {
      const value = process.env[name];
      if (typeof value === "string" && value.length > 0) env[name] = value;
    }
    for (const [name, value] of Object.entries(input.extras)) {
      if (value.includes(vault.stripeLivePrefix())) {
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

function assertNoSecretInArgv(command: string, args: readonly string[], secrets: readonly PreviewSecret[]): void {
  const fields = [command, ...args];
  for (const secret of secrets) {
    if (secret.value.length < 8) continue;
    for (const field of fields) {
      if (field.includes(secret.value)) {
        throw new LiveKeyRefusedError("argv_secret", "Refused to place a preview secret on the process command line.");
      }
    }
  }
}
