/**
 * Local shapes for the worker context pipeline.
 * Task 008 `TaskPacketV1`, Task 009 `TurnSummarizerV1` / `buildPromptEnvelope`,
 * and Task 053 `ModelProfile` are ported in `ports.ts` until those branches merge.
 */

export const COMPACTION_THRESHOLD_RATIO = 0.7;
export const CONTEXT_OVERFLOW_TIGHTEN = 0.85;
export const WORKING_MEMORY_TOKEN_CAP = 1_500;
export const SMALL_CONTEXT_WINDOW_MAX = 32_768;
export const SMALL_MODEL_VERBATIM_STEPS = 4;
export const SMALL_MODEL_MAX_READ_LINES = 200;
export const SMALL_MODEL_MAX_TEST_FAILURES = 10;
export const LARGE_MODEL_MAX_READ_LINES = 400;
export const LARGE_MODEL_MAX_TEST_FAILURES = 25;

export const COMPACTION_STAGES = [
  "trim_should_and_superseded_reads",
  "collapse_old_tool_results",
  "summarize_old_turns",
  "hard_refusal",
] as const;

export type CompactionStage = (typeof COMPACTION_STAGES)[number];

export type ZoneId = 1 | 2 | 3 | 4 | 5 | 6;

export type ZoneName =
  | "kernel_role"
  | "must"
  | "should"
  | "working_memory"
  | "history"
  | "tail";

export interface ContextZone {
  readonly id: ZoneId;
  readonly name: ZoneName;
  readonly pinned: boolean;
  readonly text: string;
}

export interface ReasoningItem {
  readonly kind: "reasoning";
  readonly opaque: string;
}

export interface ToolCallRecord {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly resultSummary: string;
  readonly content: string;
  readonly artifactIds: readonly string[];
  readonly symbolOutline?: string;
  readonly testFailures?: readonly string[];
}

export interface HistoryStep {
  readonly step: number;
  readonly assistantText: string;
  readonly reasoning: readonly ReasoningItem[];
  readonly toolCalls: readonly ToolCallRecord[];
}

export type RenderMode = "verbatim" | "collapsed" | "omitted";

export interface RenderToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly resultSummary: string;
  readonly content: string;
  readonly artifactIds: readonly string[];
  readonly superseded: boolean;
  readonly symbolOutline?: string;
  readonly testFailures?: readonly string[];
}

export interface RenderStep {
  readonly step: number;
  readonly assistantText: string;
  readonly reasoning: readonly ReasoningItem[];
  readonly toolCalls: readonly RenderToolCall[];
  readonly mode: RenderMode;
}

export interface WorkingMemory {
  readonly planSteps: readonly string[];
  readonly doneByMustId: Readonly<Record<string, string>>;
  readonly openProblems: readonly string[];
  readonly learnedFacts: readonly string[];
}

export interface TurnLogRow {
  readonly attempt: string;
  readonly step: number;
  readonly request_digest: string | null;
  readonly items_artifact: string | null;
  readonly tool_call: string;
  readonly result_summary: string;
  readonly result_artifact: string | null;
  readonly checkpoint_commit: string | null;
  readonly tokens_in: number | null;
  readonly tokens_out: number | null;
}

export type ContextMessage =
  | {
      readonly role: "system";
      readonly zone: 1 | 2 | 3 | 4;
      readonly content: string;
    }
  | {
      readonly role: "user";
      readonly zone: 5 | 6;
      readonly kind: "history_marker" | "brief" | "progress_note" | "tail";
      readonly content: string;
    }
  | {
      readonly role: "assistant";
      readonly zone: 5;
      readonly step: number;
      readonly content: string;
      readonly reasoning: readonly ReasoningItem[];
      readonly toolUses: readonly { readonly id: string; readonly name: string }[];
    }
  | {
      readonly role: "tool";
      readonly zone: 5;
      readonly step: number;
      readonly toolUseId: string;
      readonly name: string;
      readonly content: string;
      readonly artifactIds: readonly string[];
    };

export type SummarizerOutcome =
  | "not_needed"
  | "working_memory"
  | "progress_note"
  | "fallback_one_line";

export interface ContextCaps {
  readonly smallModel: boolean;
  readonly verbatimSteps: number;
  readonly maxReadLines: number;
  readonly maxTestFailures: number;
  readonly windowedSymbolOutline: boolean;
}

export class ContextBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBuildError";
  }
}
