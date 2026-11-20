export const OPENING_RUBRIC_IDS = [
  "opening.1",
  "opening.2",
  "opening.3",
  "opening.4",
  "opening.5",
] as const;

export type OpeningRubricId = (typeof OPENING_RUBRIC_IDS)[number];

export type PresentationMode = "talk_it_through" | "one_question_at_a_time";

export const UNIFIED_TURN_PIPELINE = "unified-turn-rubric" as const;

export interface OpeningPrompt {
  readonly id: OpeningRubricId;
  readonly index: number;
  readonly text: string;
  readonly example: string;
}

/** Exact prompts from project-discovery.md. Examples from opening-prompts.md. */
export const OPENING_PROMPTS: readonly OpeningPrompt[] = [
  {
    id: "opening.1",
    index: 1,
    text: "What would you like to build?",
    example: "A lunch-ordering page that collects our office\u2019s Friday orders.",
  },
  {
    id: "opening.2",
    index: 2,
    text: "Who will use it first, and what is hard for them today?",
    example: "Our office manager counts lunches by hand from chat replies.",
  },
  {
    id: "opening.3",
    index: 3,
    text: "Walk through one successful use. Who acts, what do they do and what happens at the end?",
    example: "Staff submit lunch choices and the kitchen sees totals grouped by dish.",
  },
  {
    id: "opening.4",
    index: 4,
    text: "What should the first demo prove? What can wait?",
    example:
      "Submit two soup orders and one salad. The kitchen list should show Soup \u00d7 2 and Salad \u00d7 1.",
  },
  {
    id: "opening.5",
    index: 5,
    text: "Which product, platform or technology decisions are fixed, and where would you like a recommendation?",
    example: "Use our existing web repo. Choose a free local database for the demo.",
  },
];

export interface PresentedPrompt {
  readonly id: OpeningRubricId;
  readonly index: number;
  readonly text: string;
  readonly example: string;
  readonly visible: boolean;
  readonly exampleExpansion: "collapsed" | "expanded";
}

export interface OpeningPresentation {
  readonly mode: PresentationMode;
  readonly pipeline: typeof UNIFIED_TURN_PIPELINE;
  readonly examplesToggle: "individual" | "together" | "current";
  readonly prompts: readonly PresentedPrompt[];
}

export function isOpeningRubricId(value: string | null): value is OpeningRubricId {
  return value !== null && (OPENING_RUBRIC_IDS as readonly string[]).includes(value);
}

export function openingPrompt(id: OpeningRubricId): OpeningPrompt {
  const prompt = OPENING_PROMPTS.find((item) => item.id === id);
  if (!prompt) {
    throw new Error(`missing opening prompt ${id}`);
  }
  return prompt;
}

export function presentOpening(input: {
  mode: PresentationMode;
  currentPromptId?: OpeningRubricId;
  expandedPromptIds?: readonly OpeningRubricId[];
  expandAllExamples?: boolean;
}): OpeningPresentation {
  const current = input.currentPromptId ?? "opening.1";
  const expanded = new Set(input.expandedPromptIds ?? []);
  if (input.mode === "talk_it_through") {
    const together = input.expandAllExamples === true;
    return {
      mode: input.mode,
      pipeline: UNIFIED_TURN_PIPELINE,
      examplesToggle: together ? "together" : "individual",
      prompts: OPENING_PROMPTS.map((prompt) => ({
        id: prompt.id,
        index: prompt.index,
        text: prompt.text,
        example: prompt.example,
        visible: true,
        exampleExpansion: together || expanded.has(prompt.id) ? "expanded" : "collapsed",
      })),
    };
  }
  return {
    mode: input.mode,
    pipeline: UNIFIED_TURN_PIPELINE,
    examplesToggle: "current",
    prompts: OPENING_PROMPTS.map((prompt) => ({
      id: prompt.id,
      index: prompt.index,
      text: prompt.text,
      example: prompt.example,
      visible: prompt.id === current,
      exampleExpansion: prompt.id === current ? "expanded" : "collapsed",
    })),
  };
}
