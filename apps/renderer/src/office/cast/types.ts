/**
 * Canonical office-cast shapes.
 * Room ids mirror Task 162's 11-room floor plan until that branch is wired.
 * Crew tiers mirror Task 106. Health kinds mirror Task 125. Lanes mirror Task 124.
 */

export const ROOM_IDS = [
  "ceo-office",
  "front-desk",
  "discovery-lounge",
  "research-library",
  "architecture-studio",
  "planning-war-room",
  "engineering-bullpen",
  "qa-lab",
  "integration-merge-bay",
  "shipping-dock",
  "break-room",
] as const;

export type RoomId = (typeof ROOM_IDS)[number];

export type OfficeWorkerRole =
  | "discovery"
  | "spec"
  | "researcher"
  | "architect"
  | "planner"
  | "coder"
  | "verifier"
  | "integrator"
  | "ship"
  | "ci";

export type CrewTier = "junior" | "mid" | "senior" | "principal" | "architect" | "integrator";

export type TierLabel = "Jr" | "Mid" | "Sr" | "Principal";

export type WorkerStatus =
  | "queued"
  | "thinking"
  | "waiting-run-slot"
  | "running"
  | "verifying"
  | "integrating"
  | "passed"
  | "done"
  | "held"
  | "waiting-on-you"
  | "paused"
  | "idle"
  | "parked"
  | "allowance-waiting"
  | "looping";

export type BoardLane =
  | "Queued"
  | "Working"
  | "Waiting on You"
  | "Held"
  | "Verifying"
  | "Integrating"
  | "Done";

export type HealthSignalKind =
  | "stuck_no_progress"
  | "loop_detected"
  | "rate_limited_backoff"
  | "allowance_window_wait"
  | "escalated_or_retrying"
  | "waiting_on_you";

export type OverheadIconId =
  | "typing-dots"
  | "hourglass"
  | "green-check"
  | "raised-hand"
  | "pause-bars"
  | "amber-clock"
  | "spinning-loop"
  | "coffee-cup";

export type InboxCardKind = "Decision" | "Approval" | "Secret" | "Tool" | "Account" | "Review";

export type IntakeKind = "prd" | "pdf" | "openapi" | "logo" | "svg" | "har" | "docx";

export interface OfficeHealthSignal {
  readonly kind: HealthSignalKind;
  readonly label: string;
}

export interface OfficeHelperRecord {
  readonly helperId: string;
  readonly leadAgentId: string;
  readonly kind: string;
}

export interface OfficePoolSlot {
  readonly index: number;
  readonly capacity: number;
}

export interface OfficeWorkerRecord {
  readonly agentId: string;
  readonly taskId: string;
  readonly taskTitle: string;
  readonly role: OfficeWorkerRole;
  readonly tier: CrewTier;
  readonly status: WorkerStatus;
  readonly connection: string;
  readonly modelName: string;
  readonly elapsedSeconds: number;
  readonly featureId?: string;
  readonly featureTitle?: string;
  readonly health?: OfficeHealthSignal;
  readonly poolSlot?: OfficePoolSlot;
  readonly commandLabel?: string;
  readonly queuePosition?: number;
  readonly holdReason?: string;
  readonly flagged?: boolean;
  readonly helpers?: readonly OfficeHelperRecord[];
}

export interface OfficeInboxCard {
  readonly cardId: string;
  readonly kind: InboxCardKind;
  readonly title: string;
  readonly actionable: boolean;
  readonly resolved: boolean;
  readonly priority: number;
}

export interface OfficeIntakeItem {
  readonly itemId: string;
  readonly kind: IntakeKind;
  readonly fileName: string;
  readonly phase: "scanning" | "ingested";
}

export interface OfficeFeatureRecord {
  readonly featureId: string;
  readonly title: string;
  readonly done: number;
  readonly total: number;
}

/** Slice of live state.db the cast is allowed to draw. */
export interface OfficeCanonicalSnapshot {
  readonly workers: readonly OfficeWorkerRecord[];
  readonly inboxCards: readonly OfficeInboxCard[];
  readonly intakeItems: readonly OfficeIntakeItem[];
  readonly features: readonly OfficeFeatureRecord[];
  /** Pool 2 warm-slot count from Task 119. Clamped to the 2–4 QA test rigs. */
  readonly pool2SlotCapacity?: number;
}

