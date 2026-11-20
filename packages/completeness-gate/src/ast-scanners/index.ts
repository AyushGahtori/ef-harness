export { StaticAuditAstEngine, runStaticAudit } from "./engine.js";
export type { StaticAuditEngineOptions } from "./engine.js";
export { computeStaticAuditFingerprint } from "./fingerprint.js";
export { createProcessGitRunner } from "./git-port.js";
export { STATIC_AUDIT_AST_GREP_RULES, createProcessAstGrepRunner } from "./ast-grep.js";
export { parseNameStatusZ, parseNumstatZ } from "./diff-load.js";
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
  StaticAuditFileCoverage,
  StaticAuditFinding,
  StaticAuditInput,
  StaticAuditLanguage,
  StaticAuditReport,
  StaticAuditSeverity,
} from "./types.js";
