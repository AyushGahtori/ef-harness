import { SecretRedactor, StreamingRedactor, scanForSecrets } from "@ef-harness/shared-observability";

const SECRET_KEY_PATTERN = /(?:secret|token|password|api[_-]?key|authorization|bearer)/i;
const STREAM_OVERLAP = 64;

/**
 * Store secret names and redacted digests. Values pass through `StreamingRedactor`.
 */
export function redactEffectPayload(payload: unknown): unknown {
  return redactValue(payload);
}

export function assertNoRawSecretsInPayload(payload: unknown): void {
  const findings = scanForSecrets(JSON.stringify(payload));
  if (findings.length > 0) {
    throw new Error("effects payload contains a raw secret value");
  }
}

function redactValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string") return redactString(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  const record = value as Record<string, unknown>;
  if (record.kind === "env_sync" && Array.isArray(record.variables)) {
    return {
      ...record,
      variables: record.variables.map((entry) => redactEnvVariable(entry)),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (SECRET_KEY_PATTERN.test(key) && typeof child === "string") {
      out[key] = { name: key, digest: digestPlaceholder(child) };
      continue;
    }
    out[key] = redactValue(child);
  }
  return out;
}

function redactEnvVariable(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const row = entry as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name : "unknown";
  const digest = typeof row.digest === "string" ? row.digest : "hmac:redacted";
  return { name, digest };
}

function digestPlaceholder(value: string): string {
  const redacted = redactString(value);
  if (redacted !== value) return redacted;
  return value.length > 0 ? "hmac:redacted" : "hmac:empty";
}

function redactString(value: string): string {
  const stream = new StreamingRedactor(new SecretRedactor(), STREAM_OVERLAP);
  return `${stream.push(value)}${stream.flush()}`;
}
