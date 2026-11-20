import { replaceAllLiteral } from "./text-util.js";

/**
 * Local stand-in for `SecretRedactor` (Task 011).
 * Swap this port for the shared telemetry redactor when that package is wired.
 * The method name matches the integration adapter: `redact(text) -> string`.
 */
export interface SecretRedactorPort {
  redact(text: string): string;
}

const VAULT_MIN_LENGTH = 8;

interface BuiltinPattern {
  readonly label: string;
  readonly source: string;
}

function pattern(label: string, parts: readonly string[]): BuiltinPattern {
  return { label, source: parts.join("") };
}

const BUILTIN_PATTERNS: readonly BuiltinPattern[] = [
  pattern("STRIPE_LIVE", ["sk", "_live_", "[A-Za-z0-9]{8,}"]),
  pattern("STRIPE_TEST", ["sk", "_test_", "[A-Za-z0-9]{8,}"]),
  pattern("ANTHROPIC", ["sk-ant", "-", "[A-Za-z0-9_\\-]{8,}"]),
  pattern("OPENAI_PROJECT", ["sk-proj", "-", "[A-Za-z0-9_\\-]{8,}"]),
  pattern("OPENROUTER", ["sk-or", "-v1-", "[A-Za-z0-9]{8,}"]),
  pattern("GOOGLE", ["AIza", "[0-9A-Za-z\\-_]{20,}"]),
  pattern("GITHUB_TOKEN", ["ghp", "_", "[A-Za-z0-9]{8,}"]),
  pattern("GITHUB_OAUTH", ["gho", "_", "[A-Za-z0-9]{8,}"]),
  pattern("GITHUB_FINE", ["github_pat", "_", "[A-Za-z0-9_]{8,}"]),
  pattern("AWS_ACCESS_KEY", ["AK", "IA", "[0-9A-Z]{16}"]),
  pattern("PEM_PRIVATE_KEY", [
    "-----",
    "BEGIN ",
    "PRIVATE KEY",
    "-----[\\s\\S]*?-----",
    "END ",
    "PRIVATE KEY",
    "-----",
  ]),
  pattern("BEARER", ["Bearer\\s+[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{8,}\\.[A-Za-z0-9_\\-]{4,}"]),
  pattern("BASIC_AUTH", ["[a-z][a-z0-9+.-]*://[^\\s/@:]{1,48}:[^\\s/@]{8,}@"]),
  pattern("ASSIGNED_SECRET", [
    "(?:api[_-]?key|client[_-]?secret|access[_-]?token|password)\\s*[:=]\\s*['\"][^'\"]{12,}['\"]",
  ]),
];

export class LocalSecretRedactor implements SecretRedactorPort {
  private readonly vault: string[] = [];

  registerVaultSecret(secret: string): boolean {
    if (secret.length < VAULT_MIN_LENGTH) return false;
    if (!this.vault.includes(secret)) this.vault.push(secret);
    return true;
  }

  redact(text: string): string {
    let output = text;
    const vaultSecrets = [...this.vault].sort((left, right) => right.length - left.length);
    for (const secret of vaultSecrets) {
      for (const variant of secretVariants(secret)) {
        output = replaceAllLiteral(output, variant, "[REDACTED:VAULT]");
      }
    }
    for (const entry of BUILTIN_PATTERNS) {
      const expression = new RegExp(entry.source, "g");
      output = output.replace(expression, `[REDACTED:${entry.label}]`);
    }
    return output;
  }
}

export function secretVariants(secret: string): readonly string[] {
  const base64 = Buffer.from(secret, "utf8").toString("base64");
  const base64Url = base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
  const urlEncoded = encodeURIComponent(secret);
  const jsonEscaped = secret.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const unique = new Set([secret, base64, base64Url, urlEncoded, jsonEscaped]);
  return [...unique].filter((value) => value.length >= VAULT_MIN_LENGTH).sort((left, right) => right.length - left.length);
}

export function createDefaultRedactor(): SecretRedactorPort {
  return new LocalSecretRedactor();
}
