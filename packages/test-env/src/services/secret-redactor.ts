/**
 * Local stand-in for Task 011's `SecretRedactor`.
 * Recorded HTTP cassettes pass through this before they are written to CAS.
 */
export interface SecretRedactor {
  redact(value: string): string;
  redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string>;
  redactBody(body: string, contentType: string | undefined): string;
}

const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
]);

const SECRET_JSON_KEYS =
  /^(?:password|passwd|secret|token|access_token|refresh_token|api_key|apikey|ssn|email|phone|authorization)$/i;

export class DefaultSecretRedactor implements SecretRedactor {
  redact(value: string): string {
    return value
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/([?&](?:token|api_key|access_token|password)=)[^&]*/gi, "$1[redacted]")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[redacted-ssn]");
  }

  redactHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      redacted[name.toLowerCase()] = SECRET_HEADERS.has(name.toLowerCase())
        ? "[redacted]"
        : this.redact(value);
    }
    return redacted;
  }

  redactBody(body: string, contentType: string | undefined): string {
    if (body.length === 0) return body;
    if (contentType?.toLowerCase().includes("application/json")) {
      try {
        return JSON.stringify(redactJson(JSON.parse(body) as unknown, this));
      } catch {
        return this.redact(body);
      }
    }
    return this.redact(body);
  }
}

function redactJson(value: unknown, redactor: SecretRedactor): unknown {
  if (typeof value === "string") return redactor.redact(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((item) => redactJson(item, redactor));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = SECRET_JSON_KEYS.test(key) ? "[redacted]" : redactJson(child, redactor);
    }
    return output;
  }
  return null;
}
