import type { CheckpointStopCard, FallbackBlockedError } from "./types.js";

export class FallbackBlockedNeedsConsentError extends Error implements FallbackBlockedError {
  override readonly name = "FallbackBlockedNeedsConsentError";
  readonly code = "fallback_blocked_needs_consent" as const;
  readonly parked = true as const;
  readonly capExhausted: boolean;
  readonly card: CheckpointStopCard;

  constructor(card: CheckpointStopCard) {
    super(card.message);
    this.card = card;
    this.capExhausted = card.capExhausted;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
