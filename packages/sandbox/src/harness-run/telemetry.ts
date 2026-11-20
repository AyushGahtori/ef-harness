import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { LocalTracer, ProgressEvent, TelemetrySink, TraceAttributes } from "./types.js";

export interface TraceSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly name: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly status: "ok" | "error";
  readonly attributes: TraceAttributes;
}

export class InMemoryLocalTracer implements LocalTracer {
  readonly spans: TraceSpan[] = [];

  startSpan(name: string, parentSpanId?: string): {
    readonly traceId: string;
    readonly spanId: string;
    end(status: "ok" | "error", attributes: TraceAttributes): void;
  } {
    const traceId = randomBytes(16).toString("hex");
    const spanId = randomBytes(8).toString("hex");
    const startMs = performance.now();
    const parent = parentSpanId ?? null;
    return {
      traceId,
      spanId,
      end: (status, attributes) => {
        const endMs = performance.now();
        this.spans.push({
          traceId,
          spanId,
          parentSpanId: parent,
          name,
          startMs,
          endMs,
          status,
          attributes,
        });
      },
    };
  }
}

export class TelemetryDb implements TelemetrySink {
  private readonly db: DatabaseSync;
  private closed = false;

  constructor(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY,
      attempt TEXT,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      data TEXT NOT NULL
    ) STRICT;`);
  }

  writeProgress(attemptId: string, event: ProgressEvent): void {
    if (this.closed) return;
    this.db
      .prepare("INSERT INTO telemetry (attempt, ts, kind, data) VALUES (?, ?, ?, ?)")
      .run(attemptId, Date.now(), "progress", JSON.stringify(event));
  }

  count(attemptId: string): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM telemetry WHERE attempt = ?").get(attemptId);
    if (row === undefined || typeof row !== "object" || !("n" in row)) return 0;
    const value = row.n;
    return typeof value === "number" ? value : Number(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
