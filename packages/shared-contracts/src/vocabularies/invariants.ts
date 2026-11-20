import {
  CRITERION_STATUSES,
  SETTLED_BASES,
  type CriterionStatus,
  type SettledBasis,
} from "./basis-status.js";
import {
  CHANGE_CLASSES,
  EDGE_TYPES,
  EFFECT_STATES,
  FEATURE_STATES,
  HOLD_REASONS,
  INBOX_KINDS,
  NODE_KINDS,
  PRIORITY_CLASSES,
  PROJECT_STATES,
  RETENTION_CLASSES,
  TASK_STATES,
  type TaskState,
} from "./lookups.js";
import { NAME_KINDS } from "./names.js";
import {
  MODEL_LEVELS,
  PROJECT_STAGES,
  RUNTIME_COST_CLASSES,
  RUNTIME_MODES,
  SANDBOX_TIERS,
} from "./stages.js";
import { TOUCHES_TAG_GROUPS, TOUCHES_TAGS } from "./touches.js";
import { USD_MICRO_SCALE, WINDOW_SHARE_PPM_SCALE } from "./currency.js";

type Expect<T extends true> = T;
type IsNever<T> = [T] extends [never] ? true : false;
type Probe<T> = <P>() => P extends T ? 1 : 2;
type Equal<A, B> = Probe<A> extends Probe<B> ? true : false;
type Len<T extends readonly unknown[], N extends number> = T["length"] extends N ? true : false;

type VocabularyInvariantChecks = Expect<IsNever<Extract<SettledBasis, CriterionStatus>>> &
  Expect<IsNever<Extract<SettledBasis, "asked" | "open" | "chosen under delegation">>> &
  Expect<IsNever<Extract<CriterionStatus, SettledBasis>>> &
  Expect<IsNever<Extract<TaskState, "HELD" | "held">>> &
  Expect<
    Equal<
      SettledBasis,
      "explicit" | "derived" | "delegated" | "defaulted" | "proposed" | "observed"
    >
  > &
  Expect<
    Equal<
      CriterionStatus,
      | "open"
      | "partial"
      | "missing"
      | "conflict"
      | "asked"
      | "deferred"
      | "not_applicable"
      | "settled"
    >
  > &
  Len<typeof NODE_KINDS, 17> &
  Len<typeof EDGE_TYPES, 14> &
  Len<typeof TASK_STATES, 15> &
  Len<typeof FEATURE_STATES, 13> &
  Len<typeof PROJECT_STATES, 10> &
  Len<typeof CHANGE_CLASSES, 6> &
  Len<typeof HOLD_REASONS, 5> &
  Len<typeof INBOX_KINDS, 6> &
  Len<typeof EFFECT_STATES, 6> &
  Len<typeof RETENTION_CLASSES, 4> &
  Len<typeof PRIORITY_CLASSES, 4> &
  Len<typeof SETTLED_BASES, 6> &
  Len<typeof CRITERION_STATUSES, 8> &
  Len<typeof TOUCHES_TAGS, 28> &
  Len<typeof TOUCHES_TAG_GROUPS, 7> &
  Len<typeof NAME_KINDS, 17> &
  Len<typeof PROJECT_STAGES, 3> &
  Len<typeof MODEL_LEVELS, 4> &
  Len<typeof SANDBOX_TIERS, 5> &
  Len<typeof RUNTIME_MODES, 3> &
  Len<typeof RUNTIME_COST_CLASSES, 2> &
  Expect<typeof USD_MICRO_SCALE extends typeof WINDOW_SHARE_PPM_SCALE ? true : false>;

export const vocabularyInvariantsSatisfied: VocabularyInvariantChecks = true;

export const vocabularyCounts = {
  nodeKinds: NODE_KINDS.length,
  edgeTypes: EDGE_TYPES.length,
  taskStates: TASK_STATES.length,
  featureStates: FEATURE_STATES.length,
  projectStates: PROJECT_STATES.length,
  changeClasses: CHANGE_CLASSES.length,
  holdReasons: HOLD_REASONS.length,
  inboxKinds: INBOX_KINDS.length,
  effectStates: EFFECT_STATES.length,
  retentionClasses: RETENTION_CLASSES.length,
  priorityClasses: PRIORITY_CLASSES.length,
  settledBases: SETTLED_BASES.length,
  criterionStatuses: CRITERION_STATUSES.length,
  touchesTags: TOUCHES_TAGS.length,
  touchesGroups: TOUCHES_TAG_GROUPS.length,
  nameKinds: NAME_KINDS.length,
  projectStages: PROJECT_STAGES.length,
  modelLevels: MODEL_LEVELS.length,
  sandboxTiers: SANDBOX_TIERS.length,
  runtimeModes: RUNTIME_MODES.length,
  runtimeCostClasses: RUNTIME_COST_CLASSES.length,
} as const;
