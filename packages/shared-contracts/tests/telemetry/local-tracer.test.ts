import { describe, expect, it } from "vitest";
import { SecretRedactor } from "../../src/telemetry/redactor.js";
import { LocalTracer } from "../../src/telemetry/tracer.js";
import type { CompletedSpan } from "../../src/telemetry/types.js";
import { memorySink } from "./helpers.js";

describe("LocalTracer", () => {
  it("preserves parent and child links for transactions, attempts, model calls, tools, git, and verification", () => {
    const sink = memorySink();
    const tracer = new LocalTracer({ redactor: new SecretRedactor(), sink });
    const transaction = tracer.startTransaction("coord");
    transaction.run(() => {
      const attempt = tracer.startAttempt("try", { attemptId: "A1", taskId: "T1" });
      attempt.run(() => {
        const model = tracer.startModelCall({
          taskId: "T1",
          attemptId: "A1",
          cost: 5,
          outcome: "ok",
          model: "local",
        });
        model.run(() => {
          tracer.startToolCall("npm test").end("ok");
          tracer.startGitOperation("commit").end("ok");
        });
        model.end("ok");
        tracer.startVerification("gate").end("ok");
      });
      attempt.end("ok");
    });
    transaction.end("ok");

    const spans = parseSpans(sink.lines);
    expect(spans).toHaveLength(6);
    const byKind = new Map(spans.map((span) => [span.kind, span]));
    const tx = byKind.get("transaction");
    const attempt = byKind.get("attempt");
    const model = byKind.get("model_call");
    const tool = byKind.get("tool_call");
    const git = byKind.get("git");
    const verification = byKind.get("verification");
    expect(tx?.parentSpanId).toBeNull();
    expect(attempt?.parentSpanId).toBe(tx?.spanId);
    expect(model?.parentSpanId).toBe(attempt?.spanId);
    expect(tool?.parentSpanId).toBe(model?.spanId);
    expect(git?.parentSpanId).toBe(model?.spanId);
    expect(verification?.parentSpanId).toBe(attempt?.spanId);
    expect(model?.attributes.taskId).toBe("T1");
    expect(model?.attributes.attemptId).toBe("A1");
    expect(model?.attributes.cost).toBe(5);
    expect(model?.attributes.outcome).toBe("ok");
    expect(model?.traceId).toBe(tx?.traceId);
    for (const span of spans) {
      expect(span.durationMs).toBeGreaterThanOrEqual(0);
      expect(span.endMs).toBeGreaterThanOrEqual(span.startMs);
    }
    expect(tracer.traceSpans(tx?.traceId ?? "").map((span) => span.kind).sort()).toEqual(
      ["attempt", "git", "model_call", "tool_call", "transaction", "verification"].sort(),
    );
  });

  it("keeps durations positive when the wall clock jumps backward", () => {
    let monotonic = 100;
    let wall = 10_000;
    const sink = memorySink();
    const tracer = new LocalTracer({
      redactor: new SecretRedactor(),
      sink,
      monotonicNow: () => monotonic,
      wallNow: () => wall,
    });
    const span = tracer.startSpan("transaction", { kind: "transaction" });
    monotonic = 104;
    wall = 50;
    span.end("ok");
    expect(span.span.durationMs).toBe(4);
    expect(span.span.startMs).toBe(100);
    expect(span.span.endMs).toBe(104);
    expect(span.span.startEpochMs).toBe(10_000);
    expect(span.span.endEpochMs).toBe(50);
    expect(span.span.durationMs).toBeGreaterThan(0);

    monotonic = 200;
    const backward = tracer.startVerification("clock");
    monotonic = 190;
    backward.end("ok");
    expect(backward.span.durationMs).toBe(0);
  });

  it("stores a bounded redacted ring and drops secrets from span attributes", () => {
    const secret = "SpanAttributeSecret";
    const redactor = new SecretRedactor();
    redactor.register("SPAN", secret);
    const sink = memorySink();
    const tracer = new LocalTracer({ redactor, sink, ringCapacity: 2 });
    for (let index = 0; index < 3; index += 1) {
      const span = tracer.startToolCall(`tool-${index}`, { output: index === 2 ? secret : "ok" });
      if (index === 2) span.recordException(new Error(`boom ${secret}`));
      span.end(index === 2 ? "error" : "ok");
    }
    const recent = tracer.recentSpans();
    expect(recent).toHaveLength(2);
    expect(recent.map((span) => span.name)).toEqual(["tool-1", "tool-2"]);
    const dumped = `${JSON.stringify(recent)}\n${sink.lines.join("")}`;
    expect(dumped).not.toContain(secret);
    expect(dumped).toContain("[REDACTED:SPAN]");
    const failed = recent[1];
    expect(failed?.status).toBe("error");
    expect(JSON.stringify(failed?.events)).not.toContain(secret);
  });

  it("ends open spans on close and records them once", () => {
    const sink = memorySink();
    const tracer = new LocalTracer({ redactor: new SecretRedactor(), sink });
    const span = tracer.startTransaction("open");
    tracer.close();
    expect(span.span.status).toBe("error");
    expect(span.span.attributes.endReason).toBe("process_shutdown");
    expect(parseSpans(sink.lines)).toHaveLength(1);
    span.end("ok");
    expect(parseSpans(sink.lines)).toHaveLength(1);
  });

  it("records a transaction in under 0.1 ms after warmup", () => {
    const sink = memorySink();
    const tracer = new LocalTracer({ redactor: new SecretRedactor(), sink, ringCapacity: 8 });
    for (let index = 0; index < 200; index += 1) {
      tracer.startSpan("transaction", { kind: "transaction" }).end("ok");
    }
    const samples = 1000;
    const started = performance.now();
    for (let index = 0; index < samples; index += 1) {
      tracer.startSpan("transaction", { kind: "transaction" }).end("ok");
    }
    const average = (performance.now() - started) / samples;
    expect(average).toBeLessThan(0.1);
  });
});

function parseSpans(lines: readonly string[]): CompletedSpan[] {
  return lines.filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as CompletedSpan);
}
