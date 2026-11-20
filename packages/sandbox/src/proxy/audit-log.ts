import type { NetworkAuditEvent, ProxyDiagnosticsSnapshot } from "./types.js";

const MAX_EVENTS = 1_000;

export class ProxyAuditLog {
  private readonly events: NetworkAuditEvent[] = [];
  private denied = 0;
  private readonly byAttempt = new Map<string, number>();
  private readonly byReason = new Map<string, number>();

  record(event: NetworkAuditEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (event.decision !== "deny") return;
    this.denied += 1;
    const attemptKey = event.attemptId || "unknown";
    this.byAttempt.set(attemptKey, (this.byAttempt.get(attemptKey) ?? 0) + 1);
    this.byReason.set(event.reason, (this.byReason.get(event.reason) ?? 0) + 1);
  }

  get deniedCount(): number {
    return this.denied;
  }

  recent(): readonly NetworkAuditEvent[] {
    return [...this.events];
  }

  diagnosticsHealth(): ProxyDiagnosticsSnapshot {
    return {
      deniedCount: this.denied,
      deniedByAttempt: Object.fromEntries(this.byAttempt),
      deniedByReason: Object.fromEntries(this.byReason),
    };
  }
}
