import { createHash } from "node:crypto";

/** Local Task 007 port: RFC 8785-style stable JSON + SHA-256 for cache keys. */

export interface CanonicalHash {
  normalizeNfc(text: string): string;
  sha256(bytes: Uint8Array): string;
  sha256Utf8(text: string): string;
}

export function createCanonicalHash(): CanonicalHash {
  return {
    normalizeNfc(text: string): string {
      return text.normalize("NFC");
    },
    sha256(bytes: Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    },
    sha256Utf8(text: string): string {
      return createHash("sha256").update(text, "utf8").digest("hex");
    },
  };
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const child = record[key];
      if (child !== undefined) {
        sorted[key] = sortValue(child);
      }
    }
    return sorted;
  }
  return value;
}

export function exactInputCacheKey(input: {
  modelId: string;
  systemPrompt: string;
  messagesJson: string;
  toolsSchemaJson: string;
  temperature: number;
  seed: number;
  responseFormatSchema: string;
}): string {
  const hasher = createCanonicalHash();
  const payload = stableJson({
    messagesJson: hasher.normalizeNfc(input.messagesJson),
    modelId: input.modelId,
    responseFormatSchema: hasher.normalizeNfc(input.responseFormatSchema),
    seed: input.seed,
    systemPrompt: hasher.normalizeNfc(input.systemPrompt),
    temperature: input.temperature,
    toolsSchemaJson: hasher.normalizeNfc(input.toolsSchemaJson),
  });
  return hasher.sha256Utf8(payload);
}