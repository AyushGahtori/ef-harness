import { describe, expect, it } from "vitest";
import { countWhisperBpeTokens, encodeWhisperBpe, warmWhisperBpe } from "../../src/vocabulary/index.js";

describe("Whisper GPT-2 BPE", () => {
  it("matches Whisper's gpt2 token ids instead of whitespace word counts", () => {
    warmWhisperBpe();
    expect([...encodeWhisperBpe("hello world")]).toEqual([31373, 995]);
    const spelled = "PostgreSQL";
    const tokens = countWhisperBpeTokens(spelled);
    expect(tokens).toBeGreaterThan(1);
    expect(tokens).not.toBe(spelled.split(/\s+/).length);
  });
});
