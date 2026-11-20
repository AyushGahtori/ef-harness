import { compareText } from "./canonical-hash.js";

/** Deterministic ef-fields YAML. Strings are always quoted. Anchors are never emitted. */
export function emitYamlDocument(value: Record<string, unknown>): string {
  const rendered = emitObject(value, 0);
  if (rendered === "{}") return "{}\n";
  return `${rendered.replace(/^\n/, "")}\n`;
}

function emitValue(value: unknown, indent: number): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.normalize("NFC"));
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non-finite number in ef-fields");
    }
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return emitArray(value, indent);
  if (typeof value === "object") return emitObject(value as Record<string, unknown>, indent);
  throw new Error(`unsupported ef-fields value: ${typeof value}`);
}

function emitObject(value: Record<string, unknown>, indent: number): string {
  const keys = Object.keys(value).sort(compareText);
  if (keys.length === 0) return "{}";
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const key of keys) {
    const rendered = emitValue(value[key], indent + 2);
    if (rendered.startsWith("\n")) lines.push(`${pad}${quoteKey(key)}:${rendered}`);
    else lines.push(`${pad}${quoteKey(key)}: ${rendered}`);
  }
  return `\n${lines.join("\n")}`;
}

function emitArray(value: readonly unknown[], indent: number): string {
  if (value.length === 0) return "[]";
  const pad = " ".repeat(indent);
  const lines: string[] = [];
  for (const item of value) {
    if (isPlainObject(item)) {
      const keys = Object.keys(item).sort(compareText);
      if (keys.length === 0) {
        lines.push(`${pad}- {}`);
        continue;
      }
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index] ?? "";
        const rendered = emitValue(item[key], indent + 2);
        const prefix = index === 0 ? `${pad}- ` : `${pad}  `;
        if (rendered.startsWith("\n")) lines.push(`${prefix}${quoteKey(key)}:${rendered}`);
        else lines.push(`${prefix}${quoteKey(key)}: ${rendered}`);
      }
      continue;
    }
    const rendered = emitValue(item, indent + 2);
    if (rendered.startsWith("\n")) lines.push(`${pad}-${rendered}`);
    else lines.push(`${pad}- ${rendered}`);
  }
  return `\n${lines.join("\n")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function quoteKey(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return key;
  return JSON.stringify(key);
}
