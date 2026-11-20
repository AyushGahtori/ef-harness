import { assertHistory, orderedSteps, supersededToolKeys, toRenderSteps, verbatimStepSet } from "./history.js";
import type { ModelProfile, ShouldEntry, TaskPacketV1, TurnSummarizer } from "./ports.js";
import { validateTurnSummarizerV1 } from "./ports.js";
import {
  compactionTargetTokens,
  contentTokens,
  displayModes,
  estimateAssembly,
  minimalReserveTokens,
  renderContext,
  renderMustBand,
  renderZone1,
  resolveContextCaps,
  type Assembly,
} from "./render.js";
import type { TokenEstimator } from "./token-estimator.js";
import {
  type CompactionStage,
  type ContextCaps,
  type HistoryStep,
  type SummarizerOutcome,
  type WorkingMemory,
} from "./types.js";
import { canonicalWorkingMemoryJson } from "./working-memory.js";

export interface CompactionInput {
  readonly packet: TaskPacketV1;
  readonly profile: ModelProfile;
  readonly estimator: TokenEstimator;
  readonly memory: WorkingMemory;
  readonly workingMemoryCoversThroughStep: number | null;
  readonly history: readonly HistoryStep[];
  readonly step: number;
  readonly brief: string | null;
  readonly kernelRules: string;
  readonly roleInstruction: string;
  readonly toolSchemaJson: string | null;
  readonly tightened: boolean;
  readonly turnSummarizer?: TurnSummarizer;
}

export interface CompactionOk {
  readonly status: "ok";
  readonly assembly: Assembly;
  readonly estimatedTokens: number;
  readonly targetTokens: number;
  readonly exceedsTarget: boolean;
  readonly stagesApplied: readonly CompactionStage[];
  readonly summarizerOutcome: SummarizerOutcome;
  readonly mustTokens: number;
  readonly windowTokens: number;
}

export interface CompactionRefusal {
  readonly status: "task_too_large_for_model";
  readonly mustTokens: number;
  readonly windowTokens: number;
  readonly stagesApplied: readonly ["hard_refusal"];
}

export type CompactionResult = CompactionOk | CompactionRefusal;

export class CompactionPipeline {
  run(input: CompactionInput): CompactionResult {
    assertHistory(input.history);
    const history = orderedSteps(input.history);
    const caps = resolveContextCaps(input.profile);
    const targetTokens = compactionTargetTokens(input.profile.contextWindow, input.tightened);
    const mustText = renderMustBand(input.packet);
    const mustTokens = contentTokens(mustText, "mixed", input.estimator);
    const windowTokens = input.profile.contextWindow;
    const pinnedTokens =
      contentTokens(renderZone1(input.kernelRules, input.roleInstruction), "prose", input.estimator) +
      mustTokens +
      contentTokens(renderTail(input), "prose", input.estimator);
    if (mustTokens > windowTokens || pinnedTokens + minimalReserveTokens(input.profile) > windowTokens) {
      return { status: "task_too_large_for_model", mustTokens, windowTokens, stagesApplied: ["hard_refusal"] };
    }

    let shouldItems = [...input.packet.should];
    let superseded = new Set<string>();
    let progressNote: string | null = null;
    let omitOld = false;
    const stages: CompactionStage[] = [];
    let summarizerOutcome: SummarizerOutcome = "not_needed";

    const assemble = (): Assembly =>
      buildAssembly(input, caps, shouldItems, history, superseded, progressNote, omitOld);

    if (estimateAssembly(assemble(), input.estimator) <= targetTokens) {
      const shown = toRenderSteps(history, superseded, displayModes(history, caps));
      return okResult(
        { ...assemble(), steps: shown },
        input,
        targetTokens,
        stages,
        summarizerOutcome,
        mustTokens,
        windowTokens,
      );
    }

    stages.push("trim_should_and_superseded_reads");
    superseded = new Set(supersededToolKeys(history));
    while (estimateAssembly(assemble(), input.estimator) > targetTokens && shouldItems.length > 0) {
      shouldItems = shouldItems.slice(0, -1);
    }

    if (estimateAssembly(assemble(), input.estimator) > targetTokens) {
      stages.push("collapse_old_tool_results");
      const verbatim = verbatimStepSet(history, caps.verbatimSteps);
      const collapsed = toRenderSteps(history, superseded, (step) =>
        verbatim.has(step) ? "verbatim" : "collapsed",
      );
      const afterCollapse = estimateAssembly({ ...assemble(), steps: collapsed }, input.estimator);
      if (afterCollapse > targetTokens) {
        stages.push("summarize_old_turns");
        const oldSteps = history.filter((step) => !verbatim.has(step.step));
        const summarized = summarizeOldTurns(input, oldSteps);
        progressNote = summarized.progressNote;
        omitOld = summarized.omitOld;
        summarizerOutcome = summarized.outcome;
        const finalSteps = toRenderSteps(history, superseded, (step) => {
          if (!verbatim.has(step)) return omitOld ? "omitted" : "collapsed";
          return "verbatim";
        });
        return okResult(
          { ...assemble(), steps: finalSteps },
          input,
          targetTokens,
          stages,
          summarizerOutcome,
          mustTokens,
          windowTokens,
        );
      }
      return okResult(
        { ...assemble(), steps: collapsed },
        input,
        targetTokens,
        stages,
        summarizerOutcome,
        mustTokens,
        windowTokens,
      );
    }

    return okResult(
      { ...assemble(), steps: toRenderSteps(history, superseded, displayModes(history, caps)) },
      input,
      targetTokens,
      stages,
      summarizerOutcome,
      mustTokens,
      windowTokens,
    );
  }
}

