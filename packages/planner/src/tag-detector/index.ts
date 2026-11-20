export { RulesSeamsCatalogLoader } from "./catalog.js";
export type { RulesSeamsCatalog } from "./catalog.js";
export {
  CLOSED_TOUCH_TAGS,
  TOUCH_TAG_SOURCE,
  isTouchTag,
  matchesScopePredicate,
  normalizeTouchTag,
  sortTouchTags,
} from "./closed-tags.js";
export type { ScopePredicate, TouchTag } from "./closed-tags.js";
export { DiffAutoTagDetector } from "./diff-tag-detector.js";
export type { DiffDetectOptions, DiffSignal, DiffTagReport, ScopeCreepReport } from "./diff-tag-detector.js";
export { EntityTagInheritor } from "./entity-tag-inheritor.js";
export type {
  GraphLink,
  GraphNode,
  InheritanceReport,
  InheritedNode,
  KnowledgeGraphSnapshot,
} from "./entity-tag-inheritor.js";
export { StaticRuleLintGate } from "./lint.js";
export type { LintReport } from "./lint.js";
export {
  injectNumericDefaultClash,
  injectPrototypeAuthPreferenceClash,
  M2_QUESTION_IDS,
  m2StagePort,
} from "./m2-stage-port.js";
export { SeamTaskAutoMatcher } from "./seam-match.js";
export type { SeamMatchQuery, SeamParty, SeamProposal } from "./seam-match.js";
export { EXPECTED_SEAM_IDS, EXPECTED_SEAM_NAMES } from "./seams.js";
export type { SeamId, SeamTemplate } from "./seams.js";
export { StageCoherenceSelfTest, STAGE_PRESETS } from "./stage-coherence.js";
export type { StageCatalog, StageCoherenceReport, StagePreset } from "./stage-coherence.js";
export { RULE_TOKEN_CEILING, countTokens } from "./tokens.js";
export {
  COVERING_TOPICS,
  CORPUS_RULE_TITLES,
  EXPECTED_RULE_IDS,
  CatalogValidationError,
  ruleMatches,
} from "./rules.js";
export type { CrossCuttingRule, RuleId } from "./rules.js";
