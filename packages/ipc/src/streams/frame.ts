import { BINARY_STREAM_CHANNEL, CHUNK_BYTES, JSON_RPC_CHANNEL, JSON_RPC_MAX_BYTES } from "./constants.js";
import { StreamFrameTooLargeError } from "./errors.js";

/**
 * Wire frame shared with Task 031 `FrameCodec`:
 * `uint32BE length` + `uint8 channel` + optional `uint32BE streamId` + payload.
 * `length` is the payload size. Channel 1 is `[4B len][1B = 1][4B streamId][<=64KB data]`.
 */
export interface DecodedStreamFrame {
  readonly kind: "frame";
  readonly channel: typeof JSON_RPC_CHANNEL | typeof BINARY_STREAM_CHANNEL;
  readonly streamId: number | null;
  readonly payload: Uint8Array;
}

export interface RejectedStreamFrame {
  readonly kind: "rejected";
  readonly channel: number;
  readonly declared: number;
}

export type StreamDecodeEvent = DecodedStreamFrame | RejectedStreamFrame;

function assertStreamId(streamId: number): void {
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffff_ffff) {
    throw new RangeError("stream id must be a uint32");
  }
}

export function encodeJsonFrame(payload: Uint8Array): Buffer {
  if (payload.byteLength > JSON_RPC_MAX_BYTES) {
    throw new StreamFrameTooLargeError(payload.byteLength, JSON_RPC_MAX_BYTES);
  }
  const out = Buffer.allocUnsafe(5 + payload.byteLength);
  out.writeUInt32BE(payload.byteLength, 0);
  out.writeUInt8(JSON_RPC_CHANNEL, 4);
  out.set(payload, 5);
  return out;
}

export function encodeBinaryFrame(streamId: number, payload: Uint8Array): Buffer {
  assertStreamId(streamId);
  if (payload.byteLength > CHUNK_BYTES) {
    throw new StreamFrameTooLargeError(payload.byteLength, CHUNK_BYTES);
  }
  const out = Buffer.allocUnsafe(9 + payload.byteLength);
  out.writeUInt32BE(payload.byteLength, 0);
  out.writeUInt8(BINARY_STREAM_CHANNEL, 4);
  out.writeUInt32BE(streamId, 5);
  if (payload.byteLength > 0) out.set(payload, 9);
  return out;
}

export function binaryStreamId(frame: Uint8Array): number | null {
  if (frame.byteLength < 9 || frame[4] !== BINARY_STREAM_CHANNEL) return null;
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(5, false);
}

export function framePayloadLength(frame: Uint8Array): number {
  if (frame.byteLength < 4) return 0;
  return new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
}

type Mode = "header" | "streamId" | "body" | "skip";

/**
 * Incremental decoder. An oversized length is rejected before a payload buffer
 * is allocated, and the following bytes are discarded so the socket stays in sync.
 */
export class StreamFrameCodec {
  private mode: Mode = "header";
  private header = Buffer.alloc(0);
  private streamIdBytes = Buffer.alloc(0);
  private body: Buffer | null = null;
  private bodyGot = 0;
  private bodyNeed = 0;
  private skip = 0;
  private channel = 0;
  private declared = 0;
  private streamId: number | null = null;
  largestBodyAllocation = 0;

  reset(): void {
    this.mode = "header";
    this.header = Buffer.alloc(0);
    this.streamIdBytes = Buffer.alloc(0);
    this.body = null;
    this.bodyGot = 0;
    this.bodyNeed = 0;
    this.skip = 0;
    this.channel = 0;
    this.declared = 0;
    this.streamId = null;
  }

  push(chunk: Uint8Array): StreamDecodeEvent[] {
    const events: StreamDecodeEvent[] = [];
    let index = 0;
    for (;;) {
      if (this.mode === "body" && this.body && this.bodyGot >= this.bodyNeed) {
        events.push({
          kind: "frame",
          channel: this.channel === BINARY_STREAM_CHANNEL ? BINARY_STREAM_CHANNEL : JSON_RPC_CHANNEL,
          streamId: this.streamId,
          payload: this.body,
        });
        this.body = null;
        this.mode = "header";
        continue;
      }
      if (index >= chunk.byteLength) break;
      if (this.mode === "skip") {
        const take = Math.min(this.skip, chunk.byteLength - index);
        index += take;
        this.skip -= take;
        if (this.skip === 0) this.mode = "header";
        continue;
      }
      if (this.mode === "header") {
        const need = 5 - this.header.byteLength;
        const take = Math.min(need, chunk.byteLength - index);
        this.header = Buffer.concat([this.header, chunk.subarray(index, index + take)]);
        index += take;
        if (this.header.byteLength < 5) break;
        this.declared = this.header.readUInt32BE(0);
        this.channel = this.header.readUInt8(4);
        this.header = Buffer.alloc(0);
        if (this.channel === JSON_RPC_CHANNEL) {
          if (this.declared > JSON_RPC_MAX_BYTES) {
            this.mode = "skip";
            this.skip = this.declared;
            events.push({ kind: "rejected", channel: JSON_RPC_CHANNEL, declared: this.declared });
            continue;
          }
          this.beginBody(null);
          continue;
        }
        if (this.channel === BINARY_STREAM_CHANNEL) {
          if (this.declared > CHUNK_BYTES) {
            this.mode = "skip";
            this.skip = 4 + this.declared;
            events.push({ kind: "rejected", channel: BINARY_STREAM_CHANNEL, declared: this.declared });
            continue;
          }
          this.mode = "streamId";
          this.streamIdBytes = Buffer.alloc(0);
          continue;
        }
        this.mode = "skip";
        this.skip = this.declared;
        events.push({ kind: "rejected", channel: this.channel, declared: this.declared });
        continue;
      }
      if (this.mode === "streamId") {
        const need = 4 - this.streamIdBytes.byteLength;
        const take = Math.min(need, chunk.byteLength - index);
        this.streamIdBytes = Buffer.concat([this.streamIdBytes, chunk.subarray(index, index + take)]);
        index += take;
        if (this.streamIdBytes.byteLength < 4) break;
        this.beginBody(this.streamIdBytes.readUInt32BE(0));
        continue;
      }
      const take = Math.min(this.bodyNeed - this.bodyGot, chunk.byteLength - index);
      if (this.body && take > 0) {
        this.body.set(chunk.subarray(index, index + take), this.bodyGot);
        this.bodyGot += take;
        index += take;
      }
    }
    return events;
  }

  private beginBody(streamId: number | null): void {
    this.streamId = streamId;
    this.bodyNeed = this.declared;
    this.bodyGot = 0;
    this.body = Buffer.alloc(this.declared);
    if (this.declared > this.largestBodyAllocation) this.largestBodyAllocation = this.declared;
    this.mode = "body";
  }
}
