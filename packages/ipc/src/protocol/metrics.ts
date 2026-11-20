import type { ClientSubscriptionMetrics } from "./ports.js";

export class SubscriptionMetricsRegistry {
  private readonly rows = new Map<string, ClientSubscriptionMetrics>();

  recordReplay(connectionId: string, projectId: string, durationMs: number): void {
    const row = this.slot(connectionId, projectId);
    this.rows.set(keyOf(connectionId, projectId), {
      ...row,
      replayDurationMs: Math.max(0, durationMs),
    });
  }

  recordResync(connectionId: string, projectId: string): void {
    const row = this.slot(connectionId, projectId);
    this.rows.set(keyOf(connectionId, projectId), {
      ...row,
      resyncCount: row.resyncCount + 1,
    });
  }

  addDroppedTelemetry(connectionId: string, projectId: string, count: number): void {
    if (count <= 0) return;
    const row = this.slot(connectionId, projectId);
    this.rows.set(keyOf(connectionId, projectId), {
      ...row,
      droppedTelemetryCount: row.droppedTelemetryCount + count,
    });
  }

  setLag(connectionId: string, projectId: string, subscriptionLagEvents: number): void {
    const row = this.slot(connectionId, projectId);
    this.rows.set(keyOf(connectionId, projectId), {
      ...row,
      subscriptionLagEvents: Math.max(0, subscriptionLagEvents),
    });
  }

  forClient(connectionId: string, projectId: string): ClientSubscriptionMetrics | undefined {
    const row = this.rows.get(keyOf(connectionId, projectId));
    return row ? { ...row } : undefined;
  }

  snapshot(): readonly ClientSubscriptionMetrics[] {
    return [...this.rows.values()].map((row) => ({ ...row }));
  }

  private slot(connectionId: string, projectId: string): ClientSubscriptionMetrics {
    return (
      this.rows.get(keyOf(connectionId, projectId)) ?? {
        connectionId,
        projectId,
        replayDurationMs: 0,
        resyncCount: 0,
        droppedTelemetryCount: 0,
        subscriptionLagEvents: 0,
      }
    );
  }
}

function keyOf(connectionId: string, projectId: string): string {
  return `${connectionId}\u0000${projectId}`;
}
