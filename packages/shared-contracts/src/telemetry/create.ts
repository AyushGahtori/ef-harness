import path from "node:path";
import { StructuredLogger } from "./logger.js";
import { defaultLogDirectory } from "./paths.js";
import { getSharedSecretRedactor, type SecretRedactor } from "./redactor.js";
import { RotatingJsonlSink } from "./sink.js";
import { LocalTracer } from "./tracer.js";
import type { LogLevel } from "./types.js";

export interface HarnessTelemetryOptions {
  component: string;
  directory?: string;
  level?: LogLevel;
  redactor?: SecretRedactor;
  projectId?: string;
  taskId?: string;
  attemptId?: string;
}

export interface HarnessTelemetry {
  readonly redactor: SecretRedactor;
  readonly logger: StructuredLogger;
  readonly tracer: LocalTracer;
  readonly logSink: RotatingJsonlSink;
  readonly traceSink: RotatingJsonlSink;
  close(): void;
}

export function createHarnessTelemetry(options: HarnessTelemetryOptions): HarnessTelemetry {
  const redactor = options.redactor ?? getSharedSecretRedactor();
  const directory = options.directory ?? defaultLogDirectory();
  const logSink = new RotatingJsonlSink({
    directory,
    prefix: "efharness",
    redactor,
    bindShutdown: true,
  });
  const traceSink = new RotatingJsonlSink({
    directory: path.join(directory, "traces"),
    prefix: "efharness-trace",
    redactor,
    bindShutdown: true,
  });
  const tracer = new LocalTracer({ redactor, sink: traceSink });
  const loggerOptions: ConstructorParameters<typeof StructuredLogger>[0] = {
    component: options.component,
    sink: logSink,
    redactor,
    tracer,
  };
  if (options.level) loggerOptions.level = options.level;
  if (options.projectId !== undefined) loggerOptions.projectId = options.projectId;
  if (options.taskId !== undefined) loggerOptions.taskId = options.taskId;
  if (options.attemptId !== undefined) loggerOptions.attemptId = options.attemptId;
  const logger = new StructuredLogger(loggerOptions);
  return {
    redactor,
    logger,
    tracer,
    logSink,
    traceSink,
    close() {
      tracer.close();
      traceSink.close();
      logger.close();
    },
  };
}
