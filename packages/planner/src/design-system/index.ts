export { detectBrownfield } from "./brownfield.js";
export type { BrownfieldReport } from "./brownfield.js";
export { contrastRatio, formatRatio, normalizeHex, relativeLuminance, resolveAccessiblePairing } from "./contrast.js";
export { LookAndFeelInterviewFlow } from "./interview.js";
export { DesignTokenLintRuleset, FIX_HINTS } from "./lint.js";
export {
  bindScreenSpec,
  DesignSystemScaffoldBuilder,
  LockedTokenOwnership,
  PHASE0_P04_SLOT,
  runPhase0DesignSystem,
  SCREEN_SPEC_SOURCE,
} from "./scaffold.js";
export type { ScaffoldPlan } from "./scaffold.js";
export {
  MemoryCasBlobStore,
  OfflineUiPlaywrightContractVerifier,
  productionBundle,
  StyleguideRouteVerifier,
  themesFor,
} from "./styleguide.js";
export type {
  CasBlobStorePort,
  StyleguideVerification,
  UiPlaywrightContractVerifierPort,
} from "./styleguide.js";
export { pairingLines, W3cDesignTokenGenerator } from "./tokens.js";
export {
  DENSITIES,
  LAYOUT_TEMPLATES,
  LOCAL_PORTS,
  LOCKED_PATHS,
  MOOD_PRESETS,
  PRIMITIVE_STATES,
  PROJECT_KINDS,
  SEMANTIC_COLOR_KEYS,
  SHARED_PRIMITIVES,
  SPACING_SCALE_PX,
  STYLE_DICTIONARY_SOURCE,
  STYLEGUIDE_VIEWPORTS,
  TEXT_CONTRAST_FLOOR,
  TOKEN_PATHS,
  TYPE_SCALE,
  UI_CONTRAST_FLOOR,
  UI_CONVENTIONS,
} from "./types.js";
export type {
  DesignTokenDocument,
  LookAndFeelDecision,
  LookAndFeelInput,
  ScaffoldInput,
  ScreenSpecLike,
  StyleDictionaryBuild,
} from "./types.js";
export { DesignSystemError } from "./types.js";
