import { writeDecision } from "./commit-decision.js";
import { type KnowledgeGraphPort, readDecision } from "./graph-port.js";
import { PremiseSupersessionReopener } from "./premise-supersession-reopener.js";
import type { DecisionFields } from "./types.js";

export interface ExistingFact {
  readonly id: string;
  readonly criterion: string;
  readonly value: string;
}

export type Disambiguation =
  | {
      readonly kind: "replacement";
      readonly decisionId: string;
      readonly criterion: string;
      readonly previousValue: string;
      readonly nextValue: string;
      readonly historyRetained: true;
    }
  | {
      readonly kind: "second_event";
      readonly clarifyContract: "clarify@1";
      readonly question: string;
      readonly preserved: readonly { readonly criterion: string; readonly value: string }[];
    }
  | { readonly kind: "none" };

const TIME = /\b\d{1,2}:\d{2}\b/;
const REPLACEMENT = /\bactually\b/i;
const REPLACEMENT_VERB = /\b(?:set|change|make|update|correct)\b/i;
const SECOND_EVENT = /\bkitchen\b/i;
const SECOND_EVENT_DETAIL = /\b(?:final counts|preliminary|wants|as well|also)\b/i;

/**
 * "Actually set the cutoff to 10:45" replaces one field and keeps the old fact.
 * "Kitchen wants final counts at 10:45" beside an 11:00 cutoff keeps both and asks.
 */
export class ReplacementSecondEventDisambiguator {
  constructor(
    private readonly graph: KnowledgeGraphPort,
    private readonly reopener: PremiseSupersessionReopener,
  ) {}

  classify(text: string, existing: readonly ExistingFact[]): Disambiguation {
    const nextValue = text.match(TIME)?.[0] ?? null;
    const cutoff = existing.find((fact) => /cutoff|lock/i.test(fact.criterion) || TIME.test(fact.value));
    if (!nextValue || !cutoff || nextValue === cutoff.value) return { kind: "none" };
    if (SECOND_EVENT.test(text) && SECOND_EVENT_DETAIL.test(text)) {
      return {
        kind: "second_event",
        clarifyContract: "clarify@1",
        question: `Do orders lock at ${nextValue}, or does the kitchen get a preliminary count at ${nextValue} while orders still lock at ${cutoff.value}?`,
        preserved: [
          { criterion: cutoff.criterion, value: cutoff.value },
          { criterion: "kitchen.final_counts", value: nextValue },
        ],
      };
    }
    if (REPLACEMENT.test(text) && REPLACEMENT_VERB.test(text)) {
      return {
        kind: "replacement",
        decisionId: cutoff.id,
        criterion: cutoff.criterion,
        previousValue: cutoff.value,
        nextValue,
        historyRetained: true,
      };
    }
    return { kind: "none" };
  }

  apply(text: string, existing: readonly ExistingFact[]): Disambiguation {
    const decision = this.classify(text, existing);
    if (decision.kind === "replacement") {
      this.replace(decision);
      this.reopener.reopenDependents(decision.decisionId);
    }
    if (decision.kind === "second_event") {
      this.holdSecondEvent(decision);
    }
    return decision;
  }

  private replace(decision: Extract<Disambiguation, { kind: "replacement" }>): void {
    const node = this.graph.getNode(decision.decisionId);
    const fields = node ? readDecision(node) : null;
    if (!node || !fields) return;
    const next: DecisionFields = {
      ...fields,
      status: "settled",
      basis: "explicit",
      value: decision.nextValue,
      entailmentReason: `Replaced ${decision.previousValue} and retained that fact in history`,
    };
    writeDecision(this.graph, {
      id: decision.decisionId,
      kind: node.kind,
      title: node.title,
      text: decision.nextValue,
      fields: next,
      nodeStatus: "active",
      edges: [],
      retireEdges: [],
      summary: `Replace ${decision.criterion}`,
    });
  }

  private holdSecondEvent(decision: Extract<Disambiguation, { kind: "second_event" }>): void {
    const second = decision.preserved[1];
    if (!second) return;
    const id = "kitchen.final_counts";
    if (this.graph.getNode(id)) return;
    const fields: DecisionFields = {
      criterion: second.criterion,
      status: "open",
      value: second.value,
      basis: null,
      rule: null,
      premises: [],
      evidence: [],
      retracted: false,
      feature: null,
      costly: false,
      reversibility: "easy",
      mustAsk: false,
      criterionKind: "time",
      release: "current",
      changeSummary: decision.question,
      entailmentVerdict: null,
      entailmentReason: null,
    };
    writeDecision(this.graph, {
      id,
      kind: "decision",
      title: "Kitchen final counts",
      text: decision.question,
      fields,
      nodeStatus: "active",
      edges: [],
      retireEdges: [],
      summary: "Hold a possible second event for clarify@1",
    });
  }

}

export function factsFromGraph(graph: KnowledgeGraphPort, ids: readonly string[]): ExistingFact[] {
  const facts: ExistingFact[] = [];
  for (const id of ids) {
    const node = graph.getNode(id);
    const fields = node ? readDecision(node) : null;
    if (!fields || typeof fields.value !== "string") continue;
    facts.push({ id, criterion: fields.criterion, value: fields.value });
  }
  return facts;
}
