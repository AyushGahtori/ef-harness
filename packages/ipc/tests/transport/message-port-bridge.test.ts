import { describe, expect, it } from "vitest";
import { BINARY_STREAM_CHANNEL, FrameCodec, JSON_RPC_CHANNEL, MessagePortBridge } from "../../src/transport/index.js";

describe("transport MessagePortBridge", () => {
  it("transfers channel 1 ArrayBuffers without copying", async () => {
    const { utility, renderer } = MessagePortBridge.pair();
    const waiting = new Promise<ArrayBuffer>((resolve) => {
      renderer.onBinary((message) => resolve(message.payload));
    });
    const payload = new Uint8Array([1, 2, 3, 4, 5]).buffer;
    utility.sendBinary(9, payload);
    expect(payload.byteLength).toBe(0);
    const transferred = await waiting;
    expect([...new Uint8Array(transferred)]).toEqual([1, 2, 3, 4, 5]);
    utility.close();
    renderer.close();
  });

  it("forwards a decoded channel 1 frame by transferring its buffer", async () => {
    const { utility, renderer } = MessagePortBridge.pair();
    const waiting = new Promise<{ streamId: number; payload: ArrayBuffer }>((resolve) => {
      renderer.onBinary((message) => resolve(message));
    });
    const encoded = FrameCodec.encode({
      channel: BINARY_STREAM_CHANNEL,
      streamId: 4,
      payload: Uint8Array.from([9, 8, 7]),
    });
    const frame = new FrameCodec().push(encoded)[0];
    if (!frame) throw new Error("missing frame");
    const owned = frame.payload.buffer;
    utility.forwardFrame(frame);
    expect(owned.byteLength).toBe(0);
    const message = await waiting;
    expect(message.streamId).toBe(4);
    expect([...new Uint8Array(message.payload)]).toEqual([9, 8, 7]);
    utility.close();
    renderer.close();
  });

  it("clones channel 0 JSON instead of detaching the caller's buffer", async () => {
    const { utility, renderer } = MessagePortBridge.pair();
    const waiting = new Promise<Uint8Array>((resolve) => {
      renderer.onJson((message) => resolve(message.payload));
    });
    const payload = Buffer.from('{"ok":true}');
    utility.forwardFrame({ channel: JSON_RPC_CHANNEL, streamId: null, payload });
    expect(payload.toString("utf8")).toBe('{"ok":true}');
    const copy = await waiting;
    expect(Buffer.from(copy).toString("utf8")).toBe('{"ok":true}');
    utility.close();
    renderer.close();
  });
});
