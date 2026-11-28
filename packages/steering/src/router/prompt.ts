import type { InputStartFocus, RouterPrompt, RouterRepair, ShortlistCard } from "./types.js";

export const ROUTER_V1_INSTRUCTION =
  "Split the message into clauses. For each clause, choose one intent and, if it changes something, one target from the candidate cards only. A selected box or focused question is the default target unless the clause clearly names another. If two targets fit, set needs_clarification. Never invent targets. A clause that only asks for information is a question, even if it mentions a change. When two or more real targets fit and none was focused at input start, return confidence ambiguous so the kernel can record alternateReadings and hand the clause to the multi-interpretation hold path. Closed router intents are question, change, correct_evidence, add, remove, explain_impact, new_feature, and control.";

export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export function escapeProvenance(text: string): string {
  return text
    .replaceAll("</data", "&lt;/data")
    .replaceAll("</instruction", "&lt;/instruction")
    .replaceAll("<instruction", "&lt;instruction");
}

export function renderRouterPrompt(input: {
  readonly messageText: string;
  readonly cards: readonly ShortlistCard[];
  readonly focus: InputStartFocus | null;
  readonly previousTargets: readonly string[];
  readonly repair: RouterRepair | null;
}): RouterPrompt {
  const publicCards = input.cards.map((card) => ({
    id: card.id,
    title: card.title.slice(0, 80),
    aliases: card.aliases.slice(0, 3),
    owner: card.ownerRole,
    whyMatched: card.whyMatched.join(", ").slice(0, 80),
  }));
  const repairBlock = input.repair
    ? `<data source="repair">\n${escapeProvenance(JSON.stringify({ attempt: input.repair.attempt, errors: input.repair.errors, allowedTargetIds: input.cards.map((card) => card.id) }))}\n</data>\n`
    : "";
  const rendered = [
    "router@1",
    "<instruction>",
    ROUTER_V1_INSTRUCTION,
    "</instruction>",
    `<user>\n${escapeProvenance(input.messageText)}\n</user>`,
    `<data source="shortlist">\n${escapeProvenance(JSON.stringify(publicCards))}\n</data>`,
    `<data source="focus">\n${escapeProvenance(JSON.stringify(input.focus))}\n</data>`,
    `<data source="previous-targets">\n${escapeProvenance(JSON.stringify(input.previousTargets))}\n</data>`,
    repairBlock,
  ].join("\n");
  const promptTokens = estimateTokens(rendered);
  return {
    instruction: ROUTER_V1_INSTRUCTION,
    messageText: input.messageText,
    allowedTargetIds: input.cards.map((card) => card.id),
    cards: input.cards,
    focus: input.focus,
    previousTargets: input.previousTargets,
    rendered,
    promptTokens,
    repair: input.repair,
  };
}
