import type {
  CheckpointStopCardRequest,
  DiskHeadroomCard,
  SubscriptionWeightFeed,
} from "./types.js";

/** Task 128 local port. The real `BudgetWindDownController` is not on this base. */
export interface WindDownObservation {
  readonly connectionId: string;
  readonly projectId: string;
  readonly usedPpm: number;
  readonly ceilingPpm: number;
  readonly windDownPpm: number;
  readonly resetAtMs: number | null;
  readonly phase: "wind_down" | "ceiling";
}

export interface BudgetWindDownPort {
  observe(observation: WindDownObservation): void;
  openCheckpointStopCard(card: CheckpointStopCardRequest): void;
  openDiskHeadroomCard(card: DiskHeadroomCard): void;
}

/** Task 023 local port. Currency is allowance ppm, not micro-USD. */
export interface BudgetLedgerPort {
  reserve(input: {
    readonly connectionId: string;
    readonly projectId: string;
    readonly taskId: string;
    readonly ppm: number;
  }): { readonly reservationId: string };
  settle(reservationId: string, actualPpm: number): void;
  release(reservationId: string): void;
}

/** Task 125 local port. The countdown string is the board health line. */
export interface BoardHealthPort {
  showCountdown(message: string): void;
}

/** Task 106 / Task 108 local port. Receives calibrated k[model] after each quota sample. */
export interface AllowanceWeightSink {
  publish(weights: readonly SubscriptionWeightFeed[]): void;
}

/** Task 135 local port. Signed policy priors seed k[model] before any live quota sample. */
export interface SignedPolicyPriorPort {
  priorPpmPer1k(connectionId: string, modelId: string): number | null;
}

export class RecordingBudgetLedger implements BudgetLedgerPort {
  private seq = 0;
  readonly events: { kind: "reserve" | "settle" | "release"; id: string; ppm: number }[] = [];

  reserve(input: {
    connectionId: string;
    projectId: string;
    taskId: string;
    ppm: number;
  }): { reservationId: string } {
    this.seq += 1;
    const reservationId = `ledger-${input.connectionId}-${this.seq}`;
    this.events.push({ kind: "reserve", id: reservationId, ppm: input.ppm });
    return { reservationId };
  }

  settle(reservationId: string, actualPpm: number): void {
    this.events.push({ kind: "settle", id: reservationId, ppm: actualPpm });
  }

  release(reservationId: string): void {
    this.events.push({ kind: "release", id: reservationId, ppm: 0 });
  }
}

export class RecordingWindDown implements BudgetWindDownPort {
  readonly observations: WindDownObservation[] = [];
  readonly cards: CheckpointStopCardRequest[] = [];
  readonly diskCards: DiskHeadroomCard[] = [];

  observe(observation: WindDownObservation): void {
    this.observations.push(observation);
  }

  openCheckpointStopCard(card: CheckpointStopCardRequest): void {
    this.cards.push(card);
  }

  openDiskHeadroomCard(card: DiskHeadroomCard): void {
    this.diskCards.push(card);
  }
}

export class RecordingBoardHealth implements BoardHealthPort {
  readonly messages: string[] = [];

  showCountdown(message: string): void {
    this.messages.push(message);
  }
}

export class RecordingAllowanceWeightSink implements AllowanceWeightSink {
  weights: readonly SubscriptionWeightFeed[] = [];

  publish(weights: readonly SubscriptionWeightFeed[]): void {
    this.weights = weights;
  }
}
