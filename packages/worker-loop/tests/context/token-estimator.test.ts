import { describe, expect, it } from "vitest";
import { TokenEstimator } from "../../src/context/index.js";
import { profile } from "./fixture.js";

describe("token estimator", () => {
  it("is model-family aware and adds code, JSON, and safety headroom", () => {
    const prose = "Show today's totals on the kitchen page. ".repeat(40);
    const code = "const value = items.map((item) => item.label);\n".repeat(40);
    const openai = new TokenEstimator(profile(128_000, { family: "openai" }));
    const local = new TokenEstimator(profile(16_384, { family: "local" }));
    expect(openai.estimateText(prose, "prose")).toBeGreaterThan(0);
    expect(local.estimateText(prose, "prose")).toBeGreaterThan(openai.estimateText(prose, "prose"));
    expect(openai.estimateText(code, "code")).toBeGreaterThan(openai.estimateText(prose, "prose"));
    const json = openai.estimateJson({ name: "read_file", parameters: { path: { type: "string" } } });
    expect(json).toBeGreaterThan(openai.estimateText(JSON.stringify({ name: "read_file" }), "prose"));
    const parts = [{ text: prose, kind: "prose" as const }];
    expect(openai.estimateRequest(parts)).toBeGreaterThan(openai.estimateText(prose, "prose"));
    expect(openai.safetyHeadroom(0)).toBeGreaterThanOrEqual(32);
    expect(openai.estimateText("", "mixed")).toBe(0);
    expect(openai.estimateText("longer text", "prose")).toBeGreaterThan(openai.estimateText("short", "prose"));
  });
});
