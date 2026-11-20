import { InvalidOutboxEventError } from "./errors.js";

/**
 * Mandatory consumers for domain events. Every routed type includes `exporter`
 * and `ui_projection` so a caller cannot register only `scheduler` and drop
 * the export or the board projection.
 */
export const DEFAULT_EVENT_CONSUMERS = {
  TaskAccepted: ["scheduler", "exporter", "ui_projection"],
  TaskHoldPlaced: ["scheduler", "exporter", "ui_projection"],
  FeatureCompleted: ["scheduler", "exporter", "broker", "ui_projection"],
  RevisionPublished: ["exporter", "broker", "ui_projection"],
  BudgetThresholdCrossed: ["scheduler", "broker", "exporter", "ui_projection"],
  InboxItemCreated: ["broker", "exporter", "ui_projection"],
  ShipRunUpdated: ["exporter", "broker", "ui_projection"],
  ContractChanged: ["scheduler", "exporter", "ui_projection"],
  DependencyReady: ["scheduler", "exporter", "ui_projection"],
} as const;

export type RoutedOutboxEventType = keyof typeof DEFAULT_EVENT_CONSUMERS;

export const ROUTED_OUTBOX_EVENT_TYPES = Object.keys(
  DEFAULT_EVENT_CONSUMERS,
) as readonly RoutedOutboxEventType[];

const TELEMETRY_EXACT = new Set(["worker.heartbeat", "token.delta"]);

export function isTelemetryEventType(type: string): boolean {
  return type.startsWith("telemetry.") || TELEMETRY_EXACT.has(type);
}

export function mandatoryConsumersFor(type: string): readonly string[] {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_EVENT_CONSUMERS, type)) return [];
  return DEFAULT_EVENT_CONSUMERS[type as RoutedOutboxEventType];
}

/**
 * Keeps the caller's consumer order, then appends any mandatory consumer the
 * caller omitted for a routed event type. Does not invent consumers for an
 * empty list — `appendEventInTx` rejects that before calling this.
 */
export function resolveEventConsumers(type: string, consumers: readonly string[]): string[] {
  const resolved: string[] = [];
  const seen = new Set<string>();
  const add = (consumer: string): void => {
    if (typeof consumer !== "string") {
      throw new InvalidOutboxEventError("outbox consumer names must be strings");
    }
    const name = consumer.trim();
    if (name.length === 0) {
      throw new InvalidOutboxEventError("outbox consumer names must be non-empty");
    }
    if (seen.has(name)) return;
    seen.add(name);
    resolved.push(name);
  };
  for (const consumer of consumers) add(consumer);
  for (const consumer of mandatoryConsumersFor(type)) add(consumer);
  return resolved;
}
