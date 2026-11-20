import { createCompletenessGateRunner } from "../../src/gate/index.js";
import type {
  ChangedFile,
  FeatureAuditInput,
  LeafAuditInput,
  StaticAuditReport,
} from "../../src/gate/index.js";

export function added(path: string, afterText: string): ChangedFile {
  return { path, status: "added", beforeText: "", afterText };
}

export function makeLeaf(overrides: Partial<LeafAuditInput> = {}): LeafAuditInput {
  return {
    taskId: "T02",
    featureId: "F12",
    actor: "worker",
    baseRef: "base",
    candidateRef: "candidate",
    files: [],
    produces: [],
    schemaFields: [],
    staticData: [],
    approvedDeferralIds: [],
    excludedGeneratedPaths: [],
    seedFixturePaths: [],
    protectedTestPaths: ["tests/**", "**/*.test.ts", "**/*.spec.ts"],
    protectedTestConfigPaths: [
      "vitest.config.ts",
      "playwright.config.ts",
      "jest.config.ts",
    ],
    lockedSnapshotPaths: ["**/__snapshots__/**", "**/*.snap"],
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

export function makeFeature(overrides: Partial<FeatureAuditInput> = {}): FeatureAuditInput {
  return {
    ...makeLeaf({ taskId: "F12" }),
    featureFiles: [],
    mergedTaskIds: [],
    allFeatureTaskIds: [],
    ...overrides,
  };
}

export function auditLeaf(overrides: Partial<LeafAuditInput>): StaticAuditReport {
  return createCompletenessGateRunner().runLeafStaticAudit(makeLeaf(overrides));
}

export function ruleIds(report: StaticAuditReport): string[] {
  return report.findings.map((finding) => finding.ruleId);
}
