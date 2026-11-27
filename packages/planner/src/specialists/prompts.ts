import type { HighRiskReviewRequest, TasteScreenshot } from "./types.js";

export function buildReviewerPrompt(input: HighRiskReviewRequest): string {
  const must = input.must.map((item) => `${item.id}: ${item.text}`).join("\n");
  const rules = input.rules.map((item) => `${item.id}: ${item.text}`).join("\n");
  const audit = input.staticAudit
    ? `${input.staticAudit.fingerprint} passed=${String(input.staticAudit.passed)} hard=${String(input.staticAudit.hardFindingCount)} soft=${String(input.staticAudit.softFindingCount)}`
    : "none";
  return [
    "role: reviewer@1",
    "Look for code that passes the examples without implementing the rule: literal branches, constants for specific inputs, logic weaker than the rule, and rules left unimplemented.",
    "Cite file and line. Report only concrete findings.",
    "Shortcuts to catch: hardcoded bypass, missing server-side authorization, non-atomic balance update, swallowed catch, SQL string interpolation, insecure cookie flags.",
    "MUST:",
    must || "(none)",
    "RULES:",
    rules || "(none)",
    "STATIC_AUDIT:",
    audit,
    "DIFF:",
    input.diff,
  ].join("\n");
}

export function buildTastePrompt(screenshots: readonly TasteScreenshot[]): string {
  const lines = screenshots.map(
    (shot) =>
      `${shot.id} screen=${shot.screenId} kind=${shot.kind} width=${String(shot.viewportWidth)} env=${shot.environment} seed=${shot.seedReceiptId ?? "none"}`,
  );
  return [
    "role: taste-reviewer@1",
    "ADVISORY ONLY. This review never blocks acceptance.",
    "Compare the screens with /__styleguide. Report concrete visual issues only: cramped hierarchy, awkward whitespace, inconsistent icon weight, clashing rhythm.",
    "SHOTS:",
    lines.join("\n") || "(none)",
  ].join("\n");
}

export function buildAskOwnerPrompt(question: string, factSheet: string): string {
  return [
    "role: ask-owner-responder@1",
    "Answer from the recorded facts only. Quote them. Do not invent a product decision or a status that is not in the facts.",
    `Question: ${question}`,
    "FACTS:",
    factSheet,
  ].join("\n");
}
