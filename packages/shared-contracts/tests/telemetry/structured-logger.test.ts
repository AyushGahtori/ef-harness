import { describe, expect, it } from "vitest";
import { StructuredLogger, UNSET_SPAN_ID, UNSET_TRACE_ID } from "../../src/telemetry/logger.js";
import { SecretRedactor } from "../../src/telemetry/redactor.js";
import { LocalTracer } from "../../src/telemetry/tracer.js";
import type { LogSink } from "../../src/telemetry/types.js";
import { memorySink } from "./helpers.js";

const fixed = new Date("2026-03-04T05:06:07.008Z");

describe("StructuredLogger", () => {
  it("writes mandatory utc fields and redacts before the sink sees the line", () => {
    const secret = "LoggerSecretValue";
    const redactor = new SecretRedactor();
    redactor.register("STRIPE_SECRET_KEY", secret);
    const sink = memorySink();
    const logger = new StructuredLogger({
      component: "harnessd",
      sink,
      redactor,
      now: () => fixed,
      projectId: "project-1",
      taskId: "T1",
      attemptId: "A1",
    });
    logger.info(`hello ${secret}`, { nested: { token: secret } });
    logger.flush();
    expect(sink.lines).toHaveLength(1);
    const line = sink.lines[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(line).not.toContain(secret);
    const record = JSON.parse(line) as Record<string, unknown>;
    expect(record.ts).toBe("2026-03-04T05:06:07.008Z");
    expect(record.epochMs).toBe(fixed.getTime());
    expect(record.level).toBe("info");
    expect(record.component).toBe("harnessd");
    expect(record.traceId).toBe(UNSET_TRACE_ID);
    expect(record.spanId).toBe(UNSET_SPAN_ID);
    expect(record.projectId).toBe("project-1");
    expect(record.taskId).toBe("T1");
    expect(record.attemptId).toBe("A1");
    expect(record.msg).toContain("[REDACTED:STRIPE_SECRET_KEY]");
    expect(JSON.stringify(record.fields)).toContain("[REDACTED:STRIPE_SECRET_KEY]");
  });

  it("skips disabled debug formatting before reading fields", () => {
    let reads = 0;
    const sink = memorySink();
    const logger = new StructuredLogger({
      component: "harnessd",
      sink,
      redactor: new SecretRedactor(),
      level: "info",
    });
    logger.debug("hidden-debug", {
      get leak() {
        reads += 1;
        return "nope";
      },
    });
    logger.info("visible-info");
    expect(reads).toBe(0);
    expect(sink.lines.join("")).not.toContain("hidden-debug");
    expect(sink.lines.join("")).toContain("visible-info");
  });

  it("flushes error and fatal lines immediately and keeps info buffered", () => {
    const secret = "ImmediateSecret9";
    const redactor = new SecretRedactor();
    redactor.register("NOW", secret);
    const sink = memorySink();
    let writes = 0;
    const wrapped: LogSink = {
      write(line, immediate) {
        writes += 1;
        expect(immediate).toBe(true);
        expect(line).not.toContain(secret);
        sink.write(line, immediate);
      },
      flush() {
        sink.flush();
      },
      close() {
        sink.close();
      },
    };
    const logger = new StructuredLogger({ component: "harnessd", sink: wrapped, redactor });
    logger.error("boom-now", { token: secret });
    expect(writes).toBe(1);
    expect(sink.lines.join("")).toContain("boom-now");
  });

  it("serializes cycles, bigint, buffers, and error stacks without throwing", () => {
    const secret = "StackSecretValue1";
    const redactor = new SecretRedactor();
    redactor.register("STACK", secret);
    const sink = memorySink();
    const logger = new StructuredLogger({ component: "harnessd", sink, redactor, now: () => fixed });
    const cycle: { name: string; self?: unknown } = { name: "left" };
    cycle.self = cycle;
    const error = new Error(`failed ${secret}`);
    error.stack = `Error: failed ${secret}\n    at run (file.js:1:1)`;
    const fields: { boom?: string } = {};
    Object.defineProperty(fields, "boom", {
      enumerable: true,
      get() {
        throw new Error(`explode ${secret}`);
      },
    });
    expect(() => logger.info("cycle", { cycle, big: 42n, buf: Buffer.from(secret), error })).not.toThrow();
    expect(() => logger.info("throws", fields)).not.toThrow();
    logger.flush();
    const text = sink.lines.join("");
    expect(text).not.toContain(secret);
    const parsed = JSON.parse(sink.lines[0] ?? "{}") as {
      fields: { big: string; buf: { type: string; byteLength: number }; cycle: { self: string } };
    };
    expect(parsed.fields.big).toBe("42");
    expect(parsed.fields.buf).toEqual({ type: "Buffer", byteLength: Buffer.byteLength(secret) });
    expect(parsed.fields.cycle.self).toBe("[Circular]");
    expect(text).toContain("[REDACTED:LOG_FAILURE]");
  });

  it("copies the active span ids onto the log record", () => {
    const redactor = new SecretRedactor();
    const traceSink = memorySink();
    const logSink = memorySink();
    const tracer = new LocalTracer({ redactor, sink: traceSink });
    const logger = new StructuredLogger({
      component: "harnessd",
      sink: logSink,
      redactor,
      tracer,
      now: () => fixed,
    });
    const span = tracer.startTransaction("coord");
    span.run(() => {
      logger.info("inside");
    });
    span.end("ok");
    const record = JSON.parse(logSink.lines[0] ?? "{}") as { traceId: string; spanId: string };
    expect(record.traceId).toBe(span.span.traceId);
    expect(record.spanId).toBe(span.span.spanId);
    expect(record.traceId).not.toBe(UNSET_TRACE_ID);
  });

  it("does not throw when the sink fails", () => {
    const sink: LogSink = {
      write() {
        throw new Error("disk");
      },
      flush() {},
      close() {},
    };
    const logger = new StructuredLogger({
      component: "harnessd",
      sink,
      redactor: new SecretRedactor(),
    });
    expect(() => logger.info("still-alive")).not.toThrow();
  });
});
