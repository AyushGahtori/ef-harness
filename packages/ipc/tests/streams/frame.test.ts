import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, JSON_RPC_MAX_BYTES } from "../../src/streams/constants.js";
import {
  PayloadExceedsJsonCapError,
  StreamFrameTooLargeError,
  spillToArtifactOpen,
} from "../../src/streams/errors.js";
import { adaptFrameCodec, type ExternalFrameCodec } from "../../src/streams/frame-codec.js";
import {
  StreamFrameCodec,
  encodeBinaryFrame,
  encodeJsonFrame,
} from "../../src/streams/frame.js";
import { assertJsonRpcWithinCap, encodeJsonPayload } from "../../src/streams/json-guard.js";

describe("binary frame layout", () => {
  it("encodes channel 1 as length, channel, stream id, and at most 64 KB", () => {
    const payload = Buffer.from("abc");
    const frame = encodeBinaryFrame(7, payload);
    expect(frame.readUInt32BE(0)).toBe(3);
    expect(frame.readUInt8(4)).toBe(1);
    expect(frame.readUInt32BE(5)).toBe(7);
    expect(frame.subarray(9)).toEqual(payload);
    expect(() => encodeBinaryFrame(1, Buffer.alloc(CHUNK_BYTES + 1))).toThrow(StreamFrameTooLargeError);
    expect(encodeBinaryFrame(4, Buffer.alloc(0)).byteLength).toBe(9);
  });

  it("encodes channel 0 without a stream id and refuses a body over 1 MB", () => {
    const payload = encodeJsonPayload({ jsonrpc: "2.0", method: "session.ping", params: {} });
    const frame = encodeJsonFrame(payload);
    expect(frame.readUInt32BE(0)).toBe(payload.byteLength);
    expect(frame.readUInt8(4)).toBe(0);
    expect(frame.subarray(5)).toEqual(Buffer.from(payload));
    expect(() => encodeJsonFrame(Buffer.alloc(JSON_RPC_MAX_BYTES + 1))).toThrow(StreamFrameTooLargeError);
  });

  it("reassembles a frame pushed one byte at a time and rejects an oversized chunk without allocating it", () => {
    const codec = new StreamFrameCodec();
    const frame = encodeBinaryFrame(3, Buffer.from("xyz"));
    let decoded: Uint8Array | null = null;
    for (const byte of frame) {
      const events = codec.push(Buffer.from([byte]));
      for (const event of events) {
        if (event.kind === "frame") decoded = event.payload;
      }
    }
    expect(Buffer.from(decoded ?? []).toString()).toBe("xyz");

    const hostile = new StreamFrameCodec();
    const header = Buffer.alloc(5);
    header.writeUInt32BE(CHUNK_BYTES + 1, 0);
    header.writeUInt8(1, 4);
    const rejected = hostile.push(header);
    expect(rejected).toEqual([{ kind: "rejected", channel: 1, declared: CHUNK_BYTES + 1 }]);
    expect(hostile.largestBodyAllocation).toBe(0);
    hostile.push(Buffer.alloc(4 + CHUNK_BYTES + 1));
    const follow = encodeJsonFrame(encodeJsonPayload({ jsonrpc: "2.0", id: 1, method: "session.ping" }));
    const after = hostile.push(follow);
    expect(after.some((event) => event.kind === "frame" && event.channel === 0)).toBe(true);
    expect(hostile.largestBodyAllocation).toBeLessThanOrEqual(JSON_RPC_MAX_BYTES);
  });

  it("directs a Channel 0 body over 1 MB to artifact.open", () => {
    expect(() => assertJsonRpcWithinCap(JSON_RPC_MAX_BYTES)).not.toThrow();
    expect(() => assertJsonRpcWithinCap(JSON_RPC_MAX_BYTES + 1)).toThrow(PayloadExceedsJsonCapError);
    const error = new PayloadExceedsJsonCapError(JSON_RPC_MAX_BYTES + 8);
    expect(error.spill.method).toBe("artifact.open");
    expect(spillToArtifactOpen(JSON_RPC_MAX_BYTES + 1).method).toBe("artifact.open");
    expect(() => spillToArtifactOpen(32)).toThrow(/Channel 0/);
    expect(() => encodeJsonPayload({ blob: "x".repeat(JSON_RPC_MAX_BYTES) })).toThrow(
      PayloadExceedsJsonCapError,
    );
  });

  it("adapts a transport FrameCodec and turns an oversized failure into a rejected event", () => {
    const external: ExternalFrameCodec = {
      encode(frame) {
        return encodeBinaryFrame("streamId" in frame ? frame.streamId : 0, frame.payload);
      },
      push() {
        const error = new Error("too big");
        error.name = "FrameTooLargeError";
        Object.assign(error, { byteLength: CHUNK_BYTES + 5 });
        throw error;
      },
      reset() {},
    };
    const adapted = adaptFrameCodec(external);
    expect(adapted.push(Buffer.from([1]))).toEqual([
      { kind: "oversized", declared: CHUNK_BYTES + 5 },
    ]);
  });
});
