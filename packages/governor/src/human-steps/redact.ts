/**
 * Credential-free diagnostics. Passwords and bearer tokens never survive
 * into a stored probe result, a log field, or a badge.
 */

const BEARER = /Bearer\s+[A-Za-z0-9._~+/-]+=*/g;
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]*:)[^@\s/]+@/gi;

export function maskDatabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return "[redacted-database-url]";
  }
  const user = decodeURIComponent(parsed.username);
  const auth = user.length > 0 ? `${user}:***@` : parsed.password.length > 0 ? "***@" : "";
  const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${auth}${parsed.hostname}${port}${parsed.pathname}`;
}

export function scrubSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  const unique = [...new Set(secrets.filter((secret) => secret.length >= 4))];
  unique.sort((left, right) => right.length - left.length);
  for (const secret of unique) {
    out = out.split(secret).join("***");
  }
  return out.replace(BEARER, "Bearer ***").replace(URL_USERINFO, "$1***@");
}

export function assertCredentialFree(text: string, secrets: readonly string[], label: string): void {
  for (const secret of secrets) {
    if (secret.length >= 4 && text.includes(secret)) {
      throw new Error(`${label} still contains a credential`);
    }
  }
}
