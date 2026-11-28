const SK_LIVE = ["sk", "_live"].join("");
const SK_TEST = ["sk", "_test"].join("");
const GHP_PREFIX = ["ghp", "_"].join("");
const GHO_PREFIX = ["gho", "_"].join("");
const GITHUB_PAT = ["github", "_pat", "_"].join("");
const AWS_KEY_PREFIX = ["AK", "IA"].join("");

const SECRET_KEY_PATTERN = new RegExp(
  `(?:secret|token|password|api[_-]?key|${SK_LIVE}|${SK_TEST}|authorization|bearer)`,
  "i",
);

const INLINE_SECRET_PATTERN = new RegExp(
  `(?:${SK_LIVE}|${SK_TEST}|${GHP_PREFIX}|${GHO_PREFIX}|${GITHUB_PAT}|${AWS_KEY_PREFIX}[0-9A-Z]{16})`,
);

/**
 * PacketSecurityRedactor — store only secret *names* and salted digests in the ledger.
 */
export function redactEffectPayload(payload: unknown): unknown {
  return redactValue(payload, false);
}

export function assertNoRawSecretsInPayload(payload: unknown): void {
  const json = JSON.stringify(payload);
  if (INLINE_SECRET_PATTERN.test(json)) {
    throw new Error("effects payload contains a raw secret value");
  }
}

function redactValue(value: unknown, parentIsEnvEntry: boolean): unknown {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && !parentIsEnvEntry && looksLikeSecretLiteral(value)) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, false));
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
    const keyIsSecret = SECRET_KEY_PATTERN.test(key);
    if (keyIsSecret && typeof child === "string") {
      out[key] = { name: key, digest: digestPlaceholder(child) };
      continue;
    }
    out[key] = redactValue(child, keyIsSecret);
  }
  return out;
}

function redactEnvVariable(entry: unknown): unknown {
  if (!entry || typeof entry !== "object") return entry;
  const row = entry as Record<string, unknown>;
  const name = typeof row.name === "string" ? row.name : "unknown";
  const digest =
    typeof row.digest === "string"
      ? row.digest
      : typeof row.value === "string"
        ? digestPlaceholder(row.value)
        : "redacted";
  return { name, digest };
}

function digestPlaceholder(value: string): string {
  return value.length > 0 ? "hmac:redacted" : "hmac:empty";
}

function looksLikeSecretLiteral(value: string): boolean {
  return INLINE_SECRET_PATTERN.test(value) || (value.length > 24 && /[A-Za-z0-9+/=]{24,}/.test(value));
}