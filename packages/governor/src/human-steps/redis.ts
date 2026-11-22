export function encodeRedis(parts: readonly string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${parts.length}\r\n`)];
  for (const part of parts) {
    const bytes = Buffer.from(part, "utf8");
    chunks.push(Buffer.from(`$${bytes.length}\r\n`), bytes, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

export function decodeRedisLine(buffer: Buffer): { readonly line: string; readonly rest: Buffer } | null {
  const end = buffer.indexOf("\r\n");
  if (end < 0) return null;
  return { line: buffer.subarray(0, end).toString("utf8"), rest: buffer.subarray(end + 2) };
}
