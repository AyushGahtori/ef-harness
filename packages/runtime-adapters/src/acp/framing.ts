import { AcpFramingCorruptionError, AcpProtocolError } from "./errors.js";
import type { JsonRpcMessage } from "./types.js";
import { isRecord } from "./types.js";

export interface FramePushResult {
  readonly messages: readonly JsonRpcMessage[];
  readonly error: Error | null;
}

/**
 * Newline-delimited JSON-RPC framing. A single non-JSON line before the first
 * object is a startup banner. Further non-JSON text is framing corruption.
 */
export class AcpFrameParser {
  private buffer = Buffer.alloc(0);
  private seenJson = false;
  private bannerCount = 0;
  readonly startupBanners: string[] = [];

  constructor(private readonly maxFrameBytes: number) {}

  push(chunk: Buffer): FramePushResult {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > this.maxFrameBytes && !this.buffer.includes(0x0a)) {
      this.buffer = Buffer.alloc(0);
      return {
        messages: [],
        error: new AcpProtocolError("oversized_frame", `frame exceeds ${this.maxFrameBytes} bytes`),
      };
    }
    const messages: JsonRpcMessage[] = [];
    for (;;) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) break;
      const raw = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);
      const line = stripCarriageReturn(raw);
      if (line.length === 0) continue;
      if (line.length > this.maxFrameBytes) {
        return {
          messages,
          error: new AcpProtocolError("oversized_frame", `frame exceeds ${this.maxFrameBytes} bytes`),
        };
      }
      const text = line.toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!this.seenJson && this.bannerCount === 0) {
          this.bannerCount += 1;
          this.startupBanners.push(text);
          continue;
        }
        return {
          messages,
          error: new AcpFramingCorruptionError(`non-json frame: ${text.slice(0, 120)}`),
        };
      }
      const message = asMessage(parsed);
      if (!message) {
        return { messages, error: new AcpProtocolError("malformed_frame", "frame is not a JSON-RPC object") };
      }
      this.seenJson = true;
      messages.push(message);
    }
    return { messages, error: null };
  }
}

function stripCarriageReturn(line: Buffer): Buffer {
  if (line.length > 0 && line[line.length - 1] === 0x0d) return line.subarray(0, line.length - 1);
  return line;
}

function asMessage(value: unknown): JsonRpcMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.method === "string") {
    const params = value.params === undefined ? {} : { params: value.params };
    if (value.id === undefined) return { method: value.method, ...params };
    if (typeof value.id === "number" || typeof value.id === "string") {
      return { id: value.id, method: value.method, ...params };
    }
    return null;
  }
  if ("result" in value && (typeof value.id === "number" || typeof value.id === "string")) {
    return { id: value.id, result: value.result };
  }
  if (isRecord(value.error) && (typeof value.id === "number" || typeof value.id === "string" || value.id === null)) {
    const code = value.error.code;
    const message = value.error.message;
    if (typeof code !== "number" || typeof message !== "string") return null;
    return {
      id: value.id,
      error: {
        code,
        message,
        ...(value.error.data !== undefined ? { data: value.error.data } : {}),
      },
    };
  }
  return null;
}
