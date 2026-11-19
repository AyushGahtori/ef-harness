export type RespValue = string | number | null | RespValue[];

export class RedisReplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RedisReplyError";
  }
}

export function encodeCommand(args: readonly string[]): Buffer {
  const chunks: Buffer[] = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const body = Buffer.from(arg);
    chunks.push(Buffer.from(`$${body.length}\r\n`), body, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

export function encodeValue(value: RespValue): Buffer {
  if (value === null) return Buffer.from("$-1\r\n");
  if (typeof value === "number") return Buffer.from(`:${value}\r\n`);
  if (typeof value === "string") {
    const body = Buffer.from(value);
    return Buffer.concat([Buffer.from(`$${body.length}\r\n`), body, Buffer.from("\r\n")]);
  }
  const parts = [Buffer.from(`*${value.length}\r\n`)];
  for (const item of value) parts.push(encodeValue(item));
  return Buffer.concat(parts);
}

export function encodeSimple(text: string): Buffer {
  return Buffer.from(`+${text}\r\n`);
}

export function encodeError(text: string): Buffer {
  return Buffer.from(`-${text}\r\n`);
}

export class RespParser {
  private buffer = Buffer.alloc(0);
  private readonly values: Array<RespValue | RedisReplyError> = [];

  push(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (this.tryParse()) {
      // Drain every complete value before returning to the socket.
    }
  }

  shift(): RespValue | RedisReplyError | undefined {
    return this.values.shift();
  }

  private tryParse(): boolean {
    if (this.buffer.length === 0) return false;
    const parsed = parseAt(this.buffer, 0);
    if (!parsed) return false;
    this.values.push(parsed.value);
    this.buffer = this.buffer.subarray(parsed.next);
    return true;
  }
}

function parseAt(buffer: Buffer, offset: number): { value: RespValue | RedisReplyError; next: number } | null {
  if (offset >= buffer.length) return null;
  const prefix = String.fromCharCode(buffer[offset] ?? 0);
  if (prefix === "+") return readLine(buffer, offset + 1, (text) => text);
  if (prefix === "-") return readLine(buffer, offset + 1, (text) => new RedisReplyError(text));
  if (prefix === ":") {
    return readLine(buffer, offset + 1, (text) => {
      const value = Number(text);
      if (!Number.isInteger(value)) throw new RedisReplyError(`bad integer ${text}`);
      return value;
    });
  }
  if (prefix === "$") {
    const header = readRawLine(buffer, offset + 1);
    if (!header) return null;
    const length = Number(header.text);
    if (!Number.isInteger(length)) return null;
    if (length < 0) return { value: null, next: header.next };
    const start = header.next;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    return { value: buffer.subarray(start, end).toString("utf8"), next: end + 2 };
  }
  if (prefix === "*") {
    const header = readRawLine(buffer, offset + 1);
    if (!header) return null;
    const count = Number(header.text);
    if (!Number.isInteger(count)) return null;
    if (count < 0) return { value: null, next: header.next };
    const items: RespValue[] = [];
    let cursor = header.next;
    for (let index = 0; index < count; index += 1) {
      const item = parseAt(buffer, cursor);
      if (!item) return null;
      if (item.value instanceof RedisReplyError) return { value: item.value, next: item.next };
      items.push(item.value);
      cursor = item.next;
    }
    return { value: items, next: cursor };
  }
  return { value: new RedisReplyError(`unsupported RESP prefix ${prefix}`), next: buffer.length };
}

function readLine(
  buffer: Buffer,
  offset: number,
  map: (text: string) => RespValue | RedisReplyError,
): { value: RespValue | RedisReplyError; next: number } | null {
  const raw = readRawLine(buffer, offset);
  if (!raw) return null;
  return { value: map(raw.text), next: raw.next };
}

function readRawLine(buffer: Buffer, offset: number): { text: string; next: number } | null {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  return { text: buffer.subarray(offset, end).toString("utf8"), next: end + 2 };
}
