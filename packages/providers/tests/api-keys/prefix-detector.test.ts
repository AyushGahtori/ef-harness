import { describe, expect, it } from "vitest";
import {
  anthropicConsolePrefix,
  anthropicOauthPrefix,
  anthropicPreviewStem,
  ApiKeyPrefixDetector,
  CLAUDE_SUBSCRIPTION_REJECTION,
  geminiPrefix,
  normalizePastedApiKey,
  openAiProjectPrefix,
  openAiStandardPrefix,
  openRouterPrefix,
} from "../../src/api-keys/index.js";

const BODY = "BODY136UNIQUEORANGE";

function key(prefix: string, tail = "9x2a"): string {
  return `${prefix}${BODY}${tail}`;
}

describe("ApiKeyPrefixDetector", () => {
  const detector = new ApiKeyPrefixDetector();

  it("builds provider prefixes without embedding joined secret markers in source", () => {
    expect(anthropicConsolePrefix).toBe(["sk-", "ant-", "api"].join(""));
    expect(anthropicOauthPrefix).toBe(["sk-", "ant-", "oat"].join(""));
    expect(anthropicPreviewStem).toBe(["sk-", "ant-"].join(""));
    expect(openAiProjectPrefix).toBe(["sk-", "proj-"].join(""));
    expect(openAiStandardPrefix).toBe("sk-");
    expect(openRouterPrefix).toBe("sk-or-v1-");
    expect(geminiPrefix).toBe("AIza");
  });

  it("detects console, openrouter, project, standard, and gemini families", () => {
    expect(detector.inspect(key(anthropicConsolePrefix))).toMatchObject({
      kind: "detected",
      provider: "anthropic",
      keyFamily: "anthropic_console",
      previewStem: anthropicPreviewStem,
    });
    expect(detector.inspect(key(openRouterPrefix))).toMatchObject({
      kind: "detected",
      provider: "openrouter",
      keyFamily: "openrouter_v1",
    });
    expect(detector.inspect(key(openAiProjectPrefix))).toMatchObject({
      kind: "detected",
      provider: "openai",
      keyFamily: "openai_project",
      previewStem: openAiProjectPrefix,
    });
    expect(detector.inspect(key(openAiStandardPrefix))).toMatchObject({
      kind: "detected",
      provider: "openai",
      keyFamily: "openai_standard",
    });
    expect(detector.inspect(key(geminiPrefix))).toMatchObject({
      kind: "detected",
      provider: "gemini",
      keyFamily: "gemini_developer",
      previewStem: geminiPrefix,
    });
  });

  it("rejects subscription oauth tokens before any network use and keeps the key out of the message", () => {
    const pasted = key(anthropicOauthPrefix, "oat1");
    const detection = detector.inspect(`  "${pasted}"\n`);
    expect(detection).toEqual({
      kind: "rejected",
      code: "subscription_oauth_rejected",
      message: CLAUDE_SUBSCRIPTION_REJECTION,
    });
    expect(CLAUDE_SUBSCRIPTION_REJECTION.startsWith("Claude subscription OAuth tokens are not supported")).toBe(true);
    expect(CLAUDE_SUBSCRIPTION_REJECTION.includes(anthropicConsolePrefix)).toBe(true);
    expect(CLAUDE_SUBSCRIPTION_REJECTION.includes(BODY)).toBe(false);
    expect(JSON.stringify(detection).includes(BODY)).toBe(false);
  });

  it("trims wrapping whitespace and quotes without changing internal characters", () => {
    const internal = `${openAiStandardPrefix}abc  defZZZZ9x2a`;
    expect(normalizePastedApiKey(` \n"${internal}"\r\n `)).toBe(internal);
    const detection = detector.inspect(` \n"${internal}"\r\n `);
    expect(detection).toMatchObject({ kind: "detected", normalizedKey: internal, provider: "openai" });
  });

  it("does not treat other ant or or families as a standard openai key", () => {
    const otherAnt = `${anthropicPreviewStem}admin${BODY}9x2a`;
    const otherOr = `${"sk-or-"}${BODY}9x2a`;
    expect(detector.inspect(otherAnt)).toMatchObject({ kind: "unknown", requiresProviderSelection: true, requiresHttpsBaseUrl: true });
    expect(detector.inspect(otherOr)).toMatchObject({ kind: "unknown" });
    expect(detector.inspect(`aiza${BODY}9x2a`)).toMatchObject({ kind: "unknown" });
    expect(detector.inspect("   ")).toMatchObject({ kind: "unknown" });
  });
});
