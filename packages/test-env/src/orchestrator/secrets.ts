import { MissingEnvironmentSecretError, UnresolvedEnvironmentPlaceholderError } from "./errors.js";
import type { EnvironmentKind, SecretVault } from "./types.js";

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_.-]*)\}/g;
const SECRET_PREFIX = "secret.";

export function resolveTemplates(
  templates: Readonly<Record<string, string>>,
  values: Readonly<Record<string, string>>,
  vault: SecretVault,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(templates)) {
    resolved[key] = resolveTemplate(template, values, vault);
  }
  return resolved;
}

export function resolveTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
  vault: SecretVault,
): string {
  return template.replace(PLACEHOLDER, (whole, token: string) => {
    if (token.startsWith(SECRET_PREFIX)) {
      const name = token.slice(SECRET_PREFIX.length);
      if (name === "") {
        throw new MissingEnvironmentSecretError(name);
      }
      const secret = vault.get(name);
      if (secret === undefined) {
        throw new MissingEnvironmentSecretError(name);
      }
      return secret;
    }
    const value = values[token];
    if (value === undefined) {
      throw new UnresolvedEnvironmentPlaceholderError(token);
    }
    return value;
  });
}

export function runtimeVaultInjection(
  kind: EnvironmentKind,
  vault: SecretVault,
): Readonly<Record<string, string>> {
  if (kind === "verifier" || kind === "preview") return vault.entries();
  return {};
}

export function collectSecretValues(vault: SecretVault): string[] {
  const values = new Set<string>();
  for (const value of Object.values(vault.entries())) {
    if (value.length >= 6) values.add(value);
  }
  return [...values];
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    if (secret.length === 0) continue;
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

export class MapSecretVault implements SecretVault {
  private readonly values: Readonly<Record<string, string>>;

  constructor(values: Readonly<Record<string, string>> = {}) {
    this.values = { ...values };
  }

  get(name: string): string | undefined {
    return this.values[name];
  }

  entries(): Readonly<Record<string, string>> {
    return this.values;
  }
}
