import { Buffer } from "node:buffer";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BINARY_CHUNK_BYTES,
  BINARY_STREAM_CHANNEL,
  FrameCodec,
  FrameTooLargeError,
  JSON_IPC_MAX_BYTES,
  JSON_RPC_CHANNEL,
} from "../../src/transport/index.js";

function bytes(payload: Uint8Array): Buffer {
  return Buffer.from(payload);
}

describe("transport FrameCodec", () => {
  it("round-trips the documented channel 0 and channel 1 layouts", () => {
    const json = FrameCodec.encode({ channel: JSON_RPC_CHANNEL, payload: Buffer.from("{}") });
    expect([...json.subarray(0, 5)]).toEqual([0, 0, 0, 2, 0]);
    expect(json.subarray(5).toString("utf8")).toBe("{}");
    expect(Buffer.compare(new FrameCodec().encode({ channel: JSON_RPC_CHANNEL, payload: Buffer.from("{}") }), json)).toBe(0);

    const binary = FrameCodec.encode({
      channel: BINARY_STREAM_CHANNEL,
      streamId: 7,
      payload: Buffer.from("ab"),
    });
    expect([...binary.subarray(0, 9)]).toEqual([0, 0, 0, 2, 1, 0, 0, 0, 7]);
    expect(binary.subarray(9).toString("utf8")).toBe("ab");

    const codec = new FrameCodec();
    const frames = codec.push(Buffer.concat([json, binary]));
    expect(frames).toHaveLength(2);
    expect(frames[0]?.channel).toBe(JSON_RPC_CHANNEL);
    expect(frames[0]?.streamId).toBeNull();
    expect(bytes(frames[0]?.payload ?? new Uint8Array()).toString("utf8")).toBe("{}");
    expect(frames[1]?.channel).toBe(BINARY_STREAM_CHANNEL);
    expect(frames[1]?.streamId).toBe(7);
    expect(bytes(frames[1]?.payload ?? new Uint8Array()).toString("utf8")).toBe("ab");
  });

  it("reassembles a frame split into 1-byte reads", () => {
    const payload = Buffer.from("named-pipe-frame");
    const encoded = FrameCodec.encode({ channel: JSON_RPC_CHANNEL, payload });
    const codec = new FrameCodec();
    const decoded = [];
    for (const byte of encoded) {
      decoded.push(...codec.push(Uint8Array.of(byte)));
    }
    expect(decoded).toHaveLength(1);
    expect(bytes(decoded[0]?.payload ?? new Uint8Array()).equals(payload)).toBe(true);
  });

  it("drains 50 coalesced frames from one chunk", () => {
    const parts: Buffer[] = [];
    for (let index = 0; index < 50; index += 1) {
      parts.push(
        FrameCodec.encode({
          channel: index % 2 === 0 ? JSON_RPC_CHANNEL : BINARY_STREAM_CHANNEL,
          streamId: index,
          payload: Buffer.from(`frame-${index}`),
        }),
      );
    }
    const frames = new FrameCodec().push(Buffer.concat(parts));
    expect(frames).toHaveLength(50);
    expect(bytes(frames[49]?.payload ?? new Uint8Array()).toString("utf8")).toBe("frame-49");
    expect(frames[49]?.streamId).toBe(49);
  });

  it("rejects an oversized length header before the payload arrives", () => {
    const json = Buffer.alloc(5);
    json.writeUInt32BE(0xffff_ffff, 0);
    json.writeUInt8(JSON_RPC_CHANNEL, 4);
    const codec = new FrameCodec();
    expect(() => codec.push(json)).toThrow(FrameTooLargeError);

    const binary = Buffer.alloc(5);
    binary.writeUInt32BE(BINARY_CHUNK_BYTES + 1, 0);
    binary.writeUInt8(BINARY_STREAM_CHANNEL, 4);
    expect(() => new FrameCodec().push(binary)).toThrow(FrameTooLargeError);

    expect(() =>
      FrameCodec.encode({ channel: JSON_RPC_CHANNEL, payload: new Uint8Array(JSON_IPC_MAX_BYTES + 1) }),
    ).toThrow(FrameTooLargeError);
    expect(() =>
      FrameCodec.encode({
        channel: BINARY_STREAM_CHANNEL,
        streamId: 1,
        payload: new Uint8Array(BINARY_CHUNK_BYTES + 1),
      }),
    ).toThrow(FrameTooLargeError);
  });

  it("accepts a payload at each channel ceiling", () => {
    const jsonPayload = new Uint8Array(JSON_IPC_MAX_BYTES);
    jsonPayload[0] = 9;
    jsonPayload[JSON_IPC_MAX_BYTES - 1] = 8;
    const json = new FrameCodec().push(FrameCodec.encode({ channel: JSON_RPC_CHANNEL, payload: jsonPayload }));
    expect(json[0]?.payload.byteLength).toBe(JSON_IPC_MAX_BYTES);
    expect(json[0]?.payload[0]).toBe(9);

    const binaryPayload = new Uint8Array(BINARY_CHUNK_BYTES);
    binaryPayload[BINARY_CHUNK_BYTES - 1] = 3;
    const binary = new FrameCodec().push(
      FrameCodec.encode({ channel: BINARY_STREAM_CHANNEL, streamId: 0xffff_ffff, payload: binaryPayload }),
    );
    expect(binary[0]?.streamId).toBe(0xffff_ffff);
    expect(binary[0]?.payload[BINARY_CHUNK_BYTES - 1]).toBe(3);
  });

  it("round-trips fast-check payloads across random chunk splits and coalesced batches", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 2048 }),
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 0, max: 0xffff_ffff }),
        fc.constantFrom(JSON_RPC_CHANNEL, BINARY_STREAM_CHANNEL),
        (payload, chunkSize, streamId, channel) => {
          const encoded =
            channel === JSON_RPC_CHANNEL
              ? FrameCodec.encode({ channel, payload })
              : FrameCodec.encode({ channel, streamId, payload });
          const codec = new FrameCodec();
          const frames = [];
          for (let offset = 0; offset < encoded.length; offset += chunkSize) {
            frames.push(...codec.push(encoded.subarray(offset, offset + chunkSize)));
          }
          expect(frames).toHaveLength(1);
          expect(Buffer.from(frames[0]?.payload ?? new Uint8Array()).equals(Buffer.from(payload))).toBe(true);
          if (channel === BINARY_STREAM_CHANNEL) expect(frames[0]?.streamId).toBe(streamId);
          else expect(frames[0]?.streamId).toBeNull();
        },
      ),
      { numRuns: 40 },
    );

    fc.assert(
      fc.property(
        fc.array(fc.uint8Array({ minLength: 0, maxLength: 128 }), { minLength: 1, maxLength: 12 }),
        (payloads) => {
          const encoded = payloads.map((payload, index) =>
            index % 2 === 0
              ? FrameCodec.encode({ channel: JSON_RPC_CHANNEL, payload })
              : FrameCodec.encode({ channel: BINARY_STREAM_CHANNEL, streamId: index, payload }),
          );
          const frames = new FrameCodec().push(Buffer.concat(encoded));
          expect(frames).toHaveLength(payloads.length);
          frames.forEach((frame, index) => {
            const payload = payloads[index] ?? new Uint8Array();
            expect(Buffer.from(frame.payload).equals(Buffer.from(payload))).toBe(true);
          });
        },
      ),
      { numRuns: 25 },
    );
  });
});
