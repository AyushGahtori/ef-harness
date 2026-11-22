export const CALM_BATCH_MS = 10 * 60 * 1000;
export const AGING_NUDGE_MS = 30 * 60 * 1000;
export const INBOX_HOLD_REASON = "inbox_question";
export const HUMAN_QUEUE_OWNER = "developer";
export const ALREADY_SAVED_MESSAGE = "Already saved via your edit — nothing changed" as const;
export const VS_CODE_STALE_PROMPT = "Keep VS Code edit or apply this reply?" as const;
export const VS_CODE_EDITOR = "VS Code edit";
export const FEATURE_UNDO_ACTOR = "feature undo";

export const PRIORITY_TIERS = ["P0", "P1", "P2", "P3", "P4"] as const;
export type PriorityTier = (typeof PRIORITY_TIERS)[number];

export const PRIORITY_RANK: Record<PriorityTier, number> = {
  P0: 4,
  P1: 3,
  P2: 2,
  P3: 1,
  P4: 0,
};

export const QUESTION_KINDS = [
  "technical",
  "product",
  "secret",
  "approval",
  "human_step",
  "dispute_test",
  "breaking_ccr",
  "conflict",
  "ambiguous_steering",
  "escalation",
  "advisory",
] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const HUMAN_REASONS = [
  "unsettled_product_behavior",
  "ambiguous_steering",
  "breaking_ccr",
  "secret",
  "approval",
  "human_step",
  "dispute_test",
  "unresolvable_escalation",
  "advisory",
] as const;
export type HumanReason = (typeof HUMAN_REASONS)[number];

export const QUESTION_STATUSES = ["open", "answered", "superseded", "dismissed", "retired"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const SETTLED_SOURCES = ["decision", "contract", "rule", "entity_schema"] as const;
export type SettledSource = (typeof SETTLED_SOURCES)[number];

export const OUTBOX_CONSUMERS = ["exporter", "ui_projection"] as const;

export const DEVELOPER_OWNER_ROLES = new Set(["developer", "user", "user-inbox", "human"]);
