import type { AtomicBoxClause, CanvasBox, MultiBoxSplit } from "./types.js";

const CLAUSE_SPLIT = /\s+and\s+|;\s+/i;

const STOP = new Set([
  "a",
  "an",
  "the",
  "to",
  "and",
  "or",
  "of",
  "on",
  "it",
  "this",
  "that",
  "for",
  "with",
  "at",
  "be",
  "is",
  "in",
  "by",
  "from",
  "as",
  "if",
]);

export class MultiBoxClauseSplitter {
  split(text: string, boxes: readonly CanvasBox[]): MultiBoxSplit {
    const nodeIds = boxes.map((box) => box.nodeId);
    const nodeRevisions = boxes.map((box) => ({
      nodeId: box.nodeId,
      revision: box.revision,
    }));
    const trimmed = text.trim();
    if (boxes.length === 0 || trimmed.length === 0) {
      return { nodeIds, nodeRevisions, clauses: [] };
    }
    const parts = trimmed
      .split(CLAUSE_SPLIT)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const clauses = assignClauses(parts.length > 0 ? parts : [trimmed], boxes);
    return { nodeIds, nodeRevisions, clauses };
  }
}

function assignClauses(parts: readonly string[], boxes: readonly CanvasBox[]): AtomicBoxClause[] {
  const used = new Set<number>();
  const assigned: { readonly part: string; readonly box: CanvasBox }[] = [];
  for (const part of parts) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < boxes.length; index += 1) {
      if (used.has(index)) continue;
      const box = boxes[index];
      if (!box) continue;
      const score = scoreBox(part, box);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    if (bestIndex < 0) {
      bestIndex = boxes.findIndex((_box, index) => !used.has(index));
    }
    if (bestIndex < 0) bestIndex = 0;
    const box = boxes[bestIndex];
    if (!box) continue;
    used.add(bestIndex);
    assigned.push({ part, box });
  }
  return assigned.map((item, index) => ({
    order: index + 1,
    clauseText: item.part,
    nodeId: item.box.nodeId,
    revision: item.box.revision,
    intentType: "edit_existing" as const,
  }));
}

function scoreBox(clause: string, box: CanvasBox): number {
  const needles = significant(`${box.label} ${box.nodeId}`);
  const tokens = significant(clause);
  let score = 0;
  for (const needle of needles) {
    for (const token of tokens) {
      if (token === needle) score += needle.length + 4;
      else if (
        token.length >= 4 &&
        needle.length >= 4 &&
        (token.startsWith(needle) || needle.startsWith(token))
      ) {
        score += 4;
      }
    }
  }
  const label = box.label.toLowerCase();
  if (label.length >= 3 && clause.toLowerCase().includes(label)) score += 10;
  return score;
}

function significant(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !STOP.has(token));
}
