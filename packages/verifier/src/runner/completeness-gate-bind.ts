import {
  CompletenessGateRunner,
  type LeafAuditInput,
} from "@ef-harness/completeness-gate";
import type { CompletenessGateRunnerPort } from "./ports.js";

export function verifierLeafAudit(
  overrides: Partial<LeafAuditInput> & Pick<LeafAuditInput, "taskId" | "files">,
): LeafAuditInput {
  return {
    featureId: "feature",
    actor: "worker",
    baseRef: "base",
    candidateRef: "candidate",
    produces: [],
    schemaFields: [],
    staticData: [],
    approvedDeferralIds: [],
    excludedGeneratedPaths: [],
    seedFixturePaths: [],
    protectedTestPaths: [],
    protectedTestConfigPaths: [],
    lockedSnapshotPaths: [],
    verificationScopeGrant: false,
    writeScope: ["**"],
    integratorConflictHunks: [],
    declaredSharedFiles: [],
    errorHandlingRequiresSurface: true,
    entryPoints: [],
    registeredAssets: [],
    publicFiles: [],
    assetModuleSources: [],
    visibleExampleLiterals: [],
    deletionDeclared: false,
    justifiedTaskNotes: [],
    registry: { names: [] },
    vaultSecrets: [],
    ...overrides,
  };
}

/**
 * `CleanVerifierRunner.verifyCandidate` calls `CompletenessGateRunnerPort`.
 * This bind runs that call on `CompletenessGateRunner.runLeafStaticAudit`.
 * `leafFor` sees the clean checkout path, not the worker slot.
 */
export function bindCompletenessGate(
  runner: CompletenessGateRunner,
  leafFor: (input: {
    readonly taskId: string;
    readonly attemptId: string;
    readonly commitSha: string;
    readonly checkoutPath: string;
  }) => LeafAuditInput,
): CompletenessGateRunnerPort {
  return {
    async runLeafStaticAudit(input) {
      const leaf = leafFor(input);
      const report = runner.runLeafStaticAudit({
        ...leaf,
        taskId: input.taskId,
        candidateRef: input.commitSha,
      });
      return {
        passed: report.passed,
        findings: report.findings.map(
          (finding) => `${finding.ruleId} ${finding.file}:${String(finding.line)} ${finding.message}`,
        ),
        fingerprint: report.fingerprint,
      };
    },
  };
}
