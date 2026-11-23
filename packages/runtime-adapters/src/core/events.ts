import type { PacketSecurityRedactor } from "./ports.js";
import { asRecord, asString } from "./records.js";
import type { NormalizedRuntimeEvent, RuntimeEventDraft } from "./runtime-event.js";
import { translateForeignEvent, type ForeignRawEvent } from "./translate.js";
import { isNormalizedEventType, type NormalizedEventType } from "./types.js";

const HISTORY_CAP = 5_000;

export const BOARD_CONSUMER = "board-cockpit";
export const INSPECTOR_CONSUMER = "worker-inspector";

export type WorkerActivity =
  | "thinking"
  | "editing"
  | "running"
  | "waiting"
  | "usage"
  | "error"
  | "exited"
  | "delta"
  | "permission";

export interface CanonicalWorkerEvent {
  readonly schema: "event@1";
  readonly id: string;
  readonly seq: number;
  readonly type: NormalizedEventType;
  readonly revision: 1;
  readonly subject: string;
  readonly consumers: readonly string[];
  readonly created: string;
  readonly payload: {
    readonly summary: string;
    readonly statusLine: string | null;
    readonly activity: WorkerActivity | null;
    readonly redacted: true;
    readonly body: NormalizedRuntimeEvent;
  };
}

/**
 * Local stand-in for Task 008 `WorkerEventSchema` / `event@1`.
 * Field names match the outbox envelope so Task 124 and Task 126 can read one shape.
 */
export class LocalWorkerEventSchema {
  readonly id = "event@1" as const;

  validate(event: unknown): CanonicalWorkerEvent {
    const record = asRecord(event);
    if (!record || record.schema !== "event@1") {
      throw new Error("worker event schema must be event@1");
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      throw new Error("worker event id is required");
    }
    if (typeof record.seq !== "number" || !Number.isInteger(record.seq) || record.seq < 0) {
      throw new Error("worker event seq must be a non-negative integer");
    }
    if (typeof record.type !== "string" || !isNormalizedEventType(record.type)) {
      throw new Error("worker event type is not a normalized runtime event");
    }
    if (record.revision !== 1) throw new Error("worker event revision must be 1");
    if (typeof record.subject !== "string" || record.subject.length === 0) {
      throw new Error("worker event subject is required");
    }
    if (!Array.isArray(record.consumers) || record.consumers.length === 0) {
      throw new Error("worker event consumers must be non-empty");
    }
    if (record.consumers.some((consumer) => typeof consumer !== "string" || consumer.length === 0)) {
      throw new Error("worker event consumers must be non-empty strings");
    }
    if (typeof record.created !== "string" || record.created.length === 0) {
      throw new Error("worker event created timestamp is required");
    }
    const payload = asRecord(record.payload);
    if (!payload || payload.redacted !== true || typeof payload.summary !== "string") {
      throw new Error("worker event payload must be redacted and carry a summary");
    }
    return event as CanonicalWorkerEvent;
  }
}

class SessionLog {
  readonly events: NormalizedRuntimeEvent[] = [];
  private waiters: Array<() => void> = [];
  closed = false;

  push(event: NormalizedRuntimeEvent): void {
    if (this.events.length >= HISTORY_CAP) return;
    this.events.push(event);
    this.wake();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }

  private wake(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter();
  }

