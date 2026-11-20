import { createHash } from "node:crypto";

export function sha256Hex(content: string | Uint8Array): string {
  const hash = createHash("sha256");
  if (typeof content === "string") hash.update(content, "utf8");
  else hash.update(content);
  return hash.digest("hex");
}

export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error("maxBytes must be a non-negative safe integer");
  }
  const encoded = Buffer.from(text, "utf8");
  if (encoded.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1;
  return { text: encoded.subarray(0, end).toString("utf8"), truncated: true };
}

export function truncateTokens(text: string, maxTokens: number): { text: string; truncated: boolean } {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 0) {
    throw new Error("maxTokens must be a non-negative safe integer");
  }
  const parts = text.split(/(\s+)/);
  let tokens = 0;
  let out = "";
  for (const part of parts) {
    if (part === "") continue;
    if (!/^\s+$/.test(part)) {
      if (tokens >= maxTokens) return { text: out.replace(/\s+$/u, ""), truncated: true };
      tokens += 1;
    }
    out += part;
  }
  return { text, truncated: false };
}
