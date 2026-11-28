import type { AdapterMode, ConformanceReport, ProbeResult, SandboxTierId, TrustLevel } from "./types.js";

export interface ConformanceScorecard {
  readonly surface: "settings_connections" | "diagnostics";
  readonly adapterId: string;
  readonly displayName: string;
  readonly cliVersion: string;
  readonly sandboxTier: SandboxTierId;
  readonly mode: AdapterMode;
  readonly trust: TrustLevel;
  readonly nativeResumeSupported: boolean;
  readonly notification: string | null;
  readonly probes: readonly ProbeResult[];
}

/** Shape consumed by Settings → Connections (Task 141) and Diagnostics (Task 133). */
export function exportScorecard(
  report: ConformanceReport,
  surface: ConformanceScorecard["surface"],
): ConformanceScorecard {
  return {
    surface,
    adapterId: report.adapterId,
    displayName: report.displayName,
    cliVersion: report.cliVersion,
    sandboxTier: report.sandboxTier,
    mode: report.mode,
    trust: report.trust,
    nativeResumeSupported: report.nativeResumeSupported,
    notification: report.notification,
    probes: report.probes.map((probe) => ({
      probeId: probe.probeId,
      name: probe.name,
      status: probe.status,
      durationMs: probe.durationMs,
      diagnostic: probe.diagnostic,
    })),
  };
}
