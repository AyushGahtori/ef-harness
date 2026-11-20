import type { HistoryStep, WorkingMemory } from "../../src/context/index.js";
import {
  emptyWorkingMemory,
  type ModelProfile,
  type ShouldEntry,
  type TaskPacketV1,
} from "../../src/context/index.js";

export function profile(
  contextWindow: number,
  extra?: { readonly family?: ModelProfile["family"]; readonly maxOutputTokens?: number },
): ModelProfile {
  return {
    id: "test-model",
    family: extra?.family ?? "openai",
    contextWindow,
    maxOutputTokens: extra?.maxOutputTokens ?? 512,
    editFormat: "str_replace",
    supportsParallelToolCalls: false,
    supportsReasoningReplay: true,
    supportsStreamingToolArgs: true,
    toolCallReliabilityTier: 1,
    supportsPromptCaching: true,
    routeConstraints: [],
  };
}

export function packet(options?: {
  readonly mustText?: string;
  readonly should?: readonly ShouldEntry[];
  readonly goal?: string;
}): TaskPacketV1 {
  return {
    schema: "task-packet@1",
    task: "T07",
    attempt: 2,
    epoch: 5,
    brief_version: 3,
    base: { branch: "harness/f/F12", commit: "4c1e" },
    goal: options?.goal ?? "Show today's totals on the kitchen page.",
    write_scope: ["src/app/kitchen/**", "tests/kitchen/print.*"],
    must: [
      {
        id: "SI-212",
        v: 2,
        text: options?.mustText ?? "When the cutoff passes, show the locked totals.",
      },
      { id: "X-03", v: 1, text: "Times are shown in the office time zone." },
    ],
    contracts: [{ id: "kitchen-totals", v: 1, role: "consume", text: "totals endpoint" }],
    checks_visible: ["AC-31", "UI-12"],
    checks_hidden_count: 1,
    should: options?.should ?? ["Pages use PageHeader with an actions slot."],
    skills: [{ id: "accessible-ui", digest: "sha256:abc" }],
    tools: ["edit", "harness.run", "kb.*"],
    budget: { usd_micro: 400_000, allowance_ppm: { "chatgpt-personal": 600_000 }, local_slots: 1 },
    limits: { wall_min: 30, max_steps: 40 },
  };
}

export function memory(partial?: Partial<WorkingMemory>): WorkingMemory {
  return { ...emptyWorkingMemory(), ...partial };
}

export function historyStep(
  step: number,
  options?: {
    readonly assistantText?: string;
    readonly reasoning?: readonly string[];
    readonly tools?: readonly {
      readonly id?: string;
      readonly name: string;
      readonly path?: string;
      readonly content?: string;
      readonly resultSummary?: string;
      readonly artifactIds?: readonly string[];
      readonly symbolOutline?: string;
      readonly testFailures?: readonly string[];
      readonly input?: unknown;
    }[];
  },
): HistoryStep {
  const tools = options?.tools ?? [];
  return {
    step,
    assistantText: options?.assistantText ?? `assistant ${step}`,
    reasoning: (options?.reasoning ?? []).map((opaque) => ({ kind: "reasoning" as const, opaque })),
    toolCalls: tools.map((tool, index) => ({
      id: tool.id ?? `tool-${step}-${index}`,
      name: tool.name,
      input: tool.input ?? (tool.path === undefined ? {} : { path: tool.path }),
      resultSummary: tool.resultSummary ?? `${tool.name} step ${step}`,
      content: tool.content ?? `content ${step}`,
      artifactIds: tool.artifactIds ?? [],
      ...(tool.symbolOutline === undefined ? {} : { symbolOutline: tool.symbolOutline }),
      ...(tool.testFailures === undefined ? {} : { testFailures: tool.testFailures }),
    })),
  };
}

export function lines(count: number, prefix: string): string {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`).join("\n");
}
