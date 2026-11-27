import {
  BINARY_CHUNK_BYTES,
  BINARY_STREAM_CHANNEL,
  JSON_IPC_MAX_BYTES,
  JSON_RPC_CHANNEL,
} from "./constants.js";
import { FrameChannelError, FrameTooLargeError } from "./errors.js";

export interface JsonFrame {
  readonly channel: typeof JSON_RPC_CHANNEL;
  readonly payload: Uint8Array;
}

export interface BinaryFrame {
  readonly channel: typeof BINARY_STREAM_CHANNEL;
  readonly streamId: number;
  readonly payload: Uint8Array;
}

export type EncodedFrame = JsonFrame | BinaryFrame;

export interface DecodedFrame {
  readonly channel: typeof JSON_RPC_CHANNEL | typeof BINARY_STREAM_CHANNEL;
  readonly streamId: number | null;
  readonly payload: Uint8Array;
}

function copyBytes(source: Uint8Array, start: number, length: number): Uint8Array {
  const copy = new Uint8Array(length);
  copy.set(source.subarray(start, start + length));
  return copy;
}

function assertStreamId(streamId: number): void {
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffff_ffff) {
    throw new RangeError("stream id must be a uint32");
  }
}

/**
 * Streaming codec for the window/daemon frame:
 * `uint32BE length` + `uint8 channel` + optional `uint32BE streamId` + payload.
 * `length` is the payload size. The length is checked before any payload buffer is allocated.
 */
export class FrameCodec {
  private pending: Uint8Array = new Uint8Array(0);

  encode(frame: EncodedFrame): Buffer {
    return FrameCodec.encode(frame);
  }

  static encode(frame: EncodedFrame): Buffer {
    if (frame.channel === JSON_RPC_CHANNEL) {
      if (frame.payload.byteLength > JSON_IPC_MAX_BYTES) {
        throw new FrameTooLargeError(frame.payload.byteLength, JSON_RPC_CHANNEL, JSON_IPC_MAX_BYTES);
      }
      const out = Buffer.allocUnsafe(5 + frame.payload.byteLength);
      out.writeUInt32BE(frame.payload.byteLength, 0);
      out.writeUInt8(JSON_RPC_CHANNEL, 4);
      out.set(frame.payload, 5);
      return out;
    }
    assertStreamId(frame.streamId);
    if (frame.payload.byteLength > BINARY_CHUNK_BYTES) {
      throw new FrameTooLargeError(
        frame.payload.byteLength,
        BINARY_STREAM_CHANNEL,
        BINARY_CHUNK_BYTES,
      );
    }
    const out = Buffer.allocUnsafe(9 + frame.payload.byteLength);
    out.writeUInt32BE(frame.payload.byteLength, 0);
    out.writeUInt8(BINARY_STREAM_CHANNEL, 4);
    out.writeUInt32BE(frame.streamId, 5);
    out.set(frame.payload, 9);
    return out;
  }

  reset(): void {
    this.pending = new Uint8Array(0);
  }

  push(chunk: Uint8Array): DecodedFrame[] {
    if (chunk.byteLength === 0) return [];
    this.pending =
      this.pending.byteLength === 0 ? copyBytes(chunk, 0, chunk.byteLength) : concatBytes(this.pending, chunk);
    const frames: DecodedFrame[] = [];
    while (this.pending.byteLength > 0) {
      const frame = this.tryTake();
      if (!frame) break;
      frames.push(frame);
    }
    return frames;
  }

  private tryTake(): DecodedFrame | undefined {
    if (this.pending.byteLength < 4) return undefined;
    const view = new DataView(this.pending.buffer, this.pending.byteOffset, this.pending.byteLength);
    const declared = view.getUint32(0, false);
    if (declared > JSON_IPC_MAX_BYTES) {
      this.reset();
      throw new FrameTooLargeError(declared, null, JSON_IPC_MAX_BYTES);
    }
    if (this.pending.byteLength < 5) return undefined;
    const channel = view.getUint8(4);
    if (channel === JSON_RPC_CHANNEL) {
      const total = 5 + declared;
      if (this.pending.byteLength < total) return undefined;
      const payload = copyBytes(this.pending, 5, declared);
      this.consume(total);
      return { channel: JSON_RPC_CHANNEL, streamId: null, payload };
    }
    if (channel === BINARY_STREAM_CHANNEL) {
      if (declared > BINARY_CHUNK_BYTES) {
        this.reset();
        throw new FrameTooLargeError(declared, BINARY_STREAM_CHANNEL, BINARY_CHUNK_BYTES);
      }
      const total = 9 + declared;
      if (this.pending.byteLength < total) return undefined;
      const streamId = view.getUint32(5, false);
      const payload = copyBytes(this.pending, 9, declared);
      this.consume(total);
      return { channel: BINARY_STREAM_CHANNEL, streamId, payload };
    }
    this.reset();
    throw new FrameChannelError(channel);
  }

  private consume(total: number): void {
    const rest = this.pending.subarray(total);
    this.pending = rest.byteLength === 0 ? new Uint8Array(0) : copyBytes(rest, 0, rest.byteLength);
  }
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const merged = new Uint8Array(left.byteLength + right.byteLength);
  merged.set(left, 0);
  merged.set(right, left.byteLength);
  return merged;
}
