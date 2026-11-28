import { INTERACTIVE_ROLES, INTERACTIVE_SLOT_COUNT } from "./constants.js";
import { PacingError } from "./errors.js";
import type { SlotKind, SlotSnapshot } from "./types.js";

const INTERACTIVE = new Set<string>(INTERACTIVE_ROLES);

export function isInteractiveRequest(role: string, priority: "interactive" | "background"): boolean {
  return priority === "interactive" || INTERACTIVE.has(role);
}

/**
 * One lightweight slot that background workers cannot occupy.
 * Discovery, Canvas Q&A, and steering stay ahead of a full cwnd of coding workers.
 */
export class InteractivePrioritySlot {
  private backgroundInFlight: number;
  private interactiveInFlight: number;

  constructor(snapshot: SlotSnapshot = { backgroundInFlight: 0, interactiveInFlight: 0 }) {
    this.backgroundInFlight = snapshot.backgroundInFlight;
    this.interactiveInFlight = snapshot.interactiveInFlight;
  }

  static restore(snapshot: SlotSnapshot): InteractivePrioritySlot {
    return new InteractivePrioritySlot(snapshot);
  }

  snapshot(): SlotSnapshot {
    return {
      backgroundInFlight: this.backgroundInFlight,
      interactiveInFlight: this.interactiveInFlight,
    };
  }

  tryAcquire(kind: SlotKind, backgroundCap: number): boolean {
    if (kind === "interactive") {
      if (this.interactiveInFlight >= INTERACTIVE_SLOT_COUNT) return false;
      this.interactiveInFlight += 1;
      return true;
    }
    if (backgroundCap <= 0 || this.backgroundInFlight >= backgroundCap) return false;
    this.backgroundInFlight += 1;
    return true;
  }

  release(kind: SlotKind): void {
    if (kind === "interactive") {
      if (this.interactiveInFlight <= 0) {
        throw new PacingError("slot_underflow", "No interactive slot is in flight.");
      }
      this.interactiveInFlight -= 1;
      return;
    }
    if (this.backgroundInFlight <= 0) {
      throw new PacingError("slot_underflow", "No background slot is in flight.");
    }
    this.backgroundInFlight -= 1;
  }
}
