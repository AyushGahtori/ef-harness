export interface SseFrame {
  readonly event: string;
  readonly data: string;
  readonly id: string | null;
}

/**
 * Line-buffered SSE reader. Incomplete UTF-8 sequences stay inside TextDecoder
 * until the next byte arrives, and incomplete lines stay buffered until a blank line.
 */
export class SseByteParser {
  private readonly decoder = new TextDecoder("utf-8");
  private buffered = "";

  push(chunk: Uint8Array): SseFrame[] {
    this.buffered += this.decoder.decode(chunk, { stream: true });
    return this.pullFrames();
  }

  finish(): SseFrame[] {
    this.buffered += this.decoder.decode();
    const frames = this.pullFrames();
    if (this.buffered.length > 0) {
      const trailing = parseSseBlock(this.buffered);
      this.buffered = "";
      if (trailing) frames.push(trailing);
    }
    return frames;
  }

  private pullFrames(): SseFrame[] {
    const frames: SseFrame[] = [];
    for (;;) {
      const boundary = findFrameBoundary(this.buffered);
      if (boundary === null) break;
      const block = this.buffered.slice(0, boundary.index);
      this.buffered = this.buffered.slice(boundary.index + boundary.length);
      const frame = parseSseBlock(block);
      if (frame) frames.push(frame);
    }
    return frames;
  }
}

function findFrameBoundary(text: string): { index: number; length: number } | null {
  const lf = text.indexOf("\n\n");
  const crlf = text.indexOf("\r\n\r\n");
  if (lf < 0 && crlf < 0) return null;
  if (crlf < 0) return { index: lf, length: 2 };
  if (lf < 0) return { index: crlf, length: 4 };
  return lf < crlf ? { index: lf, length: 2 } : { index: crlf, length: 4 };
}

function parseSseBlock(block: string): SseFrame | null {
  const lines = block.split(/\r?\n/);
  let event = "";
  let id: string | null = null;
  const data: string[] = [];
  let sawField = false;
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? "" : line.slice(separator + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    sawField = true;
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
    else if (field === "id") id = value;
  }
  if (!sawField || data.length === 0) return null;
  return { event, data: data.join("\n"), id };
}

export function parseJsonRecord(raw: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
