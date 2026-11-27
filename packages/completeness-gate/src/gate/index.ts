export { CompletenessGateRunner, createCompletenessGateRunner } from "./completeness-gate-runner.js";
export type { CompletenessGateDependencies } from "./completeness-gate-runner.js";
export { computeStaticAuditFingerprint } from "./fingerprint.js";
export { bindGitSafetyScanner, bindNameRegistryService } from "./kernel-bind.js";
export { createLocalStaticAuditAstEngine } from "./local-ast-engine.js";
export { createLocalNameRegistry } from "./local-name-registry.js";
export { createLocalGitSafetyScanner, maskSecretValue } from "./local-safety-scanner.js";
export { createTask058AstEngine } from "./task-058-ast-engine.js";
export type {
  AstScanContext,
  AstScanResult,
  ExtractedCodeName,
  GitSafetyScanner,
  NameAuditFailure,
  NameRegistryService,
  SafetyScanReport,
  SecretHit,
  StaticAuditAstEngine,
} from "./ports.js";
export type {
  AllowedEscape,
  AuditActor,
  AuditLevel,
  ChangedFile,
  ConflictHunk,
  CoverageMode,
  FeatureAuditInput,
  HumanOverrideRecord,
  HumanOverrideRequest,
  LeafAuditInput,
  NameKind,
  ProducedContract,
  RegisteredAsset,
  RegisteredName,
  RegistrySnapshot,
  SchemaFieldPlan,
  StaticAuditFinding,
  StaticAuditReceipt,
  StaticAuditReport,
  StaticDataDeclaration,
  WorkspaceFile,
} from "./types.js";
