import { SESSION_TOKEN_LABEL } from "./constants.js";

/** Structural subset of Task 011 `SecretRedactor`. */
export interface SecretRedactor {
  register(label: string, value: string): void;
  forget(label: string): boolean;
  redact(text: string): string;
}

/** Structural subset of Task 011 `StructuredLogger`. */
export interface StructuredLogger {
  debug(message: string, fields?: unknown): void;
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
  fatal?(message: string, fields?: unknown): void;
}

export function normalizeRedactionLabel(label: string): string {
  const cleaned = label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  return cleaned.length > 0 ? cleaned : "SECRET";
}

export class LocalSecretRedactor implements SecretRedactor {
  private readonly values = new Map<string, string>();

  register(label: string, value: string): void {
    if (value.length === 0) return;
    this.values.set(normalizeRedactionLabel(label), value);
  }

  forget(label: string): boolean {
    return this.values.delete(normalizeRedactionLabel(label));
  }

  redact(text: string): string {
    let output = text;
    for (const [label, value] of this.values) {
      if (value.length === 0 || !output.includes(value)) continue;
      output = output.split(value).join(`[REDACTED:${label}]`);
    }
    return output;
  }
}

export function isSecretRedactor(value: unknown): value is SecretRedactor {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { register?: unknown; forget?: unknown; redact?: unknown };
  return (
    typeof candidate.register === "function" &&
    typeof candidate.forget === "function" &&
    typeof candidate.redact === "function"
  );
}

export async function loadSharedSecretRedactor(): Promise<SecretRedactor | undefined> {
  const specifier = "@ef-harness/shared-contracts/telemetry";
  try {
    const loaded: unknown = await import(specifier);
    if (!loaded || typeof loaded !== "object" || !("getSharedSecretRedactor" in loaded)) return undefined;
    const getShared = loaded.getSharedSecretRedactor;
    if (typeof getShared !== "function") return undefined;
    const redactor: unknown = getShared();
    return isSecretRedactor(redactor) ? redactor : undefined;
  } catch {
    return undefined;
  }
}

function redactUnknown(value: unknown, redactor: SecretRedactor): unknown {
  if (typeof value === "string") return redactor.redact(value);
  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, redactor));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) output[key] = redactUnknown(item, redactor);
  return output;
}

export function createRedactingLogger(
  redactor: SecretRedactor,
  sink?: (line: string) => void,
): StructuredLogger {
  const write = (level: string, message: string, fields?: unknown): void => {
    const line = JSON.stringify({
      level,
      message: redactor.redact(message),
      fields: fields === undefined ? undefined : redactUnknown(fields, redactor),
    });
    sink?.(line);
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
    fatal: (message, fields) => write("fatal", message, fields),
  };
}

export function bindLogger(logger: StructuredLogger, redactor: SecretRedactor): StructuredLogger {
  const scrub = (message: string, fields?: unknown): { message: string; fields?: unknown } => {
    const safe = redactor.redact(message);
    if (fields === undefined) return { message: safe };
    return { message: safe, fields: redactUnknown(fields, redactor) };
  };
  const bound: StructuredLogger = {
    debug: (message, fields) => {
      const safe = scrub(message, fields);
      logger.debug(safe.message, safe.fields);
    },
    info: (message, fields) => {
      const safe = scrub(message, fields);
      logger.info(safe.message, safe.fields);
    },
    warn: (message, fields) => {
      const safe = scrub(message, fields);
      logger.warn(safe.message, safe.fields);
    },
    error: (message, fields) => {
      const safe = scrub(message, fields);
      logger.error(safe.message, safe.fields);
    },
  };
  if (logger.fatal) {
    const fatal = logger.fatal.bind(logger);
    bound.fatal = (message, fields) => {
      const safe = scrub(message, fields);
      fatal(safe.message, safe.fields);
    };
  }
  return bound;
}

export function registerSessionToken(redactor: SecretRedactor, token: string): void {
  redactor.register(SESSION_TOKEN_LABEL, token);
}
