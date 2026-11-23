import type { RetractionPreview } from "./types.js";

interface CuePattern {
  readonly label: string;
  readonly pattern: RegExp;
}

const CUES: readonly CuePattern[] = [
  { label: "actually scratch that", pattern: /actually,?\s+scratch that/gi },
  { label: "never mind that part", pattern: /never mind that part/gi },
  { label: "no wait", pattern: /\bno wait\b/gi },
];

/**
 * Non-destructive strike-through on the clause before an explicit self-correction.
 * The spoken words stay in the draft. Task 071 reconciles the retraction after Send.
 */
export function findRetractionPreviews(text: string): readonly RetractionPreview[] {
  const found: RetractionPreview[] = [];
  const seen = new Map<string, number>();
  for (const cue of CUES) {
    cue.pattern.lastIndex = 0;
    for (const match of text.matchAll(cue.pattern)) {
      const cueStart = match.index;
      if (cueStart === undefined) continue;
      const clause = precedingClause(text, cueStart);
      if (!clause) continue;
      const occurrence = seen.get(cue.label) ?? 0;
      seen.set(cue.label, occurrence + 1);
      found.push({
        id: `${cue.label}#${occurrence}`,
        start: clause.start,
        end: clause.end,
        text: text.slice(clause.start, clause.end),
        cue: cue.label,
        decoration: "strike-through",
        destructive: false,
        reversible: true,
        reconciler: {
          task: "Task-071",
          kind: "cross_chunk_retraction",
          applyOn: "after_send",
        },
      });
    }
  }
  found.sort((left, right) => left.start - right.start);
  return found;
}

function precedingClause(text: string, cueStart: number): { start: number; end: number } | null {
  const before = text.slice(0, cueStart).trimEnd();
  if (before.length === 0) return null;
  const stripped = /[.!?]$/.test(before) ? before.slice(0, -1) : before;
  const boundary = Math.max(stripped.lastIndexOf("."), stripped.lastIndexOf("!"), stripped.lastIndexOf("?"));
  const regionStart = boundary < 0 ? 0 : boundary + 1;
  const raw = text.slice(regionStart, cueStart);
  const lead = raw.search(/\S/);
  if (lead < 0) return null;
  const end = regionStart + raw.trimEnd().length;
  return { start: regionStart + lead, end };
}
