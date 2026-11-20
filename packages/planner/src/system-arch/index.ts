export { parseArchitectOutput, countSkeletonWords, wordBudgetViolation } from "./architect-schema.js";
export { DeterministicArchConsistencyGate } from "./consistency-gate.js";
export type { GateReport, HoistedRule } from "./consistency-gate.js";
export { FakeModelAdapter } from "./fake-model-adapter.js";
export { quoteFlowchartLabels, quoteSkeletonDiagrams, verifyMermaidSyntax } from "./mermaid-syntax.js";
export { skeletonDraft } from "./persist-skeleton.js";
export { fatalPrecheck, sharedOwners } from "./precheck.js";
export { SkeletonLockEnforcer } from "./skeleton-lock.js";
export type { LockDecision, SkeletonMutation } from "./skeleton-lock.js";
export { ArchitectureStore, openArchitectureStore } from "./state-db.js";
export type { ChangeSetDraft, EdgeDraft, GraphEdge, GraphNode, NameRecord, NodeDraft } from "./state-db.js";
export { SystemArchitectureSynthesizer, graphContradictionEngine } from "./synthesizer.js";
export type { SynthesizerOptions } from "./synthesizer.js";
export {
  MAX_REPAIR_PASSES,
  PHASE0_FOUNDATION,
  WORD_BUDGET,
  violation,
} from "./types.js";
export type {
  ArchitectModelPort,
  ArchitectModelRequest,
  ArchitectureViolation,
  SynthesisInput,
  SynthesisResult,
  SystemSkeleton,
  ViolationCode,
} from "./types.js";
