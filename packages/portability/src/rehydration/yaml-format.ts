import type { EntityKind, ExportEntity, ExportManifest, LeaseDocument } from "./types.js";
import { RehydrationError } from "./errors.js";

function yamlScalar(value: string): string {
  if (/^[a-zA-Z0-9._@-]+$/.test(value) && value.length > 0) return value;
  return JSON.stringify(value);
}

function yamlLine(key: string, value: string | number | boolean): string {
  if (typeof value === "boolean") return `${key}: ${value ? "true" : "false"}`;
  if (typeof value === "number") return `${key}: ${value}`;
  return `${key}: ${yamlScalar(String(value))}`;
}

function serializeFields(fields: Record<string, unknown>, indent = "  "): string[] {
  const lines: string[] = [];
  for (const key of Object.keys(fields).sort()) {
    const value = fields[key];
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      lines.push(...serializeFields(value as Record<string, unknown>, `${indent}  `));
    } else if (Array.isArray(value)) {
      lines.push(`${indent}${key}:`);
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          lines.push(`${indent}  -`);
          lines.push(...serializeFields(item as Record<string, unknown>, `${indent}    `).map((line) => `  ${line}`));
        } else {
          lines.push(`${indent}  - ${yamlScalar(String(item))}`);
        }
      }
    } else {
      lines.push(`${indent}${yamlLine(key, value as string | number | boolean).trim()}`);
    }
  }
  return lines;
}

export function serializeEntity(entity: ExportEntity): string {
  const lines = [yamlLine("id", entity.id), yamlLine("kind", entity.kind), yamlLine("revision", entity.revision)];
  if (entity.title !== undefined) lines.push(yamlLine("title", entity.title));
  if (entity.text !== undefined) lines.push(yamlLine("text", entity.text));
  if (entity.deleted === true) lines.push(yamlLine("deleted", true));
  lines.push("fields:");
  lines.push(...serializeFields(entity.fields));
  return `${lines.join("\n")}\n`;
}

export function serializeManifest(manifest: ExportManifest): string {
  const lines = [
    yamlLine("schemaVersion", manifest.schemaVersion),
    yamlLine("projectId", manifest.projectId),
    yamlLine("exportedAt", manifest.exportedAt),
    yamlLine("canonicalGraphSha256", manifest.canonicalGraphSha256),
    yamlLine("deviceId", manifest.deviceId),
    yamlLine("writerEpoch", manifest.writerEpoch),
  ];
  return `${lines.join("\n")}\n`;
}

export function serializeLease(lease: LeaseDocument): string {
  const lines = [
    yamlLine("device_id", lease.deviceId),
    yamlLine("holder", lease.holder),
    yamlLine("epoch", lease.epoch),
    yamlLine("heartbeat", lease.heartbeat),
    yamlLine("revision", lease.revision),
  ];
  if (lease.buildActive !== undefined) lines.push(yamlLine("build_active", lease.buildActive));
  return `${lines.join("\n")}\n`;
}

function parseScalar(raw: string): string | number | boolean {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const root: Record<string, unknown> = {};
  const stack: { indent: number; container: Record<string, unknown> }[] = [{ indent: -1, container: root }];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const indent = line.search(/\S|$/);
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= (stack.at(-1)?.indent ?? -1)) {
      stack.pop();
    }
    const parent = stack.at(-1)?.container ?? root;

    const keyMatch = /^([^:]+):\s*(.*)$/.exec(trimmed);
    if (!keyMatch) continue;
    const key = keyMatch[1]?.trim() ?? "";
    const rawValue = keyMatch[2] ?? "";
    if (rawValue === "") {
      const next: Record<string, unknown> = {};
      parent[key] = next;
      stack.push({ indent, container: next });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }
  return root;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") {
    throw new RehydrationError("yaml_invalid", `missing or invalid ${key}`);
  }
  return String(value);
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number") {
    throw new RehydrationError("yaml_invalid", `missing or invalid ${key}`);
  }
  return value;
}

const ENTITY_KINDS = new Set<string>([
  "decision",
  "requirement",
  "entity",
  "contract",
  "feature",
  "screen",
  "rule",
  "task",
  "edge",
]);

export function parseManifest(text: string): ExportManifest {
  const record = parseSimpleYaml(text);
  return {
    schemaVersion: requiredNumber(record, "schemaVersion"),
    projectId: requiredString(record, "projectId"),
    exportedAt: requiredString(record, "exportedAt"),
    canonicalGraphSha256: requiredString(record, "canonicalGraphSha256"),
    deviceId: requiredString(record, "deviceId"),
    writerEpoch: requiredNumber(record, "writerEpoch"),
  };
}

export function parseLease(text: string): LeaseDocument {
  const record = parseSimpleYaml(text);
  const deviceId =
    typeof record.device_id === "string"
      ? record.device_id
      : typeof record.activeDeviceId === "string"
        ? record.activeDeviceId
        : requiredString(record, "deviceId");
  const holder =
    typeof record.holder === "string"
      ? record.holder
      : typeof record.activeDeviceLabel === "string"
        ? record.activeDeviceLabel
        : requiredString(record, "holder");
  const epoch =
    typeof record.epoch === "number"
      ? record.epoch
      : typeof record.writerEpoch === "number"
        ? record.writerEpoch
        : requiredNumber(record, "epoch");
  const heartbeat =
    typeof record.heartbeat === "string"
      ? record.heartbeat
      : typeof record.heartbeatAtUtc === "string"
        ? record.heartbeatAtUtc
        : requiredString(record, "heartbeat");
  return {
    deviceId,
    holder,
    epoch,
    heartbeat,
    revision: requiredNumber(record, "revision"),
    buildActive: record.build_active === true || record.buildActive === true,
  };
}

export function parseEntity(text: string, filePath: string): ExportEntity {
  const record = parseSimpleYaml(text);
  const kind = requiredString(record, "kind");
  if (!ENTITY_KINDS.has(kind)) {
    throw new RehydrationError("yaml_invalid", `unknown entity kind in ${filePath}`);
  }
  const fields =
    (record.fields as Record<string, unknown> | undefined) ??
    Object.fromEntries(
      Object.entries(record).filter(
        ([key]) => !["id", "kind", "revision", "title", "text", "deleted"].includes(key),
      ),
    );
  return {
    id: requiredString(record, "id"),
    kind: kind as EntityKind,
    revision: requiredNumber(record, "revision"),
    fields,
    ...(typeof record.title === "string" ? { title: record.title } : {}),
    ...(typeof record.text === "string" ? { text: record.text } : {}),
    ...(record.deleted === true ? { deleted: true as const } : {}),
  };
}