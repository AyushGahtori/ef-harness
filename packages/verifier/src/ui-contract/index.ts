export { classifySeededRows, matchAriaSnapshot, parseAriaSnapshot, seededRowsFromSnapshot, toMatchAriaSnapshot } from "./aria-snapshot.js";
export { bindCopyCatalog, CopyCatalogLinter } from "./copy-catalog.js";
export {
  BrittleLocatorError,
  ContractSchemaError,
  CopyCatalogLintError,
  DuplicateControlNameError,
  HumanStepRequired,
} from "./errors.js";
export { assertNoBrittleLocators, compileContractChecks, missingControlMessage } from "./locators.js";
export { isMissingChromiumError, launchChromium, loadPlaywright } from "./playwright-runtime.js";
export type {
  CasBlobStorePort,
  EnvironmentHandlePort,
  HintLadderPort,
  SurfaceCheckResult,
  SurfaceCollectInput,
  SurfaceVerifierAdapter,
} from "./ports.js";
export { UiInteractionContractSchema } from "./schema.js";
export { redactVerbatim, TextMatchNormalizer } from "./text-match.js";
export type {
  ActionSpec,
  CopyCatalog,
  CopyCatalogEntry,
  CopyLintIssue,
  GeneratedCheck,
  HiddenCheckFailure,
  HiddenUiExpectation,
  LandmarkSpec,
  MatchMode,
  StateSpec,
  StoredArtifact,
  TextSpec,
  UiInteractionContract,
  UiVerificationResult,
} from "./types.js";
export { UiInteractionContractVerifier } from "./verifier.js";
export type { UiVerificationRequest } from "./verifier.js";
