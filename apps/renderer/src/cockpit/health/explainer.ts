import { CockpitExplainerV1Schema, countSentences } from "@ef-harness/shared-contracts";
import { recommendedClick } from "./actions.js";
import { ensureSentence } from "./explainer-schema.js";
import type {
  BoundedExplainerFacts,
  CockpitExplanation,
  ExplanationBullets,
  HealthSignal,
  TimelineEvent,
  WorkerHealthTelemetry,
} from "./types.js";

export interface ExplainerModel {
  complete(facts: BoundedExplainerFacts): Promise<unknown>;
  readonly tokensPerCall?: number;
}

export class ExplainerProviderError extends Error {
  readonly status: number | null;
  readonly code: "offline" | "payment_required";

  constructor(code: "offline" | "payment_required", status: number | null = null) {
    super(code);
    this.name = "ExplainerProviderError";
    this.code = code;
    this.status = status;
  }
}

interface CacheEntry {
  readonly explanation: CockpitExplanation;
}

const MAX_TIMELINE_EVENTS = 5;

export function lastEventSeq(events: readonly TimelineEvent[]): number {
  let max = -1;
  for (const event of events) {
    if (event.seq > max) max = event.seq;
  }
  return max;
}

export function boundExplainerFacts(worker: WorkerHealthTelemetry): BoundedExplainerFacts {
  const ordered = [...worker.timeline].sort((left, right) => left.seq - right.seq);
  const timeline = ordered.slice(-MAX_TIMELINE_EVENTS);
  const holds: string[] = [];
  if (worker.hold?.active) holds.push(worker.hold.reason);
  return {
    contractId: "cockpit-explainer@1",
    taskId: worker.taskId,
    lastEventSeq: lastEventSeq(worker.timeline),
    timeline,
    failingTestOrErrorSnippet:
      worker.failingSnippet ?? worker.loop.errorSnippet ?? "",
    retryHintLevel: worker.hint.hintLevel,
    activeHolds: holds,
    providerPacingState: worker.pacingState,
    requirementSnippet: worker.requirementSnippet ?? "",
  };
}

export function deterministicExplanation(
  facts: BoundedExplainerFacts,
  signals: readonly HealthSignal[],
  rejected: CockpitExplanation["modelRejected"],
): CockpitExplanation {
  const last = facts.timeline.at(-1) ?? null;
  const snippet = facts.failingTestOrErrorSnippet;
  const why = snippet
    ? ensureSentence(`It stalled or failed on ${snippet} at hint level ${facts.retryHintLevel}`)
    : ensureSentence(`It stalled with no recorded error at hint level ${facts.retryHintLevel}`);
  const trying = last
    ? ensureSentence(`It was trying to ${last.summary}`)
    : "It was trying to make progress on the task.";
  const bullets: ExplanationBullets = {
    whatItWasTryingToDo: trying,
    whyItStalledOrFailed: why,
    recommendedNextClick: ensureSentence(
      `Recommended next click: ${recommendedClick(signals)}`,
    ),
  };
  const citedEventIds = last ? [last.id] : [];
  return {
    taskId: facts.taskId,
    lastEventSeq: facts.lastEventSeq,
    source: "deterministic_fallback",
    tokensUsed: 0,
    cacheHit: false,
    bullets,
    citedEventIds,
    citationsVerified: citedEventIds.every((id) => facts.timeline.some((event) => event.id === id)),
    modelRejected: rejected,
    backgroundCall: false,
    facts,
  };
}

export interface ExplainRequest {
  readonly click: true;
  readonly worker: WorkerHealthTelemetry;
  readonly signals: readonly HealthSignal[];
}

/**
 * `cockpit-explainer@1` runs only from `explain`, which requires an explicit click.
 * Repeating the same `(taskId, lastEventSeq)` returns the cached answer at 0 tokens.
 */
export class OnDemandCockpitExplainer {
  private readonly cache = new Map<string, CacheEntry>();
  readonly backgroundCalls = 0;
  observedCount = 0;

  constructor(private readonly model: ExplainerModel) {}

  /** Remember that the button is visible. This never calls the model. */
  observe(worker: WorkerHealthTelemetry): void {
    this.observedCount += 1;
    void worker.taskId;
  }

  async explain(request: ExplainRequest): Promise<CockpitExplanation> {
    if (request.click !== true) {
      throw new Error("cockpit-explainer@1 requires an explicit click");
    }
    const facts = boundExplainerFacts(request.worker);
    const key = `${facts.taskId}\u0000${facts.lastEventSeq}`;
    const cached = this.cache.get(key);
    if (cached) {
      return {
        ...cached.explanation,
        source: "cache",
        tokensUsed: 0,
        cacheHit: true,
        backgroundCall: false,
        facts,
      };
    }
    const explanation = await this.invoke(facts, request.signals);
    this.cache.set(key, { explanation });
    return explanation;
  }

  private async invoke(
    facts: BoundedExplainerFacts,
    signals: readonly HealthSignal[],
  ): Promise<CockpitExplanation> {
    const known = new Set(facts.timeline.map((event) => event.id));
    const nextClick = recommendedClick(signals);
    try {
      const payload = await this.model.complete(facts);
      const parsed = readExplainerOutput(payload, known);
      if (!parsed.ok) {
        return deterministicExplanation(facts, signals, parsed.reason);
      }
      const sentences = splitSentences(parsed.text);
      const trying = sentences[0] ?? parsed.text;
      const why = sentences[1] ?? trying;
      const citedEventIds = [facts.timeline.at(-1)?.id].filter((id): id is string => typeof id === "string");
      return {
        taskId: facts.taskId,
        lastEventSeq: facts.lastEventSeq,
        source: "model",
        tokensUsed: this.model.tokensPerCall ?? 1,
        cacheHit: false,
        bullets: {
          whatItWasTryingToDo: trying,
          whyItStalledOrFailed: why,
          recommendedNextClick: ensureSentence(`Recommended next click: ${nextClick}`),
        },
        citedEventIds,
        citationsVerified: citedEventIds.every((id) => known.has(id)),
        modelRejected: false,
        backgroundCall: false,
        facts,
      };
    } catch (error) {
      if (error instanceof ExplainerProviderError) {
        return deterministicExplanation(facts, signals, "provider");
      }
      throw error;
    }
  }
}

type ExplainerRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: CockpitExplanation["modelRejected"] & string };

function readExplainerOutput(payload: unknown, knownEventIds: ReadonlySet<string>): ExplainerRead {
  const parsed = CockpitExplainerV1Schema.safeParse(payload);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => issue.message).join(" ");
    const essay = /sentence|500|character|too big|too_big/i.test(message);
    return { ok: false, reason: essay ? "essay" : "malformed" };
  }
  if ("blocked" in parsed.data) {
    return { ok: false, reason: "blocked" };
  }
  const mentioned = parsed.data.text.match(/\bevt-[\w-]+\b/g) ?? [];
  if (mentioned.some((id) => !knownEventIds.has(id))) {
    return { ok: false, reason: "unknown_event_id" };
  }
  return { ok: true, text: parsed.data.text };
}

function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (countSentences(trimmed) <= 1) return [trimmed];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
