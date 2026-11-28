import { mapBrownfieldKindToDb, type BrownfieldWorkItemDraft, type BrownfieldWorkKind } from "./types.js";

export interface MixedSplitResult {
  readonly drafts: readonly BrownfieldWorkItemDraft[];
  readonly combinedPrompt: string;
}

const BUG_RE =
  /\b(fix|bug|broken|redirect|regression|mystery|crash|error)\b[\s\S]{0,80}?(bug|issue|redirect|login|crash)?/i;
const PERF_RE =
  /\b(faster|speed\s*up|slow|performance|snappier|latency|optimize|optimi[sz]e)\b[\s\S]{0,120}/i;
const FEATURE_RE =
  /\b(add|introduce|build|implement|export|csv|feature|support)\b[\s\S]{0,120}/i;
const SWEEP_RE = /\b(refactor|clean\s*up|sweep|reorganize|rename)\b[\s\S]{0,120}/i;
const FLOW_RE = /\b(change|extend|modify|update)\b[\s\S]{0,80}\b(flow|screen|api|endpoint|route)\b/i;

interface Segment {
  readonly kind: BrownfieldWorkKind;
  readonly text: string;
  readonly start: number;
}

function titleFor(kind: BrownfieldWorkKind, text: string): string {
  const clipped = text.trim().replace(/\s+/g, " ").slice(0, 80);
  switch (kind) {
    case "bug_fix":
      return `Bug fix: ${clipped}`;
    case "performance_fix":
      return `Performance fix: ${clipped}`;
    case "new_feature":
      return `New feature: ${clipped}`;
    case "flow_change":
      return `Flow change: ${clipped}`;
    case "sweep":
      return `Sweep: ${clipped}`;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function recommendedOrder(kind: BrownfieldWorkKind): number {
  switch (kind) {
    case "bug_fix":
      return 1;
    case "performance_fix":
      return 2;
    case "flow_change":
      return 3;
    case "new_feature":
      return 4;
    case "sweep":
      return 5;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function extractSegments(combined: string): readonly Segment[] {
  const text = combined.trim();
  if (!text) return [];

  const clauses = text
    .split(/\s*,\s*|\s+and\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);

  if (clauses.length <= 1) {
    return [classifySingleClause(text)];
  }

  const segments: Segment[] = [];
  let offset = 0;
  for (const clause of clauses) {
    const idx = text.indexOf(clause, offset);
  const start = idx >= 0 ? idx : offset;
    segments.push(classifySingleClause(clause, start));
    offset = start + clause.length;
  }
  return segments;
}

function classifySingleClause(clause: string, start = 0): Segment {
  if (BUG_RE.test(clause)) {
    return { kind: "bug_fix", text: clause, start };
  }
  if (PERF_RE.test(clause)) {
    return { kind: "performance_fix", text: clause, start };
  }
  if (SWEEP_RE.test(clause)) {
    return { kind: "sweep", text: clause, start };
  }
  if (FLOW_RE.test(clause)) {
    return { kind: "flow_change", text: clause, start };
  }
  if (FEATURE_RE.test(clause)) {
    return { kind: "new_feature", text: clause, start };
  }
  return { kind: "new_feature", text: clause, start };
}

export class MixedRequestWorkItemSplitter {
  split(combinedPrompt: string): MixedSplitResult {
    const segments = extractSegments(combinedPrompt);
    const uniqueKinds = new Set(segments.map((s) => s.kind));
    if (uniqueKinds.size <= 1 && segments.length <= 1) {
      const only = segments[0] ?? classifySingleClause(combinedPrompt);
      const draft: BrownfieldWorkItemDraft = {
        ordinal: 1,
        kind: only.kind,
        title: titleFor(only.kind, only.text || combinedPrompt),
        userPrompt: only.text || combinedPrompt,
        recommendedOrder: recommendedOrder(only.kind),
      };
      return { drafts: [draft], combinedPrompt };
    }

    const sorted = [...segments].sort(
      (a, b) => recommendedOrder(a.kind) - recommendedOrder(b.kind) || a.start - b.start,
    );

    const drafts: BrownfieldWorkItemDraft[] = sorted.map((segment, index) => ({
      ordinal: index + 1,
      kind: segment.kind,
      title: titleFor(segment.kind, segment.text),
      userPrompt: segment.text,
      recommendedOrder: recommendedOrder(segment.kind),
    }));

    return { drafts, combinedPrompt };
  }
}

export function dbKindForDraft(draft: BrownfieldWorkItemDraft) {
  return mapBrownfieldKindToDb(draft.kind);
}