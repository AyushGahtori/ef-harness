import { ManifestValidationError } from "./errors.js";
import {
  ENVIRONMENT_KINDS,
  PROVISIONING_TIERS,
  SERVICE_NAMES,
  type AppSpec,
  type EnvironmentKind,
  type EnvironmentManifest,
  type ProvisioningTier,
  type ServiceName,
  type ServiceSpec,
} from "./types.js";

const SERVICE_NAME_SET = new Set<string>(SERVICE_NAMES);
const EXTRA_NAME = /^[a-z][a-z0-9_-]{0,40}$/;

type YamlValue = string | number | boolean | YamlValue[] | { readonly [key: string]: YamlValue };

interface YamlLine {
  readonly indent: number;
  readonly text: string;
}

export const EnvironmentManifestSchema = {
  parse(input: string | EnvironmentManifest | unknown): EnvironmentManifest {
    if (typeof input === "string") {
      return validateManifest(parseSimpleYaml(input));
    }
    return validateManifest(input);
  },
};

export function parseEnvironmentKind(value: string): EnvironmentKind {
  if ((ENVIRONMENT_KINDS as readonly string[]).includes(value)) {
    return value as EnvironmentKind;
  }
  throw new ManifestValidationError(
    `environment kind must be attempt, verifier, migration, or preview`,
  );
}

function parseSimpleYaml(source: string): YamlValue {
  const lines: YamlLine[] = [];
  for (const raw of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (raw.includes("\t")) {
      throw new ManifestValidationError("environment manifest indentation must use spaces");
    }
    const stripped = stripComment(raw).trimEnd();
    if (stripped.trim() === "") continue;
    const indent = stripped.length - stripped.trimStart().length;
    lines.push({ indent, text: stripped.trim() });
  }
  if (lines.length === 0) {
    throw new ManifestValidationError("environment manifest is empty");
  }
  const parsed = parseBlock(lines, 0, 0);
  if (parsed.next !== lines.length) {
    throw new ManifestValidationError("environment manifest has trailing structure");
  }
  return parsed.value;
}

function parseBlock(
  lines: readonly YamlLine[],
  start: number,
  minIndent: number,
): {
  value: YamlValue;
  next: number;
} {
  const first = lines[start];
  if (!first || first.indent < minIndent) {
    return { value: {}, next: start };
  }
  if (first.text.startsWith("- ")) {
    return parseList(lines, start, first.indent);
  }
  return parseMap(lines, start, first.indent);
}

function parseMap(
  lines: readonly YamlLine[],
  start: number,
  indent: number,
): {
  value: { [key: string]: YamlValue };
  next: number;
} {
  const result: { [key: string]: YamlValue } = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) {
      throw new ManifestValidationError(`unexpected indent near "${line.text}"`);
    }
    if (line.text.startsWith("- ")) break;
    const separated = splitKey(line.text);
    if (!separated) {
      throw new ManifestValidationError(`expected key: value near "${line.text}"`);
    }
    const { key, raw } = separated;
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      throw new ManifestValidationError(`duplicate manifest key ${key}`);
    }
    index += 1;
    if (raw === "") {
      const nested = parseBlock(lines, index, indent + 1);
      result[key] = nested.value;
      index = nested.next;
      continue;
    }
    if (raw === "[]") {
      result[key] = [];
      continue;
    }
    if (raw === "{}") {
      result[key] = {};
      continue;
    }
    if (raw.startsWith("[") && raw.endsWith("]")) {
      result[key] = parseInlineList(raw.slice(1, -1));
      continue;
    }
    result[key] = parseScalar(raw);
  }
  return { value: result, next: index };
}

function parseList(
  lines: readonly YamlLine[],
  start: number,
  indent: number,
): {
  value: YamlValue[];
  next: number;
} {
  const result: YamlValue[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (!line || line.indent < indent) break;
    if (line.indent > indent) {
      throw new ManifestValidationError(`unexpected indent near "${line.text}"`);
    }
    if (!line.text.startsWith("- ")) break;
    const raw = line.text.slice(2).trim();
    index += 1;
    if (raw === "") {
      const nested = parseBlock(lines, index, indent + 1);
      result.push(nested.value);
      index = nested.next;
      continue;
    }
    result.push(parseScalar(raw));
  }
  return { value: result, next: index };
}

function parseInlineList(body: string): YamlValue[] {
  const trimmed = body.trim();
  if (trimmed === "") return [];
  return trimmed.split(",").map((part) => parseScalar(part.trim()));
}

