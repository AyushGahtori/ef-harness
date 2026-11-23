import { isHookProbe, isSecurityProbe } from "./types.js";
import type { AdapterMode, ProbeResult, TrustLevel } from "./types.js";

export interface DowngradeInput {
  readonly displayName: string;
  readonly cliVersion: string;
  readonly wrapped: readonly ProbeResult[];
  readonly stripped: readonly ProbeResult[] | null;
  readonly readOnlyInspectionOnly: boolean;
  readonly nativeResumeSupported: boolean;
}

export interface DowngradeDecision {
  readonly trust: TrustLevel;
  readonly mode: AdapterMode;
  readonly nativeResumeSupported: boolean;
  readonly notification: string | null;
  readonly probes: readonly ProbeResult[];
}

/**
 * Wrapped security failures re-run in stripped mode.
 * Stripped success keeps `conformance_verified` but only in stripped mode.
 * A security failure that survives stripped mode disables dispatch, unless the
 * adapter is limited to read-only inspection (`observe_only`).
 * A native resume miss with a working labeled-WIP fallback stays verified.
 */
export class AutomaticTrustDowngrader {
  decide(input: DowngradeInput): DowngradeDecision {
    const wrappedSecurity = input.wrapped.filter((probe) => isSecurityProbe(probe.probeId) && probe.status === "fail");
    if (wrappedSecurity.length === 0) {
      const allPass = input.wrapped.every((probe) => probe.status === "pass");
      return {
        trust: allPass ? "conformance_verified" : "observe_only",
        mode: "wrapped",
        nativeResumeSupported: input.nativeResumeSupported,
        notification: null,
        probes: input.wrapped,
      };
    }
    const stripped = input.stripped;
    if (!stripped) {
      return {
        trust: input.readOnlyInspectionOnly ? "observe_only" : "disabled",
        mode: "wrapped",
        nativeResumeSupported: false,
        notification: null,
        probes: input.wrapped,
      };
    }
    const strippedSecurity = stripped.filter((probe) => isSecurityProbe(probe.probeId) && probe.status === "fail");
    if (strippedSecurity.length > 0) {
      const trust = input.readOnlyInspectionOnly ? "observe_only" : "disabled";
      return {
        trust,
        mode: "stripped",
        nativeResumeSupported: false,
        notification:
          trust === "disabled"
            ? `${input.displayName} v${input.cliVersion} failed security probes in stripped mode — conformance disabled`
            : `${input.displayName} v${input.cliVersion} failed security probes in stripped mode — limited to observe only`,
        probes: stripped,
      };
    }
    const allStrippedPass = stripped.every((probe) => probe.status === "pass");
    if (!allStrippedPass) {
      return {
        trust: "observe_only",
        mode: "stripped",
        nativeResumeSupported: input.nativeResumeSupported,
        notification: null,
        probes: stripped,
      };
    }
    const hookBroke = wrappedSecurity.some((probe) => isHookProbe(probe.probeId));
    return {
      trust: "conformance_verified",
      mode: "stripped",
      nativeResumeSupported: input.nativeResumeSupported,
      notification: hookBroke
        ? `${input.displayName} v${input.cliVersion} broke native permission hooks — switched safely to Stripped mode`
        : `${input.displayName} v${input.cliVersion} leaked a child process outside the Job Object — switched safely to Stripped mode`,
      probes: stripped,
    };
  }
}

export function needsStrippedRetry(probes: readonly ProbeResult[]): boolean {
  return probes.some((probe) => isSecurityProbe(probe.probeId) && probe.status === "fail");
}
