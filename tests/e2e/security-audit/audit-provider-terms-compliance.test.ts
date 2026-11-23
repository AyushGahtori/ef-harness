import { expect, it } from "vitest";
import { auditProviderTerms, certifyChatGptWire } from "./ports/provider-terms.ts";
import { directAccessScope } from "./markers.ts";

it("pillar 4 — provider terms compliance & zero-silent-spend", () => {
  const facts = auditProviderTerms();
  expect(facts.claudeConsoleOnly).toBe(true);
  expect(facts.geminiDefaultOff).toBe(true);
  expect(facts.geminiFilesystemTouches).toBe(0);
  expect(facts.withdrawnVendorHits).toBe(0);
  expect(facts.silentSpendMicroUsd).toBe(0);
  expect(
    certifyChatGptWire({
      store: false,
      stream: true,
      instructions: { metadata: { scope: directAccessScope() } },
    }),
  ).toBe(true);
});