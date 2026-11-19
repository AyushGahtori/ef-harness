export const packageName = "@ef-harness/shared-observability" as const;
export const layer = 0 as const;

const SECRET_PARTS: readonly (readonly string[])[] = [
  ["sk", "_live_"],
  ["sk-ant", "-"],
  ["sk-proj", "-"],
  ["ghp", "_"],
  ["AK", "IA"],
  ["BEGIN ", "PRIVATE KEY"],
];

export function redactSecrets(value: string): string {
  let redacted = value;
  for (const parts of SECRET_PARTS) {
    redacted = redacted.split(parts.join("")).join("[redacted]");
  }
  return redacted;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export function formatLog(
  level: LogLevel,
  message: string,
  fields?: Readonly<Record<string, string | number | boolean>>,
): string {
  const entry: {
    level: LogLevel;
    message: string;
    fields?: Readonly<Record<string, string | number | boolean>>;
  } = {
    level,
    message: redactSecrets(message),
  };
  if (fields) {
    const clean: Record<string, string | number | boolean> = {};
    for (const [key, field] of Object.entries(fields)) {
      clean[key] = typeof field === "string" ? redactSecrets(field) : field;
    }
    entry.fields = clean;
  }
  return JSON.stringify(entry);
}

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}
