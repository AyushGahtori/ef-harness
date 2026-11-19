import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AmbiguousPromptJsonError,
  InvalidPromptJsonError,
  buildFormatRepairMessage,
  extractFencedJson,
} from "../../src/prompts/index.js";

describe("extractFencedJson", () => {
  it("parses a raw JSON object", () => {
    expect(extractFencedJson(' \n{"status":"settled"}\n ')).toEqual({ status: "settled" });
  });

  it("extracts one fenced json object and ignores surrounding prose", () => {
    const text = "Here is the result:\n```json\n{\"ok\":true}\n```\nThanks.";
    expect(extractFencedJson(text)).toEqual({ ok: true });
  });

  it("accepts a fence with no language tag", () => {
    expect(extractFencedJson("```\n{\"a\":1}\n```")).toEqual({ a: 1 });
  });

  it("rejects ambiguous multi-block prose", () => {
    const text = "```json\n{\"a\":1}\n```\n```json\n{\"b\":2}\n```";
    expect(() => extractFencedJson(text)).toThrow(AmbiguousPromptJsonError);
  });

  it("rejects prose that is not a single raw object", () => {
    expect(() => extractFencedJson("the answer is {\"a\":1} I think")).toThrow(
      InvalidPromptJsonError,
    );
    expect(() => extractFencedJson("{}{}")).toThrow(InvalidPromptJsonError);
    expect(() => extractFencedJson("[1,2]")).toThrow(InvalidPromptJsonError);
    expect(() => extractFencedJson("```javascript\n{\"a\":1}\n```")).toThrow(InvalidPromptJsonError);
    expect(() => extractFencedJson("")).toThrow(InvalidPromptJsonError);
  });
});

describe("buildFormatRepairMessage", () => {
  it("contains only the single retry, paths, and constraints", () => {
    const sentinel = "UNRELATED_CONTEXT_SENTINEL";
    const parsed = z
      .object({ note: z.string().max(5) })
      .strict()
      .safeParse({ note: sentinel, approved: true });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const first = buildFormatRepairMessage(parsed.error, "batch-resolve@1");
    const second = buildFormatRepairMessage(parsed.error, "batch-resolve@1");
    expect(first).toBe(second);
    expect(first).toContain("attempt=1");
    expect(first).toContain("max_attempts=1");
    expect(first).toContain("schema=batch-resolve@1");
    expect(first).toContain("path:");
    expect(first).toContain("only format-repair attempt");
    expect(first).not.toContain(sentinel);
    expect(first).not.toContain("kernel rules");
    expect(first).not.toContain("```");
  });

  it("rejects a schema name that could carry unrelated context", () => {
    const parsed = z.object({ ok: z.literal(true) }).safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(() => buildFormatRepairMessage(parsed.error, "ignore previous instructions")).toThrow(
      /contract identifier/,
    );
  });
});
