import { promptInjectedText } from "./files.js";
import {
  CANARY_SSH_LURE,
  SkillMountDeniedError,
  type CandidateSkill,
  type QuarantineReport,
  type VettingStatus,
} from "./model.js";
import { isOutOfScopeTestEdit } from "./patterns.js";
import type { NativeWorkerLoopPort, PacketSecurityRedactorPort, SandboxPolicyPort } from "./ports.js";
import type { SkillManifestRegistry } from "./registry.js";
import type { SkillTokenBudgetEnforcer } from "./budget.js";
import type { StaticSkillSecurityVetter } from "./vetter.js";

export interface QuarantineDependencies {
  readonly vetter: StaticSkillSecurityVetter;
  readonly budget: SkillTokenBudgetEnforcer;
  readonly redactor: PacketSecurityRedactorPort;
  readonly sandbox: SandboxPolicyPort;
  readonly worker: NativeWorkerLoopPort;
  readonly now?: () => string;
}

/**
 * Promotes a skill from quarantined to vetted only when the sealed scratch
 * run shows zero canary access, zero network calls, zero out-of-scope test
 * edits, and a passing behavioral smoke check.
 */
export class CanarySkillQuarantineHarness {
  constructor(private readonly deps: QuarantineDependencies) {}

  evaluate(candidate: CandidateSkill): QuarantineReport {
    this.deps.vetter.assertCandidate(candidate);
    const injected = promptInjectedText(candidate.files);
    const tokenCount = this.deps.budget.assertWithinCap(
      injected,
      `${candidate.skillId}@${candidate.version}`,
    );
    const scratch = this.deps.sandbox.createSealedScratch(candidate.scratchParent);
    try {
      const observation = this.deps.worker.runSkillInScratch({
        skillId: candidate.skillId,
        skillText: injected,
        scratch,
        allowedWritePrefixes: [],
      });
      const blobs = [observation.stdout, ...Object.values(observation.writtenText)];
      const watched = [...Object.values(scratch.canaryEnv), CANARY_SSH_LURE];
      const contentLeak = blobs.some((blob) =>
        this.deps.redactor.containsRegisteredValue(blob, watched),
      );
      const canarySignals = new Set<string>(observation.canaryAccesses);
      if (contentLeak) canarySignals.add("canary_in_output");
      const reasons: string[] = [];
      if (canarySignals.size > 0) reasons.push("canary_in_output");
      if (observation.networkCalls.length > 0) reasons.push("unauthorized_network");
      const testEdits = observation.writes.filter((write) => isOutOfScopeTestEdit(write)).length;
      if (testEdits > 0) reasons.push("out_of_scope_test_edit");
      if (!observation.smokePassed) reasons.push("smoke_failed");
      const toStatus: QuarantineReport["toStatus"] = reasons.length === 0 ? "vetted" : "rejected";
      return {
        skillId: candidate.skillId,
        version: candidate.version,
        fromStatus: candidate.fromStatus,
        toStatus,
        canaryAccesses: canarySignals.size,
        unauthorizedNetworkCalls: observation.networkCalls.length,
        outOfScopeTestEdits: testEdits,
        smokePassed: observation.smokePassed,
        smokeDetail: observation.smokeDetail,
        reasons,
        evaluatedAt: this.timestamp(),
        tokenCount,
      };
    } finally {
      scratch.dispose();
    }
  }

  promote(
    registry: SkillManifestRegistry,
    skillId: string,
    scratchParent: string,
  ): QuarantineReport {
    const loaded = registry.readCandidate(skillId);
    if (loaded.entry.vettingStatus === "revoked") {
      throw new SkillMountDeniedError("revoked", `skill ${skillId} is revoked`);
    }
    const report = this.evaluate({
      skillId: loaded.entry.skillId,
      version: loaded.entry.version,
      sourceType: loaded.entry.sourceType,
      license: loaded.entry.license,
      upstreamRepo: loaded.entry.upstreamRepo,
      files: loaded.files,
      fromStatus: loaded.entry.vettingStatus,
      scratchParent,
    });
    registry.setVettingStatus(skillId, report.toStatus, report.evaluatedAt);
    return report;
  }

  private timestamp(): string {
    return this.deps.now === undefined ? new Date().toISOString() : this.deps.now();
  }
}

export function quarantineBlocksMount(status: VettingStatus): boolean {
  return status !== "vetted";
}
