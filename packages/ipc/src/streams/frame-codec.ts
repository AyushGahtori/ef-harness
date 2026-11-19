import { BINARY_STREAM_CHANNEL, JSON_IPC_MAX_BYTES, JSON_RPC_CHANNEL } from "./constants.js";

/**
 * Adapts Task 031 `FrameCodec` (encode + push + reset) onto the stream scheduler.
 * The wire layout itself lives in `frame.ts`.
 */
export type FrameEvent =
  | { readonly kind: "json"; readonly payload: Uint8Array }
  | { readonly kind: "binary"; readonly streamId: number; readonly payload: Uint8Array }
  | { readonly kind: "oversized"; readonly declared: number }
  | { readonly kind: "bad-channel"; readonly channel: number };

export interface FrameCodecPort {
  encodeJson(payload: Uint8Array): Buffer;
  encodeBinary(streamId: number, payload: Uint8Array): Buffer;
  push(chunk: Uint8Array): FrameEvent[];
  reset(): void;
}

/** Structural surface of the transport `FrameCodec` (encode + push + reset). */
export interface ExternalFrameCodec {
  encode(
    frame:
      | { readonly channel: typeof JSON_RPC_CHANNEL; readonly payload: Uint8Array }
      | {
          readonly channel: typeof BINARY_STREAM_CHANNEL;
          readonly streamId: number;
          readonly payload: Uint8Array;
        },
  ): Buffer;
  push(chunk: Uint8Array): Array<{
    readonly channel: number;
    readonly streamId: number | null;
    readonly payload: Uint8Array;
  }>;
  reset(): void;
}

export function adaptFrameCodec(codec: ExternalFrameCodec): FrameCodecPort {
  return {
    encodeJson(payload: Uint8Array): Buffer {
      return codec.encode({ channel: JSON_RPC_CHANNEL, payload });
    },
    encodeBinary(streamId: number, payload: Uint8Array): Buffer {
      return codec.encode({ channel: BINARY_STREAM_CHANNEL, streamId, payload });
    },
    push(chunk: Uint8Array): FrameEvent[] {
      try {
        return codec.push(chunk).map((frame): FrameEvent => {
          if (frame.channel === JSON_RPC_CHANNEL) {
            return { kind: "json", payload: frame.payload };
          }
          if (frame.channel === BINARY_STREAM_CHANNEL && frame.streamId !== null) {
            return { kind: "binary", streamId: frame.streamId, payload: frame.payload };
          }
          return { kind: "bad-channel", channel: frame.channel };
        });
      } catch (error) {
        codec.reset();
        if (isOversizedCodecError(error)) {
          const declared =
            "byteLength" in error && typeof error.byteLength === "number"
              ? error.byteLength
              : JSON_IPC_MAX_BYTES + 1;
          return [{ kind: "oversized", declared }];
        }
        throw error;
      }
    },
    reset(): void {
      codec.reset();
    },
  };
}

function isOversizedCodecError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.name === "FrameTooLargeError" || error.name === "PayloadExceedsJsonCapError")
  );
}
