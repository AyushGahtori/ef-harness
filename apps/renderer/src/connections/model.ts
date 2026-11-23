import type { RoleId } from "./catalog.js";

export interface HealthRowModel {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly authMode: string;
  readonly billingTypeBadge: "Subscription" | "Pay-per-token" | "Local Free";
  readonly maskedKeyOrEmail: string;
  readonly statusBadge: string;
  readonly allowanceLabel: string;
  readonly allowanceRatio: number;
  readonly activeCwnd: number;
  readonly expiryWarning: string | null;
  readonly conformanceStatus: string | null;
  readonly reservePercent: number | null;
  readonly softCap: string | null;
  readonly hardCap: string | null;
  readonly paused: boolean;
  readonly testFocusId: string;
  readonly refreshFocusId: string;
  readonly pauseFocusId: string;
  readonly removeFocusId: string;
}

export interface CardModel {
  readonly id: string;
  readonly title: string;
  readonly focusId: string;
}

export interface RoleModel {
  readonly id: RoleId;
  readonly label: string;
  readonly connectionId: string | null;
  readonly connectionLabel: string | null;
  readonly focusId: string;
}

export interface StopCardModel {
  readonly message: string;
  readonly costEstimate: string;
  readonly action: "Switch Connection";
  readonly parked: true;
}

export interface DrawerModel {
  readonly connectionId: string;
  readonly kind: "zero-token" | "conformance";
  readonly latencyMs: number;
  readonly discoveredModelCount: number;
  readonly diagnostic: string;
}

export interface ConnectionsViewModel {
  readonly routeId: "settings/connections";
  readonly themeName: "light" | "dark";
  readonly layout: "stacked" | "split";
  readonly cards: readonly CardModel[];
  readonly geminiEnabled: boolean;
  readonly geminiNoticeAccepted: boolean;
  readonly geminiNotice: string;
  readonly geminiInvocation: string;
  readonly geminiCompliance: "allowed" | "opt_in_with_notice" | "disabled_by_policy" | "route_revoked";
  readonly geminiBlockReason: string | null;
  readonly claudeCodeNotice: string;
  readonly rows: readonly HealthRowModel[];
  readonly neverFallbackWithoutAsking: boolean;
  readonly loudWarning: string | null;
  readonly roles: readonly RoleModel[];
  readonly oracleNote: string | null;
  readonly banner: string | null;
  readonly resumeBlocked: boolean;
  readonly activeConnectionId: string | null;
  readonly danglingConnectionIds: readonly string[];
  readonly detectedProvider: string | null;
  readonly maskedDraft: string | null;
  readonly holdingSecret: boolean;
  readonly drawer: DrawerModel | null;
  readonly stopCard: StopCardModel | null;
  readonly focusId: string;
  readonly focusOrder: readonly string[];
}