function okResult(
  assembly: Assembly,
  input: CompactionInput,
  targetTokens: number,
  stagesApplied: readonly CompactionStage[],
  summarizerOutcome: SummarizerOutcome,
  mustTokens: number,
  windowTokens: number,
): CompactionOk {
  const estimatedTokens = estimateAssembly(assembly, input.estimator);
  return {
    status: "ok",
    assembly,
    estimatedTokens,
    targetTokens,
    exceedsTarget: estimatedTokens > targetTokens,
    stagesApplied,
    summarizerOutcome,
    mustTokens,
    windowTokens,
  };
}

function buildAssembly(
  input: CompactionInput,
  caps: ContextCaps,
  shouldItems: readonly ShouldEntry[],
  history: readonly HistoryStep[],
  superseded: ReadonlySet<string>,
  progressNote: string | null,
  omitOld: boolean,
): Assembly {
  const verbatim = verbatimStepSet(history, caps.verbatimSteps);
  const steps = toRenderSteps(history, superseded, (step) => {
    if (verbatim.has(step)) return "verbatim";
    return omitOld ? "omitted" : "verbatim";
  });
  return {
    kernelRules: input.kernelRules,
    roleInstruction: input.roleInstruction,
    packet: input.packet,
    shouldItems,
    memory: input.memory,
    brief: input.brief,
    progressNote,
    steps,
    currentStep: input.step,
    caps,
    toolSchemaJson: input.toolSchemaJson,
  };
}

function summarizeOldTurns(
  input: CompactionInput,
  oldSteps: readonly HistoryStep[],
): { progressNote: string | null; omitOld: boolean; outcome: SummarizerOutcome } {
  if (oldSteps.length === 0) {
    return { progressNote: null, omitOld: false, outcome: "fallback_one_line" };
  }
  const maxOld = oldSteps.reduce((max, step) => Math.max(max, step.step), 0);
  if (input.workingMemoryCoversThroughStep !== null && input.workingMemoryCoversThroughStep >= maxOld) {
    return { progressNote: null, omitOld: true, outcome: "working_memory" };
  }
  const budget = progressNoteBudget(input.profile.contextWindow);
  if (input.turnSummarizer === undefined) {
    return { progressNote: null, omitOld: false, outcome: "fallback_one_line" };
  }
  try {
    const raw = input.turnSummarizer({
      contractId: "turn-summarizer@1",
      tokenBudget: budget,
      mustIds: input.packet.must.map((item) => item.id),
      workingMemoryJson: canonicalWorkingMemoryJson(input.memory),
      oldTurns: oldSteps.map((step) => ({
        step: step.step,
        assistantText: step.assistantText,
        tools: step.toolCalls.map((call) => ({
          name: call.name,
          resultSummary: call.resultSummary,
          artifactIds: [...call.artifactIds],
        })),
      })),
    });
    const validated = validateTurnSummarizerV1(raw, budget, (text) =>
      input.estimator.estimateText(text, "prose"),
    );
    if (!validated.ok) return { progressNote: null, omitOld: false, outcome: "fallback_one_line" };
    return { progressNote: validated.progressNote, omitOld: true, outcome: "progress_note" };
  } catch {
    return { progressNote: null, omitOld: false, outcome: "fallback_one_line" };
  }
}

function progressNoteBudget(contextWindow: number): number {
  return contextWindow <= 32_768 ? 200 : 400;
}

function renderTail(input: CompactionInput): string {
  return renderContext({
    kernelRules: input.kernelRules,
    roleInstruction: input.roleInstruction,
    packet: input.packet,
    shouldItems: [],
    memory: input.memory,
    brief: null,
    progressNote: null,
    steps: [],
    currentStep: input.step,
    caps: resolveContextCaps(input.profile),
    toolSchemaJson: null,
  }).zones[5].text;
}
