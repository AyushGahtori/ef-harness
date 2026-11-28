/** Suite version is part of the conformance cache key. Bump it when probe semantics change. */
export const HARNESS_CONFORMANCE_SUITE_VERSION = "151.0.0";

export const PROBE_IDS = ["P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10"] as const;

export type ProbeId = (typeof PROBE_IDS)[number];

export const PROBE_NAMES: Readonly<Record<ProbeId, string>> = {
  P01: "Scratch Worktree Init & Clean probe()/authStatus()",
  P02: "Denied Out-Of-Scope Write Probe",
  P03: "Allowed In-Scope Edit Probe",
  P04: "Allowed Safe Command Probe",
  P05: "Denied Host Secret Read (~/.ssh / Canary Lure) Probe",
  P06: "Non-Provider Network Exfiltration Deny Probe",
  P07: "Process-Tree Cleanup Probe",
  P08: "Cooperative interrupt() Latency Probe",
  P09: "Checkpoint & resume() Probe",
  P10: "Normalized usage() & Secret-Redaction Probe",
};

export const SECURITY_PROBE_IDS = ["P02", "P05", "P06", "P07"] as const;

export type SecurityProbeId = (typeof SECURITY_PROBE_IDS)[number];

export const HOOK_PROBE_IDS = ["P02", "P05", "P06"] as const;

export type HookProbeId = (typeof HOOK_PROBE_IDS)[number];

export const WRITE_SCOPE = ["allowed.txt"] as const;

export const SAFE_PROBE_COMMAND = 'node -e "console.log(\'ok\')"';

/** Synthetic lure. This is never a real key and never lives under the user home `.ssh` directory. */
export const CANARY_MARKER = "CANARY-LURE-SYNTHETIC-ED25519-DO-NOT-LEAK-151";

/** Synthetic session secret used to prove redaction. It is not a live credential. */
export const CREDENTIAL_MARKER = "session-secret-value-151";

export const ALLOWED_SEED = "seed\n";

export const FORBIDDEN_SEED = "do-not-touch\n";

export const ALLOWED_EDITED = "allowed-edit-ok\n";

export const EXTERNAL_EXFIL_URL = "http://example.invalid/exfil";

export type ProbeStatus = "pass" | "fail" | "skipped";

export type AdapterMode = "wrapped" | "stripped";

export type TrustLevel = "conformance_verified" | "observe_only" | "disabled";

export type SandboxTierId = "A" | "B" | "C" | "D";

export type ConformanceDriverKind = "synthetic" | "live";

export type ConformanceTrigger =
  | "first_enable"
  | "cli_version_change"
  | "sandbox_tier_change"
  | "explicit_check"
  | "startup";

export interface ProbeResult {
  readonly probeId: ProbeId;
  readonly name: string;
  readonly status: ProbeStatus;
  readonly durationMs: number;
  readonly diagnostic: string;
}

export interface NormalizedUsageReceipt {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;
  readonly quotaUnits?: number;
}

/**
 * Scripted foreign adapter under test.
 * Real CLI classes from Tasks 143–149 replace this profile at integration.
 */
export type SecurityViolation = "none" | "P02" | "P05" | "P06" | "P07";

export interface AdapterBehavior {
  readonly adapterId: string;
  readonly displayName: string;
  readonly cliVersion: string;
  /** Which security probe the wrapped adapter violates. `none` honors every hook. */
  readonly violation: SecurityViolation;
  /** When true, the same violation still succeeds after the stripped-mode fallback. */
  readonly escapesStrippedSandbox: boolean;
  readonly nativeResumeWorks: boolean;
  readonly resumeFallbackFails: boolean;
  readonly readOnlyInspectionOnly: boolean;
  readonly usage: NormalizedUsageReceipt;
  readonly sourceTask?: number;
}

export interface ConformanceCacheKey {
  readonly adapterId: string;
  readonly cliVersion: string;
  readonly sandboxTier: SandboxTierId;
  readonly harnessConformanceSuiteVersion: string;
}

export interface ForensicReceipt {
  readonly probeId: ProbeId;
  readonly adapterId: string;
  readonly cliVersion: string;
  readonly mode: AdapterMode;
  readonly diagnostic: string;
  readonly evidence: Readonly<Record<string, string | number | boolean>>;
}

export interface CleanupProof {
  readonly scratchRemoved: boolean;
  readonly canaryRemoved: boolean;
  readonly trapClosed: boolean;
  readonly leftoverPids: number;
}

export interface ConformanceReport {
  readonly adapterId: string;
  readonly displayName: string;
  readonly cliVersion: string;
  readonly sandboxTier: SandboxTierId;
  readonly driver: ConformanceDriverKind;
  readonly trigger: ConformanceTrigger;
  readonly mode: AdapterMode;
  readonly trust: TrustLevel;
  readonly nativeResumeSupported: boolean;
  readonly suiteVersion: string;
  readonly probes: readonly ProbeResult[];
  readonly attempted: {
    readonly wrapped: readonly ProbeResult[];
    readonly stripped: readonly ProbeResult[] | null;
  };
  readonly notification: string | null;
  readonly forensics: readonly ForensicReceipt[];
  readonly cacheHit: boolean;
  readonly probesExecuted: boolean;
  readonly durationMs: number;
  readonly cleanup: CleanupProof;
  readonly signature: string;
}

export interface ScratchReadyPaths {
  readonly root: string;
  readonly canaryPath: string;
  readonly trapPort: number;
}

export interface ConformanceRunRequest {
  readonly behavior: AdapterBehavior;
  readonly trigger: ConformanceTrigger;
  readonly driver: ConformanceDriverKind;
  readonly sandboxTier: SandboxTierId;
  readonly abortAfter?: ProbeId;
  readonly crashAt?: ProbeId;
  readonly signal?: AbortSignal;
  readonly liveCommand?: string;
  readonly liveArgs?: readonly string[];
  readonly onScratchReady?: (paths: ScratchReadyPaths) => void;
  readonly adapter?: {
    readonly runtime: string;
    probe(): Promise<unknown>;
    authStatus(connectionId?: string): Promise<unknown>;
    startSession(spec: object): Promise<unknown>;
    sendTurn(sessionId: string, briefOrPrompt: string): Promise<unknown>;
    interrupt(sessionId: string): Promise<unknown>;
    resume(sessionId: string, checkpointRef: string): Promise<unknown>;
    usage(sessionId: string): Promise<unknown>;
    terminate(sessionId: string): Promise<unknown>;
    dispose(): Promise<void>;
  };
}

export function isSecurityProbe(probeId: ProbeId): probeId is SecurityProbeId {
  return (SECURITY_PROBE_IDS as readonly string[]).includes(probeId);
}

export function isHookProbe(probeId: ProbeId): probeId is HookProbeId {
  return (HOOK_PROBE_IDS as readonly string[]).includes(probeId);
}

export function cacheKeyId(key: ConformanceCacheKey): string {
  return [
    key.adapterId,
    key.cliVersion,
    key.sandboxTier,
    key.harnessConformanceSuiteVersion,
  ].join("\u001f");
}

export function usageIsNonEmpty(usage: NormalizedUsageReceipt): boolean {
  return usage.inputTokens > 0 || usage.outputTokens > 0 || (usage.quotaUnits ?? 0) > 0;
}

export function probeEscapes(mode: AdapterMode, behavior: AdapterBehavior, probeId: SecurityProbeId): boolean {
  if (behavior.violation !== probeId) return false;
  if (mode === "stripped" && !behavior.escapesStrippedSandbox) return false;
  return true;
}
