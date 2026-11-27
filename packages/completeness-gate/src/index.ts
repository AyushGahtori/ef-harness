export const packageName = "@ef-harness/completeness-gate" as const;
export const layer = 2 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  STATIC_AUDIT_AST_GREP_RULES,
  StaticAuditAstEngine,
  computeStaticAuditFingerprint,
  createProcessAstGrepRunner,
  createProcessGitRunner,
  parseNameStatusZ,
  parseNumstatZ,
  runStaticAudit,
} from "./ast-scanners/index.js";
export type {
  AstGrepLanguage,
  AstGrepMatch,
  AstGrepRule,
  AstGrepRunner,
  AstGrepScanResult,
  AuditFileInput,
  DiffFileStatus,
  GitExecResult,
  GitRunnerPort,
  ProducedSymbol,
  ProducedSymbolKind,
  StaticAuditBrief,
  StaticAuditContext,
  StaticAuditConventions,
  StaticAuditCoverageMode,
  StaticAuditEngineOptions,
  StaticAuditFileCoverage,
  StaticAuditFinding,
  StaticAuditInput,
  StaticAuditLanguage,
  StaticAuditReport,
  StaticAuditSeverity,
} from "./ast-scanners/index.js";
export {
  CompletenessGateRunner,
  computeStaticAuditFingerprint as gateComputeStaticAuditFingerprint,
  bindGitSafetyScanner,
  bindNameRegistryService,
  createCompletenessGateRunner,
  createLocalGitSafetyScanner,
  createLocalNameRegistry,
  createLocalStaticAuditAstEngine,
  createTask058AstEngine,
  maskSecretValue,
} from "./gate/index.js";
export type {
  AllowedEscape,
  AstScanContext,
  AstScanResult,
  AuditActor,
  AuditLevel,
  ChangedFile,
  CompletenessGateDependencies,
  ConflictHunk,
  CoverageMode,
  ExtractedCodeName,
  FeatureAuditInput,
  GitSafetyScanner,
  HumanOverrideRecord,
  HumanOverrideRequest,
  LeafAuditInput,
  NameAuditFailure,
  NameKind,
  NameRegistryService,
  ProducedContract,
  RegisteredAsset,
  RegisteredName,
  RegistrySnapshot,
  SafetyScanReport,
  SchemaFieldPlan,
  SecretHit,
  StaticAuditAstEngine as GateStaticAuditAstEngine,
  StaticAuditFinding as GateStaticAuditFinding,
  StaticAuditReceipt,
  StaticAuditReport as GateStaticAuditReport,
  StaticDataDeclaration,
  WorkspaceFile,
} from "./gate/index.js";
