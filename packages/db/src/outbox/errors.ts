export class EmptyOutboxConsumersError extends Error {
  readonly code = "empty_outbox_consumers" as const;

  constructor() {
    super("appendEventInTx requires at least one consumer");
    this.name = "EmptyOutboxConsumersError";
  }
}

export class TelemetryNotAllowedInOutboxError extends Error {
  readonly code = "telemetry_not_allowed_in_outbox" as const;

  constructor(readonly eventType: string) {
    super(
      `telemetry event kind ${eventType} cannot be appended to the outbox; write it to telemetry.db`,
    );
    this.name = "TelemetryNotAllowedInOutboxError";
  }
}

export class OutboxTransactionRequiredError extends Error {
  readonly code = "outbox_transaction_required" as const;

  constructor() {
    super("appendEventInTx must run inside the caller's active BEGIN IMMEDIATE transaction");
    this.name = "OutboxTransactionRequiredError";
  }
}

export class InvalidOutboxEventError extends Error {
  readonly code = "invalid_outbox_event" as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidOutboxEventError";
  }
}

export class OutboxStartupReplayPendingError extends Error {
  readonly code = "outbox_startup_replay_pending" as const;

  constructor() {
    super("pending outbox deliveries must be replayed before new worker turns are dispatched");
    this.name = "OutboxStartupReplayPendingError";
  }
}

export class PermanentOutboxDeliveryError extends Error {
  readonly code = "permanent_outbox_delivery" as const;
  readonly permanent = true as const;

  constructor(message: string) {
    super(message);
    this.name = "PermanentOutboxDeliveryError";
  }
}

export class TransientOutboxDeliveryError extends Error {
  readonly code = "transient_outbox_delivery" as const;
  readonly transient = true as const;

  constructor(message: string) {
    super(message);
    this.name = "TransientOutboxDeliveryError";
  }
}

export function isRetryableDeliveryError(error: unknown): boolean {
  if (error instanceof PermanentOutboxDeliveryError) return false;
  if (typeof error === "object" && error !== null && "permanent" in error) {
    if ((error as { readonly permanent?: unknown }).permanent === true) return false;
  }
  return true;
}
