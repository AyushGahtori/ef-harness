export {
  EF_HARNESS_CONTRACT_STUB_NOT_IMPLEMENTED,
  FORBIDDEN_INPUT_FIELDS,
  HARNESS_BINDER_DIR,
} from "./constants.js";
export type { ForbiddenInputField } from "./constants.js";

export {
  BindingDefectError,
  CleanRunError,
  ObservationMismatchError,
} from "./errors.js";
export type { BindingDefectCode, CleanFailureClass, RejectionClass } from "./errors.js";

export type {
  AcceptanceCheck,
  BinderMode,
  BinderWrite,
  BlindBinderOutput,
  CandidateComparison,
  CheckRuntime,
  ContractEntrySpec,
  EntryKind,
  EntrySurface,
  GateDecision,
  ObservationField,
  ObservationsSchema,
  PostHocProof,
  SetupHelper,
  StubBehavior,
  StubKind,
} from "./types.js";

export { parseBlindBinderV1, sameObservationFields } from "./blind-binder-schema.js";
export type { ParseFailure, ParseSuccess } from "./blind-binder-schema.js";

export { parseSignature, requireSignature } from "./signature.js";
export type { ParsedParam, ParsedSignature } from "./signature.js";

export { BinderModeRouter } from "./mode-router.js";
export type { ModeRouteInput } from "./mode-router.js";

export { ContractStubGenerator } from "./contract-stub-generator.js";
export type { GeneratedStub, GenerateOptions } from "./contract-stub-generator.js";

export { BinderAdapterCache, checkEntrySignatureHash, entrySignatureHash } from "./binder-cache.js";
export type { CachedBinderAdapter } from "./binder-cache.js";

export {
  adapterPath,
  applyBinderWrites,
  assertProductUntouched,
  isBinderPath,
  normalizeRel,
} from "./containment.js";

export {
  assembleBlindBinderPrompt,
  assertBinderInputBlind,
  forbiddenFieldPaths,
  primaryEntry,
  sanitizeBinderInput,
  wrapUntrusted,
} from "./blindness.js";
export type { BlindPrompt } from "./blindness.js";

export { auditBinderAdapter } from "./adapter-audit.js";
export type { AdapterAudit } from "./adapter-audit.js";

export { deepEqual } from "./compare.js";

export { InProcessCleanVerifierPort, compileCleanTree } from "./clean-verifier-port.js";
export type { CleanVerifierPort, CompileResult } from "./clean-verifier-port.js";

export {
  RedBeforeGreenGate,
  adapterKernelRun,
  kernelRun,
} from "./red-before-green.js";
export type { GateRequest, PostHocRequest } from "./red-before-green.js";

export { FakeModelAdapter } from "./fake-model-adapter.js";
export type { BinderModelAdapter, ScriptedBinderTurn } from "./fake-model-adapter.js";

export { BlindBinderOrchestrator } from "./orchestrator.js";
export type { BindTrees, BlindBindResult } from "./orchestrator.js";
