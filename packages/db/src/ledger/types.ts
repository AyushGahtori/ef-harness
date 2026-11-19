export const SCOPE_KINDS = ["project", "feature", "task", "wave_paperwork", "grant"] as const;

export type ScopeKind = (typeof SCOPE_KINDS)[number];

export const RESERVATION_PURPOSES = ["model_call", "paperwork", "effect"] as const;

export type ReservationPurpose = (typeof RESERVATION_PURPOSES)[number];

export const RESERVATION_STATES = ["held", "settled", "released", "unknown"] as const;

export type ReservationState = (typeof RESERVATION_STATES)[number];

export interface ScopeRef {
  scopeKind: ScopeKind;
  scopeId: string;
}

export interface RegisteredCurrency {
  code: string;
  unit: string;
  scale: number;
}

export interface BudgetScopeRecord {
  scopeKind: ScopeKind;
  scopeId: string;
  currency: string;
  limitUnits: number;
  reservedUnits: number;
  spentUnits: number;
  closed: boolean;
  parentKind: ScopeKind | null;
  parentId: string | null;
}

export interface CreateBudgetScopeInput {
  scopeKind: ScopeKind;
  scopeId: string;
  currency: string;
  limitUnits: number;
  parentKind?: ScopeKind;
  parentId?: string;
}

export interface ReserveAcrossScopesInput {
  reservationId: string;
  purpose: ReservationPurpose;
  currency: string;
  amountUnits: number;
  scopeKind: ScopeKind;
  scopeId: string;
  additionalScopes?: readonly ScopeRef[];
  createdAt: number;
  attemptId?: string;
  /** When set, a paperwork draw on a later wave is borrowing. */
  activeWaveId?: string;
  crossWaveBorrowApproved?: boolean;
}

export interface ReservationHandle {
  reservationId: string;
  purpose: ReservationPurpose;
  currency: string;
  amountUnits: number;
  scopes: readonly ScopeRef[];
  state: "held";
  taskClass?: string;
  estimateKind?: "p95_stream_cutoff";
}

export type ReserveResult =
  | { ok: true; reservation: ReservationHandle }
  | { ok: false; blockingScopes: readonly string[] };

export interface SettleReservationInput {
  reservationId: string;
  actualUnits: number;
  now: number;
}

export type SettleResult =
  | {
      ok: true;
      idempotent: boolean;
      reservationId: string;
      amountUnits: number;
      actualUnits: number;
      overrunUnits: number;
    }
  | { ok: false; reason: "missing" | "already_settled" | "already_released" | "not_open" };

export type ReleaseResult =
  | { ok: true; reservationId: string }
  | {
      ok: false;
      reason: "missing" | "not_held" | "unknown_retained" | "already_released" | "already_settled";
    };

export type MarkUnknownResult =
  | { ok: true; reservationId: string; idempotent: boolean }
  | { ok: false; reason: "missing" | "not_held" };

export interface ReconcileUnknownInput {
  reservationId: string;
  resolution: "settle" | "release";
  now: number;
  actualUnits?: number;
}

export type ReconcileUnknownResult =
  | { ok: true; resolution: "settle"; settle: Extract<SettleResult, { ok: true }> }
  | { ok: true; resolution: "release"; reservationId: string }
  | { ok: false; reason: "missing" | "not_unknown" };

export interface BudgetRemainingRow {
  scopeKind: ScopeKind;
  scopeId: string;
  currency: string;
  limitUnits: number;
  reservedUnits: number;
  spentUnits: number;
  remainingUnits: number;
  overrun: boolean;
}

export interface ThresholdCrossedEvent {
  scopeKind: ScopeKind;
  scopeId: string;
  currency: string;
  thresholdPercent: 50 | 80 | 90 | 100;
  level: "alert" | "wind_down" | "stopped";
  stopNewDispatches: boolean;
  keepCheckpointReserve: boolean;
  parkAttempts: boolean;
  limitUnits: number;
  reservedUnits: number;
  spentUnits: number;
  remainingUnits: number;
  overrun: boolean;
}

export interface ReservationRecord {
  reservationId: string;
  attemptId: string | null;
  purpose: ReservationPurpose;
  currency: string;
  amountUnits: number;
  state: ReservationState;
  actualUnits: number | null;
  overrunUnits: number;
  createdAt: number;
  settledAt: number | null;
  scopes: readonly ScopeRef[];
}

export interface ReserveP95StreamCutoffInput extends Omit<ReserveAcrossScopesInput, "amountUnits"> {
  taskClass: string;
  observedOutputUnits: readonly number[];
}
