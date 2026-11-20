/** Worker model level used by Task 088 MUST ceilings. */
export type WorkerLevel = "junior" | "senior";

/** Brief band a knowledge fact is pushed or promoted into. */
export type KnowledgeBand = "MUST" | "SHOULD" | "COULD";

/** How a cross-cutting rule matched the task's effective tag union. */
export type MatchProvenance = "direct_tag" | "entity_inheritance" | "global";

export type RuleKind = "cross_cutting" | "universal_policy" | "project";

export type KbToolName =
  | "kb.search"
  | "kb.get_node"
  | "kb.get_contract"
  | "kb.list_rules_for_tags";

/**
 * Scope is absent (`null`) or a list.
 * `null` means that side of the predicate is not applied.
 * An empty list is present: `any: []` matches nothing, `all: []` is a vacuous subset.
 */
export interface MatchableRule {
  readonly id: string;
  readonly title: string;
  readonly kind: RuleKind;
  readonly active: boolean;
  readonly global: boolean;
  readonly any: readonly string[] | null;
  readonly all: readonly string[] | null;
  readonly appliesAs: "must" | "should";
  readonly checkIds: readonly string[];
}

export interface RuleMatchInput {
  readonly taskTouches: readonly string[];
  readonly inheritedEntityTags: readonly string[];
  readonly screenEndpointTags: readonly string[];
}

export interface RuleMatch {
  readonly ruleId: string;
  readonly title: string;
  readonly kind: RuleKind;
  readonly matchedVia: MatchProvenance;
  readonly matchedTags: readonly string[];
  readonly appliesAs: "must" | "should";
  readonly checkIds: readonly string[];
  readonly global: boolean;
}

export interface RuleMatchReport {
  readonly effectiveTags: readonly string[];
  readonly directTags: readonly string[];
  readonly inheritedEntityTags: readonly string[];
  readonly screenEndpointTags: readonly string[];
  readonly matches: readonly RuleMatch[];
}

export interface ContractLink {
  readonly contractId: string;
  readonly relation: string;
}

/** Knowledge node visible to the pull tools. Sealed oracles set `hidden`. */
export interface KnowledgeNode {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly prose: string;
  readonly tags: readonly string[];
  readonly status: "active" | "retired";
  readonly hidden: boolean;
  readonly visibility: string;
  readonly canonical: Readonly<Record<string, unknown>>;
  readonly outgoingContractLinks: readonly ContractLink[];
  readonly schemas: readonly unknown[];
  readonly seams: readonly unknown[];
  readonly errorCodes: readonly string[];
  readonly version: number;
  readonly rev: number;
  readonly couldIndex: boolean;
  readonly band: KnowledgeBand;
  readonly tokenCost: number;
}

export interface PullCallContext {
  readonly attemptId: string;
  readonly taskId: string;
  readonly projectId: string;
  readonly waveId: string;
  readonly waveIndex: number;
  readonly turnId: string;
  readonly taskTags: readonly string[];
  readonly workerLevel: WorkerLevel;
  readonly leaseEpoch?: number;
  readonly currentMustTokens?: number;
}

export interface Clock {
  now(): number;
}

export const KB_TOOLS: readonly KbToolName[] = [
  "kb.search",
  "kb.get_node",
  "kb.get_contract",
  "kb.list_rules_for_tags",
];

/** Per-turn pull ceiling from Task 089. 24 KB of returned text. */
export const MAX_PULL_CALLS_PER_TURN = 25;
export const MAX_PULL_BYTES_PER_TURN = 24 * 1024;

export const PULL_BUDGET_CODE = "PULL_BUDGET_EXCEEDED";
export const PULL_BUDGET_MESSAGE =
  "Pull quota reached; proceed with current context or escalate via harness.ask_owner if key context is missing";

export const NOT_FOUND_CODE = "NOT_FOUND";
export const NOT_FOUND_MESSAGE = "Not found";

/** Repeated-pull promotion threshold: distinct tasks that share a tag. */
export const PULL_TAG_TASK_THRESHOLD = 3;
/** Wave promotion threshold: 40% of tasks in the wave, compared in integers. */
export const PULL_WAVE_RATIO_NUMERATOR = 2;
export const PULL_WAVE_RATIO_DENOMINATOR = 5;
/** Recurring zero-hit searches that become one gap finding. */
export const NEGATIVE_SEARCH_THRESHOLD = 3;
