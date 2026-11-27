const JSON_RPC_CHANNEL = 0;
const BINARY_STREAM_CHANNEL = 1;
const JSON_IPC_MAX_BYTES = 1_048_576;
const BINARY_CHUNK_BYTES = 65_536;

export class FrameTooLargeError extends Error {
  constructor(declared: number, limit: number) {
    super(`frame payload ${declared} exceeds ${limit}`);
    this.name = "FrameTooLargeError";
  }
}

export interface DecodedFrame {
  readonly channel: 0 | 1;
  readonly streamId: number | null;
  readonly payload: Uint8Array;
}

/** Local port of Task 031 `FrameCodec`. `length` is the payload size. */
export class FrameCodec {
  private pending: Buffer = Buffer.alloc(0);

  static encodeJson(payload: Uint8Array): Buffer {
    if (payload.byteLength > JSON_IPC_MAX_BYTES) throw new FrameTooLargeError(payload.byteLength, JSON_IPC_MAX_BYTES);
    const out = Buffer.allocUnsafe(5 + payload.byteLength);
    out.writeUInt32BE(payload.byteLength, 0);
    out.writeUInt8(JSON_RPC_CHANNEL, 4);
    out.set(payload, 5);
    return out;
  }

  static encodeBinary(streamId: number, payload: Uint8Array): Buffer {
    if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffff_ffff) {
      throw new RangeError("stream id must be a uint32");
    }
    if (payload.byteLength > BINARY_CHUNK_BYTES) throw new FrameTooLargeError(payload.byteLength, BINARY_CHUNK_BYTES);
    const out = Buffer.allocUnsafe(9 + payload.byteLength);
    out.writeUInt32BE(payload.byteLength, 0);
    out.writeUInt8(BINARY_STREAM_CHANNEL, 4);
    out.writeUInt32BE(streamId, 5);
    out.set(payload, 9);
    return out;
  }

  push(chunk: Uint8Array): DecodedFrame[] {
    let incoming = Buffer.from(chunk);
    if (this.pending.length < 4) {
      const take = Math.min(4 - this.pending.length, incoming.length);
      this.pending = Buffer.concat([this.pending, incoming.subarray(0, take)]);
      incoming = incoming.subarray(take);
      if (this.pending.length < 4) return [];
      this.assertDeclared(this.pending.readUInt32BE(0));
    }
    if (incoming.length > 0) this.pending = Buffer.concat([this.pending, incoming]);
    const frames: DecodedFrame[] = [];
    while (this.pending.length >= 5) {
      const declared = this.pending.readUInt32BE(0);
      this.assertDeclared(declared);
      const channel = this.pending.readUInt8(4);
      if (channel === JSON_RPC_CHANNEL) {
        const total = 5 + declared;
        if (this.pending.length < total) break;
        const payload = copy(this.pending.subarray(5, total));
        this.pending = this.pending.subarray(total);
        frames.push({ channel: JSON_RPC_CHANNEL, streamId: null, payload });
        continue;
      }
      if (channel === BINARY_STREAM_CHANNEL) {
        if (declared > BINARY_CHUNK_BYTES) {
          this.pending = Buffer.alloc(0);
          throw new FrameTooLargeError(declared, BINARY_CHUNK_BYTES);
        }
        const total = 9 + declared;
        if (this.pending.length < total) break;
        const streamId = this.pending.readUInt32BE(5);
        const payload = copy(this.pending.subarray(9, total));
        this.pending = this.pending.subarray(total);
        frames.push({ channel: BINARY_STREAM_CHANNEL, streamId, payload });
        continue;
      }
      this.pending = Buffer.alloc(0);
      throw new Error(`unknown frame channel ${channel}`);
    }
    return frames;
  }

  takePending(): Uint8Array {
    const rest = this.pending;
    this.pending = Buffer.alloc(0);
    return rest;
  }

  private assertDeclared(declared: number): void {
    if (declared > JSON_IPC_MAX_BYTES) {
      this.pending = Buffer.alloc(0);
      throw new FrameTooLargeError(declared, JSON_IPC_MAX_BYTES);
    }
  }
}

function copy(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.byteLength);
  out.set(source);
  return out;
}