  wait(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class NormalizedRuntimeEventBus {
  private readonly logs = new Map<string, SessionLog>();
  private readonly sequences = new Map<string, number>();
  private ignored = 0;

  constructor(
    private readonly redactor: PacketSecurityRedactor,
    private readonly clock: () => string = () => new Date().toISOString(),
  ) {}

  get ignoredCount(): number {
    return this.ignored;
  }

  ingest(sessionId: string, raw: ForeignRawEvent): readonly NormalizedRuntimeEvent[] {
    const translation = translateForeignEvent(raw);
    this.ignored += translation.ignored;
    return translation.drafts.map((draft) => this.publish(sessionId, draft));
  }

  publish(sessionId: string, draft: RuntimeEventDraft): NormalizedRuntimeEvent {
    const seq = (this.sequences.get(sessionId) ?? 0) + 1;
    this.sequences.set(sessionId, seq);
    const plain = {
      ...draft,
      sessionId,
      seq,
      at: this.clock(),
      redacted: true as const,
    };
    const event = this.redactor.redactValue(plain) as NormalizedRuntimeEvent;
    this.log(sessionId).push(event);
    return event;
  }

  history(sessionId: string): readonly NormalizedRuntimeEvent[] {
    return [...(this.logs.get(sessionId)?.events ?? [])];
  }

  subscribe(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    const log = this.log(sessionId);
    return {
      [Symbol.asyncIterator](): AsyncIterator<NormalizedRuntimeEvent> {
        let index = 0;
        return {
          async next(): Promise<IteratorResult<NormalizedRuntimeEvent>> {
            for (;;) {
              if (index < log.events.length) {
                const value = log.events[index];
                index += 1;
                if (value) return { value, done: false };
              }
              if (log.closed) return { value: undefined, done: true };
              await log.wait();
            }
          },
        };
      },
    };
  }

  close(sessionId: string): void {
    this.logs.get(sessionId)?.close();
  }

  toWorkerEvent(event: NormalizedRuntimeEvent): CanonicalWorkerEvent {
    const view = describe(event);
    return {
      schema: "event@1",
      id: `${event.sessionId}:${event.seq}`,
      seq: event.seq,
      type: event.type,
      revision: 1,
      subject: event.sessionId,
      consumers: consumersFor(event.type),
      created: event.at,
      payload: {
        summary: view.summary,
        statusLine: view.statusLine,
        activity: view.activity,
        redacted: true,
        body: event,
      },
    };
  }

  workerHistory(sessionId: string): readonly CanonicalWorkerEvent[] {
    return this.history(sessionId).map((event) => this.toWorkerEvent(event));
  }

  private log(sessionId: string): SessionLog {
    const existing = this.logs.get(sessionId);
    if (existing) return existing;
    const created = new SessionLog();
    this.logs.set(sessionId, created);
    return created;
  }
}

function consumersFor(type: NormalizedEventType): readonly string[] {
  const base = [BOARD_CONSUMER, INSPECTOR_CONSUMER];
  if (type === "usage_reported" || type === "rate_limited") return [...base, "pacing"];
  if (type === "session_error" || type === "session_exited") return [...base, "health"];
  return base;
}

function describe(event: NormalizedRuntimeEvent): {
  readonly summary: string;
  readonly statusLine: string | null;
  readonly activity: WorkerActivity | null;
} {
  switch (event.type) {
    case "turn_started":
      return { summary: "Turn started", statusLine: "Thinking", activity: "thinking" };
    case "assistant_delta":
      return {
        summary: clip(event.channel === "plan" ? event.text : event.text, 160),
        statusLine: null,
        activity: "delta",
      };
    case "tool_call_requested":
      return { summary: `Requested ${event.toolKind} ${event.title}`, statusLine: null, activity: "waiting" };
    case "tool_call_started":
      if (event.toolKind === "shell") {
        return { summary: `Running ${event.title}`, statusLine: `Running ${event.title}`, activity: "running" };
      }
      if (event.toolKind === "edit") {
        return { summary: `Editing ${event.title}`, statusLine: `Editing ${event.title}`, activity: "editing" };
      }
      return { summary: `Started ${event.toolKind} ${event.title}`, statusLine: null, activity: "running" };
    case "tool_call_finished":
      return {
        summary: `Finished ${event.title}`,
        statusLine: null,
        activity: event.toolKind === "shell" ? "running" : "editing",
      };
    case "file_edited": {
      const file = event.paths[0] ?? "files";
      return { summary: `Edited ${file}`, statusLine: `Editing ${file}`, activity: "editing" };
    }
    case "permission_requested":
      return { summary: "Permission requested", statusLine: "Waiting on permission", activity: "waiting" };
    case "permission_decided":
      return {
        summary: event.effect === "allow" ? "Permission allowed" : "Permission denied",
        statusLine: null,
        activity: "permission",
      };
    case "usage_reported":
      return { summary: "Usage reported", statusLine: null, activity: "usage" };
    case "rate_limited":
      return {
        summary:
          event.usedPercent === null ? "Rate limit reported" : `Rate limit ${event.usedPercent} percent`,
        statusLine: null,
        activity: "usage",
      };
    case "turn_completed":
      return { summary: `Turn completed (${event.stopReason})`, statusLine: null, activity: "thinking" };
    case "session_error":
      return { summary: event.message, statusLine: null, activity: "error" };
    case "session_exited":
      return {
        summary:
          event.disposition === "abnormal"
            ? `Session exited abnormally (${event.exitCode ?? "unknown"})`
            : `Session exited (${event.disposition})`,
        statusLine: null,
        activity: "exited",
      };
    default: {
      const unreachable: never = event;
      return { summary: `Runtime event ${String(unreachable)}`, statusLine: null, activity: null };
    }
  }
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

export function workerEventSummary(event: unknown): string | null {
  const record = asRecord(event);
  const payload = asRecord(record?.payload);
  return asString(payload?.summary);
}
