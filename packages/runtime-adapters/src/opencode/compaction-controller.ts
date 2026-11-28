import { LABELED_WIP_HEADER, OPENCODE_COMPACTION_THRESHOLD, type UsageTotals } from "./types.js";
import { OpenCodeAdapterError } from "./errors.js";

export type CompactionAssessment =
  | {
      readonly action: "none";
      readonly utilization: number;
      readonly usedTokens: number;
      readonly contextCeilingTokens: number;
    }
  | {
      readonly action: "pinned_compaction";
      readonly utilization: number;
      readonly usedTokens: number;
      readonly contextCeilingTokens: number;
      readonly compactedBrief: string;
      readonly pinnedMust: readonly string[];
      readonly pinnedWriteScope: readonly string[];
    }
  | {
      readonly action: "fresh_session_checkpoint";
      readonly utilization: number;
      readonly usedTokens: number;
      readonly contextCeilingTokens: number;
      readonly reason: string;
      readonly pinnedMust: readonly string[];
      readonly pinnedWriteScope: readonly string[];
      readonly labeledWip: string;
      readonly compactedBrief: string;
    };

export interface CompactionInput {
  readonly usage: UsageTotals;
  readonly contextCeilingTokens: number;
  readonly mustChecklist: readonly string[];
  readonly writeScope: readonly string[];
  readonly brief: string;
  readonly transcript: string;
  readonly preferFreshSession?: boolean;
}

export function usedTokenTotal(usage: UsageTotals): number {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite + usage.reasoning;
}

function mustLines(brief: string, checklist: readonly string[]): string[] {
  const fromBrief = brief
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\bMUST\b/.test(line));
  const merged: string[] = [];
  for (const item of [...checklist, ...fromBrief]) {
    const trimmed = item.trim();
    if (trimmed.length > 0 && !merged.includes(trimmed)) merged.push(trimmed);
  }
  return merged;
}

function assertPins(text: string, pins: readonly string[]): void {
  for (const pin of pins) {
    if (!text.includes(pin)) {
      throw new OpenCodeAdapterError("compaction_dropped_pin", "pinned MUST or write_scope text was dropped");
    }
  }
}

/**
 * Silent OpenCode auto-compaction stays off (`compaction.auto: false`).
 * This controller is the only compaction path. At >= 75% of the context
 * ceiling it keeps every MUST line and every write_scope path verbatim.
 */
export class OpenCodeCompactionController {
  constructor(private readonly threshold = OPENCODE_COMPACTION_THRESHOLD) {}

  utilization(usedTokens: number, contextCeilingTokens: number): number {
    if (contextCeilingTokens <= 0) {
      throw new OpenCodeAdapterError("compaction_ceiling", "context ceiling must be positive");
    }
    return usedTokens / contextCeilingTokens;
  }

  assess(input: CompactionInput): CompactionAssessment {
    const usedTokens = usedTokenTotal(input.usage);
    const utilization = this.utilization(usedTokens, input.contextCeilingTokens);
    const pinnedMust = mustLines(input.brief, input.mustChecklist);
    const pinnedWriteScope = [...input.writeScope];
    if (utilization < this.threshold) {
      return {
        action: "none",
        utilization,
        usedTokens,
        contextCeilingTokens: input.contextCeilingTokens,
      };
    }
    const compactedBrief = this.compose(pinnedMust, pinnedWriteScope, input.transcript);
    assertPins(compactedBrief, pinnedMust);
    assertPins(compactedBrief, pinnedWriteScope);
    if (input.preferFreshSession === true) {
      return {
        action: "fresh_session_checkpoint",
        utilization,
        usedTokens,
        contextCeilingTokens: input.contextCeilingTokens,
        reason: "explicit_fresh_session_handoff",
        pinnedMust,
        pinnedWriteScope,
        labeledWip: LABELED_WIP_HEADER,
        compactedBrief,
      };
    }
    return {
      action: "pinned_compaction",
      utilization,
      usedTokens,
      contextCeilingTokens: input.contextCeilingTokens,
      compactedBrief,
      pinnedMust,
      pinnedWriteScope,
    };
  }

  private compose(must: readonly string[], writeScope: readonly string[], transcript: string): string {
    const mustBlock = must.map((item) => `- ${item}`).join("\n");
    const scopeBlock = writeScope.map((item) => `- ${item}`).join("\n");
    const clipped = transcript.length > 4_000 ? transcript.slice(transcript.length - 4_000) : transcript;
    return [
      "MUST CHECKLIST",
      mustBlock,
      "",
      "WRITE SCOPE",
      scopeBlock,
      "",
      "PINNED BRIEF RULES",
      "The MUST checklist and write_scope paths above stay verbatim.",
      "",
      "COMPACTED TRANSCRIPT",
      clipped,
    ].join("\n");
  }
}
