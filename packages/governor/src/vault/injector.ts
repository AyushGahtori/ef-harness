import { spawn } from "node:child_process";
import { looksLikeProviderCredential } from "./patterns.js";
import type { PacketSecurityRedactor } from "./redactor.js";
import type { StoredSecret, VaultSecretSource } from "./ports.js";
import { LiveKeyTestRefusalGuard } from "./refusal.js";
import type { EnvScope, InjectionRole, SandboxTier } from "./types.js";
import { LiveKeyRefusedError, SecretNotFoundError, WorkerSandboxSecretError, ZeroArgvSecretError } from "./types.js";

const LAUNCH_ENV = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "ComSpec", "COMSPEC", "TEMP", "TMP"];

const EXACT_SENSITIVE = new Set([
  "DATABASE_URL",
  "REDIS_URL",
  "MONGODB_URI",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OPENROUTER_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "VERCEL_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "SENDGRID_API_KEY",
  "RESEND_API_KEY",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_ACCOUNT_SID",
  "CURSOR_API_KEY",
  "ACCESS_TOKEN",
]);

const SENSITIVE_NAME = /(API_KEY|APIKEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_KEY|CREDENTIAL)/i;

const MAX_CAPTURE_BYTES = 1024 * 1024;

export function isSensitiveEnvName(name: string): boolean {
  return EXACT_SENSITIVE.has(name.toUpperCase()) || SENSITIVE_NAME.test(name);
}

export function workerEnvironmentIsCredentialFree(env: Readonly<Record<string, string>>): boolean {
  for (const [name, value] of Object.entries(env)) {
    if (isSensitiveEnvName(name)) return false;
    if (looksLikeProviderCredential(value)) return false;
  }
  return true;
}

export interface InjectedProcessRequest {
  readonly role: InjectionRole;
  readonly tier?: SandboxTier;
  readonly secretIds: readonly string[];
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly baseEnv?: Readonly<Record<string, string>>;
  readonly targetEnvScope?: EnvScope;
}

export interface InjectedProcessResult {
  readonly exitCode: number | null;
  readonly redactedStdout: string;
  readonly redactedStderr: string;
  readonly argv: readonly string[];
  readonly shell: false;
  readonly envNames: readonly string[];
  readonly role: InjectionRole;
  readonly tier: SandboxTier | null;
}

export class RuntimeOnlyEnvInjector {
  constructor(
    private readonly secrets: VaultSecretSource,
    private readonly redactor: PacketSecurityRedactor,
    private readonly guard: LiveKeyTestRefusalGuard,
  ) {}

  async spawn(request: InjectedProcessRequest): Promise<InjectedProcessResult> {
    const loaded: StoredSecret[] = [];
    for (const secretId of request.secretIds) {
      const secret = await this.secrets.readSecret(secretId);
      if (!secret) throw new SecretNotFoundError(secretId);
      loaded.push(secret);
    }
    assertNoSecretInArgv(request.command, request.args, loaded.map((item) => item.value));
    const target = injectionTarget(request);
    if (request.role !== "coding-worker") {
      const decisions = this.guard.inspectMany(
        loaded.map((secret) => ({
          value: secret.value,
          envScope: secret.envScope,
          injectionTarget: target,
          name: secret.name,
          ...(secret.providerHint ? { providerHint: secret.providerHint } : {}),
          ...(secret.taggedProd ? { taggedProd: true } : {}),
          ...(secret.testOverride ? { explicitTestOverride: true } : {}),
          storedEnvScope: secret.envScope,
        })),
      );
      for (const decision of decisions) {
        if (!decision.allowed) throw new LiveKeyRefusedError(decision.code, decision.message);
      }
    }
    const env = launchEnv(request.baseEnv);
    const injected = request.role === "coding-worker" ? [] : loaded;
    for (const secret of injected) env[secret.name] = secret.value;
    if (request.role === "coding-worker" && !workerEnvironmentIsCredentialFree(env)) {
      throw new WorkerSandboxSecretError();
    }
    const labels = injected.map((secret) => secret.name);
    for (const secret of injected) this.redactor.register(secret.name, secret.value);
    try {
      const captured = await runChild(request.command, request.args, env, request.cwd);
      return {
        exitCode: captured.exitCode,
        redactedStdout: this.redactor.redact(captured.stdout),
        redactedStderr: this.redactor.redact(captured.stderr),
        argv: [...request.args],
        shell: false,
        envNames: Object.keys(env).sort(),
        role: request.role,
        tier: request.tier ?? null,
      };
    } finally {
      for (const label of labels) this.redactor.forget(label);
    }
  }
}

function injectionTarget(request: InjectedProcessRequest): EnvScope | "preview" | "worker" {
  if (request.role === "coding-worker") return "worker";
  if (request.role === "preview") return "preview";
  if (request.role === "test") return "test";
  return request.targetEnvScope ?? "prod";
}

function launchEnv(base: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of LAUNCH_ENV) {
    const value = process.env[name];
    if (typeof value === "string" && value.length > 0) env[name] = value;
  }
  if (base) {
    for (const [name, value] of Object.entries(base)) {
      if (isSensitiveEnvName(name) || looksLikeProviderCredential(value)) continue;
      env[name] = value;
    }
  }
  return env;
}

function assertNoSecretInArgv(command: string, args: readonly string[], secrets: readonly string[]): void {
  const fields = [command, ...args];
  for (const secret of secrets) {
    const pieces = [secret, ...secret.split(/\r?\n/)];
    for (const piece of pieces) {
      if (piece.length < 8) continue;
      for (const field of fields) {
        if (field.includes(piece)) throw new ZeroArgvSecretError();
      }
    }
  }
}

function runChild(
  command: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string | undefined,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_CAPTURE_BYTES) {
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_CAPTURE_BYTES) {
        child.kill();
        return;
      }
      stderr.push(chunk);
    });
    child.once("error", reject);
    child.once("exit", (exitCode) => {
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}
