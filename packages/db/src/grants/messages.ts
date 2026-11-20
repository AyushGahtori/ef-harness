export const GRANT_PRIORITY_CLASSES = [
  "interactive",
  "foreground",
  "background",
  "batch",
] as const;

export type GrantPriorityClass = (typeof GRANT_PRIORITY_CLASSES)[number];

export function isGrantPriorityClass(value: string): value is GrantPriorityClass {
  return (GRANT_PRIORITY_CLASSES as readonly string[]).includes(value);
}

export type GrantCloseReason = "expired" | "nearing_expiry" | "recalled";

export interface GrantIssuedMessage {
  readonly type: "GrantIssued";
  readonly grantId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: string;
  readonly units: number;
  readonly concurrency: number;
  readonly priorityClass: GrantPriorityClass;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface GrantDepositedAck {
  readonly type: "GrantDepositedAck";
  readonly grantId: string;
}

export interface GrantClosureReport {
  readonly type: "GrantClosureReport";
  readonly grantId: string;
  readonly usedUnits: number;
  readonly unknownUnits: number;
}

export interface GrantUnknownReconciledMessage {
  readonly type: "GrantUnknownReconciled";
  readonly grantId: string;
  readonly usedUnits: number;
  readonly unknownUnits: number;
}

export type GrantProtocolMessage =
  | GrantIssuedMessage
  | GrantDepositedAck
  | GrantClosureReport
  | GrantUnknownReconciledMessage;

export interface GrantMessageSink {
  deliver(message: GrantProtocolMessage): void | Promise<void>;
}

export interface IssueGrantInput {
  readonly grantId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly currency: string;
  readonly units: number;
  readonly concurrency: number;
  readonly priorityClass: GrantPriorityClass;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface ClosureRecording {
  readonly grantId: string;
  readonly idempotent: boolean;
  readonly usedUnits: number;
  readonly unknownUnits: number;
  readonly unusedUnitsReturned: number;
  readonly state: "closed";
  readonly recordedAt: number;
}

export interface UnknownReconciliationRecording {
  readonly grantId: string;
  readonly idempotent: boolean;
  readonly usedUnits: number;
  readonly unknownUnits: number;
  readonly windowDelta: number;
}

export interface DepositAckResult {
  readonly grantId: string;
  readonly state: "issued" | "deposited" | "closed" | "expired";
  readonly changed: boolean;
}

export interface ExpiredGrant {
  readonly grantId: string;
  readonly projectId: string;
  readonly connectionId: string;
  readonly units: number;
  readonly usedUnits: number;
}

export interface ReleasedGrant {
  readonly grantId: string;
  readonly unitsReturned: number;
  readonly state: "expired";
}

export type CloseGrantResult =
  | {
      readonly status: "waiting_for_held";
      readonly grantId: string;
      readonly heldCount: number;
    }
  | {
      readonly status: "reported";
      readonly grantId: string;
      readonly report: GrantClosureReport;
    }
  | {
      readonly status: "already_reported";
      readonly grantId: string;
    };
