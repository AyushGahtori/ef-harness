import {
  SecretRedactor as ObservabilitySecretRedactor,
  getSharedSecretRedactor,
} from "@ef-harness/shared-observability";
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

/** Canonical redactor. The historical name remains so callers keep one constructor. */
export class LocalSecretRedactor extends ObservabilitySecretRedactor {}

export async function loadSharedSecretRedactor(): Promise<SecretRedactor> {
  return getSharedSecretRedactor();
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
