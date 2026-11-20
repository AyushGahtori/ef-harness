import { describe, expect, it } from "vitest";
import { SseByteParser } from "../../src/protocols/index.js";

describe("SseByteParser", () => {
  it("reassembles JSON and UTF-8 characters split one byte at a time", () => {
    const payload = `event: response.output_text.delta\ndata: {"delta":"café 👍"}\n\n`;
    const bytes = new TextEncoder().encode(payload);
    const parser = new SseByteParser();
    const frames = [];
    for (const byte of bytes) {
      frames.push(...parser.push(Uint8Array.of(byte)));
    }
    frames.push(...parser.finish());
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe("response.output_text.delta");
    expect(JSON.parse(frames[0]?.data ?? "{}")).toEqual({ delta: "café 👍" });
  });

  it("keeps a frame buffered when the blank line is split", () => {
    const parser = new SseByteParser();
    const first = parser.push(new TextEncoder().encode('data: {"delta":"hi"}\n'));
    expect(first).toEqual([]);
    const second = parser.push(new TextEncoder().encode('\ndata: {"delta":"yo"}\n\n'));
    expect(second.map((frame) => frame.data)).toEqual(['{"delta":"hi"}', '{"delta":"yo"}']);
  });

  it("joins continued data lines and ignores comments", () => {
    const parser = new SseByteParser();
    const frames = parser.push(
      new TextEncoder().encode(': keep-alive\ndata: {"a":1}\ndata: {"b":2}\n\n'),
    );
    expect(frames[0]?.data).toBe('{"a":1}\n{"b":2}');
  });
});
