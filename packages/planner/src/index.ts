export const packageName = "@ef-harness/planner" as const;
export const layer = 3 as const;

export function packageIdentity(): {
  readonly name: typeof packageName;
  readonly layer: typeof layer;
} {
  return { name: packageName, layer };
}

export {
  CLOSED_TOUCH_TAGS,
  CORPUS_RULE_TITLES,
  COVERING_TOPICS,
  CatalogValidationError,
  DiffAutoTagDetector,
  EXPECTED_RULE_IDS,
  EXPECTED_SEAM_IDS,
  EXPECTED_SEAM_NAMES,
  EntityTagInheritor,
  M2_QUESTION_IDS,
  RULE_TOKEN_CEILING,
  RulesSeamsCatalogLoader,
  STAGE_PRESETS,
  SeamTaskAutoMatcher,
  StageCoherenceSelfTest,
  StaticRuleLintGate,
  TOUCH_TAG_SOURCE,
  countTokens,
  injectNumericDefaultClash,
  injectPrototypeAuthPreferenceClash,
  isTouchTag,
  m2StagePort,
  matchesScopePredicate,
  normalizeTouchTag,
  ruleMatches,
  sortTouchTags,
} from "./tag-detector/index.js";
export type {
  CrossCuttingRule,
  DiffDetectOptions,
  DiffSignal,
  DiffTagReport,
  GraphLink,
  GraphNode,
  InheritanceReport,
  InheritedNode,
  KnowledgeGraphSnapshot,
  LintReport,
  RuleId,
  RulesSeamsCatalog,
  ScopeCreepReport,
  ScopePredicate,
  SeamId,
  SeamMatchQuery,
  SeamParty,
  SeamProposal,
  SeamTemplate,
  StageCatalog,
  StageCoherenceReport,
  StagePreset,
  TouchTag,
} from "./tag-detector/index.js";
