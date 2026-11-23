import type { EntityKind, ExportEntity, ExportManifest, LeaseSnapshot } from "./types.js";
import { ENTITY_PATHS } from "./types.js";

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
          lines.push(...serializeFields(item as Record<string, unknown>, `${indent}    `).map((l) => `  ${l}`));
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

export class SortedPerEntityYamlSerializer {
  entityPath(kind: EntityKind, id: string): string {
    const edgePath = kind === "edge" ? `${ENTITY_PATHS.edge}/${id}.yaml` : `${ENTITY_PATHS[kind]}/${id}.yaml`;
    return edgePath;
  }

  serializeEntity(entity: ExportEntity): string {
    const lines = [
      yamlLine("id", entity.id),
      yamlLine("kind", entity.kind),
      yamlLine("revision", entity.revision),
    ];
    if (entity.title !== undefined) lines.push(yamlLine("title", entity.title));
    if (entity.text !== undefined) lines.push(yamlLine("text", entity.text));
    if (entity.deleted === true) lines.push(yamlLine("deleted", true));
    lines.push("fields:");
    lines.push(...serializeFields(entity.fields));
    return `${lines.join("\n")}\n`;
  }

  serializeManifest(manifest: ExportManifest): string {
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

  serializeLease(lease: LeaseSnapshot): string {
    const lines = [
      yamlLine("device_id", lease.deviceId),
      yamlLine("holder", lease.holder),
      yamlLine("epoch", lease.epoch),
      yamlLine("heartbeat", lease.heartbeat),
      yamlLine("revision", lease.revision),
    ];
    return `${lines.join("\n")}\n`;
  }

  historySegmentPath(isoMonth: string, deviceShort: string): string {
    return `history/${isoMonth}-${deviceShort}.jsonl`;
  }
}