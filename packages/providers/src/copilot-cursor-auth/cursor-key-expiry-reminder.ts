import {
  CURSOR_REFRESH_NOW_LABEL,
  CURSOR_REMINDER_WINDOW_MS,
  CURSOR_RESIGN_IN_LABEL,
  CURSOR_URGENT_WINDOW_MS,
  cursorExpiryMessage,
} from "./constants.js";
import type { CursorBrowserAuthFlow, EstablishedCursorConnection } from "./cursor-browser-auth-flow.js";
import type {
  AccountCardNotice,
  AccountCardSink,
  Clock,
  CursorDispatchParker,
  ExpiryReminderCard,
  GlobalDbConnectionsPort,
  NoSilentPaidFallbackPort,
  ReminderCardSink,
  SchedulerNotice,
} from "./types.js";

export interface CursorKeyExpiryReminderDeps {
  readonly connections: GlobalDbConnectionsPort;
  readonly clock: Clock;
  readonly reminders: ReminderCardSink;
  readonly accounts: AccountCardSink;
  readonly parker: CursorDispatchParker;
  readonly fallbackGuard: NoSilentPaidFallbackPort;
  readonly auth: CursorBrowserAuthFlow;
}

export class CursorKeyExpiryReminderScheduler {
  constructor(private readonly deps: CursorKeyExpiryReminderDeps) {}

  onColdOpen(): readonly SchedulerNotice[] {
    return this.evaluateAll();
  }

  onDailyTick(): readonly SchedulerNotice[] {
    return this.evaluateAll();
  }

  acknowledge(connectionId: string): void {
    const now = this.deps.clock.now();
    this.deps.connections.update(connectionId, (current) => {
      if (current.metadata.kind !== "cursor") throw new Error("Not a Cursor connection");
      const remaining = current.metadata.expiresAt - now;
      const reminder = { ...current.metadata.reminder };
      if (remaining <= CURSOR_URGENT_WINDOW_MS) reminder.urgentAcknowledged = true;
      else reminder.sevenDayAcknowledged = true;
      return { ...current, metadata: { ...current.metadata, reminder } };
    });
  }

  async refreshNow(connectionId: string): Promise<EstablishedCursorConnection> {
    return this.deps.auth.refresh(connectionId);
  }

  onHttp401(connectionId: string): SchedulerNotice {
    const current = this.requireCursor(connectionId);
    if (current.metadata.status === "unauthorized" || current.metadata.status === "expired") {
      return { kind: "account", card: this.accountCard(connectionId, "unauthorized") };
    }
    return this.park(connectionId, "unauthorized");
  }

  private evaluateAll(): SchedulerNotice[] {
    const notices: SchedulerNotice[] = [];
    for (const record of this.deps.connections.list()) {
      if (record.metadata.kind !== "cursor") continue;
      const notice = this.evaluate(record.id);
      if (notice) notices.push(notice);
    }
    return notices;
  }

  private evaluate(connectionId: string): SchedulerNotice | null {
    const record = this.requireCursor(connectionId);
    const remaining = record.metadata.expiresAt - this.deps.clock.now();
    if (record.metadata.status === "expired" || record.metadata.status === "unauthorized") {
      return null;
    }
    if (remaining <= 0) return this.park(connectionId, "expired");
    if (remaining <= CURSOR_URGENT_WINDOW_MS) {
      if (record.metadata.reminder.urgentEmitted) return null;
      return this.emitReminder(connectionId, remaining, "urgent");
    }
    if (remaining <= CURSOR_REMINDER_WINDOW_MS) {
      const reminder = record.metadata.reminder;
      if (reminder.sevenDayEmitted || reminder.sevenDayAcknowledged) return null;
      return this.emitReminder(connectionId, remaining, "seven_day");
    }
    return null;
  }

  private emitReminder(
    connectionId: string,
    remaining: number,
    phase: "seven_day" | "urgent",
  ): SchedulerNotice {
    this.deps.connections.update(connectionId, (current) => {
      if (current.metadata.kind !== "cursor") throw new Error("Not a Cursor connection");
      const reminder = { ...current.metadata.reminder };
      if (phase === "urgent") reminder.urgentEmitted = true;
      else reminder.sevenDayEmitted = true;
      return { ...current, metadata: { ...current.metadata, reminder } };
    });
    const card: ExpiryReminderCard = {
      kind: "fyi_account_reminder",
      connectionId,
      blocking: false,
      tone: "calm",
      phase,
      message: cursorExpiryMessage(remaining),
      actionLabel: CURSOR_REFRESH_NOW_LABEL,
    };
    this.deps.reminders.emit(card);
    return { kind: "reminder", card };
  }

  private park(connectionId: string, reason: "expired" | "unauthorized"): SchedulerNotice {
    this.deps.connections.update(connectionId, (current) => {
      if (current.metadata.kind !== "cursor") throw new Error("Not a Cursor connection");
      const status = reason === "expired" ? "expired" : "unauthorized";
      return {
        ...current,
        enabled: 0,
        metadata: { ...current.metadata, status },
      };
    });
    this.deps.parker.park({ connectionId, reason });
    const card = this.accountCard(connectionId, reason);
    this.deps.accounts.emit(card);
    this.deps.fallbackGuard.refuseSilentPaidFallback({
      connectionId,
      from: "cursor_subscription",
      to: "paid_api_key",
    });
    return { kind: "account", card };
  }

  private accountCard(
    connectionId: string,
    reason: "expired" | "unauthorized",
  ): AccountCardNotice {
    return {
      kind: "AccountCard",
      connectionId,
      blocking: true,
      actionLabel: CURSOR_RESIGN_IN_LABEL,
      reason,
    };
  }

  private requireCursor(connectionId: string) {
    const record = this.deps.connections.get(connectionId);
    if (!record || record.metadata.kind !== "cursor") {
      throw new Error("Cursor connection was not found");
    }
    return record as typeof record & { metadata: Extract<typeof record.metadata, { kind: "cursor" }> };
  }
}
