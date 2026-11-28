import {
  CLI_TOOLS,
  DATABASE_HARD_BYPASS_MESSAGE,
  HUMAN_STEP_STATUSES,
  HUMAN_STEP_TYPES,
  PLAYWRIGHT_HARD_BYPASS_MESSAGE,
  type AttestationDecision,
  type CliToolName,
  type HumanStepBadge,
  type HumanStepRecord,
  type HumanStepStatus,
  type HumanStepType,
  type ProbeResult,
  type ProbeSpec,
} from "./types.js";

const HARD_BYPASS_GENERIC =
  "This requirement is checked on this machine — fix it or skip the feature. It cannot be marked verified by hand.";

export function isHumanStepStatus(value: string): value is HumanStepStatus {
  return (HUMAN_STEP_STATUSES as readonly string[]).includes(value);
}

export function isHumanStepType(value: string): value is HumanStepType {
  return (HUMAN_STEP_TYPES as readonly string[]).includes(value);
}

export function isCliToolName(value: string): value is CliToolName {
  return (CLI_TOOLS as readonly string[]).includes(value);
}

export function isAutomatable(spec: ProbeSpec): boolean {
  return spec.kind !== "unprobeable";
}

/**
 * Locally probeable runtimes that fail immediately if skipped default to hard.
 * Cloud, DNS, and webhook steps stay attestable because a private endpoint
 * can be invisible to a laptop probe.
 */
export function defaultHardLocal(spec: ProbeSpec): boolean {
  return spec.kind === "playwright" || spec.kind === "docker" || spec.kind === "database_url" || spec.kind === "cli_tool";
}

export class AttestedVsVerifiedBadgePolicy {
  defaultHardLocal(spec: ProbeSpec): boolean {
    return defaultHardLocal(spec);
  }

  badge(step: HumanStepRecord): HumanStepBadge {
    if (step.resolution === "feature_skipped") {
      return {
        status: step.status,
        label: skippedLabel(step.probeSpec.kind),
        tone: "neutral",
        honest: step.status !== "verified" && step.status !== "attested",
      };
    }
    if (step.status === "verified") {
      if (step.lastProbeResult?.outcome !== "pass") {
        return {
          status: step.status,
          label: "Not verified — no passing probe",
          tone: "attention",
          honest: false,
        };
      }
      return { status: step.status, label: "Verified", tone: "green", honest: true };
    }
    if (step.status === "attested") {
      return {
        status: step.status,
        label: "Self-attested by you (unprobed)",
        tone: "neutral",
        honest: step.lastProbeResult?.outcome !== "pass",
      };
    }
    if (step.status === "failed") {
      return {
        status: step.status,
        label: step.lastProbeResult?.diagnosis ?? "Check failed",
        tone: "attention",
        honest: true,
      };
    }
    if (step.status === "probing") {
      return { status: step.status, label: "Checking", tone: "neutral", honest: true };
    }
    return { status: step.status, label: "Waiting on you", tone: "neutral", honest: true };
  }

  /**
   * Manual confirmation is never `verified`. Hard local runtimes cannot be
   * attested either: the next command would fail immediately.
   */
  decideAttestation(step: HumanStepRecord): AttestationDecision {
    if (step.status === "verified" && step.lastProbeResult?.outcome === "pass") {
      return { allowed: false, message: "This step is already verified by a probe" };
    }
    if (step.hardLocal) {
      return { allowed: false, message: hardBypassMessage(step.probeSpec) };
    }
    return {
      allowed: true,
      message: "Self-attested by you (unprobed)",
    };
  }

  statusAfterProbe(result: ProbeResult): "verified" | "failed" {
    return result.outcome === "pass" ? "verified" : "failed";
  }
}

function skippedLabel(kind: ProbeSpec["kind"]): string {
  if (kind === "playwright") return "Browser checks disabled";
  if (kind === "database_url") return "Database checks disabled";
  if (kind === "docker") return "Docker checks disabled";
  return "Feature skipped";
}

function hardBypassMessage(spec: ProbeSpec): string {
  if (spec.kind === "playwright") return PLAYWRIGHT_HARD_BYPASS_MESSAGE;
  if (spec.kind === "database_url") return DATABASE_HARD_BYPASS_MESSAGE;
  if (spec.kind === "docker") return "Docker is required for this step — start Docker Desktop or skip the feature";
  if (spec.kind === "cli_tool") {
    return `${spec.tool} is required on this machine — install it or skip the feature`;
  }
  return HARD_BYPASS_GENERIC;
}
