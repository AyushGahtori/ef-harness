import type { DenialAuditEvent, LaunchLatencySample, SandboxAuditEntry, SandboxAuditLogger, SandboxGovernorSink } from "./types.js";

export function percentileNearestRank(samples: readonly number[], percentile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] ?? 0;
}

export class LaunchLatencyTracker {
  private readonly samples: number[] = [];

  record(latencyMs: number): { readonly p50Ms: number; readonly p95Ms: number } {
    this.samples.push(latencyMs);
    return {
      p50Ms: percentileNearestRank(this.samples, 50),
      p95Ms: percentileNearestRank(this.samples, 95),
    };
  }
}

export function emitDenial(
  logger: SandboxAuditLogger,
  governor: SandboxGovernorSink,
  event: DenialAuditEvent,
): void {
  logger.write({
    ts: new Date().toISOString(),
    level: "warn",
    component: "tier-a-mxc",
    msg: "sandbox denial",
    fields: {
      tier: event.tier,
      attemptId: event.attemptId,
      target: event.target,
      access: event.access,
      errno: event.errno,
      ruleId: event.ruleId,
      source: event.source,
    },
  });
  governor.reportDenial(event);
}

export function emitLatency(
  logger: SandboxAuditLogger,
  governor: SandboxGovernorSink,
  sample: LaunchLatencySample,
): void {
  const entry: SandboxAuditEntry = {
    ts: new Date().toISOString(),
    level: "info",
    component: "tier-a-mxc",
    msg: "sandbox launch latency",
    fields: {
      tier: sample.tier,
      attemptId: sample.attemptId,
      latencyMs: sample.latencyMs,
      p50Ms: sample.p50Ms,
      p95Ms: sample.p95Ms,
    },
  };
  logger.write(entry);
  governor.reportLaunchLatency(sample);
}
