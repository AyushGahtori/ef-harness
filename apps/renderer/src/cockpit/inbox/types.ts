export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CADENCE_LANES = ["interrupt_now", "batch", "fyi"] as const;
export type CadenceLane = (typeof CADENCE_LANES)[number];

export const INTERRUPT_CONDITIONS = [
  "stop",
  "budget",
  "auth_expiry",
  "disk_red",
  "breaking_stop",
] as const;
export type InterruptCondition = (typeof INTERRUPT_CONDITIONS)[number];

export const CARD_TYPES = [
  "decision",
  "secret",
  "tool",
  "account",
  "approval",
  "review",
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const BATCH_SUBJECTS = ["question", "decision", "update", "action"] as const;
export type BatchSubject = (typeof BATCH_SUBJECTS)[number];

export const CALM_BATCH_MS = 10 * 60 * 1000;
export const INTERRUPTION_BUDGET_PER_HOUR = 4;
export const INTERRUPTION_WINDOW_MS = 60 * 60 * 1000;
export const SNOOZE_MS = 30 * 60 * 1000;

export const ZEN_MESSAGE = "Nothing needs you right now · Build is moving smoothly";
export const SNOOZE_LABEL = "Pause routine questions for 30 min";
export const STALE_VS_CODE_PROMPT = "Already resolved via VS Code — Keep or Change?";
export const LIVE_KEY_REFUSAL =
  "Live key refused for test scope — use sk_test_ or local mock";
export const RETIRED_LABEL = "Resolved / Retired";
export const AUTH_EXPIRY_TOAST = "EF Harness needs you: ChatGPT sign-in expired";
export const OPTIONS_CHANGED_PROMPT = "Options changed — Keep or Change?";

export const INK = "#1c1917";
export const PAPER = "#fafaf9";
export const MUTED = "#44403c";
export const DANGER_INK = "#7f1d1d";
export const DANGER_PAPER = "#fef2f2";

export type EnvScope = "test" | "dev" | "staging" | "prod";
export type ToolName = "Docker Desktop" | "Playwright Chromium" | "gh" | "node";
export type AccountProvider = "ChatGPT Plus" | "GitHub Copilot" | "Cursor" | "Vercel" | "GitHub";
export type ApprovalSideEffect =
  | "push_branch"
  | "open_pr"
  | "deploy_staging"
  | "deploy_prod"
  | "destructive_migration"
  | "npm_dependency"
  | "breaking_ccr";
export type ReviewSource =
  | "spec_proposal"
  | "markdown_conflict"
  | "landing_summary"
  | "visual_baseline";
export type HonestyBadge = "Verified" | "Attested";
export type WindowPresence = "foreground" | "background" | "minimized";
export type ReleaseReason = "interrupt" | "window" | "early_flush" | "manual";
export type CardStatus = "queued" | "surfaced" | "fyi" | "retired";

export interface ProvenanceLink {
  readonly label: string;
  readonly href: string;
}

export interface DecisionOption {
  number: number;
  id: string;
  label: string;
  recommended: boolean;
}

export interface ReviewItem {
  id: string;
  title: string;
  summary: string;
  disposition: "pending" | "approved" | "rejected" | "editing";
}

export interface DecisionPayload {
  kind: "decision";
  questionId: string;
  selectedOptionId: string | null;
}

export interface SecretPayload {
  kind: "secret";
  secretName: string;
  envScope: EnvScope;
  mockAvailable: boolean;
  refusalMessage: string | null;
  inputLength: number;
  saved: boolean;
  secretId: string | null;
  probeStatus: "idle" | "verified" | "failed";
}

export interface ToolPayload {
  kind: "tool";
  toolName: ToolName;
  diagnosis: string;
  commandPreview: string;
  badge: HonestyBadge;
  stepId: string;
}

export interface AccountPayload {
  kind: "account";
  provider: AccountProvider;
  allowanceResetLabel: string | null;
  toastBody: string;
}

export interface ApprovalPayload {
  kind: "approval";
  sideEffect: ApprovalSideEffect;
  impactSummary: string;
  decision: "pending" | "approved" | "declined" | "editing";
}

export interface ReviewPayload {
  kind: "review";
  groupKey: string;
  source: ReviewSource;
  expanded: boolean;
  items: ReviewItem[];
}

export type CardPayload =
  | DecisionPayload
  | SecretPayload
  | ToolPayload
  | AccountPayload
  | ApprovalPayload
  | ReviewPayload;

export interface InboxCard {
  id: string;
  type: CardType;
  priority: Priority;
  condition: InterruptCondition | null;
  title: string;
  whyThisMatters: string;
  blockingLabel: string;
  blockedTaskCount: number;
  provenance: ProvenanceLink;
  createdAt: number;
  subscribers: string[];
  onCriticalPath: boolean;
  optionsVersion: number;
  options: DecisionOption[];
  status: CardStatus;
  lane: CadenceLane;
  subject: BatchSubject;
  inlinePrompt: string | null;
  pendingOptionId: string | null;
  settledOptionId: string | null;
  retiredBy: "vscode" | "feature_undo" | null;
  motion: "none" | "retire-to-history";
  historyLabel: string | null;
  payload: CardPayload;
  needsAction: boolean;
  elementKey: string;
  groupKey: string | null;
}

export interface CardDraft {
  readonly id: string;
  readonly type: CardType;
  readonly priority: Priority;
  readonly title: string;
  readonly provenance: ProvenanceLink;
  readonly condition?: InterruptCondition;
  readonly subject?: BatchSubject;
  readonly blockedTaskIds?: readonly string[];
  readonly onCriticalPath?: boolean;
  readonly options?: readonly {
    readonly id: string;
    readonly label: string;
    readonly recommended?: boolean;
  }[];
  readonly optionsVersion?: number;
  readonly groupKey?: string;
  readonly secretName?: string;
  readonly envScope?: EnvScope;
  readonly mockAvailable?: boolean;
  readonly toolName?: ToolName;
  readonly diagnosis?: string;
  readonly commandPreview?: string;
  readonly badge?: HonestyBadge;
  readonly stepId?: string;
  readonly provider?: AccountProvider;
  readonly allowanceResetLabel?: string;
  readonly toastBody?: string;
  readonly sideEffect?: ApprovalSideEffect;
  readonly impactSummary?: string;
  readonly reviewSource?: ReviewSource;
  readonly reviewItemTitle?: string;
  readonly reviewItemSummary?: string;
}

export interface VProps {
  readonly id?: string;
  readonly role?: string;
  readonly ariaLabel?: string;
  readonly ariaExpanded?: boolean;
  readonly ariaPressed?: boolean;
  readonly ariaLive?: "off" | "polite";
  readonly href?: string;
  readonly tabIndex?: number;
  readonly inputType?: "password" | "text";
  readonly fg?: string;
  readonly bg?: string;
  readonly cardId?: string;
  readonly indicator?: "subtle";
  readonly titleLines?: 1;
  readonly action?: string;
  readonly primary?: boolean;
  readonly minTargetPx?: number;
  readonly valueLength?: number;
  readonly dataState?: string;
}

export type VChild = VNode | string;

export interface VNode {
  readonly type: string;
  readonly props: VProps;
  readonly children: readonly VChild[];
  readonly key?: string;
}

export interface AxeViolation {
  readonly id: string;
  readonly impact: "critical" | "serious" | "moderate" | "minor";
  readonly message: string;
}

export interface AxeReport {
  readonly violations: readonly AxeViolation[];
  readonly seriousOrCritical: readonly AxeViolation[];
}

export function isInterruptCondition(value: string): value is InterruptCondition {
  return (INTERRUPT_CONDITIONS as readonly string[]).includes(value);
}