function parseScalar(raw: string): YamlValue {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function splitKey(text: string): { key: string; raw: string } | null {
  const match = /^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/.exec(text);
  if (!match) return null;
  return { key: match[1] ?? "", raw: match[2] ?? "" };
}

function stripComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || line[index - 1] === " ")) {
      return line.slice(0, index);
    }
  }
  return line;
}

function validateManifest(input: unknown): EnvironmentManifest {
  const record = asRecord(input, "environment manifest");
  const allowed = new Set(["services", "app", "extraServices", "env", "tier"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ManifestValidationError(`unknown manifest field ${key}`);
    }
  }
  const services = validateServices(record.services);
  const app = record.app === undefined ? undefined : validateApp(record.app);
  const extraServices =
    record.extraServices === undefined ? undefined : validateExtra(record.extraServices);
  const env = record.env === undefined ? {} : validateEnv(record.env);
  const tier = record.tier === undefined ? undefined : validateTier(record.tier);
  return {
    services,
    env,
    ...(app ? { app } : {}),
    ...(extraServices ? { extraServices } : {}),
    ...(tier !== undefined ? { tier } : {}),
  };
}

function validateServices(value: unknown): ServiceName[] {
  if (!Array.isArray(value)) {
    throw new ManifestValidationError("services must be a list");
  }
  const services: ServiceName[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !SERVICE_NAME_SET.has(entry)) {
      throw new ManifestValidationError(`unsupported service ${String(entry)}`);
    }
    services.push(entry as ServiceName);
  }
  return services;
}

function validateApp(value: unknown): AppSpec {
  const record = asRecord(value, "app");
  const start = requiredString(record, "start", "app.start");
  const ready = requiredString(record, "ready", "app.ready");
  const cwd = optionalString(record, "cwd", "app.cwd");
  const memoryCeilingMb = optionalPositive(record, "memoryCeilingMb", "app.memoryCeilingMb");
  rejectUnknown(record, ["start", "ready", "cwd", "memoryCeilingMb"], "app");
  return {
    start,
    ready,
    ...(cwd !== undefined ? { cwd } : {}),
    ...(memoryCeilingMb !== undefined ? { memoryCeilingMb } : {}),
  };
}

function validateExtra(value: unknown): Record<string, ServiceSpec> {
  const record = asRecord(value, "extraServices");
  const extra: Record<string, ServiceSpec> = {};
  for (const [name, spec] of Object.entries(record)) {
    if (!EXTRA_NAME.test(name) || SERVICE_NAME_SET.has(name)) {
      throw new ManifestValidationError(`invalid extra service name ${name}`);
    }
    const body = asRecord(spec, `extraServices.${name}`);
    rejectUnknown(body, ["start", "ready", "cwd", "memoryCeilingMb"], `extraServices.${name}`);
    const cwd = optionalString(body, "cwd", `extraServices.${name}.cwd`);
    const memoryCeilingMb = optionalPositive(
      body,
      "memoryCeilingMb",
      `extraServices.${name}.memoryCeilingMb`,
    );
    extra[name] = {
      start: requiredString(body, "start", `extraServices.${name}.start`),
      ready: requiredString(body, "ready", `extraServices.${name}.ready`),
      ...(cwd !== undefined ? { cwd } : {}),
      ...(memoryCeilingMb !== undefined ? { memoryCeilingMb } : {}),
    };
  }
  return extra;
}

function validateEnv(value: unknown): Record<string, string> {
  const record = asRecord(value, "env");
  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== "string") {
      throw new ManifestValidationError(`env.${key} must be a string`);
    }
    env[key] = entry;
  }
  return env;
}

function validateTier(value: unknown): ProvisioningTier {
  if (typeof value !== "number" || !(PROVISIONING_TIERS as readonly number[]).includes(value)) {
    throw new ManifestValidationError("tier must be 0, 1, 2, or 3");
  }
  return value as ProvisioningTier;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestValidationError(`${label} must be a map`);
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ManifestValidationError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | undefined {
  if (record[key] === undefined) return undefined;
  return requiredString(record, key, label);
}

function optionalPositive(
  record: Record<string, unknown>,
  key: string,
  label: string,
): number | undefined {
  if (record[key] === undefined) return undefined;
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ManifestValidationError(`${label} must be a positive number`);
  }
  return value;
}

function rejectUnknown(
  record: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const permitted = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!permitted.has(key)) {
      throw new ManifestValidationError(`unknown ${label} field ${key}`);
    }
  }
}
