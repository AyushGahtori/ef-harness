import { createHash } from "node:crypto";
import type { GlobalDbConformancePort, VerdictSignerPort } from "./ports.js";
import { cacheKeyId } from "./types.js";
import type { ConformanceCacheKey, ConformanceReport, ProbeResult } from "./types.js";

export function probeDigest(probes: readonly ProbeResult[]): string {
  return createHash("sha256")
    .update(probes.map((probe) => `${probe.probeId}:${probe.status}`).join("|"))
    .digest("hex");
}

export function verdictPayload(report: ConformanceReport): string {
  return JSON.stringify({
    adapterId: report.adapterId,
    cliVersion: report.cliVersion,
    osSandboxTier: report.sandboxTier,
    mode: report.mode,
    trust: report.trust,
    nativeResumeSupported: report.nativeResumeSupported,
    suiteVersion: report.suiteVersion,
    probeDigest: probeDigest(report.probes),
  });
}

/**
 * Passing verdicts are reused only when adapter, CLI version, sandbox tier, and
 * suite version all match. A signature mismatch is a miss, not a hit.
 */
export class ConformanceVersionCache {
  private readonly memory = new Map<string, ConformanceReport>();

  constructor(
    private readonly db: GlobalDbConformancePort,
    private readonly signer: VerdictSignerPort,
  ) {}

  lookup(key: ConformanceCacheKey): ConformanceReport | null {
    const cached = this.memory.get(cacheKeyId(key));
    if (cached && this.accepts(cached)) return cached;
    const stored = this.db.findActive(key);
    if (!stored || stored.trust !== "conformance_verified") return null;
    if (stored.signature !== stored.report.signature) return null;
    if (!this.accepts(stored.report)) return null;
    this.memory.set(cacheKeyId(key), stored.report);
    return stored.report;
  }

  store(key: ConformanceCacheKey, report: ConformanceReport): void {
    if (report.trust !== "conformance_verified") {
      this.memory.delete(cacheKeyId(key));
      return;
    }
    if (!this.accepts(report)) return;
    this.memory.set(cacheKeyId(key), report);
  }

  dropMemory(): void {
    this.memory.clear();
  }

  private accepts(report: ConformanceReport): boolean {
    if (report.trust !== "conformance_verified") return false;
    return this.signer.verify(verdictPayload(report), report.signature);
  }
}
