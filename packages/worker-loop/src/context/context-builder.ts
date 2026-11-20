import { CompactionPipeline, type CompactionOk } from "./compaction.js";
import type { ModelProfile, TaskPacketV1, TurnSummarizer } from "./ports.js";
import { defaultKernelRules, defaultRoleInstruction, renderContext, type RenderedContext } from "./render.js";
import { TokenEstimator } from "./token-estimator.js";
import {
  ContextBuildError,
  type CompactionStage,
  type ContextZone,
  type HistoryStep,
  type SummarizerOutcome,
  type WorkingMemory,
} from "./types.js";
import { sha256Hex } from "./working-memory.js";

export interface BuildRequestInput {
  readonly packet: TaskPacketV1;
  readonly modelProfile: ModelProfile;
  readonly workingMemory: WorkingMemory;
  readonly history: readonly HistoryStep[];
  readonly step: number;
  readonly initialUserBrief?: string;
  readonly kernelRules?: string;
  readonly roleInstruction?: string;
  readonly turnSummarizer?: TurnSummarizer;
  readonly contextOverflow?: boolean;
  readonly workingMemoryCoversThroughStep?: number | null;
  readonly toolSchemas?: readonly unknown[];
}

export interface BuiltContextRequest extends RenderedContext {
  readonly status: "ok";
  readonly estimatedTokens: number;
  readonly targetTokens: number;
  readonly exceedsTarget: boolean;
  readonly stagesApplied: readonly CompactionStage[];
  readonly summarizerOutcome: SummarizerOutcome;
  readonly mustTokens: number;
  readonly windowTokens: number;
  readonly recoveryAttempts: 0 | 1;
  readonly tightened: boolean;
  readonly requestDigest: string;
  readonly zones: readonly [
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
    ContextZone,
  ];
}

export interface TaskTooLarge {
  readonly status: "task_too_large_for_model";
  readonly mustTokens: number;
  readonly windowTokens: number;
  readonly stagesApplied: readonly ["hard_refusal"];
}

export interface ParkedAfterOverflow {
  readonly status: "park_after_context_overflow";
  readonly estimatedTokens: number;
  readonly targetTokens: number;
  readonly mustTokens: number;
  readonly windowTokens: number;
  readonly recoveryAttempts: 1;
  readonly tightened: true;
  readonly stagesApplied: readonly CompactionStage[];
  readonly zones: BuiltContextRequest["zones"];
  readonly messages: BuiltContextRequest["messages"];
  readonly verbatimStepNumbers: readonly number[];
  readonly text: string;
}

export type BuildRequestResult = BuiltContextRequest | TaskTooLarge | ParkedAfterOverflow;

export class WorkerContextBuilder {
  private readonly pipeline = new CompactionPipeline();

  constructor(private readonly defaults?: { readonly turnSummarizer?: TurnSummarizer }) {}

  buildRequest(input: BuildRequestInput): BuildRequestResult {
    if (!Number.isInteger(input.step) || input.step < 1) {
      throw new ContextBuildError("current step must be a positive integer");
    }
    if (!Number.isInteger(input.modelProfile.contextWindow) || input.modelProfile.contextWindow <= 0) {
      throw new ContextBuildError("modelProfile.contextWindow must be a positive integer");
    }
    const estimator = new TokenEstimator(input.modelProfile);
    const tightened = input.contextOverflow === true;
    const toolSchemaJson =
      input.toolSchemas === undefined ? null : JSON.stringify(input.toolSchemas);
    const summarizer = input.turnSummarizer ?? this.defaults?.turnSummarizer;
    const result = this.pipeline.run({
      packet: input.packet,
      profile: input.modelProfile,
      estimator,
      memory: input.workingMemory,
      workingMemoryCoversThroughStep: input.workingMemoryCoversThroughStep ?? null,
      history: input.history,
      step: input.step,
      brief: input.initialUserBrief ?? null,
      kernelRules: input.kernelRules ?? defaultKernelRules(),
      roleInstruction: input.roleInstruction ?? defaultRoleInstruction(),
      toolSchemaJson,
      tightened,
      ...(summarizer === undefined ? {} : { turnSummarizer: summarizer }),
    });
    if (result.status === "task_too_large_for_model") {
      return {
        status: "task_too_large_for_model",
        mustTokens: result.mustTokens,
        windowTokens: result.windowTokens,
        stagesApplied: result.stagesApplied,
      };
    }
    return this.finish(result, tightened);
  }

  private finish(result: CompactionOk, tightened: boolean): BuildRequestResult {
    const rendered = renderContext(result.assembly);
    if (tightened && result.exceedsTarget) {
      return {
        status: "park_after_context_overflow",
        estimatedTokens: result.estimatedTokens,
        targetTokens: result.targetTokens,
        mustTokens: result.mustTokens,
        windowTokens: result.windowTokens,
        recoveryAttempts: 1,
        tightened: true,
        stagesApplied: result.stagesApplied,
        zones: rendered.zones,
        messages: rendered.messages,
        verbatimStepNumbers: rendered.verbatimStepNumbers,
        text: rendered.text,
      };
    }
    return {
      status: "ok",
      ...rendered,
      estimatedTokens: result.estimatedTokens,
      targetTokens: result.targetTokens,
      exceedsTarget: result.exceedsTarget,
      stagesApplied: result.stagesApplied,
      summarizerOutcome: result.summarizerOutcome,
      mustTokens: result.mustTokens,
      windowTokens: result.windowTokens,
      recoveryAttempts: tightened ? 1 : 0,
      tightened,
      requestDigest: sha256Hex(rendered.text),
    };
  }
}
