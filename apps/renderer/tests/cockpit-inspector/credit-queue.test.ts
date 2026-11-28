import { describe, expect, it } from "vitest";

import { CreditLimitedStream } from "../../src/cockpit/inspector/credit-stream.js";
import { INITIAL_STREAM_CREDITS } from "../../src/cockpit/inspector/constants.js";
import type { BinaryStreamClient, DiffRangeChunk } from "../../src/cockpit/inspector/ports.js";

class Gate implements BinaryStreamClient {
  readonly entered: Array<() => void> = [];

  fetchDiffRange(): Promise<DiffRangeChunk> {
    return new Promise((resolve) => {
      this.entered.push(() => {
        resolve({
          attemptId: "att",
          filePath: "a.ts",
          hunkOffset: 0,
          limit: 1,
          bytesRead: 1,
          hunks: [],
        });
      });
    });
  }

  fetchLogChunk(): Promise<never> {
    return new Promise(() => undefined);
  }

  fetchScreenshot(): Promise<never> {
    return new Promise(() => undefined);
  }
}

describe("credit limited stream", () => {
  it("queues the next range read until an in-flight credit returns", async () => {
    const gate = new Gate();
    const stream = new CreditLimitedStream(gate);
    const signal = new AbortController().signal;
    const calls = Array.from({ length: INITIAL_STREAM_CREDITS + 1 }, () =>
      stream.fetchDiffRange("att", "a.ts", 0, 1, signal),
    );
    await Promise.resolve();
    expect(gate.entered).toHaveLength(INITIAL_STREAM_CREDITS);
    const first = gate.entered.shift();
    if (!first) throw new Error("missing in-flight read");
    first();
    await calls[0];
    await Promise.resolve();
    expect(gate.entered).toHaveLength(INITIAL_STREAM_CREDITS);
    for (const release of gate.entered.splice(0)) release();
    await Promise.all(calls);
  });
});
