import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardHealthSignalEngine,
  FakeModelAdapter,
  OnDemandCockpitExplainer,
} from "../../src/cockpit/health/index.js";
import type { HealthSignal, TimelineEvent, WorkerHealthTelemetry } from "../../src/cockpit/health/index.js";
import { board, failingTests, worker } from "./support.js";

const TYPE_ERROR = "TypeError: Cannot read properties of undefined";

function events(count: number): TimelineEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `evt-${index + 1}`,
    seq: index + 1,
    atMs: index * 1_000,
    summary: `step ${index + 1}`,
  }));
}

function loopingWorker(timeline: TimelineEvent[]): WorkerHealthTelemetry {
  return worker({
    steps: failingTests(3, TYPE_ERROR),
    failingSnippet: TYPE_ERROR,
    requirementSnippet: "MUST print the page",
    hint: { hintLevel: 2, escalatedTo: "Senior" },
    hold: { active: true, reason: "clarifying cutoff" },
    pacingState: "burn_paced",
    timeline,
    progress: { tokenChunks: 4, lastTokenChunkAtMs: 50_000 },
  });
}

describe("on-demand cockpit explainer", () => {
  const engines: BoardHealthSignalEngine[] = [];

  afterEach(() => {
    for (const engine of engines) engine.dispose();
    engines.length = 0;
    vi.useRealTimers();
  });

  it("stays at zero model calls until the developer clicks, then caches that answer", async () => {
    vi.useFakeTimers();
    const model = new FakeModelAdapter();
    const explainer = new OnDemandCockpitExplainer(model);
    const subject = loopingWorker(events(8));
    const engine = new BoardHealthSignalEngine();
    engines.push(engine);
    const viewed = engine.ingest(board(0, [subject]));
    for (let count = 0; count < 20; count += 1) explainer.observe(subject);
    vi.advanceTimersByTime(300_000);
    expect(model.calls).toBe(0);
    expect(model.tokensCharged).toBe(0);
    expect(explainer.backgroundCalls).toBe(0);
    expect(explainer.observedCount).toBe(20);
    expect(engine.view().modelCalls).toBe(0);

    const signals = viewed.workers[0]?.signals ?? [];
    const first = await explainer.explain({ click: true, worker: subject, signals });
    vi.advanceTimersByTime(4_000);
    const second = await explainer.explain({ click: true, worker: subject, signals });
    vi.advanceTimersByTime(4_000);
    const third = await explainer.explain({ click: true, worker: subject, signals });

    expect(model.calls).toBe(1);
    expect(model.tokensCharged).toBe(17);
    expect(first.tokensUsed).toBe(17);
    expect(first.cacheHit).toBe(false);
    expect(first.source).toBe("model");
    expect(second.tokensUsed).toBe(0);
    expect(third.tokensUsed).toBe(0);
    expect(second.cacheHit).toBe(true);
    expect(third.cacheHit).toBe(true);
    expect(second.bullets).toEqual(first.bullets);
    expect(third.bullets).toEqual(first.bullets);
    expect(first.citationsVerified).toBe(true);
    expect(first.citedEventIds).toEqual(["evt-8"]);
    expect(first.backgroundCall).toBe(false);

    const prompt = model.prompts[0];
    expect(prompt?.timeline.map((event) => event.id)).toEqual(["evt-4", "evt-5", "evt-6", "evt-7", "evt-8"]);
    expect(prompt?.failingTestOrErrorSnippet).toBe(TYPE_ERROR);
    expect(prompt?.retryHintLevel).toBe(2);
    expect(prompt?.activeHolds).toEqual(["clarifying cutoff"]);
    expect(prompt?.providerPacingState).toBe("burn_paced");
    expect(prompt?.requirementSnippet).toBe("MUST print the page");
    expect(prompt?.contractId).toBe("cockpit-explainer@1");

    const moved = worker({
      ...subject,
      timeline: [...subject.timeline, { id: "evt-9", seq: 9, atMs: 9_000, summary: "step 9" }],
    });
    const fourth = await explainer.explain({ click: true, worker: moved, signals });
    expect(model.calls).toBe(2);
    expect(fourth.cacheHit).toBe(false);
    expect(fourth.lastEventSeq).toBe(9);
  });

  it("accepts a two-sentence contract and rejects an essay or a fake citation", async () => {
    const model = new FakeModelAdapter();
    model.mode = "two_sentence";
    const explainer = new OnDemandCockpitExplainer(model);
    const subject = loopingWorker(events(2));
    const signals: HealthSignal[] = [
      {
        kind: "loop_detected",
        variant: "loop",
        alarm: true,
        tone: "red",
        label: "Repeating error 3×",
        clusterLabel: null,
        taskId: subject.taskId,
        connectionId: subject.connectionId,
        attemptId: subject.attemptId,
        detail: TYPE_ERROR,
        actions: [
          {
            id: "escalate_tier",
            label: "Escalate tier",
            signalKind: "loop_detected",
            destructive: false,
            opensModal: false,
          },
        ],
        flashing: false,
        modal: false,
        inline: true,
        stealsFocus: false,
      },
    ];
    const mapped = await explainer.explain({ click: true, worker: subject, signals });
    expect(mapped.source).toBe("model");
    expect(mapped.bullets.whatItWasTryingToDo).toContain("step 2");
    expect(mapped.bullets.whyItStalledOrFailed).toContain("blocker");
    expect(mapped.bullets.recommendedNextClick).toBe("Recommended next click: Escalate tier.");
    expect(mapped.citedEventIds).toEqual(["evt-2"]);

    model.mode = "essay";
    const essayWorker = worker({ ...subject, taskId: "T-essay", timeline: events(1) });
    const essay = await explainer.explain({ click: true, worker: essayWorker, signals });
    expect(essay.source).toBe("deterministic_fallback");
    expect(essay.modelRejected).toBe("essay");
    expect(JSON.stringify(essay.bullets)).not.toContain("Speculation paragraph");

    model.mode = "bad_citation";
    const cited = worker({ ...subject, taskId: "T-cite", timeline: events(1) });
    const rejected = await explainer.explain({ click: true, worker: cited, signals });
    expect(rejected.source).toBe("deterministic_fallback");
    expect(rejected.modelRejected).toBe("unknown_event_id");
    expect(rejected.citationsVerified).toBe(true);
    expect(rejected.citedEventIds).toEqual(["evt-1"]);
    expect(JSON.stringify(rejected.bullets)).not.toContain("evt-hallucinated");
    expect(JSON.stringify(rejected.bullets)).not.toContain("Guess");
  });

  it("falls back locally on HTTP 402 without throwing", async () => {
    const model = new FakeModelAdapter();
    model.mode = "payment_required";
    const explainer = new OnDemandCockpitExplainer(model);
    const subject = loopingWorker(events(3));
    const engine = new BoardHealthSignalEngine({ liveClock: false });
    engines.push(engine);
    const signals = engine.ingest(board(0, [subject])).workers[0]?.signals ?? [];

    await expect(explainer.explain({ click: true, worker: subject, signals })).resolves.toMatchObject({
      source: "deterministic_fallback",
      tokensUsed: 0,
      modelRejected: "provider",
      backgroundCall: false,
    });
    const fallback = await explainer.explain({ click: true, worker: subject, signals });
    expect(model.calls).toBe(1);
    expect(fallback.cacheHit).toBe(true);
    expect(fallback.tokensUsed).toBe(0);
    expect(fallback.bullets.whyItStalledOrFailed).toContain(TYPE_ERROR);
    expect(fallback.bullets.whyItStalledOrFailed).toContain("hint level 2");
    expect(fallback.bullets.recommendedNextClick).toContain("Escalate tier");
    expect(fallback.bullets.whatItWasTryingToDo).toContain("step 3");
  });

  it("falls back when every provider is offline", async () => {
    const model = new FakeModelAdapter();
    model.mode = "offline";
    const explainer = new OnDemandCockpitExplainer(model);
    const subject = loopingWorker(events(1));
    const result = await explainer.explain({
      click: true,
      worker: subject,
      signals: [],
    });
    expect(result.source).toBe("deterministic_fallback");
    expect(result.bullets.recommendedNextClick).toContain("Inspect");
    expect(result.bullets.whyItStalledOrFailed).toContain(TYPE_ERROR);
  });
});
