export class RouterError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class RouterInputError extends RouterError {
  constructor(message: string) {
    super("ROUTER_INPUT", message);
  }
}

export class DuplicateMessageConflictError extends RouterError {
  constructor(messageId: string) {
    super("DUPLICATE_MESSAGE", `message ${messageId} was already sequenced with different text`);
  }
}

export class RouterSchemaError extends RouterError {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super("ROUTER_SCHEMA", errors.join("; "));
    this.errors = errors;
  }
}

export class RouterPromptBudgetError extends RouterError {
  constructor(tokens: number) {
    super("PROMPT_BUDGET", `router@1 prompt is ${tokens} tokens; the budget is 1500`);
  }
}

export class FocusDraftMissingError extends RouterError {
  constructor(draftId: string) {
    super("FOCUS_DRAFT_MISSING", `no input-start snapshot exists for draft ${draftId}`);
  }
}

export class EmptyOutboxConsumersError extends RouterError {
  constructor() {
    super("EMPTY_OUTBOX_CONSUMERS", "outbox events require at least one consumer");
  }
}

export class TelemetryNotAllowedInOutboxError extends RouterError {
  constructor(type: string) {
    super("TELEMETRY_NOT_OUTBOX", `${type} belongs in telemetry.db, not the outbox`);
  }
}

export class OutboxTransactionRequiredError extends RouterError {
  constructor() {
    super("OUTBOX_TRANSACTION_REQUIRED", "appendEventInTx requires an open transaction");
  }
}