export interface OfficeViewState {
  readonly zoom: number;
  readonly hoveredAgentId?: string;
  readonly selectedAgentId?: string;
}

export interface AgentOfficeTag {
  readonly agentId: string;
  readonly shortTitle: string;
  readonly fullTitle: string;
  readonly text: string;
  readonly maxChars: 22;
}

export interface ConnectionPin {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly colorHex: string;
  readonly shape: string;
}

export interface RankOutfit {
  readonly id: string;
  readonly tierLabel: TierLabel;
  readonly garments: readonly string[];
  readonly props: readonly string[];
}

export interface OverheadIconVisual {
  readonly icon: OverheadIconId | null;
  readonly frameLagMs: 0;
  readonly delayedByWalk: false;
}

export interface SeatedCastMember {
  readonly source: "state.db";
  readonly agentId: string;
  readonly taskId: string;
  readonly roomId: RoomId;
  readonly deskIndex: number;
  readonly rigIndex: number | null;
  readonly x: number;
  readonly y: number;
  readonly outfit: RankOutfit;
  readonly tag: AgentOfficeTag;
  readonly pin: ConnectionPin;
  readonly overhead: OverheadIconVisual;
  readonly boardLane: BoardLane;
  readonly flagged: boolean;
  readonly status: WorkerStatus;
  readonly featureId: string | null;
}

export interface VisibleHelperSprite {
  readonly source: "state.db";
  readonly helperId: string;
  readonly leadAgentId: string;
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly index: number;
}

export interface HelperCountPill {
  readonly leadAgentId: string;
  readonly text: string;
  readonly hiddenCount: number;
  readonly visibleCount: 3;
  readonly x: number;
  readonly y: number;
}

export interface PlacedAgentLabel {
  readonly agentId: string;
  readonly taskId: string;
  readonly text: string;
  readonly fullTitle: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly visible: boolean;
  readonly culled: boolean;
  readonly protected: boolean;
  readonly z: number;
}

export interface DeskPinVisual {
  readonly agentId: string;
  readonly taskId: string;
  readonly roomId: RoomId;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly colorHex: string;
  readonly shape: string;
  readonly label: string;
  readonly tooltipText: string;
}

export interface FeaturePodPlinth {
  readonly featureId: string;
  readonly roomId: "engineering-bullpen";
  readonly text: string;
  readonly title: string;
  readonly done: number;
  readonly total: number;
  readonly x: number;
  readonly y: number;
  readonly occupiedDeskCount: number;
}

export interface TestRigVisual {
  readonly roomId: "qa-lab";
  readonly rigIndex: number;
  readonly glowing: boolean;
  readonly occupantAgentId: string | null;
  readonly x: number;
  readonly y: number;
}

export interface PaperSlipVisual {
  readonly cardId: string;
  readonly kind: InboxCardKind;
  readonly title: string;
}

export interface CeoTrayVisual {
  readonly roomId: "ceo-office";
  readonly clean: boolean;
  readonly slipCount: number;
  readonly stackHeight: number;
  readonly overflow: boolean;
  readonly unreadBadge: number;
  readonly slips: readonly PaperSlipVisual[];
}

export interface FrontDeskParcelVisual {
  readonly roomId: "front-desk";
  readonly stackCount: 1;
  readonly itemCount: number;
  readonly label: string;
  readonly itemIds: readonly string[];
}

export interface OfficeCastScene {
  readonly rooms: readonly RoomId[];
  readonly seats: readonly SeatedCastMember[];
  readonly helpers: readonly VisibleHelperSprite[];
  readonly helperPills: readonly HelperCountPill[];
  readonly labels: readonly PlacedAgentLabel[];
  readonly pins: readonly DeskPinVisual[];
  readonly pods: readonly FeaturePodPlinth[];
  readonly rigs: readonly TestRigVisual[];
  readonly tray: CeoTrayVisual;
  readonly parcel: FrontDeskParcelVisual | null;
  readonly idle: boolean;
  readonly phantomSpriteCount: number;
  /** Icons are applied on the projection frame. There is no walk queue. */
  readonly walkQueues: readonly [];
}
