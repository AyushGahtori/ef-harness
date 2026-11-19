import { MessageChannel, type MessagePort } from "node:worker_threads";
import { BINARY_CHUNK_BYTES, BINARY_STREAM_CHANNEL, JSON_RPC_CHANNEL } from "./constants.js";
import { FrameChannelError, FrameTooLargeError } from "./errors.js";
import type { DecodedFrame } from "./frame-codec.js";

export interface BridgeBinaryMessage {
  readonly kind: "binary";
  readonly streamId: number;
  readonly payload: ArrayBuffer;
}

export interface BridgeJsonMessage {
  readonly kind: "json";
  readonly payload: Uint8Array;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transferable(payload: Uint8Array): ArrayBuffer {
  const buffer = payload.buffer;
  if (payload.byteOffset === 0 && payload.byteLength === buffer.byteLength && buffer instanceof ArrayBuffer) {
    return buffer;
  }
  const copy = new ArrayBuffer(payload.byteLength);
  new Uint8Array(copy).set(payload);
  return copy;
}

/**
 * Zero-copy bridge from the utility process that owns the named pipe to the renderer.
 * Channel 1 payloads are transferred with `postMessage(message, [buffer])`.
 */
export class MessagePortBridge {
  private readonly binaryListeners = new Set<(message: BridgeBinaryMessage) => void>();
  private readonly jsonListeners = new Set<(message: BridgeJsonMessage) => void>();

  static pair(): { utility: MessagePortBridge; renderer: MessagePortBridge } {
    const channel = new MessageChannel();
    return {
      utility: new MessagePortBridge(channel.port1),
      renderer: new MessagePortBridge(channel.port2),
    };
  }

  constructor(private readonly port: MessagePort) {
    this.port.start();
    this.port.on("message", (data: unknown) => this.dispatch(data));
  }

  sendBinary(streamId: number, payload: ArrayBuffer): void {
    if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffff_ffff) {
      throw new RangeError("stream id must be a uint32");
    }
    if (payload.byteLength > BINARY_CHUNK_BYTES) {
      throw new FrameTooLargeError(payload.byteLength, BINARY_STREAM_CHANNEL, BINARY_CHUNK_BYTES);
    }
    this.port.postMessage({ kind: "binary", streamId, payload }, [payload]);
  }

  forwardFrame(frame: DecodedFrame): void {
    if (frame.channel === BINARY_STREAM_CHANNEL) {
      if (frame.streamId === null) throw new FrameChannelError(frame.channel);
      this.sendBinary(frame.streamId, transferable(frame.payload));
      return;
    }
    if (frame.channel !== JSON_RPC_CHANNEL) throw new FrameChannelError(frame.channel);
    const copy = new Uint8Array(frame.payload.byteLength);
    copy.set(frame.payload);
    this.port.postMessage({ kind: "json", payload: copy });
  }

  onBinary(listener: (message: BridgeBinaryMessage) => void): () => void {
    this.binaryListeners.add(listener);
    return () => {
      this.binaryListeners.delete(listener);
    };
  }

  onJson(listener: (message: BridgeJsonMessage) => void): () => void {
    this.jsonListeners.add(listener);
    return () => {
      this.jsonListeners.delete(listener);
    };
  }

  close(): void {
    this.port.close();
  }

  private dispatch(data: unknown): void {
    if (!isRecord(data)) return;
    if (data.kind === "binary" && data.payload instanceof ArrayBuffer && typeof data.streamId === "number") {
      const message: BridgeBinaryMessage = {
        kind: "binary",
        streamId: data.streamId,
        payload: data.payload,
      };
      for (const listener of this.binaryListeners) listener(message);
      return;
    }
    if (data.kind === "json" && data.payload instanceof Uint8Array) {
      const message: BridgeJsonMessage = { kind: "json", payload: data.payload };
      for (const listener of this.jsonListeners) listener(message);
    }
  }
}
