import type { PrePushDependencies } from "./contracts.js";
import type { PrePushSafetyInput, PrePushSafetyResult } from "./types.js";

const FORBIDDEN_TRACKED_PREFIXES = [".harness/views/", ".env.local"];

function hasForbiddenTracked(paths: readonly string[]): string | undefined {
  for (const file of paths) {
    const norm = file.replaceAll("\\", "/");
    if (FORBIDDEN_TRACKED_PREFIXES.some((prefix) => norm === prefix || norm.startsWith(prefix))) {
      return norm;
    }
    if (norm === ".env.local" || norm.endsWith("/.env.local")) {
      return norm;
    }
  }
  return undefined;
}

export class PrePushSafetyGate {
  constructor(private readonly deps: PrePushDependencies) {}

  async evaluate(input: PrePushSafetyInput): Promise<PrePushSafetyResult> {
    if (!input.localChecksPassed) {
      return {
        ok: false,
        reason: "Local verification suite did not pass; push blocked",
        blockedEffect: "git_push",
      };
    }

    const forbidden = hasForbiddenTracked(input.trackedFiles);
    if (forbidden) {
      return {
        ok: false,
        reason: `Forbidden harness or local env file is tracked: ${forbidden}`,
        blockedEffect: "git_push",
      };
    }

    const findings = await this.deps.scanner.scanCommitRange(
      input.baseRef,
      input.headRef ?? "HEAD",
    );
    if (findings.length > 0) {
      const first = findings[0];
      return {
        ok: false,
        reason: `gitleaks found ${findings.length} secret(s); first at ${first?.file ?? "?"}:${first?.line ?? "?"}`,
        blockedEffect: "git_push",
      };
    }

    return { ok: true };
  }
}