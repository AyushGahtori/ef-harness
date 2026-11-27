import { buildTriagePrompt } from "./framing.js";
import { condenseHarTimeline, failingHttpRequests, HarAndLogScrubber } from "./har-log-scrubber.js";
import { IssueTriageV1Schema } from "./issue-triage-schema.js";
import { SourceMapStackMapper } from "./source-map-mapper.js";
import { cardFromIssueTriage, extractJsonObject, fallbackSymptomCard, parseSymptomCard } from "./symptom-card.js";
import { routeSymptomCard } from "./routing.js";
import type { FakeModelAdapter, ToolLessCompletionRequest } from "./fake-model.js";
import type { FailingHttpRequest, MappedStackFrame, RouteDecision, ScrubbedHar, SymptomCard } from "./types.js";

export interface ToolLessModel {
  complete(request: ToolLessCompletionRequest): { readonly text: string; readonly tools?: readonly string[] };
}

export interface TriageInput {
  readonly bugReport: string;
  readonly stack?: string;
  readonly har?: string | unknown;
  readonly pii?: boolean;
  readonly buildRoots?: readonly string[];
}

export interface TriageResult {
  readonly card: SymptomCard;
  readonly route: RouteDecision;
  readonly badge: string;
  readonly prompt: string;
  readonly tools: readonly [];
  readonly sideEffects: readonly [];
  readonly modelRejected: boolean;
  readonly harError: string | null;
  readonly scrubbedReport: string;
  readonly scrubbedHar: ScrubbedHar | null;
}

const EMPTY_TOOLS = [] as const;
const EMPTY_EFFECTS = [] as const;

/**
 * issue-triage@1 with zero shell, file, and network tools.
 * External text is framed as data and the model reply is schema-validated before it can become a card.
 */
export class ToolLessIssueTriager {
  private readonly scrubber: HarAndLogScrubber;

  constructor(private readonly model: ToolLessModel | FakeModelAdapter) {
    this.scrubber = new HarAndLogScrubber();
  }

  async triage(input: TriageInput): Promise<TriageResult> {
    const pii = input.pii === true;
    const reportResult = this.scrubber.scrubLog(input.bugReport, { pii });
    const scrubbedReport = reportResult.ok ? reportResult.value : "";
    const badge = reportResult.ok ? reportResult.badge : "Scrubbed 0 secrets before saving";
    let scrubbedHar: ScrubbedHar | null = null;
    let harError: string | null = null;
    if (input.har !== undefined) {
      const harResult = this.scrubber.scrubHar(input.har, { pii });
      if (harResult.ok) scrubbedHar = harResult.value;
      else harError = harResult.message;
    }
    const stack = input.stack ?? "";
    const frames =
      input.buildRoots && input.buildRoots.length > 0 && stack.length > 0
        ? await new SourceMapStackMapper(input.buildRoots).mapStack(stack)
        : [];
    const failing = scrubbedHar ? failingHttpRequests(scrubbedHar) : [];
    const urls = scrubbedHar ? scrubbedHar.log.entries.map((entry) => entry.request.url) : [];
    const timeline = scrubbedHar ? condenseHarTimeline(scrubbedHar) : "";
    const prompt = buildTriagePrompt({
      report: scrubbedReport,
      stack: frames.map(describeFrame).join("\n"),
      timeline,
    });
    const completion = this.model.complete({
      contractId: "issue-triage@1",
      prompt,
      tools: EMPTY_TOOLS,
    });
    const parsed = interpretModel(completion.text, { frames, failing, urls, report: scrubbedReport });
    const card = mergeHarnessFacts(parsed.card, { frames, failing, urls });
    return {
      card,
      route: routeSymptomCard(card),
      badge,
      prompt,
      tools: EMPTY_TOOLS,
      sideEffects: EMPTY_EFFECTS,
      modelRejected: parsed.modelRejected,
      harError,
      scrubbedReport,
      scrubbedHar,
    };
  }
}

function describeFrame(frame: MappedStackFrame): string {
  if (frame.resolved && frame.source && frame.originalLine !== null && frame.originalColumn !== null) {
    const name = frame.functionName ? `${frame.functionName} ` : "";
    return `${name}${frame.source}:${frame.originalLine}:${frame.originalColumn}`;
  }
  return frame.raw;
}

function interpretModel(
  text: string,
  context: {
    readonly frames: readonly MappedStackFrame[];
    readonly failing: readonly FailingHttpRequest[];
    readonly urls: readonly string[];
    readonly report: string;
  },
): { readonly card: SymptomCard; readonly modelRejected: boolean } {
  const json = extractJsonObject(text);
  const direct = parseSymptomCard(json);
  if (direct) return { card: direct, modelRejected: false };
  const issue = IssueTriageV1Schema.parse(json);
  if (issue.kind === "card") {
    return { card: cardFromIssueTriage(issue.value, context), modelRejected: false };
  }
  return {
    card: fallbackSymptomCard({
      report: context.report,
      frames: context.frames,
      failing: context.failing,
      urls: context.urls,
    }),
    modelRejected: true,
  };
}

function mergeHarnessFacts(
  card: SymptomCard,
  context: {
    readonly frames: readonly MappedStackFrame[];
    readonly failing: readonly FailingHttpRequest[];
    readonly urls: readonly string[];
  },
): SymptomCard {
  return {
    ...card,
    mappedStackFrames: card.mappedStackFrames.length > 0 ? card.mappedStackFrames : context.frames,
    failingHttpRequests: card.failingHttpRequests.length > 0 ? card.failingHttpRequests : context.failing,
    affectedUrlsOrRoutes: card.affectedUrlsOrRoutes.length > 0 ? card.affectedUrlsOrRoutes : context.urls,
  };
}
