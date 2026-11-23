import type { NormalizedRuntimeEvent, NormalizedUsage } from "./types.js";
import { emptyUsage, isRecord } from "./types.js";

type Listener = (event: NormalizedRuntimeEvent) => void;

/** Local port of Task 142 `NormalizedRuntimeEventBus`. */
export class NormalizedRuntimeEventBus {
  private readonly history: NormalizedRuntimeEvent[] = [];
  private readonly listeners = new Set<Listener>();

  publish(event: NormalizedRuntimeEvent): void {
    this.history.push(event);
    for (const listener of [...this.listeners]) listener(event);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(sessionId?: string): readonly NormalizedRuntimeEvent[] {
    if (!sessionId) return [...this.history];
    return this.history.filter((event) => event.sessionId === sessionId);
  }

  stream(sessionId: string): AsyncIterable<NormalizedRuntimeEvent> {
    const historical = this.history.filter((event) => event.sessionId === sessionId);
    const queue: NormalizedRuntimeEvent[] = [];
    let wake: (() => void) | null = null;
    let closed = historical.some((event) => event.type === "session_exited");
    const unsubscribe = this.subscribe((event) => {
      if (event.sessionId !== sessionId) return;
      queue.push(event);
      if (event.type === "session_exited") closed = true;
      wake?.();
      wake = null;
    });
    const iterator: AsyncIterator<NormalizedRuntimeEvent> = {
      async next() {
        for (;;) {
          const fromHistory = historical.shift();
          if (fromHistory) return { done: false, value: fromHistory };
          const live = queue.shift();
          if (live) return { done: false, value: live };
          if (closed) {
            unsubscribe();
            return { done: true, value: undefined };
          }
          await new Promise<void>((resolve) => {
            if (queue.length > 0 || closed || historical.length > 0) {
              resolve();
              return;
            }
            wake = resolve;
          });
        }
      },
      async return() {
        unsubscribe();
        return { done: true, value: undefined };
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  }
}

export function eventNow(at = new Date()): string {
  return at.toISOString();
}

export function makeEvent(
  type: NormalizedRuntimeEvent["type"],
  sessionId: string,
  payload: Readonly<Record<string, unknown>>,
): NormalizedRuntimeEvent {
  return { type, sessionId, at: eventNow(), payload };
}

export function usageFromUpdate(update: Record<string, unknown>): NormalizedUsage {
  const cost = isRecord(update.cost) ? update.cost : null;
  const amount = typeof cost?.amount === "number" ? cost.amount : undefined;
  const usage: NormalizedUsage = {
    inputTokens: numberField(update, "inputTokens", "input_tokens"),
    cachedInputTokens: numberField(update, "cachedInputTokens", "cached_input_tokens"),
    outputTokens: numberField(update, "outputTokens", "output_tokens"),
    reasoningTokens: numberField(update, "reasoningTokens", "reasoning_tokens", "thoughtTokens"),
  };
  const micro = numberField(update, "costMicroUsd", "cost_micro_usd");
  if (micro > 0) return { ...usage, costMicroUsd: micro };
  if (amount !== undefined && amount > 0) return { ...usage, costMicroUsd: Math.round(amount * 1_000_000) };
  return usage.inputTokens === 0 && usage.outputTokens === 0 ? { ...emptyUsage(), ...usage } : usage;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

export function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!isRecord(content)) return "";
  return typeof content.text === "string" ? content.text : "";
}
