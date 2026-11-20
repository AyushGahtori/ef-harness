import { type DecisionWrite, writeMany } from "./commit-decision.js";
import type { KnowledgeGraphPort } from "./graph-port.js";
import type { DecisionFields, JsonValue } from "./types.js";

export interface ExtractedClaim {
  readonly id: string;
  readonly criterion: string;
  readonly value: JsonValue;
  readonly feature: string | null;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
}

export interface TurnChunk {
  readonly index: number;
  readonly text: string;
  readonly startOffset: number;
  readonly claims: readonly ExtractedClaim[];
}

export interface LongTurn {
  readonly turnId: string;
  readonly author: "developer" | "harness";
  readonly chunks: readonly TurnChunk[];
}

export interface ReconciledSpan {
  readonly claimId: string;
  readonly quote: string;
  readonly feature: string | null;
  readonly retracted: boolean;
  readonly release: "current" | "later";
  readonly start: number;
  readonly end: number;
}

export interface Reconciliation {
  readonly spans: readonly ReconciledSpan[];
  readonly survivingIds: readonly string[];
  commit(): void;
}

interface RetractionSpan {
  readonly start: number;
  readonly end: number;
  readonly stems: ReadonlySet<string>;
}

const RETRACTION =
  /\b(?:scrap|scratch|retract|cancel|drop|forget|withdraw)\b|\bnever mind\b|\bscratch that\b|\bdo not add\b|\bdon't add\b|\bno longer\b/i;

const STOP = new Set([
  "actually",
  "maybe",
  "add",
  "that",
  "this",
  "the",
  "a",
  "an",
  "to",
  "of",
  "and",
  "or",
  "after",
  "launch",
  "just",
  "really",
  "please",
  "scrap",
  "scratch",
  "retract",
  "cancel",
  "drop",
  "forget",
  "withdraw",
  "never",
  "mind",
  "longer",
]);

/**
 * Reconciles every chunk of one submitted turn before the first graph write.
 * "Maybe add printing … actually, scrap printing" leaves zero printing nodes.
 */
export class LongTurnRetractionReconciler {
  constructor(private readonly graph: KnowledgeGraphPort) {}

  reconcile(turn: LongTurn): Reconciliation {
    const retractions = findRetractions(turn);
    const claims = turn.chunks.flatMap((chunk) => chunk.claims);
    const spans = claims.map((claim) => toSpan(claim, retractions));
    const surviving = claims.filter((claim) => {
      const span = spans.find((item) => item.claimId === claim.id);
      return span ? !span.retracted : false;
    });
    return {
      spans,
      survivingIds: surviving.map((claim) => claim.id),
      commit: () => {
        if (turn.author !== "developer") return;
        const writes = surviving.map((claim) => toWrite(claim, spans));
        writeMany(this.graph, writes, "Reconciled long turn");
      },
    };
  }
}

function toSpan(claim: ExtractedClaim, retractions: readonly RetractionSpan[]): ReconciledSpan {
  const stems = claimStems(claim);
  const retracted = retractions.some((retraction) => {
    const shares = [...stems].some((stem) => retraction.stems.has(stem));
    if (!shares) return false;
    const earlier = claim.start < retraction.start;
    const overlaps = claim.start < retraction.end && claim.end > retraction.start;
    return earlier || overlaps;
  });
  return {
    claimId: claim.id,
    quote: claim.quote,
    feature: claim.feature,
    retracted,
    release: retracted ? "current" : releaseOf(claim),
    start: claim.start,
    end: claim.end,
  };
}

function toWrite(claim: ExtractedClaim, spans: readonly ReconciledSpan[]): DecisionWrite {
  const span = spans.find((item) => item.claimId === claim.id);
  const release = span?.release ?? "current";
  const fields: DecisionFields = {
    criterion: claim.criterion,
    status: "settled",
    value: claim.value,
    basis: "explicit",
    rule: null,
    premises: [],
    evidence: [],
    retracted: false,
    feature: claim.feature,
    costly: false,
    reversibility: "easy",
    mustAsk: false,
    criterionKind: claim.feature ?? "feature",
    release,
    changeSummary: null,
    entailmentVerdict: null,
    entailmentReason: null,
  };
  return {
    id: claim.id,
    kind: claim.feature ? "feature" : "decision",
    title: claim.criterion,
    text: claim.quote,
    fields,
    nodeStatus: "active",
    edges: [],
    retireEdges: [],
    summary: `Commit reconciled claim ${claim.id}`,
  };
}

function findRetractions(turn: LongTurn): RetractionSpan[] {
  const found: RetractionSpan[] = [];
  for (const chunk of turn.chunks) {
    let cursor = 0;
    for (const sentence of chunk.text.split(/(?<=[.!?])\s+/)) {
      const at = chunk.text.indexOf(sentence, cursor);
      const local = at >= 0 ? at : cursor;
      cursor = local + sentence.length;
      if (!RETRACTION.test(sentence)) continue;
      found.push({
        start: chunk.startOffset + local,
        end: chunk.startOffset + local + sentence.length,
        stems: contentStems(sentence),
      });
    }
  }
  return found;
}

function releaseOf(claim: ExtractedClaim): "current" | "later" {
  return /\bafter launch\b|\blater release\b|\bfor later\b/i.test(claim.quote) ? "later" : "current";
}

function claimStems(claim: ExtractedClaim): Set<string> {
  return contentStems(`${claim.quote} ${claim.feature ?? ""} ${claim.criterion}`);
}

function contentStems(text: string): Set<string> {
  const stems = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z0-9']+/g) ?? []) {
    if (STOP.has(word)) continue;
    const value = stem(word);
    if (value.length >= 4 && !STOP.has(value)) stems.add(value);
  }
  return stems;
}

function stem(word: string): string {
  let value = word;
  if (value.endsWith("ing") && value.length > 5) value = value.slice(0, -3);
  if (value.endsWith("s") && value.length > 4) value = value.slice(0, -1);
  return value;
}
