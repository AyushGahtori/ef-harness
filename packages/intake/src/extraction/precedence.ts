import { claimSignal } from "./dedup.js";
import type {
  ConflictCard,
  DocClause,
  LiveUtterance,
  PrecedenceResult,
  SettledLiveDecision,
  SupersededClause,
} from "./types.js";
import { EM_DASH, EXCLUDED_BY_LIVE_INSTRUCTION, overriddenByTurn } from "./types.js";

interface ParsedOverride {
  readonly turnId: string;
  readonly turnLabel: string;
  readonly quote: string;
  readonly explicit: boolean;
  readonly exclusions: readonly string[];
  readonly replacements: readonly { readonly topic: string; readonly from: string; readonly to: string }[];
}

function normalizeTopic(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseOverride(utterance: LiveUtterance): ParsedOverride {
  const text = utterance.text;
  const exclusions: string[] = [];
  const replacements: { topic: string; from: string; to: string }[] = [];
  if (/\bno\s+subscriptions?\b/i.test(text) || /\bone-time payments only\b/i.test(text)) {
    exclusions.push("subscription");
  }
  const skip = /\bskip\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{0,40}?)(?=\s+and\b|[.,]|$)/i.exec(text);
  if (skip?.[1]) exclusions.push(normalizeTopic(skip[1]));
  const instead = /\b(\d{1,2}:\d{2})\s+instead of\s+(\d{1,2}:\d{2})\b/i.exec(text);
  if (instead?.[1] && instead?.[2]) {
    replacements.push({ topic: "cutoff", from: instead[2], to: instead[1] });
  }
  const explicit = exclusions.length > 0 || replacements.length > 0 || /\bexcept\b/i.test(text);
  return {
    turnId: utterance.turnId,
    turnLabel: utterance.turnLabel,
    quote: text,
    explicit,
    exclusions,
    replacements,
  };
}

function matchesExclusion(clause: DocClause, topic: string): boolean {
  if (topic === "subscription") return /subscription|stripe/i.test(clause.text);
  if (topic === "mobile app") return /mobile app/i.test(clause.text);
  return clause.text.toLowerCase().includes(topic);
}

function matchesReplacement(clause: DocClause, replacement: { topic: string; from: string }): boolean {
  if (replacement.topic === "cutoff") return /cutoff|cut-off/i.test(clause.text) && clause.text.includes(replacement.from);
  return clause.text.includes(replacement.from);
}

function valuesConflict(clause: DocClause, decision: SettledLiveDecision): boolean {
  if (clause.criterion && clause.criterion === decision.criterion) {
    const clauseValue = (clause.value ?? clause.text).trim().toLowerCase();
    return clauseValue !== decision.value.trim().toLowerCase();
  }
  const clauseSignalValue = claimSignal(clause.text);
  const liveSignal = claimSignal(`${decision.criterion} ${decision.value} ${decision.quote}`);
  if (!clauseSignalValue || !liveSignal) return false;
  return clauseSignalValue.topic === liveSignal.topic && clauseSignalValue.value !== liveSignal.value;
}

/**
 * Live speech outranks uploaded documents.
 * An explicit override archives the doc clause. A bare conflict becomes a card
 * and leaves the settled live decision in place.
 */
export class LiveSpeechPrecedenceReconciler {
  reconcile(input: {
    readonly utterances: readonly LiveUtterance[];
    readonly settled: readonly SettledLiveDecision[];
    readonly clauses: readonly DocClause[];
  }): PrecedenceResult {
    const overrides = input.utterances.map(parseOverride).filter((item) => item.explicit);
    const archived: SupersededClause[] = [];
    const archivedIds = new Set<string>();
    const synthesized: SettledLiveDecision[] = [];

    for (const override of overrides) {
      if (override.exclusions.includes("subscription")) {
        synthesized.push({
          id: `live-${override.turnId}-payments`,
          criterion: "payments.model",
          value: "one-time",
          quote: override.quote,
          turnId: override.turnId,
          turnLabel: override.turnLabel,
          basis: "explicit",
          status: "settled",
        });
      }
      for (const replacement of override.replacements) {
        synthesized.push({
          id: `live-${override.turnId}-${replacement.topic}`,
          criterion: replacement.topic === "cutoff" ? "time.cutoff" : replacement.topic,
          value: replacement.to,
          quote: override.quote,
          turnId: override.turnId,
          turnLabel: override.turnLabel,
          basis: "explicit",
          status: "settled",
        });
      }
      for (const clause of input.clauses) {
        if (archivedIds.has(clause.id)) continue;
        const excluded = override.exclusions.find((topic) => matchesExclusion(clause, topic));
        const replaced = override.replacements.find((replacement) => matchesReplacement(clause, replacement));
        if (!excluded && !replaced) continue;
        const supersededBy = excluded === "subscription" ? EXCLUDED_BY_LIVE_INSTRUCTION : overriddenByTurn(override.turnLabel);
        archived.push({
          clauseId: clause.id,
          status: "superseded",
          supersededBy,
          quote: clause.quote,
          locatorLabel: clause.locatorLabel,
        });
        archivedIds.add(clause.id);
      }
    }

    const conflicts: ConflictCard[] = [];
    const settled = [...input.settled];
    for (const decision of synthesized) {
      if (!settled.some((item) => item.id === decision.id)) settled.push(decision);
    }
    let card = 0;
    for (const clause of input.clauses) {
      if (archivedIds.has(clause.id)) continue;
      for (const decision of input.settled) {
        if (!valuesConflict(clause, decision)) continue;
        card += 1;
        conflicts.push({
          id: `live-conflict-${card}`,
          message: `You said: ${decision.quote} (${decision.turnLabel}) vs ${clause.locatorLabel} says: ${clause.quote} ${EM_DASH} Keep yours or adopt doc?`,
          liveQuote: decision.quote,
          liveTurnLabel: decision.turnLabel,
          docQuote: clause.quote,
          docLocatorLabel: clause.locatorLabel,
          options: ["keep_yours", "adopt_doc"],
          clauseId: clause.id,
          decisionId: decision.id,
        });
        break;
      }
    }
    const conflictIds = new Set(conflicts.map((item) => item.clauseId));
    const surviving = input.clauses.filter((clause) => !archivedIds.has(clause.id) && !conflictIds.has(clause.id));
    const tasks = surviving.filter((clause) => clause.kind === "requirement");
    const subscriptionTaskCount = tasks.filter((clause) => /subscription|stripe/i.test(clause.text)).length;
    return {
      settledLive: settled,
      archived,
      conflicts,
      survivingClauses: surviving,
      tasks,
      subscriptionTaskCount,
    };
  }
}
