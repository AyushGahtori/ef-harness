export { expandNamingVariants, uniqueVariants, CASING_VARIANT_ORDER } from "./naming-variants.js";
export type { CasingVariant } from "./naming-variants.js";
export {
  VariantExpandedReferenceInventory,
  HistoricalMigrationWriteBlockedError,
} from "./variant-expanded-reference-inventory.js";
export type { InventoryScanOptions, InventoryScanResult } from "./variant-expanded-reference-inventory.js";
export { PersistedNameBoundaryGate } from "./persisted-name-boundary-gate.js";
export type { PersistedNameApproval } from "./persisted-name-boundary-gate.js";
export { RiskyAstTransformDetector } from "./risky-ast-transform-detector.js";
export type { AstDiffInput, AstDiffScanOptions } from "./risky-ast-transform-detector.js";
export { SweepLeftoverScanner } from "./sweep-leftover-scanner.js";
export type { LeftoverScanOptions, LeftoverScanResult } from "./sweep-leftover-scanner.js";
export { PostSweepBriefSymbolUpdater, MAX_SYMBOL_MAP_HEADER_TOKENS } from "./post-sweep-brief-symbol-updater.js";
export { PreSweepCharacterizationGuard } from "./characterization-guard.js";
export type {
  CharacterizationSafetyNetPort,
  CharacterizationPlan,
  CharacterizationGuardResult,
} from "./characterization-guard.js";
export {
  PostSweepResyncPlanner,
  SweepAuditScorecardRecorder,
} from "./sweep-resync.js";
export type { ChecklistGlobRewrite, ResyncRefreshResult } from "./sweep-resync.js";
export { isHistoricalMigrationPath, classifyLineHit, defaultFileZone } from "./zone-classifier.js";
export type {
  SafetyZone,
  PersistedNameKind,
  ReferenceHit,
  Zone2Decision,
  PersistedNameGateResult,
  RiskyAstFlag,
  RiskyAstFlagKind,
  SweepSymbolMapEntry,
  QueuedTaskRecord,
  SweepAuditScorecard,
} from "./types.js";