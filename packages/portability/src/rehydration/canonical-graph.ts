import { createHash } from "node:crypto";

import type { ExportEntity, HistoryRecord } from "./types.js";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) sorted[key] = sortValue(child);
    }
    return sorted;
  }
  return value;
}

export function stableSortedJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function computeCanonicalGraphSha256(
  entities: readonly ExportEntity[],
  history: readonly HistoryRecord[] = [],
): string {
  const body = stableSortedJson({
    entities: entities
      .filter((entity) => entity.deleted !== true)
      .map((entity) => ({
        id: entity.id,
        kind: entity.kind,
        revision: entity.revision,
        title: entity.title ?? "",
        text: entity.text ?? "",
        fields: entity.fields,
      }))
      .sort((left, right) => {
        const byKind = left.kind.localeCompare(right.kind);
        if (byKind !== 0) return byKind;
        return left.id.localeCompare(right.id);
      }),
    history: [...history].sort((left, right) => left.changeId.localeCompare(right.changeId)),
  });
  return sha256Hex(new TextEncoder().encode(body));
}